import { describe, expect, it } from "vitest"

import { checkInvariants } from "@/game/invariants"
import { currentTarget } from "@/game/reducer"
import type { GameEvent } from "@/game/types"
import {
  converged,
  hashes,
  inject,
  injectRaw,
  logHas,
  SafetyMonitor,
  totalScore,
} from "./helpers"
import { createGame, createLobby, target, type Room } from "./sim"

const status = (room: Room, id: string) => room.node(id).getView().status
const leaders = (room: Room) =>
  room
    .live()
    .filter((n) => n.getView().isLeader)
    .map((n) => n.id)

function killHostAndElect(room: Room, host = "p1"): void {
  room.kill(host)
  const ok = room.runUntil(
    () =>
      converged(room) &&
      room
        .live()
        .every(
          (n) =>
            n.getView().state?.phase === "PLAYING" &&
            n.getView().leaderId !== host &&
            n.getView().leaderId != null
        ),
    30000
  )
  expect(ok).toBe(true)
}

describe("lobby", () => {
  it("cannot start until all ready and fully meshed; join rejected after start", () => {
    const room = createLobby(3)
    room.node("p3").setReady(false)
    room.run(100)
    expect(room.node("p1").startGame()).toBe("notReady")
    room.node("p3").setReady(true)
    room.run(100)
    room.net.disconnect("p2", "p3")
    room.run(1500)
    expect(room.node("p1").getView().startBlockers).toContain("meshIncomplete")
    room.net.connect("p2", "p3")
    room.run(1500)
    expect(room.node("p1").startGame()).toBeNull()
    expect(
      room.node("p1").addGuest({ id: "p9", name: "late", secretHash: "z" })
    ).toBe("started")
  })

  it("lobby host leaving closes the room", () => {
    const room = createLobby(3)
    room.kill("p1")
    room.run(7000)
    expect(status(room, "p2")).toBe("CLOSED")
  })

  it("the lobby Host can remove a stuck guest, who is told why", () => {
    const room = createLobby(3)
    expect(room.node("p1").kickGuest("p3")).toBe(true)
    room.run(300)
    expect(
      room
        .node("p1")
        .getView()
        .lobby!.players.map((p) => p.id)
    ).toEqual(["p1", "p2"])
    expect(room.node("p3").getView().status).toBe("CLOSED")
    expect(room.node("p3").getView().closedReason).toBe("removed")
    // Only the Host may remove, and never itself or a stranger.
    expect(room.node("p2").kickGuest("p1")).toBe(false)
    expect(room.node("p1").kickGuest("p1")).toBe(false)
    expect(room.node("p1").kickGuest("nobody")).toBe(false)
  })

  it("player limit enforced", () => {
    const room = createLobby(2, { config: { playerLimit: 2 } })
    expect(
      room.node("p1").addGuest({ id: "p9", name: "x", secretHash: "z" })
    ).toBe("full")
  })
})

