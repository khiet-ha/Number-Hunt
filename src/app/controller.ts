import type { GameConfig } from "@/game/types"
import { DEFAULT_CONFIG } from "@/game/types"
import { EventLogger, type KeyValueStore } from "@/multiplayer/env"
import { GameNode, loadPersisted, sanitizeName } from "@/multiplayer/node"
import {
  checkAnswer,
  decodeAnswer,
  decodeOffer,
  encodeAnswer,
  encodeOffer,
  INVITE_TTL_MS,
  offerUrl,
  type InviteKind,
  type OpenInvite,
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

/**
 * Wires QR bootstrap ↔ WebRTC transport ↔ GameNode for the UI.
 * Holds no game rules; everything replicated lives in GameNode.
 */

export type Screen =
  | { name: "home" }
  | { name: "join"; offerText: string }
  | { name: "answer"; answerText: string; roomId: string; rejoin: boolean }
  | { name: "room" }

export interface InviteView {
  kind: InviteKind
  url: string
  nonce: string
  createdAt: number
}

export interface AppState {
  screen: Screen
  error: string | null
  notice: string | null
  busy: boolean
  invite: InviteView | null
}

export interface AppOptions {
  store: KeyValueStore
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

  constructor(private readonly opts: AppOptions) {
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
    this.set({
      error: err instanceof Error ? err.message : String(err),
      busy: false,
    })
  }

  clearError() {
    this.set({ error: null, notice: null })
  }

  /** A previous in-game session on this tab that can be rejoined. */
  resumable(): Session | null {
    const s = this.session
    if (!s || this.node) return null
    return loadPersisted(this.opts.store, s.roomId, s.id)?.state ? s : null
  }

  forgetSession() {
    saveSession(this.opts.store, null)
    this.session = null
    this.set({})
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
      for (const fn of this.listeners) fn()
    })
    this.set({ screen: { name: "room" }, busy: false })
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
        store: this.opts.store,
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
      if (err || !entry) throw new Error(err ?? "Mã mời không còn hiệu lực")
      if (entry.info.kind === "join") {
        const reject = node.addGuest({ id: a.p, name: a.m, secretHash: a.x })
        if (reject)
          throw new Error(
            reject === "full"
              ? "Phòng đã đủ người"
              : "Trận đã bắt đầu, không thể tham gia"
          )
      } else {
        const member = node.getMember(a.p)
        if (!member) throw new Error("Người này không thuộc trận đấu")
        if ((await sha256Hex(a.x)) !== member.secretHash)
          throw new Error("Không xác thực được người chơi")
      }
      this.invites.delete(a.n)
      transport.bind(a.p, entry.link)
      await entry.link.acceptAnswer(a.s)
      this.set({ invite: null, notice: `Đang kết nối ${a.m}…`, error: null })
      if (entry.info.kind === "join") this.maintainInvite()
      return true
    } catch (e) {
      this.fail(e)
      return false
    }
  }

  // ---------------------------------------------------------------- Player

  openJoin(offerText: string) {
    this.set({ screen: { name: "join", offerText }, error: null })
  }

  /** Player scanned the Host's (or a member's) offer: create the answer QR. */
  async acceptOffer(offerText: string, name: string) {
    try {
      this.set({ busy: true, error: null })
      const o = await decodeOffer(offerText)
      let session: Session
      const rejoin = o.k === "rejoin"
      if (rejoin) {
        const prev = this.session
        if (
          !prev ||
          prev.roomId !== o.r ||
          !loadPersisted(this.opts.store, prev.roomId, prev.id)?.state
        ) {
          throw new Error(
            "Thiết bị/tab này không có phiên chơi trước của phòng " + o.r
          )
        }
        session = prev
      } else {
        saveName(name)
        session = await newSession(o.r, sanitizeName(name))
        this.session = session
        saveSession(this.opts.store, session)
      }
      const transport = this.newTransport()
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
        screen: { name: "answer", answerText, roomId: o.r, rejoin },
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
        store: this.opts.store,
        logger: this.logger,
      })
      this.attachNode(node)
    } catch (e) {
      if (e instanceof Error && e.message === "timeout")
        this.fail(new Error("Không kết nối được. Hãy thử lại với mã mời mới."))
      else this.fail(e)
    }
  }

  // ---------------------------------------------------------------- Common

  leave() {
    this.stopInviteTimer()
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
