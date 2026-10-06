import { mulberry32 } from "@/game/rng"
import type { GameConfig, PlayerId } from "@/game/types"
import { DEFAULT_CONFIG } from "@/game/types"
import type {
  Clock,
  LinkState,
  Transport,
  TransportHandlers,
} from "@/multiplayer/env"
import { EventLogger, MemoryStore } from "@/multiplayer/env"
import { GameNode, type NodeMode, type Timings } from "@/multiplayer/node"

/** Deterministic virtual clock + timer queue. */
export class SimClock implements Clock {
  private t = 0
  private seq = 0
  private q: { at: number; seq: number; fn: () => void; dead?: boolean }[] = []
  now() {
    return this.t
  }
  setTimeout(fn: () => void, ms: number) {
    const item = { at: this.t + Math.max(0, ms), seq: this.seq++, fn }
    this.q.push(item)
    return item
  }
  clearTimeout(h: unknown) {
    if (h) (h as { dead?: boolean }).dead = true
  }
  /** Run all timers due within `ms`. */
  advance(ms: number) {
    const end = this.t + ms
    for (;;) {
      let best = -1
      for (let i = 0; i < this.q.length; i++) {
        const it = this.q[i]
        if (it.at > end) continue
        if (
          best < 0 ||
          it.at < this.q[best].at ||
          (it.at === this.q[best].at && it.seq < this.q[best].seq)
        )
          best = i
      }
      if (best < 0) break
      const [it] = this.q.splice(best, 1)
      this.t = Math.max(this.t, it.at)
      if (!it.dead) it.fn()
    }
    this.t = end
  }
}

export interface NetOptions {
  latency: [number, number]
  drop: number
  dup: number
  /** If false, messages on a link may be reordered by jitter. */
  fifo: boolean
  seed: number
}

interface Link {
  up: boolean
  epoch: number
  lastAt: Record<string, number>
}

export class SimNetwork {
  readonly clock = new SimClock()
  readonly opts: NetOptions
  private rng: () => number
  private handlers = new Map<PlayerId, TransportHandlers>()
  private links = new Map<string, Link>()
  /** Intercept hook for tests: return false to drop. */
  filter: ((from: PlayerId, to: PlayerId, data: string) => boolean) | null =
    null
  delivered = 0

  constructor(opts: Partial<NetOptions> = {}) {
    this.opts = {
      latency: [2, 10],
      drop: 0,
      dup: 0,
      fifo: true,
      seed: 1,
      ...opts,
    }
    const r = mulberry32(this.opts.seed)
    this.rng = () => r() / 0x100000000
  }

  private key(a: PlayerId, b: PlayerId) {
    return a < b ? `${a}|${b}` : `${b}|${a}`
  }

  link(a: PlayerId, b: PlayerId): Link | undefined {
    return this.links.get(this.key(a, b))
  }

  connect(a: PlayerId, b: PlayerId) {
    const k = this.key(a, b)
    const l = this.links.get(k) ?? { up: false, epoch: 0, lastAt: {} }
    if (l.up) return
    l.up = true
    l.epoch++
    l.lastAt = {}
    this.links.set(k, l)
    this.handlers.get(a)?.onLinkState(b, "connected")
    this.handlers.get(b)?.onLinkState(a, "connected")
  }

  disconnect(a: PlayerId, b: PlayerId, state: LinkState = "failed") {
    const l = this.links.get(this.key(a, b))
    if (!l || !l.up) return
    l.up = false
    l.epoch++
    this.handlers.get(a)?.onLinkState(b, state)
    this.handlers.get(b)?.onLinkState(a, state)
  }

  /** Silently stop delivering (no link-state event): simulates a frozen peer. */
  blackhole(a: PlayerId, b: PlayerId) {
    const l = this.links.get(this.key(a, b))
    if (!l) return
    l.epoch++
    l.up = false
  }

  peersOf(id: PlayerId): PlayerId[] {
    const out: PlayerId[] = []
    for (const [k, l] of this.links) {
      if (!l.up) continue
      const [a, b] = k.split("|")
      if (a === id) out.push(b)
      else if (b === id) out.push(a)
    }
    return out
  }

  transport(id: PlayerId): Transport {
    return {
      setHandlers: (h) => void this.handlers.set(id, h),
      send: (to, data) => this.send(id, to, data),
      linkState: (peer) => {
        const l = this.link(id, peer)
        return !l ? "none" : l.up ? "connected" : "failed"
      },
      openPeers: () => this.peersOf(id),
      close: (peer) => this.disconnect(id, peer, "closed"),
      closeAll: () =>
        this.peersOf(id).forEach((p) => this.disconnect(id, p, "closed")),
    }
  }

  detach(id: PlayerId) {
    for (const p of this.peersOf(id)) this.disconnect(id, p, "closed")
    this.handlers.delete(id)
  }

