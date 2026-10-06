import { stateHash } from "@/game/reducer"
import type { GameNode } from "@/multiplayer/node"
import {
  PROTOCOL_VERSION,
  type Envelope,
  type MessageType,
  type Payloads,
} from "@/multiplayer/protocol"
import { roomId, type Room } from "./sim"

let counter = 0

/** Send a hand-crafted envelope over the (from → to) link. */
export function inject<T extends MessageType>(
  room: Room,
  from: string,
  to: string,
  type: T,
  payload: Payloads[T],
  over: Partial<Envelope> = {}
): void {
  const env = {
    protocol: PROTOCOL_VERSION,
    type,
    roomId,
    senderId: from,
    term: room.node(from)?.getView().term ?? 0,
    messageId: `inj.${++counter}`,
    payload,
    ...over,
  }
  room.net.transport(from).send(to, JSON.stringify(env))
}

export function injectRaw(
  room: Room,
  from: string,
  to: string,
  raw: string
): void {
  room.net.transport(from).send(to, raw)
}

export function logHas(node: GameNode, type: string): boolean {
  return node.logger.entries.some((e) => e.type === type)
}

export function hashes(room: Room): Set<string> {
  return new Set(
    room
      .live()
      .map((n) => (n.getView().state ? stateHash(n.getView().state!) : "null"))
  )
}

export function converged(room: Room): boolean {
  const views = room.live().map((n) => n.getView())
  return views.every((v) => v.status === "ACTIVE") && hashes(room).size === 1
}

export function totalScore(node: GameNode): number {
  const s = node.getView().state!
  return Object.values(s.scores).reduce((a, b) => a + b, 0)
}

/** Records (logIndex → hash) seen on any node; flags divergence. */
export class SafetyMonitor {
  private seen = new Map<string, string>()
  private states = new Map<string, { id: string; s: unknown }>()
  violations: string[] = []
  firstDetail: string | null = null
  sample(room: Room) {
    for (const n of room.live()) {
      const s = n.getView().state
      if (!s) continue
      const key = `${s.round}:${s.logIndex}`
      const h = stateHash(s)
      const prev = this.seen.get(key)
      if (prev && prev !== h) {
        this.violations.push(`${n.id} diverged at ${key}`)
        if (!this.firstDetail) {
          const o = this.states.get(key)!
          this.firstDetail = `t=${room.net.clock.now()} ${o.id}: ${JSON.stringify(o.s)}\n${n.id}: ${JSON.stringify(s)}`
        }
      } else if (!prev) {
        this.seen.set(key, h)
        this.states.set(key, { id: n.id, s: structuredClone(s) })
      }
    }
  }
}
