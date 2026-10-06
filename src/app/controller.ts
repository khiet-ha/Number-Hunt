import type { GameConfig } from "@/game/types"
import { DEFAULT_CONFIG } from "@/game/types"
import { EventLogger, type KeyValueStore } from "@/multiplayer/env"
import { clearPersisted, GameNode, sanitizeName } from "@/multiplayer/node"
import {
  checkAnswer,
  decodeAnswer,
  decodeOffer,
  encodeAnswer,
  encodeOffer,
  INVITE_TTL_MS,
  offerUrl,
  type InviteKind,
  QrError,
  type OpenInvite,
  type QrErrorCode,
} from "@/qr/envelope"
import type { PeerLink } from "@/webrtc/peer"
import { DEFAULT_ICE } from "@/webrtc/peer"
import { WebRtcTransport } from "@/webrtc/transport"
import {
  loadSession,
  newRoomId,
  newSession,
  randomToken,
  saveName,
  saveSession,
  sha256Hex,
  type Session,
} from "./identity"
import {
  clearResume,
  findResumable,
  getTabId,
  RESUME_BEAT_MS,
  touchResume,
  type ResumeInfo,
} from "./resume"

/**
 * Wires QR bootstrap ↔ WebRTC transport ↔ GameNode for the UI.
 * Holds no game rules; everything replicated lives in GameNode.
 */

/** What a scanned/pasted invite says, decoded before the player commits. */
export interface OfferPeek {
  roomId: string
  kind: InviteKind
  inviterId: string
}

export type Screen =
  | { name: "home" }
  | {
      name: "join"
      offerText: string
      /** null while decoding or when the invite is invalid (see offerError). */
      offer: OfferPeek | null
      offerError: AppErrorCode | null
    }
  | {
      name: "answer"
      answerText: string
      roomId: string
      rejoin: boolean
      startedAt: number
    }
  | { name: "room" }

export interface InviteView {
  kind: InviteKind
  url: string
  nonce: string
  createdAt: number
}

/** Error codes surfaced to the UI, which owns their (translated) wording. */
export type AppErrorCode =
  | QrErrorCode
  | "roomFull"
  | "gameStarted"
  | "notMember"
  | "authFailed"
  | "noPreviousSession"
  | "openElsewhere"
  | "connectTimeout"
  | "unexpected"

export interface AppMessage<C extends string> {
  code: C
  params?: Record<string, string>
}

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    readonly params?: Record<string, string>
  ) {
    super(code)
    this.name = "AppError"
  }
}

export interface AppState {
  screen: Screen
  error: AppMessage<AppErrorCode> | null
  notice: AppMessage<"connecting" | "joined" | "rejoined"> | null
  busy: boolean
  invite: InviteView | null
}

export interface AppOptions {
  /** Per tab (sessionStorage): which session this tab is playing. */
  store: KeyValueStore
  /** Per browser (localStorage): replicated game state, to resume later. */
  persist: KeyValueStore
  baseUrl: string
  iceServers?: RTCIceServer[]
  debug?: boolean
}

const CONNECT_TIMEOUT_MS = 120_000
/** Renew the open join invite this long before it expires. */
const INVITE_RENEW_MARGIN_MS = 30_000

export class AppController {
  state: AppState = {
    screen: { name: "home" },
    error: null,
    notice: null,
    busy: false,
    invite: null,
  }
  node: GameNode | null = null
  readonly logger = new EventLogger(400)
  private transport: WebRtcTransport | null = null
  private session: Session | null = null
  private invites = new Map<string, { link: PeerLink; info: OpenInvite }>()
  private listeners = new Set<() => void>()
  private unsubNode: (() => void) | null = null
  private inviteTimer: ReturnType<typeof setInterval> | null = null
  private resumeTimer: ReturnType<typeof setInterval> | null = null
  private lastResumeTouch = 0
  private readonly tabId: string

