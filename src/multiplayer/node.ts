import {
  applyEvent,
  currentTarget,
  quorumSize,
  sameEventContent,
  stateHash,
  validateConfig,
  validateEvent,
} from "@/game/reducer"
import type {
  GameConfig,
  GameEvent,
  GameEventPayload,
  GameState,
  Member,
  PlayerId,
} from "@/game/types"
import { LIMITS, PLAYER_COLORS, eventId } from "@/game/types"
import type { Clock, KeyValueStore, LinkState, Transport } from "./env"
import { EventLogger, LruSet, MemoryStore, realClock } from "./env"
import type {
  CommitCertificate,
  Envelope,
  LobbyPlayer,
  LocalStatus,
  MessageType,
  PayloadOf,
  Payloads,
  Snapshot,
} from "./protocol"
import { PROTOCOL_VERSION, decode, encode } from "./protocol"

/**
 * GameNode = the multiplayer core of one peer (docs/design/04, 05, 07).
 *
 * Replication model (Raft/Paxos-lite, single outstanding entry):
 *  - One leader (Host) per term; the leader of term T is unique because it needs
 *    a quorum of votes and each peer votes at most once per term (persisted).
 *  - The leader proposes log entries one at a time at index = logIndex + 1.
 *    Peers store the proposal as `accepted` and ACK. With a quorum of ACKs
 *    (leader included) the entry is committed and broadcast with a certificate.
 *  - Only committed entries go through applyEvent(); nothing else mutates state.
 *  - A new leader collects (committed snapshot, accepted entry) from a quorum of
 *    voters, adopts the most advanced committed state and re-proposes the
 *    highest-term accepted entry at the next index. Quorum intersection
 *    guarantees no committed entry is ever lost or duplicated.
 */

export interface Timings {
  tickMs: number
  heartbeatMs: number
  peerTimeoutMs: number
  hostTimeoutMs: number
  failedGraceMs: number
  resendMs: number
  pauseAfterMs: number
  electionTimeoutMs: number
  preVoteTimeoutMs: number
  countdownMs: number
  meshRetryMs: number
  dialTimeoutMs: number
  clickTimeoutMs: number
  syncRetryMs: number
}

export const DEFAULT_TIMINGS: Timings = {
  tickMs: 100,
  heartbeatMs: 1000,
  peerTimeoutMs: 4000,
  hostTimeoutMs: 5000,
  failedGraceMs: 1500,
  resendMs: 600,
  pauseAfterMs: 2500,
  electionTimeoutMs: 3000,
  preVoteTimeoutMs: 1000,
  countdownMs: 3000,
  meshRetryMs: 2500,
  dialTimeoutMs: 15000,
  clickTimeoutMs: 3000,
  syncRetryMs: 1000,
}

export interface Identity {
  id: PlayerId
  name: string
  secretHash: string
}

export type NodeMode =
  | { kind: "host"; config: GameConfig }
  | { kind: "guest"; hostId: PlayerId }
  /** Rejoin after reload: restore persisted term/vote/state, then sync. */
  | { kind: "restore" }

export interface NodeOptions {
  roomId: string
  identity: Identity
  transport: Transport
  mode: NodeMode
  clock?: Clock
  store?: KeyValueStore
  timings?: Partial<Timings>
  logger?: EventLogger
  /** Local (non-replicated) randomness: ids, seeds, jitter. */
  random?: () => number
}

export interface LobbyView {
  hostId: PlayerId
  players: LobbyPlayer[]
  config: GameConfig
}

export interface PeerView {
  id: PlayerId
  link: LinkState
  alive: boolean
}

export interface NodeView {
  selfId: PlayerId
  roomId: string
  status: LocalStatus
  term: number
  leaderId: PlayerId | null
  isLeader: boolean
  lobby: LobbyView | null
  state: GameState | null
  members: Member[]
  countdownEndsAt: number | null
  pendingClick: { requestId: string; number: number } | null
  lastReject: { number: number; reason: string; at: number } | null
  peers: PeerView[]
  quorum: number
  aliveCount: number
  closedReason: string | null
  startBlockers: string[]
  nextConfig: GameConfig | null
}

interface Pending {
  event: GameEvent
  acks: Set<PlayerId>
  firstSentAt: number
  sentAt: Map<PlayerId, number>
}

interface Election {
  phase: "pre" | "vote"
  term: number
  votes: Map<PlayerId, PayloadOf<"ELECTION_ACK"> | true>
  deadline: number
}

interface Persisted {
  v: 1
  currentTerm: number
  votedFor: PlayerId | null
  state: GameState | null
  accepted: GameEvent | null
  cert: CommitCertificate | null
  startMembers: Member[] | null
}

type Kind = "lobby" | "game" | "closed"

const persistKey = (roomId: string, id: string) => `nh:raft:${roomId}:${id}`

export function loadPersisted(
  store: KeyValueStore,
  roomId: string,
  id: string
): Persisted | null {
  try {
    const raw = store.get(persistKey(roomId, id))
    if (!raw) return null
    const p = JSON.parse(raw) as Persisted
    return p && p.v === 1 ? p : null
  } catch {
    return null
  }
}

/** Forget the saved replication state of a player (leaving for good). */
export function clearPersisted(
  store: KeyValueStore,
  roomId: string,
  id: string
): void {
  try {
    store.remove(persistKey(roomId, id))
  } catch {
    /* ignore */
  }
}

function randomId(random: () => number, len = 10): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789"
  let s = ""
  for (let i = 0; i < len; i++) s += abc[Math.floor(random() * abc.length)]
  return s
}

export function sanitizeName(name: string): string {
  return (
    name
      .replace(/[\p{Cc}<>]/gu, "")
      .trim()
      .slice(0, LIMITS.maxNameLength) || "Player"
  )
}

export class GameNode {
  readonly id: PlayerId
  readonly roomId: string
  readonly logger: EventLogger
  private readonly identity: Identity
  private readonly t: Transport
  private readonly clock: Clock
  private readonly store: KeyValueStore
  private readonly T: Timings
  private readonly random: () => number
  private readonly nonce: string

  private kind: Kind
  private closedReason: string | null = null

  // --- replication (persisted) ---
  private currentTerm = 0
  private votedFor: PlayerId | null = null
  private state: GameState | null = null
  private accepted: GameEvent | null = null
  private cert: CommitCertificate | null = null
  /** Membership from an accepted (maybe not yet committed) GAME_STARTED. */
  private startMembers: Member[] | null = null

  // --- replication (volatile) ---
  private leaderId: PlayerId | null = null
  /** Last time the leader acted as leader (heartbeat claiming it, propose, commit, snapshot). */
  private leaderContactAt = -Infinity
  private recent: GameEvent[] = []
  private pending: Pending | null = null
  private queue: GameEventPayload[] = []
  private processed = new LruSet(4096)
  private election: Election | null = null
  private nextElectionAt = 0
  private countdownEndsAt: number | null = null
  private syncing = false
  private syncRequestedAt = -Infinity
  private desyncCount = 0
  private desync = false
  private leaderPaused = false
  private hashCache: { state: GameState; hash: string } | null = null