describe("B. click race", () => {
  it("C01 one valid click => one point everywhere", () => {
    const room = createGame(3)
    room.node("p3").click(target(room.node("p3")))
    room.run(300)
    for (const n of room.live())
      expect(n.getView().state!.scores).toEqual({ p1: 0, p2: 0, p3: 1 })
  })

  it("C02 two simultaneous clicks => exactly one winner", () => {
    const room = createGame(3)
    const t = target(room.node("p1"))
    room.node("p2").click(t)
    room.node("p3").click(t)
    room.run(500)
    expect(hashes(room).size).toBe(1)
    const s = room.node("p1").getView().state!
    expect(totalScore(room.node("p1"))).toBe(1)
    expect(s.claimed[String(t)]).toMatch(/p2|p3/)
    const loser = s.claimed[String(t)] === "p2" ? "p3" : "p2"
    expect(room.node(loser).getView().lastReject?.reason).toMatch(
      /reserved|lostRace/
    )
  })

  it("C03 eight simultaneous clicks => exactly one winner", () => {
    const room = createGame(8, { net: { latency: [5, 60] } })
    const t = target(room.node("p1"))
    for (const n of room.live()) n.click(t)
    room.run(1000)
    expect(hashes(room).size).toBe(1)
    expect(totalScore(room.node("p4"))).toBe(1)
  })

  it("C04 wrong number => no state change", () => {
    const room = createGame(3)
    const before = room.node("p1").getView().state
    expect(room.node("p2").click(target(room.node("p2")) + 1)).toBe("wrong")
    inject(room, "p2", "p1", "CLICK_REQUEST", {
      requestId: "bad1",
      number: 999,
    })
    room.run(300)
    expect(room.node("p1").getView().state).toEqual(before)
    expect(logHas(room.node("p1"), "CLICK_REJECTED")).toBe(true)
  })

  it("C05 double click => one point", () => {
    const room = createGame(3)
    const t = target(room.node("p2"))
    expect(room.node("p2").click(t)).toBe("sent")
    expect(room.node("p2").click(t)).toBe("ignored")
    room.run(300)
    room.node("p2").click(t)
    room.run(300)
    expect(room.node("p1").getView().state!.scores.p2).toBe(1)
  })

  it("C06 duplicate requestId ignored", () => {
    const room = createGame(3)
    const t = target(room.node("p1"))
    inject(room, "p2", "p1", "CLICK_REQUEST", { requestId: "same", number: t })
    inject(room, "p2", "p1", "CLICK_REQUEST", { requestId: "same", number: t })
    room.run(300)
    // The next target with the same requestId must also be ignored.
    inject(room, "p2", "p1", "CLICK_REQUEST", {
      requestId: "same",
      number: target(room.node("p1")),
    })
    room.run(300)
    expect(room.node("p1").getView().state!.scores.p2).toBe(1)
    expect(logHas(room.node("p1"), "CLICK_DUP")).toBe(true)
  })

  it("C07 click during migration ignored", () => {
    const room = createGame(3)
    room.kill("p1")
    room.runUntil(() => status(room, "p2") === "MIGRATING", 10000, 20)
    expect(room.node("p2").click(target(room.node("p2")))).toBe("ignored")
  })

  it("C08 stale-term click rejected", () => {
    const room = createGame(3)
    killHostAndElect(room)
    const leader = leaders(room)[0]
    const other = leader === "p2" ? "p3" : "p2"
    const before = room.node(leader).getView().state
    inject(
      room,
      other,
      leader,
      "CLICK_REQUEST",
      { requestId: "old", number: target(room.node(leader)) },
      { term: 0 }
    )
    room.run(300)
    expect(room.node(leader).getView().state).toEqual(before)
  })

  it("C09 already claimed number rejected", () => {
    const room = createGame(3)
    const t = target(room.node("p1"))
    room.node("p2").click(t)
    room.run(300)
    inject(room, "p3", "p1", "CLICK_REQUEST", { requestId: "late", number: t })
    room.run(300)
    expect(room.node("p1").getView().state!.claimed[String(t)]).toBe("p2")
    expect(totalScore(room.node("p1"))).toBe(1)
  })

  it("C10 proposal without quorum => no point; game pauses; commits once quorum returns", () => {
    const room = createGame(3)
    room.net.blackhole("p1", "p2")
    room.net.blackhole("p1", "p3")
    room.node("p1").click(target(room.node("p1")))
    room.run(3000)
    for (const n of room.live()) expect(totalScore(n)).toBe(0)
    expect(status(room, "p1")).toBe("PAUSED")
    room.net.connect("p1", "p2")
    room.net.connect("p1", "p3")
    room.runUntil(() => converged(room), 5000)
    for (const n of room.live()) expect(totalScore(n)).toBeLessThanOrEqual(1)
    expect(hashes(room).size).toBe(1)
  })
})

