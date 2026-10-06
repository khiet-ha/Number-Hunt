import { describe, expect, it } from "vitest"

import { checkInvariants } from "@/game/invariants"
import { mulberry32 } from "@/game/rng"
import type { GameState } from "@/game/types"
import { SafetyMonitor, converged } from "./helpers"
import { createGame, target, type Room } from "./sim"

function botsClick(room: Room, rnd: () => number) {
  for (const n of room.live()) {
    const v = n.getView()
    if (v.status === "ACTIVE" && v.state?.phase === "PLAYING" && rnd() < 0.5)
      n.click(target(n))
  }
}

function checkAll(
  room: Room,
  prev: Map<string, GameState>,
  mon: SafetyMonitor
) {
  mon.sample(room)
  for (const n of room.live()) {
    const s = n.getView().state
    if (!s) continue
    const p = prev.get(n.id)
    checkInvariants(s, p && p.round === s.round ? p : undefined)
    prev.set(n.id, s)
  }
}

function scenario(seed: number) {
  const room = createGame(8, {
    net: { seed, latency: [5, 20] },
    config: { numberCount: 100, mode: seed % 2 ? "RANDOM" : "TRADITIONAL" },
  })
  // Turn on the hostile network only after the lobby (lobby messages are not retried).
  Object.assign(room.net.opts, {
    latency: [100, 300],
    drop: 0.05 + (seed % 6) / 100,
    dup: 0.05,
    fifo: seed % 3 !== 0,
  })
  const r = mulberry32(seed * 7919)
  const rnd = () => r() / 0x100000000
  const mon = new SafetyMonitor()
  const prev = new Map<string, GameState>()
  const dead = new Set<string>()
  const kills: string[] = []

  for (let step = 0; step < 900; step++) {
    // all live bots click the target within the same 100 ms window
    if (step % 2 === 0) botsClick(room, rnd)
    room.run(50)
    checkAll(room, prev, mon)

    // Kill the Host at a random point (immediately after a proposal / commit included).
    if (step % 150 === 75 && dead.size < 3) {
      const leader = room.live().find((n) => n.getView().isLeader)
      if (leader) {
        room.kill(leader.id)
        dead.add(leader.id)
        kills.push(`host:${leader.id}@${step}`)
      }
    }
    // Kill a random follower too, sometimes.
    if (step % 200 === 130 && dead.size < 3) {
      const live = room.live().filter((n) => !n.getView().isLeader)
      const victim = live[Math.floor(rnd() * live.length)]
      if (victim) {
        room.kill(victim.id)
        dead.add(victim.id)
        kills.push(`peer:${victim.id}@${step}`)
      }
    }
    // Reconnect multiple players simultaneously (page reload → restore).
    if (step % 300 === 290 && dead.size) {
      for (const id of dead) {
        room.revive(id)
        for (const other of room.ids)
          if (other !== id && room.nodes.has(other)) room.net.connect(id, other)
      }
      dead.clear()
    }
  }
  // Heal: revive everyone, clean network, wait for convergence.
  for (const id of dead) {
    room.revive(id)
    for (const other of room.ids)
      if (other !== id && room.nodes.has(other)) room.net.connect(id, other)
  }
  Object.assign(room.net.opts, {
    latency: [5, 20],
    drop: 0,
    dup: 0,
    fifo: true,
  })
  const ok = room.runUntil(() => converged(room), 60000)
  checkAll(room, prev, mon)
  return { room, ok, mon, kills }
}

describe("stress", () => {
  const seeds = process.env.STRESS_SEEDS
    ? Array.from({ length: Number(process.env.STRESS_SEEDS) }, (_, i) => i + 1)
    : [1, 2, 3, 4, 5, 6]
  for (const seed of seeds) {
    it(`8 players, lossy/laggy/duplicating network, random Host kills (seed ${seed})`, () => {
      const { room, ok, mon, kills } = scenario(seed)
      expect(mon.violations, kills.join(",")).toEqual([])
      expect(ok, kills.join(",")).toBe(true)
      expect(room.live().length).toBe(8)
      const leaders = room.live().filter((n) => n.getView().isLeader)
      expect(leaders.length).toBe(1)
      // Liveness after healing: the game keeps progressing.
      expect(
        room.runUntil(
          () =>
            room.live().every((n) => n.getView().state!.phase === "PLAYING"),
          10000
        )
      ).toBe(true)
      const before = room.node("p1").getView().state!.targetIndex
      for (let i = 0; i < 3; i++) {
        const want = before + i + 1
        const clicker = room.node(room.ids[i + 3])
        room.runUntil(
          () => {
            if (room.node("p1").getView().state!.targetIndex >= want)
              return true
            clicker.click(target(clicker)) // ignored while an earlier bot click is still pending
            return false
          },
          10000,
          100
        )
        room.run(300)
      }
      expect(room.node("p8").getView().state!.targetIndex).toBe(before + 3)
      expect(converged(room)).toBe(true)
    }, 60000)
  }
})