  constructor(private readonly opts: AppOptions) {
    this.tabId = getTabId(opts.store)
    this.session = loadSession(opts.store)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch }
    for (const fn of this.listeners) fn()
  }

  private fail(err: unknown) {
    const error: AppMessage<AppErrorCode> =
      err instanceof AppError
        ? { code: err.code, params: err.params }
        : err instanceof QrError
          ? { code: err.code }
          : { code: "unexpected", params: { detail: String(err) } }
    this.set({ error, busy: false })
  }

  clearError() {
    this.set({ error: null, notice: null })
  }

  /**
   * A started game this device can rejoin: the one of this tab (after a
   * reload) or the last one saved by a tab/app that has since been closed.
   */
  resumable(): ResumeInfo | null {
    if (this.node) return null
    return findResumable(
      { tab: this.opts.store, persist: this.opts.persist, now: Date.now() },
      this.tabId,
      (s) => clearPersisted(this.opts.persist, s.roomId, s.id)
    )
  }

  forgetSession() {
    const info = this.resumable()
    if (info) clearPersisted(this.opts.persist, info.roomId, info.session.id)
    clearResume(this.opts.persist)
    saveSession(this.opts.store, null)
    this.session = null
    this.set({})
  }

  /** While in a started game, keep the resume record fresh (2s heartbeat). */
  private startResumeBeat() {
    this.stopResumeBeat()
    this.resumeTimer = setInterval(
      () => this.touchResumeRecord(),
      RESUME_BEAT_MS
    )
    this.touchResumeRecord()
  }

  /** Called on the timer and on every node change, so the record exists as soon as the game does. */
  private touchResumeRecord() {
    const session = this.session
    const state = this.node?.getView().state
    if (!session || !state || state.phase === "FINISHED") return
    const now = Date.now()
    if (now - this.lastResumeTouch < 1000) return
    this.lastResumeTouch = now
    touchResume(this.opts.persist, session, this.tabId, now)
  }

  private stopResumeBeat() {
    if (this.resumeTimer) clearInterval(this.resumeTimer)
    this.resumeTimer = null
  }

  private newTransport(): WebRtcTransport {
    this.transport?.closeAll()
    this.transport = new WebRtcTransport({
      iceServers: this.opts.iceServers ?? DEFAULT_ICE,
      gatherTimeoutMs: 4000,
    })
    return this.transport
  }

  private attachNode(node: GameNode) {
    this.unsubNode?.()
    this.node = node
    this.unsubNode = node.subscribe(() => {
      this.maintainInvite()
      this.confirmConnecting(node)
      this.touchResumeRecord()
      for (const fn of this.listeners) fn()
    })
    this.startResumeBeat()
    this.set({ screen: { name: "room" }, busy: false })
  }

  /** "Connecting Bob…" turns into "Bob joined" once his link is open. */
  private confirmConnecting(node: GameNode) {
    const n = this.state.notice
    if (n?.code !== "connecting" || !n.params?.id) return
    const peer = node.getView().peers.find((p) => p.id === n.params?.id)
    if (peer?.link !== "connected") return
    const code = n.params.kind === "rejoin" ? "rejoined" : "joined"
    this.set({ notice: { code, params: n.params } })
    setTimeout(() => {
      if (this.state.notice?.code === code) this.set({ notice: null })
    }, 4000)
  }

  // ---------------------------------------------------------------- Host

  async createRoom(name: string, config: GameConfig = DEFAULT_CONFIG) {
    try {
      this.set({ busy: true, error: null })
      saveName(name)
      const session = await newSession(newRoomId(), sanitizeName(name))
      this.session = session
      saveSession(this.opts.store, session)
      const transport = this.newTransport()
      const node = new GameNode({
        roomId: session.roomId,
        identity: {
          id: session.id,
          name: session.name,
          secretHash: session.secretHash,
        },
        transport,
        mode: { kind: "host", config },
        store: this.opts.persist,
        logger: this.logger,
      })
      this.attachNode(node)
      await this.createInvite("join")
      // Node notifications stop when the Host is alone in the lobby, so the
      // invite expiry check also runs on a timer.
      this.stopInviteTimer()
      this.inviteTimer = setInterval(() => this.maintainInvite(), 10_000)
    } catch (e) {
      this.fail(e)
    }
  }

  /** Lobby Host keeps exactly one open join invite while seats remain. */
  private maintainInvite() {
    const node = this.node
    if (!node) return
    const inv = this.state.invite
    if (node.isLobbyHost()) {
      if (!inv && node.canAcceptGuests() && !this.state.busy)
        void this.createInvite("join")
      // An invite is only valid for INVITE_TTL_MS; replace it before the
      // Host's lobby silently stops accepting answers.
      if (
        inv &&
        inv.kind === "join" &&
        !this.state.busy &&
        Date.now() - inv.createdAt > INVITE_TTL_MS - INVITE_RENEW_MARGIN_MS
      )
        void this.createInvite("join")
      if (inv && inv.kind === "join" && !node.canAcceptGuests())
        this.cancelInvite()
    } else if (inv && inv.kind === "join") {
      this.cancelInvite()
    }
  }

  private stopInviteTimer() {
    if (this.inviteTimer) clearInterval(this.inviteTimer)
    this.inviteTimer = null
  }

  cancelInvite() {
    for (const { link } of this.invites.values()) link.close()
    this.invites.clear()
    this.set({ invite: null })
  }

  /** join: lobby Host invites a new player. rejoin: any member invites a returning one. */
  async createInvite(kind: InviteKind) {
    const node = this.node
    const transport = this.transport
    if (!node || !transport) return
    this.cancelInvite()
    this.set({ busy: true })
    try {
      const link = transport.createUnbound()
      const sdp = await link.createOffer()
      const info: OpenInvite = {
        nonce: randomToken(8),
        kind,
        createdAt: Date.now(),
      }
      const packed = await encodeOffer({
        r: node.roomId,
        h: node.id,
        n: info.nonce,
        k: kind,
        s: sdp,
      })
      this.invites.set(info.nonce, { link, info })
      this.set({
        busy: false,
        invite: {
          kind,
          url: offerUrl(this.opts.baseUrl, packed),
          nonce: info.nonce,
          createdAt: info.createdAt,
        },
      })
    } catch (e) {
      this.fail(e)
    }
  }

  /** Host (or inviting member) scanned / pasted a player's answer. */
  async submitAnswer(text: string): Promise<boolean> {
    const node = this.node
    const transport = this.transport
    if (!node || !transport) return false
    try {
      const a = await decodeAnswer(text)
      const entry = this.invites.get(a.n)
      const err = checkAnswer(a, {
        roomId: node.roomId,
        selfId: node.id,
        invite: entry?.info,
        now: Date.now(),
      })
      if (err || !entry) throw new AppError(err ?? "inviteUsed")
      if (entry.info.kind === "join") {
        const reject = node.addGuest({ id: a.p, name: a.m, secretHash: a.x })
        if (reject)
          throw new AppError(reject === "full" ? "roomFull" : "gameStarted")
      } else {
        const member = node.getMember(a.p)
        if (!member) throw new AppError("notMember")
        if ((await sha256Hex(a.x)) !== member.secretHash)
          throw new AppError("authFailed")
      }
      this.invites.delete(a.n)
      transport.bind(a.p, entry.link)
      await entry.link.acceptAnswer(a.s)
      this.set({
        invite: null,
        notice: {
          code: "connecting",
          params: { name: a.m, id: a.p, kind: entry.info.kind },
        },
        error: null,
      })
      if (entry.info.kind === "join") this.maintainInvite()
      return true
    } catch (e) {
      this.fail(e)
      return false
    }
  }

  // ---------------------------------------------------------------- Player

  /**
   * Show the join screen right away, then decode the invite so the screen can
   * say what it is (new player vs. rejoin) or why it is unusable.
   */
  openJoin(offerText: string) {
    this.set({
      screen: { name: "join", offerText, offer: null, offerError: null },
      error: null,
    })
    decodeOffer(offerText).then(
      (o) => {
        this.setJoinPeek(
          offerText,
          { roomId: o.r, kind: o.k, inviterId: o.h },
          null
        )
        // Nothing to confirm when coming back to a game we are part of: the
        // player already chose to rejoin by scanning, so go straight on.
        const info = o.k === "rejoin" ? this.resumable() : null
        if (info && info.roomId === o.r && info.status === "ready")
          void this.acceptOffer(offerText, info.session.name)
      },
      (e) =>
        this.setJoinPeek(
          offerText,
          null,
          e instanceof QrError ? e.code : "offerInvalid"
        )
    )
  }

  private setJoinPeek(
    offerText: string,
    offer: OfferPeek | null,
    offerError: AppErrorCode | null
  ) {
    const s = this.state.screen
    if (s.name !== "join" || s.offerText !== offerText) return
    this.set({ screen: { ...s, offer, offerError } })
  }

  /** Player scanned the Host's (or a member's) offer: create the answer QR. */
  async acceptOffer(offerText: string, name: string) {
    let transport: WebRtcTransport | null = null
    try {
      this.set({ busy: true, error: null })
      const o = await decodeOffer(offerText)
      let session: Session
      const rejoin = o.k === "rejoin"
      if (rejoin) {
        const info = this.resumable()
        if (!info || info.roomId !== o.r)
          throw new AppError("noPreviousSession", { roomId: o.r })
        if (info.status === "openElsewhere") throw new AppError("openElsewhere")
        session = info.session
        this.session = session
        saveSession(this.opts.store, session)
      } else {
        saveName(name)
        session = await newSession(o.r, sanitizeName(name))
        this.session = session
        saveSession(this.opts.store, session)
      }
      transport = this.newTransport()
      const link = transport.createUnbound()
      transport.bind(o.h, link)
      const sdp = await link.acceptOffer(o.s)
      const answerText = await encodeAnswer({
        r: o.r,
        h: o.h,
        n: o.n,
        p: session.id,
        m: session.name,
        x: rejoin ? session.secret : session.secretHash,
        s: sdp,
      })
      this.set({
        busy: false,
        screen: {
          name: "answer",
          answerText,
          roomId: o.r,
          rejoin,
          startedAt: Date.now(),
        },
      })
      await transport.waitOpen(o.h, CONNECT_TIMEOUT_MS)
      if (this.transport !== transport) return
      const node = new GameNode({
        roomId: o.r,
        identity: {
          id: session.id,
          name: session.name,
          secretHash: session.secretHash,
        },
        transport,
        mode: rejoin ? { kind: "restore" } : { kind: "guest", hostId: o.h },
        store: this.opts.persist,
        logger: this.logger,
      })
      this.attachNode(node)
    } catch (e) {
      // Cancelled or superseded (backHome, a newer join): nothing to report.
      if (transport && this.transport !== transport) return
      if (e instanceof Error && e.message === "timeout") {
        // Leave the dead-end "waiting" screen; the error banner explains why.
        this.transport?.closeAll()
        this.transport = null
        this.set({ screen: { name: "home" } })
        this.fail(new AppError("connectTimeout"))
      } else this.fail(e)
    }
  }

  // ---------------------------------------------------------------- Common

  leave() {
    this.stopInviteTimer()
    this.stopResumeBeat()
    clearResume(this.opts.persist)
    this.node?.leave()
    this.node?.stop()
    this.unsubNode?.()
    this.node = null
    this.cancelInvite()
    this.transport?.closeAll()
    this.transport = null
    saveSession(this.opts.store, null)
    this.session = null
    this.set({
      screen: { name: "home" },
      invite: null,
      error: null,
      notice: null,
    })
  }

  backHome() {
    this.transport?.closeAll()
    this.transport = null
    this.set({ screen: { name: "home" }, busy: false })
  }
}