describe("C. event ordering", () => {
  it("E01 duplicate event ignored", () => {
    const room = createGame(3, { net: { dup: 0.5 } })
    for (let i = 0; i < 3; i++) {
      room.node("p2").click(target(room.node("p2")))
      room.run(400)
    }
    expect(hashes(room).size).toBe(1)
    expect(totalScore(room.node("p3"))).toBe(3)
    expect(logHas(room.node("p3"), "DROP_DUP")).toBe(true)
  })

  it("E02 event gap => snapshot requested and applied", () => {
    const room = createGame(3)
    let dropped = 0
    room.net.filter = (from, to, data) => {
      if (
        to === "p3" &&
        from === "p1" &&
        data.includes('"EVENT_COMMIT"') &&
        dropped === 0
      ) {
        dropped++
        return false
      }
      return true
    }
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    room.node("p2").click(target(room.node("p2")))
    room.run(2500)
    expect(dropped).toBe(1)
    expect(
      room
        .node("p3")
        .logger.entries.some(
          (e) => e.type === "STATE_REQUEST" && e.dir === "out"
        )
    ).toBe(true)
    expect(logHas(room.node("p3"), "SNAPSHOT_APPLIED")).toBe(true)
    expect(converged(room)).toBe(true)
    expect(totalScore(room.node("p3"))).toBe(2)
  })

  it("E03 stale term ignored", () => {
    const room = createGame(3)
    killHostAndElect(room)
    const s = room.node("p3").getView().state!
    const fake = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: currentTarget(s)!, winner: "p2", requestId: "z" },
    } as GameEvent
    inject(
      room,
      "p2",
      "p3",
      "EVENT_PROPOSE",
      { event: fake, commitIndex: s.logIndex },
      { term: 0 }
    )
    room.run(200)
    expect(logHas(room.node("p3"), "DROP_STALE_TERM")).toBe(true)
    expect(room.node("p3").getView().state).toEqual(s)
  })

  it("E04 future term => freeze then reconcile to one history", () => {
    const room = createGame(3)
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    inject(
      room,
      "p2",
      "p3",
      "HEARTBEAT",
      {
        leaderId: null,
        logIndex: 0,
        stateHash: null,
        links: [],
        paused: false,
      },
      { term: 7 }
    )
    room.run(50)
    expect(room.node("p3").getView().term).toBe(7)
    expect(status(room, "p3")).toBe("MIGRATING")
    expect(
      room.runUntil(
        () =>
          converged(room) &&
          room.live().every((n) => n.getView().state!.phase === "PLAYING"),
        30000
      )
    ).toBe(true)
    expect(totalScore(room.node("p3"))).toBe(1)
    expect(room.node("p1").getView().term).toBeGreaterThanOrEqual(7)
  })

  it("E05/S01 spoofed senderId rejected", () => {
    const room = createGame(3)
    inject(
      room,
      "p2",
      "p1",
      "CLICK_REQUEST",
      { requestId: "spoof", number: target(room.node("p1")) },
      { senderId: "p3" }
    )
    room.run(300)
    expect(logHas(room.node("p1"), "DROP_SPOOF")).toBe(true)
    expect(totalScore(room.node("p1"))).toBe(0)
  })

  it("E06/S02/S03 client-supplied winner/score ignored", () => {
    const room = createGame(3)
    const payload = {
      requestId: "x1",
      number: target(room.node("p1")),
      winner: "p3",
      score: 100,
    } as never
    inject(room, "p2", "p1", "CLICK_REQUEST", payload)
    room.run(300)
    expect(room.node("p1").getView().state!.scores).toEqual({
      p1: 0,
      p2: 1,
      p3: 0,
    })
  })
})