  // --- lobby ---
  private lobby: LobbyView | null = null
  private expectedHostId: PlayerId | null = null
  private listedInLobby = false
  private nextJoinSeq = 2
  private nextConfig: GameConfig | null = null

  // --- liveness ---
  private lastSeen = new Map<PlayerId, number>()
  private downSince = new Map<PlayerId, number>()
  private peerLinks = new Map<PlayerId, PlayerId[]>()
  private lastHeartbeatAt = -Infinity
  private lastMeshAt = -Infinity
  private dialing = new Map<PlayerId, number>()
  private seen = new LruSet(8192)
  private msgCounter = 0

  // --- local UI ---
  private pendingClick: {
    requestId: string
    number: number
    at: number
  } | null = null
  private lastReject: { number: number; reason: string; at: number } | null =
    null
  private listeners = new Set<() => void>()
  private notifyQueued = false
  private lastStatus: LocalStatus | null = null
  private timer: unknown = null
  private stopped = false

  constructor(opts: NodeOptions) {
    this.id = opts.identity.id
    this.identity = { ...opts.identity, name: sanitizeName(opts.identity.name) }
    this.roomId = opts.roomId
    this.t = opts.transport
    this.clock = opts.clock ?? realClock
    this.store = opts.store ?? new MemoryStore()
    this.T = { ...DEFAULT_TIMINGS, ...opts.timings }
    this.logger = opts.logger ?? new EventLogger()
    this.random = opts.random ?? Math.random
    this.nonce = randomId(this.random, 6)

    const now = this.clock.now()
    const mode = opts.mode
    if (mode.kind === "host") {
      this.kind = "lobby"
      this.leaderId = this.id
      this.lobby = {
        hostId: this.id,
        config: { ...mode.config },
        players: [
          {
            id: this.id,
            name: this.identity.name,
            color: PLAYER_COLORS[0],
            joinSequence: 1,
            secretHash: this.identity.secretHash,
            ready: true,
          },
        ],
      }
    } else if (mode.kind === "guest") {
      this.kind = "lobby"
      this.expectedHostId = mode.hostId
      this.leaderId = mode.hostId
      this.lastSeen.set(mode.hostId, now)
    } else {
      this.kind = "game"
      const p = loadPersisted(this.store, this.roomId, this.id)
      if (p) {
        this.currentTerm = p.currentTerm
        this.votedFor = p.votedFor
        this.state = p.state
        this.accepted = p.accepted
        this.cert = p.cert
        this.startMembers = p.startMembers
      }
      this.syncing = true
    }

    this.t.setHandlers({
      onMessage: (from, data) => this.onMessage(from, data),
      onLinkState: (peer, st) => this.onLinkState(peer, st),
    })
    this.schedule()
  }

  // =========================================================================
  // Public API (UI)
  // =========================================================================

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  stop(): void {
    this.stopped = true
    if (this.timer != null) this.clock.clearTimeout(this.timer)
    this.timer = null
  }

  getView(): NodeView {
    const members = this.members()
    return {
      selfId: this.id,
      roomId: this.roomId,
      status: this.status(),
      term: this.currentTerm,
      leaderId: this.leaderId,
      isLeader: this.leaderId === this.id && this.kind !== "closed",
      lobby: this.lobby,
      state: this.state,
      members,
      countdownEndsAt: this.countdownEndsAt,
      pendingClick: this.pendingClick
        ? {
            requestId: this.pendingClick.requestId,
            number: this.pendingClick.number,
          }
        : null,
      lastReject: this.lastReject,
      peers: members
        .filter((m) => m.id !== this.id)
        .map((m) => ({
          id: m.id,
          link: this.t.linkState(m.id),
          alive: this.alive(m.id),
        })),
      quorum: this.quorum(),
      aliveCount: this.aliveCount(),
      closedReason: this.closedReason,
      startBlockers: this.startBlockers(),
      nextConfig: this.nextConfig,
    }
  }

  /** Members a peer can verify a rejoin secret against. */
  getMember(id: PlayerId): Member | undefined {
    return this.members().find((m) => m.id === id)
  }

  isLobbyHost(): boolean {
    return this.kind === "lobby" && this.lobby?.hostId === this.id
  }

