import { describe, expect, it } from "vitest"

import { generateBoard } from "@/game/board"
import { generateTargets } from "@/game/generator"
import { checkInvariants } from "@/game/invariants"
import {
  applyEvent,
  currentTarget,
  quorumSize,
  stateHash,
  validateEvent,
} from "@/game/reducer"
import type { GameConfig, GameEvent, GameState, Member } from "@/game/types"
import { DEFAULT_CONFIG } from "@/game/types"

const members: Member[] = [
  { id: "a", name: "A", color: "#f00", joinSequence: 1, secretHash: "x" },
  { id: "b", name: "B", color: "#0f0", joinSequence: 2, secretHash: "y" },
]

function start(config: Partial<GameConfig> = {}, seed = 42): GameState {
  const cfg = { ...DEFAULT_CONFIG, numberCount: 5, ...config }
  return applyEvent(null, {
    type: "GAME_STARTED",
    term: 0,
    index: 1,
    payload: { roomId: "R", hostId: "a", config: cfg, members, seed },
  })
}

function next(
  s: GameState,
  e: Omit<GameEvent, "index" | "term"> & { term?: number }
): GameState {
  return applyEvent(s, { term: 0, ...e, index: s.logIndex + 1 } as GameEvent)
}

function play(s: GameState): GameState {
  return next(s, { type: "PLAY_BEGIN", payload: {} })
}

function find(s: GameState, winner = "a"): GameState {
  return next(s, {
    type: "NUMBER_FOUND",
    payload: { number: currentTarget(s)!, winner, requestId: `r${s.logIndex}` },
  })
}