describe("D. host migration", () => {
  it("H01 Host disconnects => game freezes", () => {
    const room = createGame(4)
    room.kill("p1")
    expect(
      room.runUntil(
        () =>
          ["p2", "p3", "p4"].every((id) => status(room, id) === "MIGRATING"),
        8000,
        20
      )
    ).toBe(true)
  })

  it("H02/H03 deterministic candidate gets quorum => new Host, new term, game resumes", () => {
    const room = createGame(5)
    room.node("p3").click(target(room.node("p3")))
    room.run(300)
    killHostAndElect(room)
    expect(leaders(room)).toEqual(["p2"])
    for (const n of room.live()) {
      const v = n.getView()
      expect(v.leaderId).toBe("p2")
      expect(v.term).toBe(1)
      expect(v.state!.leadership).toEqual({ hostId: "p2", term: 1 })
      expect(v.state!.scores.p3).toBe(1)
    }
    room.node("p4").click(target(room.node("p4")))
    room.run(300)
    expect(totalScore(room.node("p5"))).toBe(2)
  })

  it("H02 lowest *alive* joinSequence wins when p2 is also dead", () => {
    const room = createGame(5)
    room.kill("p2")
    room.run(100)
    killHostAndElect(room)
    expect(leaders(room)).toEqual(["p3"])
  })

  it("H04 no quorum => remains paused", () => {
    const room = createGame(4)
    room.kill("p1")
    room.kill("p2")
    room.run(30000)
    expect(leaders(room)).toEqual([])
    expect(status(room, "p3")).toBe("MIGRATING")
    expect(room.node("p3").getView().term).toBe(0) // pre-vote prevents term inflation
  })

  it("H05/R05 old Host returns as a normal peer", () => {
    const room = createGame(3)
    killHostAndElect(room)
    const p1 = room.revive("p1")
    room.net.connect("p1", "p2")
    room.net.connect("p1", "p3")
    expect(room.runUntil(() => converged(room), 15000)).toBe(true)
    room.run(10000)
    expect(leaders(room)).toEqual(["p2"])
    expect(p1.getView().leaderId).toBe("p2")
    expect(p1.getView().term).toBe(1)
  })

  it("H06/S05 old-term commit ignored", () => {
    const room = createGame(3)
    killHostAndElect(room)
    const p1 = room.revive("p1")
    room.net.connect("p1", "p3")
    const s = room.node("p3").getView().state!
    const fake = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: currentTarget(s)!, winner: "p1", requestId: "o" },
    } as GameEvent
    inject(
      room,
      "p1",
      "p3",
      "EVENT_COMMIT",
      {
        event: fake,
        certificate: {
          term: 0,
          index: fake.index,
          eventId: `0:${fake.index}`,
          acknowledgements: ["p1", "p2", "p3"],
        },
      },
      { term: 0 }
    )
    room.run(100)
    expect(room.node("p3").getView().state!.scores.p1).toBe(0)
    expect(logHas(room.node("p3"), "DROP_STALE_TERM")).toBe(true)
    void p1
  })

  it("H07 Host dies right after proposing => no duplicate score", () => {
    const room = createGame(3)
    room.net.filter = (from, _to, data) =>
      !(from === "p1" && data.includes('"EVENT_PROPOSE"'))
    room.node("p2").click(target(room.node("p2")))
    room.run(50)
    room.net.filter = null
    killHostAndElect(room)
    for (const n of room.live()) {
      checkInvariants(n.getView().state!)
      expect(totalScore(n)).toBe(0)
    }
  })

  it("H07b Host dies after quorum ACK but before COMMIT reaches anyone => point preserved once", () => {
    const room = createGame(3)
    room.net.filter = (from, _to, data) =>
      !(from === "p1" && data.includes('"EVENT_COMMIT"'))
    room.node("p2").click(target(room.node("p2")))
    room.run(200)
    expect(room.node("p1").getView().state!.scores.p2).toBe(1) // committed on the old Host
    expect(room.node("p3").getView().state!.scores.p2).toBe(0)
    room.net.filter = null
    killHostAndElect(room)
    for (const n of room.live()) {
      checkInvariants(n.getView().state!)
      expect(n.getView().state!.scores.p2).toBe(1)
    }
    const p1 = room.revive("p1")
    room.net.connect("p1", "p2")
    room.net.connect("p1", "p3")
    expect(room.runUntil(() => converged(room), 15000)).toBe(true)
    expect(p1.getView().state!.scores.p2).toBe(1)
  })

  it("H08 Host dies after commit reached one peer => committed state preserved", () => {
    const room = createGame(4)
    room.net.filter = (from, to, data) =>
      !(from === "p1" && to !== "p4" && data.includes('"EVENT_COMMIT"'))
    room.node("p3").click(target(room.node("p3")))
    room.run(200)
    room.net.filter = null
    killHostAndElect(room)
    for (const n of room.live()) expect(n.getView().state!.scores.p3).toBe(1)
  })

  it("H09 network partition: minority cannot progress, majority can; heal converges", () => {
    const room = createGame(5)
    const minority = ["p1", "p2"]
    const majority = ["p3", "p4", "p5"]
    for (const a of minority)
      for (const b of majority) room.net.disconnect(a, b)
    room.node("p2").click(target(room.node("p2")))
    room.run(500)
    expect(totalScore(room.node("p1"))).toBe(0)
    expect(
      room.runUntil(
        () =>
          majority.every(
            (id) =>
              room.node(id).getView().status === "ACTIVE" &&
              room.node(id).getView().leaderId === "p3" &&
              room.node(id).getView().state!.phase === "PLAYING"
          ),
        30000
      )
    ).toBe(true)
    room.node("p4").click(target(room.node("p4")))
    room.run(500)
    expect(room.node("p5").getView().state!.scores.p4).toBe(1)
    expect(status(room, "p1")).toBe("PAUSED")
    for (const a of minority) for (const b of majority) room.net.connect(a, b)
    expect(room.runUntil(() => converged(room), 20000)).toBe(true)
    for (const n of room.live()) {
      expect(n.getView().state!.scores).toMatchObject({ p2: 0, p4: 1 })
      expect(n.getView().leaderId).toBe("p3")
    }
  })

  it("H10 Host dies during countdown => countdown restarted by new Host", () => {
    const room = createLobby(3)
    room.node("p1").startGame()
    room.runUntil(
      () => room.live().every((n) => n.getView().state?.phase === "COUNTDOWN"),
      2000,
      10
    )
    room.kill("p1")
    expect(
      room.runUntil(
        () =>
          room
            .live()
            .every(
              (n) =>
                n.getView().state?.phase === "PLAYING" &&
                n.getView().leaderId === "p2"
            ),
        30000
      )
    ).toBe(true)
  })

  it("H10b Host dies after proposing GAME_STARTED (guests accepted, none committed)", () => {
    const room = createLobby(3)
    room.net.filter = (from, _to, data) =>
      !(from === "p1" && data.includes('"EVENT_COMMIT"'))
    room.node("p1").startGame()
    room.run(100)
    room.net.filter = null
    room.kill("p1")
    expect(
      room.runUntil(
        () => room.live().every((n) => n.getView().state?.phase === "PLAYING"),
        30000
      )
    ).toBe(true)
    expect(leaders(room)).toEqual(["p2"])
  })

  it("W07 transient disconnect => no migration", () => {
    const room = createGame(3)
    room.net.blackhole("p1", "p2")
    room.run(2500)
    room.net.connect("p1", "p2")
    room.run(3000)
    expect(room.node("p2").getView().term).toBe(0)
    expect(leaders(room)).toEqual(["p1"])
  })

  it("W08 failed connection => faster election path", () => {
    const room = createGame(3)
    room.net.disconnect("p1", "p2", "failed")
    room.net.disconnect("p1", "p3", "failed")
    // failedGraceMs (1.5s) instead of hostTimeoutMs (5s)
    expect(room.runUntil(() => leaders(room).includes("p2"), 4500, 20)).toBe(
      true
    )
  })

  it("asymmetric link loss does not depose a healthy Host (pre-vote stickiness)", () => {
    const room = createGame(4)
    room.net.disconnect("p1", "p2")
    room.run(15000)
    expect(leaders(room)).toEqual(["p1"])
    expect(room.node("p3").getView().term).toBe(0)
    expect(status(room, "p2")).toBe("MIGRATING")
  })

  it("finish and rematch", () => {
    const room = createGame(2, { config: { numberCount: 5 } })
    for (let i = 0; i < 5; i++) {
      room.node(i % 2 ? "p2" : "p1").click(target(room.node("p1")))
      room.run(300)
    }
    expect(room.node("p2").getView().state!.phase).toBe("FINISHED")
    expect(room.node("p1").rematch()).toBeNull()
    expect(
      room.runUntil(
        () =>
          room
            .live()
            .every(
              (n) =>
                n.getView().state!.phase === "PLAYING" &&
                n.getView().state!.round === 2
            ),
        10000
      )
    ).toBe(true)
    expect(room.node("p2").getView().state!.scores).toEqual({ p1: 0, p2: 0 })
  })
})