  private send(from: PlayerId, to: PlayerId, data: string): boolean {
    const l = this.link(from, to)
    if (!l || !l.up) return false
    if (this.filter && !this.filter(from, to, data)) return true
    const copies = this.rng() < this.opts.dup ? 2 : 1
    for (let c = 0; c < copies; c++) {
      if (this.rng() < this.opts.drop) continue
      const [lo, hi] = this.opts.latency
      let at = this.clock.now() + lo + Math.floor(this.rng() * (hi - lo + 1))
      const dir = `${from}>${to}`
      if (this.opts.fifo) {
        at = Math.max(at, l.lastAt[dir] ?? 0)
        l.lastAt[dir] = at
      }
      const epoch = l.epoch
      this.clock.setTimeout(() => {
        if (!l.up || l.epoch !== epoch) return
        this.delivered++
        this.handlers.get(to)?.onMessage(from, data)
      }, at - this.clock.now())
    }
    return true
  }
}

export const FAST: Partial<Timings> = {}

export interface Room {
  net: SimNetwork
  nodes: Map<PlayerId, GameNode>
  stores: Map<PlayerId, MemoryStore>
  ids: PlayerId[]
  node(id: PlayerId): GameNode
  run(ms: number): void
  runUntil(pred: () => boolean, maxMs?: number, step?: number): boolean
  kill(id: PlayerId): void
  revive(id: PlayerId): GameNode
  live(): GameNode[]
  leaderOf(): GameNode[]
}

export const roomId = "ROOM01"

export function makeNode(
  net: SimNetwork,
  id: PlayerId,
  mode: NodeMode,
  store: MemoryStore,
  seed: number,
  timings?: Partial<Timings>
) {
  const r = mulberry32(seed)
  return new GameNode({
    roomId,
    identity: { id, name: id, secretHash: `h_${id}` },
    transport: net.transport(id),
    mode,
    clock: net.clock,
    store,
    timings,
    logger: new EventLogger(2000),
    random: () => r() / 0x100000000,
  })
}

/** Build a lobby with n players, full mesh, everybody ready; does not start. */
export function createLobby(
  n: number,
  opts: {
    net?: Partial<NetOptions>
    config?: Partial<GameConfig>
    timings?: Partial<Timings>
  } = {}
): Room {
  const net = new SimNetwork(opts.net)
  const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`)
  const nodes = new Map<PlayerId, GameNode>()
  const stores = new Map<PlayerId, MemoryStore>()
  const config: GameConfig = {
    ...DEFAULT_CONFIG,
    numberCount: 10,
    ...opts.config,
  }
  ids.forEach((id, i) => {
    const store = new MemoryStore()
    stores.set(id, store)
    const mode: NodeMode =
      i === 0 ? { kind: "host", config } : { kind: "guest", hostId: ids[0] }
    nodes.set(id, makeNode(net, id, mode, store, 1000 + i, opts.timings))
  })
  const host = nodes.get(ids[0]) as GameNode
  for (const id of ids.slice(1)) {
    host.addGuest({ id, name: id, secretHash: `h_${id}` })
    net.connect(ids[0], id)
  }
  for (let i = 1; i < n; i++)
    for (let j = i + 1; j < n; j++) net.connect(ids[i], ids[j])
  const room: Room = {
    net,
    nodes,
    stores,
    ids,
    node: (id) => nodes.get(id) as GameNode,
    run: (ms) => net.clock.advance(ms),
    runUntil(pred, maxMs = 30000, step = 50) {
      for (let t = 0; t <= maxMs; t += step) {
        if (pred()) return true
        net.clock.advance(step)
      }
      return pred()
    },
    kill(id) {
      nodes.get(id)?.stop()
      net.detach(id)
      nodes.delete(id)
    },
    revive(id) {
      const node = makeNode(
        net,
        id,
        { kind: "restore" },
        stores.get(id) as MemoryStore,
        5000 + Math.floor(net.clock.now()),
        opts.timings
      )
      nodes.set(id, node)
      return node
    },
    live: () => [...nodes.values()],
    leaderOf: () => [...nodes.values()].filter((nd) => nd.getView().isLeader),
  }
  room.run(1500) // heartbeats exchange links
  for (const id of ids.slice(1)) room.node(id).setReady(true)
  room.run(200)
  return room
}

/** Lobby → GAME_STARTED → countdown → PLAYING. */
export function createGame(
  n: number,
  opts: Parameters<typeof createLobby>[1] = {}
): Room {
  const room = createLobby(n, opts)
  const err = room.node(room.ids[0]).startGame()
  if (err) throw new Error(`startGame: ${err}`)
  const ok = room.runUntil(
    () =>
      room
        .live()
        .every(
          (nd) =>
            nd.getView().state?.phase === "PLAYING" &&
            nd.getView().status === "ACTIVE"
        ),
    20000
  )
  if (!ok) throw new Error("game did not reach PLAYING")
  return room
}

export function target(node: GameNode): number {
  const s = node.getView().state!
  return s.targets[s.targetIndex]
}