describe("A. game engine", () => {
  it("G01 sequential targets", () => {
    expect(
      generateTargets(
        { ...DEFAULT_CONFIG, numberCount: 5, numberMode: "SEQUENTIAL" },
        1
      )
    ).toEqual([1, 2, 3, 4, 5])
  })

  it("G02 fixed step", () => {
    expect(
      generateTargets(
        {
          ...DEFAULT_CONFIG,
          numberCount: 4,
          numberMode: "FIXED_STEP",
          step: 3,
        },
        1
      )
    ).toEqual([1, 4, 7, 10])
  })

  it("G03 random steps deterministic given seed/config", () => {
    const cfg: GameConfig = {
      ...DEFAULT_CONFIG,
      numberCount: 30,
      numberMode: "RANDOM_STEP",
      randomSteps: [3, 10, 20],
    }
    const a = generateTargets(cfg, 99)
    expect(generateTargets(cfg, 99)).toEqual(a)
    expect(generateTargets(cfg, 100)).not.toEqual(a)
    for (let i = 1; i < a.length; i++)
      expect([3, 10, 20]).toContain(a[i] - a[i - 1])
    expect(a[0]).toBe(1)
  })

  it("G04 traditional board: positions unchanged after commit", () => {
    let s = play(start({ mode: "TRADITIONAL" }))
    const before = generateBoard(
      s.seed,
      s.layoutVersion,
      s.targets,
      s.config.sizeMode
    )
    s = find(s)
    expect(s.layoutVersion).toBe(0)
    expect(
      generateBoard(s.seed, s.layoutVersion, s.targets, s.config.sizeMode)
    ).toEqual(before)
  })

  it("G05 random board: layout changes after commit", () => {
    let s = play(start({ mode: "RANDOM", numberCount: 20 }))
    const before = generateBoard(
      s.seed,
      s.layoutVersion,
      s.targets,
      s.config.sizeMode
    )
    s = find(s)
    expect(s.layoutVersion).toBe(1)
    expect(
      generateBoard(s.seed, s.layoutVersion, s.targets, s.config.sizeMode)
    ).not.toEqual(before)
  })

  it("G06 final target => FINISHED in the same committed event", () => {
    let s = play(start({ numberCount: 5 }))
    for (let i = 0; i < 5; i++) {
      const prev = s
      s = find(s, i % 2 ? "b" : "a")
      checkInvariants(s, prev)
    }
    expect(s.phase).toBe("FINISHED")
    expect(s.scores).toEqual({ a: 3, b: 2 })
    expect(currentTarget(s)).toBeNull()
  })

  it("G07 same seed => same board on all peers; cells stay inside the board", () => {
    const t = generateTargets({ ...DEFAULT_CONFIG, numberCount: 100 }, 7)
    const a = generateBoard(7, 3, t, "RANDOM")
    expect(generateBoard(7, 3, t, "RANDOM")).toEqual(a)
    const slots = new Set(a.map((c) => `${c.x},${c.y}`))
    expect(slots.size).toBe(100)
    for (const c of a) {
      expect(c.x).toBeGreaterThan(0)
      expect(c.y).toBeGreaterThan(0)
      expect(c.x).toBeLessThan(3000)
      expect(c.y).toBeLessThan(4000)
    }
  })

  it("rejects invalid events without mutating", () => {
    const s = play(start())
    const wrong = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: 99, winner: "a", requestId: "x" },
    } as GameEvent
    expect(validateEvent(s, wrong)).toBe("notCurrentTarget")
    expect(() => applyEvent(s, wrong)).toThrow()
    const fakeWinner = {
      ...wrong,
      payload: { number: currentTarget(s)!, winner: "zz", requestId: "x" },
    } as GameEvent
    expect(validateEvent(s, fakeWinner)).toBe("winner")
    const gap = {
      ...wrong,
      index: s.logIndex + 2,
      payload: { number: currentTarget(s)!, winner: "a", requestId: "x" },
    } as GameEvent
    expect(validateEvent(s, gap)).toBe("index")
    expect(
      validateEvent(start(), {
        type: "PLAY_BEGIN",
        term: 0,
        index: 2,
        payload: {},
      })
    ).toBeNull()
  })

  it("HOST_CHANGED moves to countdown and requires a higher term", () => {
    const s = play(start())
    expect(
      validateEvent(s, {
        type: "HOST_CHANGED",
        term: 0,
        index: s.logIndex + 1,
        payload: { hostId: "b", term: 0 },
      })
    ).toBe("staleTerm")
    expect(
      validateEvent(s, {
        type: "HOST_CHANGED",
        term: 1,
        index: s.logIndex + 1,
        payload: { hostId: "b", term: 2 },
      })
    ).toBe("staleTerm")
    const s2 = applyEvent(s, {
      type: "HOST_CHANGED",
      term: 1,
      index: s.logIndex + 1,
      payload: { hostId: "b", term: 1 },
    })
    // Re-proposing the same entry in a later term yields an identical state.
    expect(
      applyEvent(s, {
        type: "HOST_CHANGED",
        term: 5,
        index: s.logIndex + 1,
        payload: { hostId: "b", term: 1 },
      })
    ).toEqual(s2)
    expect(s2.leadership).toEqual({ hostId: "b", term: 1 })
    expect(s2.phase).toBe("COUNTDOWN")
  })

  it("REMATCH resets scores and keeps membership", () => {
    let s = play(start({ numberCount: 5 }))
    for (let i = 0; i < 5; i++) s = find(s)
    const r = next(s, {
      type: "REMATCH",
      payload: { config: { ...s.config, numberCount: 6 }, seed: 5 },
    })
    expect(r.round).toBe(2)
    expect(r.targets.length).toBe(6)
    expect(r.scores).toEqual({ a: 0, b: 0 })
    expect(r.members).toEqual(s.members)
  })

  it("state hash is canonical (key order independent)", () => {
    const s = start()
    const shuffled = JSON.parse(JSON.stringify(s, Object.keys(s).reverse()))
    expect(stateHash({ ...shuffled, ...s })).toBe(stateHash(s))
  })

  it("quorum sizes", () => {
    expect([2, 3, 4, 5, 8].map(quorumSize)).toEqual([2, 2, 3, 3, 5])
  })
})