describe("E. reconnect", () => {
  it("R01/R02/R03 player reconnects with same identity and catches up", () => {
    const room = createGame(3)
    const before = room
      .node("p3")
      .getView()
      .members.find((m) => m.id === "p3")
    room.net.disconnect("p3", "p1")
    room.net.disconnect("p3", "p2")
    for (let i = 0; i < 3; i++) {
      room.node("p2").click(target(room.node("p2")))
      room.run(300)
    }
    room.net.connect("p3", "p1")
    room.net.connect("p3", "p2")
    expect(room.runUntil(() => converged(room), 5000)).toBe(true)
    expect(room.node("p3").getView().state!.scores.p2).toBe(3)
    expect(
      room
        .node("p3")
        .getView()
        .members.find((m) => m.id === "p3")
    ).toEqual(before)
    expect(room.node("p1").getView().members.length).toBe(3)
  })

  it("player reload (restore from session storage) rejoins with same slot", () => {
    const room = createGame(3)
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    room.kill("p3")
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    const p3 = room.revive("p3")
    room.net.connect("p3", "p1")
    room.net.connect("p3", "p2")
    expect(room.runUntil(() => converged(room), 8000)).toBe(true)
    expect(p3.getView().state!.scores.p2).toBe(2)
  })

  it("R04 state hash mismatch => DESYNC surfaced, recovered by a fresh snapshot", () => {
    const room = createGame(3)
    const st = room.node("p1").getView().state!
    room.net.filter = (from, _to, data) =>
      !(
        from === "p1" &&
        data.includes('"STATE_SNAPSHOT"') &&
        !data.includes('"inj.')
      )
    for (let i = 0; i < 3; i++) {
      inject(room, "p1", "p3", "STATE_SNAPSHOT", {
        state: { ...st, scores: { ...st.scores, p3: 50 } },
        stateHash: "bogus",
        certificate: null,
      })
    }
    room.run(50)
    expect(status(room, "p3")).toBe("DESYNC")
    expect(room.node("p3").getView().state!.scores.p3).toBe(0)
    expect(room.node("p3").click(target(room.node("p3")))).toBe("ignored")
    room.net.filter = null
    expect(room.runUntil(() => converged(room), 10000)).toBe(true)
  })

  it("R04b silent local corruption detected via heartbeat hash", () => {
    const room = createGame(3)
    ;(room.node("p3").getView().state!.scores as Record<string, number>).p3 = 9 // simulate a bug
    room.run(3000)
    expect(logHas(room.node("p3"), "STATE_HASH_MISMATCH")).toBe(true)
    expect(room.node("p3").getView().state!.scores.p3).toBe(0)
  })
})