  /** Lobby Host: register a guest whose QR handshake completed. */
  addGuest(g: {
    id: PlayerId
    name: string
    secretHash: string
  }): string | null {
    if (!this.isLobbyHost() || !this.lobby) return "started"
    const lobby = this.lobby
    const existing = lobby.players.find((p) => p.id === g.id)
    if (!existing && lobby.players.length >= lobby.config.playerLimit)
      return "full"
    const now = this.clock.now()
    // Grace period: the WebRTC link is still being established after the QR scan.
    this.lastSeen.set(g.id, now + this.T.dialTimeoutMs)
    this.downSince.delete(g.id)
    if (existing) {
      existing.name = sanitizeName(g.name)
      existing.secretHash = g.secretHash
    } else {
      const used = new Set(lobby.players.map((p) => p.color))
      lobby.players.push({
        id: g.id,
        name: sanitizeName(g.name),
        color: PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0],
        joinSequence: this.nextJoinSeq++,
        secretHash: g.secretHash,
        ready: false,
      })
    }
    this.log("local", "GUEST_ADDED", { peer: g.id })
    this.broadcastLobby()
    this.notify()
    return null
  }

  /** Lobby Host: drop a guest (e.g. one whose connection never completed). */
  kickGuest(id: PlayerId): boolean {
    if (!this.isLobbyHost() || id === this.id) return false
    const had = this.lobby?.players.some((p) => p.id === id) ?? false
    this.removeGuest(id)
    this.notify()
    return had
  }

  canAcceptGuests(): boolean {
    return (
      this.isLobbyHost() &&
      !!this.lobby &&
      this.lobby.players.length < this.lobby.config.playerLimit
    )
  }

  setConfig(config: GameConfig): string | null {
    const err = validateConfig(config)
    if (err) return err
    if (this.isLobbyHost() && this.lobby) {
      if (config.playerLimit < this.lobby.players.length) return "playerLimit"
      this.lobby.config = { ...config }
      this.broadcastLobby()
    } else if (this.kind === "game") {
      this.nextConfig = { ...config }
    } else return "notAllowed"
    this.notify()
    return null
  }

  setReady(ready: boolean): void {
    if (this.kind !== "lobby" || !this.lobby) return
    if (this.isLobbyHost()) {
      const me = this.lobby.players.find((p) => p.id === this.id)
      if (me) me.ready = ready
      this.broadcastLobby()
      this.notify()
    } else {
      this.send(this.lobby.hostId, "READY", { ready })
    }
  }

  startBlockers(): string[] {
    if (!this.isLobbyHost() || !this.lobby) return []
    const players = this.lobby.players
    const out: string[] = []
    if (players.length < LIMITS.minPlayers) out.push("needPlayers")
    if (players.some((p) => !p.ready)) out.push("notReady")
    if (!this.meshComplete()) out.push("meshIncomplete")
    return out
  }

  /** Lobby Host: freeze membership and propose GAME_STARTED (index 1, term 0). */
  startGame(): string | null {
    const blockers = this.startBlockers()
    if (!this.isLobbyHost() || !this.lobby) return "notHost"
    if (blockers.length) return blockers[0]
    const lobby = this.lobby
    const members: Member[] = lobby.players.map(({ ready: _ready, ...m }) => ({
      ...m,
    }))
    this.kind = "game"
    this.startMembers = members
    this.lobby = null
    this.nextConfig = { ...lobby.config }
    this.propose({
      type: "GAME_STARTED",
      payload: {
        roomId: this.roomId,
        hostId: this.id,
        config: lobby.config,
        members,
        seed: this.randomSeed(),
      },
    })
    this.notify()
    return null
  }

  /** Leader, after FINISHED: start another round with the same frozen membership. */
  rematch(): string | null {
    if (
      this.leaderId !== this.id ||
      !this.state ||
      this.state.phase !== "FINISHED"
    )
      return "notAllowed"
    if (this.pending) return "busy"
    const config = this.nextConfig ?? this.state.config
    return this.propose({
      type: "REMATCH",
      payload: { config, seed: this.randomSeed() },
    })
      ? null
      : "invalid"
  }

  /** UI intent. Never mutates replicated state; only sends a command to the Host. */
  click(number: number): "sent" | "ignored" | "wrong" {
    const st = this.state
    if (this.status() !== "ACTIVE" || !st || st.phase !== "PLAYING")
      return "ignored"
    if (this.pendingClick) return "ignored"
    if (number !== currentTarget(st)) {
      this.lastReject = { number, reason: "wrongNumber", at: this.clock.now() }
      this.notify()
      return "wrong"
    }
    const requestId = randomId(this.random, 12)
    this.pendingClick = { requestId, number, at: this.clock.now() }
    const payload = { requestId, number, clientTimestamp: Date.now() }
    if (this.leaderId === this.id)
      this.handleClick(this.id, this.currentTerm, payload)
    else if (this.leaderId) this.send(this.leaderId, "CLICK_REQUEST", payload)
    this.notify()
    return "sent"
  }

  leave(): void {
    if (this.kind === "closed") return
    for (const m of this.members())
      if (m.id !== this.id) this.send(m.id, "LEAVE", {})
    this.store.remove(persistKey(this.roomId, this.id))
    this.close("left")
    this.t.closeAll()
  }

  // =========================================================================
  // Derived state
  // =========================================================================

  private members(): Member[] {
    if (this.state) return this.state.members
    if (this.startMembers) return this.startMembers
    return this.lobby?.players ?? []
  }

  private memberIds(): PlayerId[] {
    return this.members().map((m) => m.id)
  }

  private knows(id: PlayerId): boolean {
    if (this.members().some((m) => m.id === id)) return true
    return this.kind === "lobby" && id === this.expectedHostId
  }

  private joinSeq(id: PlayerId): number {
    return this.members().find((m) => m.id === id)?.joinSequence ?? Infinity
  }

  private quorum(): number {
    return quorumSize(this.members().length)
  }

  private peerDead(p: PlayerId, timeout: number): boolean {
    if (p === this.id) return false
    const now = this.clock.now()
    const ds = this.downSince.get(p)
    if (ds != null && now - ds > this.T.failedGraceMs) return true
    return now - (this.lastSeen.get(p) ?? -Infinity) > timeout
  }

  private alive(p: PlayerId): boolean {
    return !this.peerDead(p, this.T.peerTimeoutMs)
  }

  private aliveCount(): number {
    return this.memberIds().filter((m) => this.alive(m)).length
  }

  private leaderAlive(): boolean {
    if (this.leaderId === this.id) return true
    if (
      this.leaderId == null ||
      this.peerDead(this.leaderId, this.T.hostTimeoutMs)
    )
      return false
    // In a game, being reachable is not enough: the peer must still act as leader
    // (a Host that reloaded comes back as a plain peer of the same term).
    return (
      this.kind !== "game" ||
      this.clock.now() - this.leaderContactAt <= this.T.hostTimeoutMs
    )
  }

  /** Deterministic priority: nobody alive (in my view) has a lower joinSequence. */
  private priorityOk(candidate: PlayerId): boolean {
    const js = this.joinSeq(candidate)
    if (js === Infinity) return false
    return this.members().every(
      (m) => m.id === candidate || m.joinSequence > js || !this.alive(m.id)
    )
  }

  private leaderStalled(): boolean {
    if (this.leaderId !== this.id || this.kind !== "game") return false
    if (this.aliveCount() < this.quorum()) return true
    return (
      !!this.pending &&
      this.clock.now() - this.pending.firstSentAt > this.T.pauseAfterMs
    )
  }

  private status(): LocalStatus {
    if (this.kind === "closed") return "CLOSED"
    if (this.kind === "lobby") return "LOBBY"
    if (this.desync) return "DESYNC"
    if (this.leaderId === this.id) {
      if (!this.state) return "SYNCING"
      return this.leaderStalled() ? "PAUSED" : "ACTIVE"
    }
    if (!this.leaderAlive() || this.election) return "MIGRATING"
    if (!this.state || this.syncing) return "SYNCING"
    if (this.leaderPaused) return "PAUSED"
    return "ACTIVE"
  }

  private meshComplete(): boolean {
    const ids = this.memberIds()
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        if (!this.linked(a, b)) return false
      }
    }
    return true
  }

  private linked(a: PlayerId, b: PlayerId): boolean {
    if (a === this.id) return this.t.linkState(b) === "connected"
    if (b === this.id) return this.t.linkState(a) === "connected"
    return !!(
      this.peerLinks.get(a)?.includes(b) || this.peerLinks.get(b)?.includes(a)
    )
  }

  private currentHash(): string | null {
    const s = this.state
    if (!s) return null
    if (this.hashCache?.state === s) return this.hashCache.hash
    const hash = stateHash(s)
    this.hashCache = { state: s, hash }
    return hash
  }

  private snapshot(): Snapshot | null {
    if (!this.state) return null
    return {
      state: this.state,
      stateHash: this.currentHash() as string,
      certificate: this.cert,
    }
  }

  private randomSeed(): number {
    return Math.floor(this.random() * 0x100000000) >>> 0
  }

  // =========================================================================
  // Messaging
  // =========================================================================

  private send<T extends MessageType>(
    to: PlayerId,
    type: T,
    payload: Payloads[T],
    term = this.currentTerm
  ): boolean {
    if (to === this.id || this.stopped) return false
    const env: Envelope<T> = {
      protocol: PROTOCOL_VERSION,
      type,
      roomId: this.roomId,
      senderId: this.id,
      term,
      messageId: `${this.nonce}.${++this.msgCounter}`,
      payload,
    }
    const ok = this.t.send(to, encode(env as Envelope))
    if (type !== "HEARTBEAT") {
      const index =
        (payload as { event?: GameEvent }).event?.index ??
        (payload as { index?: number }).index
      this.log("out", type, {
        peer: to,
        messageId: env.messageId,
        index,
        note: ok ? undefined : "no-link",
      })
    }
    return ok
  }

  private broadcast<T extends MessageType>(
    type: T,
    payload: Payloads[T]
  ): void {
    for (const id of this.memberIds())
      if (id !== this.id) this.send(id, type, payload)
  }

  private log(
    dir: "in" | "out" | "local",
    type: string,
    extra: {
      peer?: string
      messageId?: string
      index?: number
      note?: string
    } = {}
  ) {
    this.logger.log({
      t: this.clock.now(),
      dir,
      type,
      term: this.currentTerm,
      ...extra,
    })
  }

  private onLinkState(peer: PlayerId, st: LinkState): void {
    if (this.stopped) return
    const now = this.clock.now()
    if (st === "connected") {
      this.downSince.delete(peer)
      this.lastSeen.set(peer, now)
      this.dialing.delete(peer)
      // Exchange liveness right away; the peer learns term/leader/logIndex from it.
      this.sendHeartbeatTo(peer)
      if (this.isLobbyHost() && this.lobby)
        this.send(peer, "LOBBY_STATE", this.lobby)
      if (
        this.leaderId === this.id &&
        this.pending &&
        !this.pending.acks.has(peer)
      ) {
        this.send(peer, "EVENT_PROPOSE", {
          event: this.pending.event,
          commitIndex: this.state?.logIndex ?? 0,
        })
        this.pending.sentAt.set(peer, now)
      }
      if (
        this.kind === "game" &&
        this.leaderId &&
        this.leaderId !== this.id &&
        peer === this.leaderId
      ) {
        this.requestState(peer, "reconnect", true)
      }
    } else if (st === "failed" || st === "closed" || st === "none") {
      if (!this.downSince.has(peer)) this.downSince.set(peer, now)
      this.dialing.delete(peer)
    }
    this.log("local", `LINK_${st.toUpperCase()}`, { peer })
    this.notify()
  }

  private onMessage(from: PlayerId, data: string): void {
    if (this.stopped || this.kind === "closed") return
    const env = decode(data)
    if (!env) return this.log("in", "DROP_MALFORMED", { peer: from })
    if (env.senderId !== from)
      return this.log("in", "DROP_SPOOF", { peer: from, note: env.senderId })
    if (env.roomId !== this.roomId)
      return this.log("in", "DROP_ROOM", { peer: from })
    if (!this.knows(from)) return this.log("in", "DROP_UNKNOWN", { peer: from })
    const key = `${from}|${env.messageId}`
    if (this.seen.has(key))
      return this.log("in", "DROP_DUP", {
        peer: from,
        messageId: env.messageId,
      })
    this.seen.add(key)
    this.lastSeen.set(from, this.clock.now())
    if (this.kind === "lobby" && from === this.leaderId)
      this.leaderContactAt = this.clock.now()
    if (env.type !== "HEARTBEAT")
      this.log("in", env.type, { peer: from, messageId: env.messageId })
    try {
      this.dispatch(from, env)
    } catch (err) {
      this.log("local", "HANDLER_ERROR", { peer: from, note: String(err) })
    }
    this.notify()
  }

  private dispatch(from: PlayerId, env: Envelope): void {
    switch (env.type) {
      case "LOBBY_STATE":
        return this.onLobbyState(from, env.payload as Payloads["LOBBY_STATE"])
      case "READY":
        return this.onReady(from, env.payload as Payloads["READY"])
      case "LEAVE":
        return this.onLeave(from)
      case "JOIN_REJECT":
      case "ROOM_CLOSED":
        if (
          this.kind === "lobby" &&
          from === (this.lobby?.hostId ?? this.expectedHostId)
        )
          this.close((env.payload as { reason: string }).reason)
        return
      case "CLICK_REQUEST":
        return this.handleClick(
          from,
          env.term,
          env.payload as Payloads["CLICK_REQUEST"]
        )
      case "CLICK_REJECT":
        return this.onClickReject(env.payload as Payloads["CLICK_REJECT"])
      case "EVENT_PROPOSE":
        return this.onPropose(
          from,
          env.term,
          env.payload as Payloads["EVENT_PROPOSE"]
        )
      case "EVENT_ACK":
        return this.onAck(from, env.term, env.payload as Payloads["EVENT_ACK"])
      case "EVENT_COMMIT":
        return this.onCommit(
          from,
          env.term,
          env.payload as Payloads["EVENT_COMMIT"]
        )
      case "STATE_REQUEST":
        return this.onStateRequest(from)
      case "STATE_SNAPSHOT":
        return this.onSnapshot(
          from,
          env.term,
          env.payload as Payloads["STATE_SNAPSHOT"]
        )
      case "HEARTBEAT":
        return this.onHeartbeat(
          from,
          env.term,
          env.payload as Payloads["HEARTBEAT"]
        )
      case "PRE_VOTE":
        return this.onPreVote(from, env.payload as Payloads["PRE_VOTE"])
      case "PRE_VOTE_ACK":
        return this.onPreVoteAck(from, env.payload as Payloads["PRE_VOTE_ACK"])
      case "HOST_ELECTION":
        return this.onElection(from, env.payload as Payloads["HOST_ELECTION"])
      case "ELECTION_ACK":
        return this.onElectionAck(from, env.payload as Payloads["ELECTION_ACK"])
      case "SIGNAL":
        return this.onSignal(from, env.payload as Payloads["SIGNAL"])
    }
  }

  /**
   * Term rules (design 03 §10, 07 §7-8):
   *  - lower term: stale, ignore;
   *  - higher term: adopt it (the leader of a term is unique), step down,
   *    freeze and reconcile via snapshot;
   *  - equal term from a leader we did not know yet: learn it.
   */
  private observeTerm(
    term: number,
    from: PlayerId,
    claimsLeader: boolean
  ): boolean {
    if (this.kind !== "game") return term === this.currentTerm
    if (term < this.currentTerm) {
      this.log("in", "DROP_STALE_TERM", { peer: from, note: String(term) })
      return false
    }
    if (term > this.currentTerm) {
      this.adoptTerm(term, claimsLeader ? from : null)
      if (claimsLeader) {
        this.leaderContactAt = this.clock.now()
        this.requestState(from, "behind", true)
      }
      return true
    }
    if (claimsLeader) {
      if (this.leaderId == null) {
        this.leaderId = from
        this.election = null
        this.log("local", "LEADER_LEARNED", { peer: from })
      } else if (this.leaderId !== from) {
        this.log("local", "DROP_CONFLICTING_LEADER", { peer: from })
        return false
      }
      this.leaderContactAt = this.clock.now()
    }
    return true
  }

  private adoptTerm(term: number, leader: PlayerId | null): void {
    const wasLeader = this.leaderId === this.id
    this.currentTerm = term
    this.votedFor = null
    this.leaderId = leader
    this.election = null
    if (wasLeader) this.stepDown()
    this.syncing = leader != null
    this.persist()
    this.log("local", "TERM_ADOPTED", { peer: leader ?? undefined })
  }

  private stepDown(): void {
    this.pending = null
    this.queue = []
    this.log("local", "STEP_DOWN")
  }

  // =========================================================================
  // Lobby
  // =========================================================================

  private broadcastLobby(): void {
    if (!this.lobby) return
    for (const p of this.lobby.players)
      if (p.id !== this.id) this.send(p.id, "LOBBY_STATE", this.lobby)
  }

  private onLobbyState(from: PlayerId, p: Payloads["LOBBY_STATE"]): void {
    if (this.kind !== "lobby" || this.isLobbyHost()) return
    if (from !== this.expectedHostId || p.hostId !== from) return
    const listed = p.players.some((pl) => pl.id === this.id)
    // The Host may send LOBBY_STATE before it registered us; only a later removal counts.
    if (!listed) {
      if (this.listedInLobby) this.close("removed")
      return
    }
    this.listedInLobby = true
    this.lobby = p
    this.leaderId = from
  }

  private onReady(from: PlayerId, p: Payloads["READY"]): void {
    if (!this.isLobbyHost() || !this.lobby) return
    const pl = this.lobby.players.find((x) => x.id === from)
    if (!pl) return
    pl.ready = p.ready
    this.broadcastLobby()
  }

  private onLeave(from: PlayerId): void {
    if (this.kind === "lobby") {
      if (this.isLobbyHost()) this.removeGuest(from)
      else if (from === this.lobby?.hostId) this.close("hostLeft")
    } else {
      // A member that leaves mid-game stays in the membership (quorum is fixed);
      // treat it as failed immediately instead of waiting for the timeout.
      this.downSince.set(from, this.clock.now() - this.T.failedGraceMs - 1)
      this.lastSeen.set(from, -Infinity)
    }
    this.t.close(from)
  }

  private removeGuest(id: PlayerId): void {
    if (!this.lobby) return
    const before = this.lobby.players.length
    this.lobby.players = this.lobby.players.filter(
      (p) => p.id !== id || p.id === this.id
    )
    if (this.lobby.players.length !== before) {
      this.log("local", "GUEST_REMOVED", { peer: id })
      // The broadcast no longer reaches the removed guest, so tell it directly
      // (if the link still works) instead of letting it time out as "hostLeft".
      // The link is left open so the message is not dropped by the close; the
      // guest closes on receipt and its later messages are ignored as unknown.
      this.send(id, "JOIN_REJECT", { reason: "removed" })
      this.broadcastLobby()
    }
  }

  private close(reason: string): void {
    if (this.kind === "closed") return
    this.kind = "closed"
    this.closedReason = reason
    this.pending = null
    this.election = null
    this.log("local", "CLOSED", { note: reason })
    this.notify()
  }

  // =========================================================================
  // Clicks (design 04)
  // =========================================================================

  private handleClick(
    from: PlayerId,
    term: number,
    p: Payloads["CLICK_REQUEST"]
  ): void {
    const key = `${from}:${p.requestId}`
    if (this.processed.has(key))
      return this.log("local", "CLICK_DUP", { peer: from })
    this.processed.add(key)
    const s = this.state
    let reason: string | null = null
    if (this.leaderId !== this.id || this.kind !== "game") reason = "notHost"
    else if (!s) reason = "notStarted"
    else if (!s.members.some((m) => m.id === from)) reason = "notMember"
    else if (term !== this.currentTerm) reason = "staleTerm"
    else if (s.phase !== "PLAYING") reason = "phase"
    else if (this.pending || this.queue.length) reason = "reserved"
    else if (this.aliveCount() < this.quorum()) reason = "noQuorum"
    else if (p.number !== currentTarget(s)) reason = "wrongNumber"
    else if (s.claimed[String(p.number)] != null) reason = "claimed"
    if (reason) {
      this.log("local", "CLICK_REJECTED", { peer: from, note: reason })
      if (from === this.id)
        this.onClickReject({ requestId: p.requestId, reason })
      else this.send(from, "CLICK_REJECT", { requestId: p.requestId, reason })
      return
    }
    // Reservation = this proposal: while it is pending every other click is rejected.
    this.propose({
      type: "NUMBER_FOUND",
      payload: { number: p.number, winner: from, requestId: p.requestId },
    })
  }

  private onClickReject(p: Payloads["CLICK_REJECT"]): void {
    if (this.pendingClick?.requestId !== p.requestId) return
    this.lastReject = {
      number: this.pendingClick.number,
      reason: p.reason,
      at: this.clock.now(),
    }
    this.pendingClick = null
  }

  // =========================================================================
  // Log replication (leader side)
  // =========================================================================

  private propose(content: GameEventPayload): boolean {
    if (this.leaderId !== this.id || this.pending) return false
    const event = {
      ...content,
      term: this.currentTerm,
      index: (this.state?.logIndex ?? 0) + 1,
    } as GameEvent
    const err = validateEvent(this.state, event)
    if (err) {
      this.log("local", "PROPOSE_INVALID", {
        index: event.index,
        note: `${event.type}:${err}`,
      })
      return false
    }
    const now = this.clock.now()
    this.pending = {
      event,
      acks: new Set([this.id]),
      firstSentAt: now,
      sentAt: new Map(),
    }
    this.accepted = event
    this.persist()
    const commitIndex = this.state?.logIndex ?? 0
    for (const id of this.memberIds()) {
      if (id === this.id) continue
      this.send(id, "EVENT_PROPOSE", { event, commitIndex })
      this.pending.sentAt.set(id, now)
    }
    this.maybeCommit()
    this.notify()
    return true
  }

  private onAck(from: PlayerId, term: number, p: Payloads["EVENT_ACK"]): void {
    const pend = this.pending
    if (this.leaderId !== this.id || !pend || term !== this.currentTerm) return
    if (p.eventId !== eventId(pend.event) || !this.memberIds().includes(from))
      return
    pend.acks.add(from)
    this.maybeCommit()
  }

  private maybeCommit(): void {
    const pend = this.pending
    if (!pend || pend.acks.size < this.quorum()) return
    const e = pend.event
    const certificate: CommitCertificate = {
      term: e.term,
      index: e.index,
      eventId: eventId(e),
      acknowledgements: [...pend.acks].sort(),
    }
    this.pending = null
    this.applyCommitted(e, certificate)
    this.broadcast("EVENT_COMMIT", { event: e, certificate })
    this.pump()
  }

  private pump(): void {
    if (this.leaderId !== this.id || this.pending || this.kind !== "game")
      return
    while (this.queue.length && !this.pending) {
      const next = this.queue.shift() as GameEventPayload
      this.propose(next)
    }
    const s = this.state
    if (!this.pending && s && s.phase === "COUNTDOWN") {
      if (this.countdownEndsAt == null)
        this.countdownEndsAt = this.clock.now() + this.T.countdownMs
      if (this.clock.now() >= this.countdownEndsAt)
        this.propose({ type: "PLAY_BEGIN", payload: {} })
    }
  }

  // =========================================================================
  // Log replication (follower side)
  // =========================================================================

  private recentAt(index: number): GameEvent | undefined {
    return this.recent.find((e) => e.index === index)
  }

  private onPropose(
    from: PlayerId,
    term: number,
    p: Payloads["EVENT_PROPOSE"]
  ): void {
    const e = p.event
    if (this.kind === "lobby") {
      // The only proposal accepted in the lobby is GAME_STARTED from the lobby Host.
      if (
        from !== this.lobby?.hostId ||
        e.type !== "GAME_STARTED" ||
        term !== 0 ||
        e.term !== 0
      )
        return
      if (
        !e.payload.members.some((m) => m.id === this.id) ||
        e.payload.roomId !== this.roomId
      )
        return
      if (validateEvent(null, e)) return
      this.kind = "game"
      this.startMembers = e.payload.members
      this.lobby = null
      this.leaderId = from
    } else if (!this.observeTerm(term, from, true)) return
    if (from !== this.leaderId || e.term !== term) return

    const my = this.state?.logIndex ?? 0
    if (e.index <= my) {
      const mine = this.recentAt(e.index)
      if (mine && sameEventContent(mine, e))
        this.send(from, "EVENT_ACK", { eventId: eventId(e), index: e.index })
      return
    }
    if (e.index > my + 1) return this.requestState(from, "gap")
    const err = validateEvent(this.state, e)
    if (err)
      return this.log("local", "PROPOSAL_REJECTED", {
        peer: from,
        index: e.index,
        note: err,
      })
    this.accepted = e
    this.persist()
    this.send(from, "EVENT_ACK", { eventId: eventId(e), index: e.index })
  }

  private certValid(e: GameEvent, c: CommitCertificate): boolean {
    if (c.eventId !== eventId(e) || c.index !== e.index || c.term !== e.term)
      return false
    const members =
      e.type === "GAME_STARTED" ? e.payload.members : this.members()
    const ids = new Set(members.map((m) => m.id))
    const acks = new Set(c.acknowledgements.filter((a) => ids.has(a)))
    return acks.size >= quorumSize(members.length)
  }

  private onCommit(
    from: PlayerId,
    term: number,
    p: Payloads["EVENT_COMMIT"]
  ): void {
    if (!this.observeTerm(term, from, true) || from !== this.leaderId) return
    const e = p.event
    const my = this.state?.logIndex ?? 0
    if (e.index <= my) return // duplicate (E01)
    if (e.index > my + 1) return this.requestState(from, "gap") // gap (E02)
    if (!this.certValid(e, p.certificate))
      return this.log("local", "DROP_BAD_CERT", { peer: from, index: e.index })
    const err = validateEvent(this.state, e)
    if (err) {
      this.log("local", "COMMIT_INVALID", {
        peer: from,
        index: e.index,
        note: err,
      })
      return this.requestState(from, "gap")
    }
    this.applyCommitted(e, p.certificate)
  }

  /** The single place where replicated state changes. */
  private applyCommitted(e: GameEvent, c: CommitCertificate): void {
    const prev = this.state
    this.state = applyEvent(prev, e)
    this.recent.push(e)
    if (this.recent.length > 64) this.recent.shift()
    this.cert = c
    if (this.accepted && this.accepted.index <= e.index) this.accepted = null
    if (this.kind === "lobby") this.kind = "game"
    this.lobby = null
    this.log("local", `APPLY_${e.type}`, { index: e.index })
    this.afterApply(e)
    this.persist()
    this.notify()
  }

  private afterApply(e: GameEvent): void {
    const now = this.clock.now()
    const s = this.state as GameState
    if (
      s.phase === "COUNTDOWN" &&
      (e.type === "GAME_STARTED" ||
        e.type === "HOST_CHANGED" ||
        e.type === "REMATCH")
    ) {
      this.countdownEndsAt = now + this.T.countdownMs
    }
    if (e.type === "PLAY_BEGIN") this.countdownEndsAt = null
    if (e.type === "NUMBER_FOUND" && this.pendingClick) {
      if (
        e.payload.winner !== this.id &&
        this.pendingClick.number === e.payload.number
      ) {
        this.lastReject = {
          number: e.payload.number,
          reason: "lostRace",
          at: now,
        }
      }
      this.pendingClick = null
    }
    if (e.type === "HOST_CHANGED" || e.type === "REMATCH")
      this.pendingClick = null
  }

  private requestState(
    to: PlayerId,
    reason: Payloads["STATE_REQUEST"]["reason"],
    force = false
  ): void {
    const now = this.clock.now()
    this.syncing = true
    if (!force && now - this.syncRequestedAt < this.T.syncRetryMs) return
    this.syncRequestedAt = now
    this.send(to, "STATE_REQUEST", {
      haveIndex: this.state?.logIndex ?? 0,
      reason,
    })
  }

  private onStateRequest(from: PlayerId): void {
    if (this.leaderId !== this.id || this.kind !== "game") return
    const snap = this.snapshot()
    if (snap) this.send(from, "STATE_SNAPSHOT", snap)
  }

  private onSnapshot(
    from: PlayerId,
    term: number,
    snap: Payloads["STATE_SNAPSHOT"]
  ): void {
    if (this.kind !== "game") return
    if (!this.observeTerm(term, from, true) || from !== this.leaderId) return
    const s = snap.state
    if (s.roomId !== this.roomId || !s.members.some((m) => m.id === this.id))
      return
    if (stateHash(s) !== snap.stateHash) {
      // R04: never silently repair; re-request, and surface DESYNC if it repeats.
      this.desyncCount++
      this.log("local", "SNAPSHOT_HASH_MISMATCH", {
        peer: from,
        note: String(this.desyncCount),
      })
      if (this.desyncCount >= 3) this.desync = true
      this.requestState(from, "hash", true)
      return
    }
    const my = this.state?.logIndex ?? 0
    if (s.logIndex < my) return
    const enteringCountdown =
      s.phase === "COUNTDOWN" &&
      (this.state?.phase !== "COUNTDOWN" || s.round !== this.state?.round)
    this.state = s
    this.recent = []
    this.cert = snap.certificate
    if (this.accepted && this.accepted.index <= s.logIndex) this.accepted = null
    this.desyncCount = 0
    this.desync = false
    this.syncing = false
    if (
      enteringCountdown ||
      (s.phase === "COUNTDOWN" && this.countdownEndsAt == null)
    ) {
      this.countdownEndsAt = this.clock.now() + this.T.countdownMs
    }
    if (s.phase !== "COUNTDOWN") this.countdownEndsAt = null
    this.log("local", "SNAPSHOT_APPLIED", { peer: from, index: s.logIndex })
    this.persist()
  }

  // =========================================================================
  // Heartbeat & failure detection (design 05 §2)
  // =========================================================================

  private heartbeatPayload(): Payloads["HEARTBEAT"] {
    const known = new Set(this.memberIds())
    return {
      leaderId: this.leaderId,
      logIndex: this.state?.logIndex ?? 0,
      stateHash: this.currentHash(),
      links: this.t.openPeers().filter((p) => known.has(p)),
      paused: this.leaderStalled(),
    }
  }

  private sendHeartbeatTo(peer: PlayerId): void {
    if (this.kind === "closed") return
    this.send(peer, "HEARTBEAT", this.heartbeatPayload())
  }

  private onHeartbeat(
    from: PlayerId,
    term: number,
    p: Payloads["HEARTBEAT"]
  ): void {
    this.peerLinks.set(from, p.links)
    if (this.kind !== "game") return
    const claimsLeader = p.leaderId === from
    if (!this.observeTerm(term, from, claimsLeader)) return
    if (
      !claimsLeader &&
      from === this.leaderId &&
      term === this.currentTerm &&
      this.leaderId !== this.id
    ) {
      // Our leader restarted and no longer leads this term: start migration now.
      this.leaderId = null
      this.log("local", "LEADER_ABDICATED", { peer: from })
      return
    }
    if (!claimsLeader || from !== this.leaderId) return
    this.leaderPaused = p.paused
    const my = this.state?.logIndex ?? 0
    if (p.logIndex > my) {
      this.requestState(from, "behind")
    } else if (p.logIndex === my) {
      if (p.stateHash && this.state && p.stateHash !== this.currentHash()) {
        this.log("local", "STATE_HASH_MISMATCH", { peer: from, index: my })
        this.requestState(from, "hash")
      } else if (this.state) {
        this.syncing = false
      }
    } else if (this.state) {
      // New leader is re-committing; we are not behind.
      this.syncing = false
    }
  }

  // =========================================================================
  // Election (design 05)
  // =========================================================================

  private startPreVote(): void {
    const term = this.currentTerm + 1
    this.election = {
      phase: "pre",
      term,
      votes: new Map([[this.id, true]]),
      deadline: this.clock.now() + this.T.preVoteTimeoutMs,
    }
    this.log("local", "PRE_VOTE_START", { note: String(term) })
    this.broadcast("PRE_VOTE", { term, logIndex: this.state?.logIndex ?? 0 })
  }

  private onPreVote(from: PlayerId, p: Payloads["PRE_VOTE"]): void {
    // Pre-vote changes no state, so an isolated peer cannot inflate terms.
    const granted =
      this.kind === "game" &&
      p.term > this.currentTerm &&
      this.memberIds().includes(from) &&
      !(this.leaderAlive() && this.leaderId !== from) &&
      this.priorityOk(from)
    this.send(from, "PRE_VOTE_ACK", { term: p.term, granted })
  }

  private onPreVoteAck(from: PlayerId, p: Payloads["PRE_VOTE_ACK"]): void {
    const el = this.election
    if (!el || el.phase !== "pre" || p.term !== el.term || !p.granted) return
    el.votes.set(from, true)
    if (el.votes.size >= this.quorum()) this.startVote()
  }

  private startVote(): void {
    const term = (this.election as Election).term
    this.currentTerm = term
    this.votedFor = this.id
    this.leaderId = null
    this.persist()
    const self: PayloadOf<"ELECTION_ACK"> = {
      term,
      granted: true,
      snapshot: this.snapshot(),
      accepted: this.accepted,
    }
    this.election = {
      phase: "vote",
      term,
      votes: new Map([[this.id, self]]),
      deadline: this.clock.now() + this.T.electionTimeoutMs,
    }
    this.log("local", "ELECTION_START", { note: String(term) })
    this.broadcast("HOST_ELECTION", {
      term,
      logIndex: this.state?.logIndex ?? 0,
    })
  }

  private onElection(from: PlayerId, p: Payloads["HOST_ELECTION"]): void {
    const T = p.term
    let granted = false
    if (
      this.kind === "game" &&
      T >= this.currentTerm &&
      this.memberIds().includes(from) &&
      this.priorityOk(from)
    ) {
      granted =
        T > this.currentTerm || this.votedFor === null || this.votedFor === from
    }
    if (granted) {
      if (T > this.currentTerm) this.adoptTerm(T, null)
      this.votedFor = from
      this.election = null
      this.persist()
    }
    this.send(from, "ELECTION_ACK", {
      term: T,
      granted,
      snapshot: granted ? this.snapshot() : null,
      accepted: granted ? this.accepted : null,
    })
    this.log("local", granted ? "VOTE_GRANTED" : "VOTE_DENIED", {
      peer: from,
      note: String(T),
    })
  }

  private onElectionAck(from: PlayerId, p: Payloads["ELECTION_ACK"]): void {
    const el = this.election
    if (
      !el ||
      el.phase !== "vote" ||
      p.term !== el.term ||
      el.term !== this.currentTerm ||
      !p.granted
    )
      return
    el.votes.set(from, p)
    if (el.votes.size >= this.quorum()) this.becomeLeader()
  }

  /** State reconciliation (design 05 §8) + new term. */
  private becomeLeader(): void {
    const el = this.election as Election
    const votes = [...el.votes.values()].filter(
      (v): v is PayloadOf<"ELECTION_ACK"> => v !== true
    )
    let best = this.state
    let bestCert = this.cert
    for (const v of votes) {
      const s = v.snapshot
      if (
        !s ||
        s.state.roomId !== this.roomId ||
        stateHash(s.state) !== s.stateHash
      )
        continue
      if (!best || s.state.logIndex > best.logIndex) {
        best = s.state
        bestCert = s.certificate
      }
    }
    const nextIndex = (best?.logIndex ?? 0) + 1
    let carried: GameEvent | null = null
    for (const e of [this.accepted, ...votes.map((v) => v.accepted)]) {
      if (e && e.index === nextIndex && (!carried || e.term > carried.term))
        carried = e
    }
    if (!best && !carried) {
      this.log("local", "ELECTION_NO_STATE")
      this.election = null
      return
    }
    this.election = null
    this.leaderId = this.id
    if (best !== this.state) {
      this.state = best ? structuredClone(best) : null
      this.recent = []
      this.cert = bestCert
    }
    this.accepted = null
    this.pending = null
    this.syncing = false
    this.queue = []
    // Paxos rule: re-propose the highest-term accepted value under our own term.
    if (carried)
      this.queue.push({
        type: carried.type,
        payload: carried.payload,
      } as GameEventPayload)
    this.queue.push({
      type: "HOST_CHANGED",
      payload: { hostId: this.id, term: this.currentTerm },
    })
    this.persist()
    this.log("local", "BECAME_LEADER", {
      note: `carried=${carried ? eventId(carried) : "-"}`,
    })
    for (const id of this.memberIds())
      if (id !== this.id) this.sendHeartbeatTo(id)
    this.pump()
  }

  // =========================================================================
  // Mesh maintenance & relayed signaling (design 06 §5)
  // =========================================================================

  private meshTick(now: number): void {
    if (
      !this.t.dial ||
      now - this.lastMeshAt < this.T.meshRetryMs ||
      this.kind === "closed"
    )
      return
    this.lastMeshAt = now
    const myJs = this.joinSeq(this.id)
    const open = this.t.openPeers()
    for (const m of this.members()) {
      const link = this.t.linkState(m.id)
      // `disconnected` may still recover on its own (WebRTC moves it to
      // `failed` if not); replacing it early would drop a healthy peer
      // (design 06 §6, W07). Stuck `connecting` links are retried after
      // dialTimeoutMs below.
      if (m.id === this.id || link === "connected" || link === "disconnected")
        continue
      if (myJs >= m.joinSequence) continue // lower joinSequence initiates (W05)
      const started = this.dialing.get(m.id)
      if (started != null && now - started < this.T.dialTimeoutMs) continue
      const relay = open.find((r) => this.peerLinks.get(r)?.includes(m.id))
      if (!relay) continue
      this.dialing.set(m.id, now)
      this.log("local", "DIAL", { peer: m.id, note: `via ${relay}` })
      this.t
        .dial(m.id)
        .then((sdp) =>
          this.send(relay, "SIGNAL", {
            origin: this.id,
            target: m.id,
            kind: "offer",
            sdp,
          })
        )
        .catch((err) =>
          this.log("local", "DIAL_FAILED", { peer: m.id, note: String(err) })
        )
    }
  }

  private onSignal(from: PlayerId, p: Payloads["SIGNAL"]): void {
    if (!this.knows(p.origin) || !this.knows(p.target)) return
    if (p.target !== this.id) {
      // One-hop relay.
      if (from === p.origin && this.t.linkState(p.target) === "connected")
        this.send(p.target, "SIGNAL", p)
      return
    }
    if (p.kind === "offer") {
      if (!this.t.acceptDial || this.joinSeq(p.origin) >= this.joinSeq(this.id))
        return
      this.t
        .acceptDial(p.origin, p.sdp)
        .then((sdp) => {
          const answer = {
            origin: this.id,
            target: p.origin,
            kind: "answer" as const,
            sdp,
          }
          this.send(
            this.t.linkState(p.origin) === "connected" ? p.origin : from,
            "SIGNAL",
            answer
          )
        })
        .catch((err) =>
          this.log("local", "ACCEPT_DIAL_FAILED", {
            peer: p.origin,
            note: String(err),
          })
        )
    } else {
      this.t.completeDial?.(p.origin, p.sdp).catch((err) =>
        this.log("local", "COMPLETE_DIAL_FAILED", {
          peer: p.origin,
          note: String(err),
        })
      )
    }
  }

  // =========================================================================
  // Timers
  // =========================================================================

  private schedule(): void {
    if (this.stopped) return
    this.timer = this.clock.setTimeout(() => {
      this.tick()
      this.schedule()
    }, this.T.tickMs)
  }

  /** Exposed for tests; normally driven by the internal timer. */
  tick(): void {
    if (this.stopped || this.kind === "closed") return
    const now = this.clock.now()
    if (now - this.lastHeartbeatAt >= this.T.heartbeatMs) {
      this.lastHeartbeatAt = now
      const hb = this.heartbeatPayload()
      for (const id of this.memberIds())
        if (id !== this.id) this.send(id, "HEARTBEAT", hb)
    }
    if (this.kind === "lobby") this.lobbyTick()
    else this.gameTick(now)
    this.meshTick(now)
    if (
      this.pendingClick &&
      now - this.pendingClick.at > this.T.clickTimeoutMs
    ) {
      this.lastReject = {
        number: this.pendingClick.number,
        reason: "timeout",
        at: now,
      }
      this.pendingClick = null
      this.notify()
    }
    const st = this.status()
    if (st !== this.lastStatus) {
      this.lastStatus = st
      this.log("local", `STATUS_${st}`)
      this.notify()
    }
  }

  private lobbyTick(): void {
    if (this.isLobbyHost() && this.lobby) {
      for (const p of this.lobby.players) {
        if (p.id !== this.id && this.peerDead(p.id, this.T.peerTimeoutMs))
          this.removeGuest(p.id)
      }
    } else if (this.lobby || this.expectedHostId) {
      const host = this.lobby?.hostId ?? (this.expectedHostId as PlayerId)
      // MVP: no Host migration in the lobby; the room closes (design 07 §13).
      if (this.peerDead(host, this.T.hostTimeoutMs)) this.close("hostLeft")
    }
  }

  private gameTick(now: number): void {
    if (this.leaderId === this.id) {
      const pend = this.pending
      if (pend) {
        for (const id of this.memberIds()) {
          if (id === this.id || pend.acks.has(id)) continue
          if (now - (pend.sentAt.get(id) ?? -Infinity) >= this.T.resendMs) {
            this.send(id, "EVENT_PROPOSE", {
              event: pend.event,
              commitIndex: this.state?.logIndex ?? 0,
            })
            pend.sentAt.set(id, now)
          }
        }
      } else this.pump()
      return
    }
    if (this.election && this.leaderAlive()) {
      // A pre-vote started while the leader looked dead; it is reachable again
      // (same term, no new leader), so abandon the candidacy and unfreeze.
      this.log("local", "ELECTION_ABANDONED", {
        note: String(this.election.term),
      })
      this.election = null
    }
    if (!this.leaderAlive()) {
      const el = this.election
      if (el && now > el.deadline) {
        this.log("local", "ELECTION_TIMEOUT", { note: String(el.term) })
        this.election = null
        this.nextElectionAt = now + Math.floor(this.random() * 500)
      }
      if (
        !this.election &&
        now >= this.nextElectionAt &&
        this.priorityOk(this.id)
      )
        this.startPreVote()
      return
    }
    if ((this.syncing || this.desync || !this.state) && this.leaderId) {
      const wait = this.desync ? this.T.syncRetryMs * 5 : this.T.syncRetryMs
      if (now - this.syncRequestedAt >= wait)
        this.requestState(this.leaderId, "behind", true)
    }
  }

  // =========================================================================
  // Persistence & notifications
  // =========================================================================

  private persist(): void {
    if (this.kind !== "game") return
    const p: Persisted = {
      v: 1,
      currentTerm: this.currentTerm,
      votedFor: this.votedFor,
      state: this.state,
      accepted: this.accepted,
      cert: this.cert,
      startMembers: this.startMembers,
    }
    try {
      this.store.set(persistKey(this.roomId, this.id), JSON.stringify(p))
    } catch {
      /* storage full / unavailable: in-memory state still correct */
    }
  }

  private notify(): void {
    if (this.notifyQueued || this.listeners.size === 0) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      for (const fn of this.listeners) fn()
    })
  }
}