describe("G. trust boundaries", () => {
  it("S02/S03 non-Host cannot propose or commit", () => {
    const room = createGame(3)
    const s = room.node("p3").getView().state!
    const fake = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: currentTarget(s)!, winner: "p2", requestId: "f" },
    } as GameEvent
    inject(room, "p2", "p3", "EVENT_PROPOSE", {
      event: fake,
      commitIndex: s.logIndex,
    })
    inject(room, "p2", "p3", "EVENT_COMMIT", {
      event: fake,
      certificate: {
        term: 0,
        index: fake.index,
        eventId: `0:${fake.index}`,
        acknowledgements: ["p1", "p2", "p3"],
      },
    })
    inject(room, "p2", "p3", "STATE_SNAPSHOT", {
      state: { ...s, scores: { ...s.scores, p2: 99 } },
      stateHash: "x",
      certificate: null,
    })
    room.run(200)
    expect(room.node("p3").getView().state).toEqual(s)
  })

  it("S04 Host proposing a fake target is not ACKed", () => {
    const room = createGame(3)
    const s = room.node("p3").getView().state!
    const fake = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: 777, winner: "p1", requestId: "f" },
    } as GameEvent
    inject(room, "p1", "p3", "EVENT_PROPOSE", {
      event: fake,
      commitIndex: s.logIndex,
    })
    room.run(100)
    expect(logHas(room.node("p3"), "PROPOSAL_REJECTED")).toBe(true)
  })

  it("S04b commit with an insufficient certificate is rejected", () => {
    const room = createGame(3)
    const s = room.node("p3").getView().state!
    const e = {
      type: "NUMBER_FOUND",
      term: 0,
      index: s.logIndex + 1,
      payload: { number: currentTarget(s)!, winner: "p1", requestId: "f" },
    } as GameEvent
    inject(room, "p1", "p3", "EVENT_COMMIT", {
      event: e,
      certificate: {
        term: 0,
        index: e.index,
        eventId: `0:${e.index}`,
        acknowledgements: ["p1"],
      },
    })
    room.run(100)
    expect(logHas(room.node("p3"), "DROP_BAD_CERT")).toBe(true)
    expect(totalScore(room.node("p3"))).toBe(0)
  })

  it("S06/S07 malformed / invalid-term / oversized messages dropped safely", () => {
    const room = createGame(3)
    const bad = [
      "not json",
      "null",
      "[]",
      JSON.stringify({ protocol: 1, type: "HEARTBEAT" }),
      JSON.stringify({
        protocol: 2,
        type: "NOPE",
        roomId: "ROOM01",
        senderId: "p2",
        term: 0,
        messageId: "m",
        payload: {},
      }),
      JSON.stringify({
        protocol: 2,
        type: "CLICK_REQUEST",
        roomId: "ROOM01",
        senderId: "p2",
        term: -1,
        messageId: "m2",
        payload: { requestId: "r", number: 1 },
      }),
      JSON.stringify({
        protocol: 2,
        type: "CLICK_REQUEST",
        roomId: "ROOM01",
        senderId: "p2",
        term: "0",
        messageId: "m3",
        payload: { requestId: "r", number: 1 },
      }),
      JSON.stringify({
        protocol: 2,
        type: "EVENT_PROPOSE",
        roomId: "ROOM01",
        senderId: "p2",
        term: 0,
        messageId: "m4",
        payload: {
          event: {
            type: "NUMBER_FOUND",
            term: 0,
            index: 1,
            payload: { number: "1" },
          },
          commitIndex: 0,
        },
      }),
      "x".repeat(70000),
    ]
    for (const b of bad) injectRaw(room, "p2", "p1", b)
    inject(
      room,
      "p2",
      "p1",
      "CLICK_REQUEST",
      { requestId: "r", number: 1 },
      { roomId: "OTHER" }
    )
    room.run(100)
    const drops = room
      .node("p1")
      .logger.entries.filter((e) => e.type.startsWith("DROP_")).length
    expect(drops).toBeGreaterThanOrEqual(bad.length + 1)
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    expect(totalScore(room.node("p1"))).toBe(1)
  })
})

describe("review regressions", () => {
  it("carried GAME_STARTED keeps leadership term 0 so HOST_CHANGED applies", () => {
    const room = createLobby(3)
    room.net.filter = (from, _to, data) =>
      !(from === "p1" && data.includes('"EVENT_COMMIT"'))
    room.node("p1").startGame()
    room.run(100)
    room.net.filter = null
    room.kill("p1")
    expect(
      room.runUntil(
        () => room.live().every((n) => n.getView().state?.phase === "PLAYING"),
        30000
      )
    ).toBe(true)
    for (const n of room.live()) {
      expect(n.getView().state!.leadership).toEqual({ hostId: "p2", term: 1 })
    }
    expect(logHas(room.node("p2"), "PROPOSE_INVALID")).toBe(false)
  })

  it("carried GAME_STARTED yields the same state as the original commit", () => {
    const room = createLobby(5)
    const mon = new SafetyMonitor()
    // Only p5 receives the commit; p5's vote never reaches p2.
    room.net.filter = (from, to, data) =>
      !(
        (from === "p1" && to !== "p5" && data.includes('"EVENT_COMMIT"')) ||
        (from === "p5" && to === "p2" && data.includes('"ELECTION_ACK"'))
      )
    room.node("p1").startGame()
    room.run(150)
    room.kill("p1")
    room.runUntil(() => {
      mon.sample(room)
      return room.live().every((n) => n.getView().state?.phase === "PLAYING")
    }, 30000)
    expect(mon.violations).toEqual([])
  })

  it("a follower recovers from a stale pre-vote once the leader is back", () => {
    const room = createGame(3)
    room.net.blackhole("p1", "p2")
    room.run(6000) // p2 suspects p1 and starts a pre-vote; p3 denies it
    room.net.connect("p1", "p2")
    expect(room.runUntil(() => status(room, "p2") === "ACTIVE", 5000)).toBe(
      true
    )
    expect(leaders(room)).toEqual(["p1"])
    room.node("p2").click(target(room.node("p2")))
    room.run(300)
    expect(room.node("p3").getView().state!.scores.p2).toBe(1)
  })

  it("a guest removed by the Host is told it was removed", () => {
    const room = createLobby(3)
    // p3 can hear the Host but the Host no longer hears p3.
    room.net.filter = (from, to) => !(from === "p3" && to === "p1")
    room.run(20000)
    expect(status(room, "p3")).toBe("CLOSED")
    expect(room.node("p3").getView().closedReason).toBe("removed")
    expect(
      room
        .node("p1")
        .getView()
        .lobby!.players.map((p) => p.id)
    ).toEqual(["p1", "p2"])
  })
})
