import { describe, expect, it } from "vitest"

import { saveSession, type Session } from "@/app/identity"
import {
  findResumable,
  getTabId,
  readResume,
  RESUME_TTL_MS,
  TAB_LOCK_MS,
  touchResume,
} from "@/app/resume"
import { MemoryStore } from "@/multiplayer/env"

const session: Session = {
  roomId: "ROOM01",
  id: "p_alice",
  name: "Alice",
  secret: "s3cret",
  secretHash: "hash",
}

function saveGame(persist: MemoryStore, phase: string, s = session) {
  persist.set(
    `nh:raft:${s.roomId}:${s.id}`,
    JSON.stringify({
      v: 1,
      currentTerm: 0,
      votedFor: null,
      state: { phase },
      accepted: null,
      cert: null,
      startMembers: null,
    })
  )
}

function setup() {
  const tab = new MemoryStore()
  const persist = new MemoryStore()
  const discarded: string[] = []
  const find = (now: number, tabId: string) =>
    findResumable({ tab, persist, now }, tabId, (s) => {
      discarded.push(s.id)
      persist.remove(`nh:raft:${s.roomId}:${s.id}`)
    })
  return { tab, persist, find, discarded }
}

describe("resume after closing the app", () => {
  it("a new tab can resume a started game saved by a closed one", () => {
    const { persist, find } = setup()
    saveGame(persist, "PLAYING")
    touchResume(persist, session, "oldTab", 1_000)

    const info = find(1_000 + 60_000, "newTab")
    expect(info).toMatchObject({
      roomId: "ROOM01",
      status: "ready",
      lastActiveAt: 1_000,
    })
    expect(info?.session.secret).toBe("s3cret")
  })

  it("keeps the same identity (id and secret) so the old slot is reclaimed", () => {
    const { persist, find } = setup()
    saveGame(persist, "COUNTDOWN")
    touchResume(persist, session, "oldTab", 0)
    expect(find(10_000, "newTab")?.session).toEqual(session)
  })

  it("a tab that is still open holds the game (no double rejoin)", () => {
    const { persist, find } = setup()
    saveGame(persist, "PLAYING")
    touchResume(persist, session, "tabA", 100_000)
    expect(find(100_000 + TAB_LOCK_MS - 1, "tabB")?.status).toBe(
      "openElsewhere"
    )
    expect(find(100_000 + TAB_LOCK_MS + 1, "tabB")?.status).toBe("ready")
    // The owning tab itself is never locked out.
    expect(find(100_001, "tabA")?.status).toBe("ready")
  })

  it("a reload keeps working: the tab pointer survives and is not locked", () => {
    const { tab, persist, find } = setup()
    const tabId = getTabId(tab)
    expect(getTabId(tab)).toBe(tabId)
    saveSession(tab, session)
    saveGame(persist, "PLAYING")
    touchResume(persist, session, tabId, 5_000)
    expect(find(5_500, tabId)?.status).toBe("ready")
  })

  it("expires saved games after the TTL and forgets their state", () => {
    const { persist, find, discarded } = setup()
    saveGame(persist, "PLAYING")
    touchResume(persist, session, "oldTab", 0)
    expect(find(RESUME_TTL_MS + 1, "newTab")).toBeNull()
    expect(discarded).toEqual(["p_alice"])
    expect(readResume(persist)).toBeNull()
    expect(persist.get("nh:raft:ROOM01:p_alice")).toBeNull()
  })

  it("does not offer a finished game", () => {
    const { persist, find, discarded } = setup()
    saveGame(persist, "FINISHED")
    touchResume(persist, session, "oldTab", 0)
    expect(find(1_000, "newTab")).toBeNull()
    expect(discarded).toEqual(["p_alice"])
  })

  it("does not offer a room that never reached a started game", () => {
    const { tab, persist, find } = setup()
    // Lobby: a session pointer but no replicated state.
    saveSession(tab, session)
    expect(find(1_000, getTabId(tab))).toBeNull()
    // The pointer of a tab that is just joining is kept.
    expect(tab.get("nh:session")).not.toBeNull()
    // A saved record without state is junk and is dropped.
    touchResume(persist, session, "oldTab", 0)
    const other = setup()
    touchResume(other.persist, session, "oldTab", 0)
    expect(other.find(1_000, "newTab")).toBeNull()
    expect(readResume(other.persist)).toBeNull()
  })

  it("ignores a corrupted record", () => {
    const { persist, find } = setup()
    persist.set("nh:resume", "{not json")
    expect(find(1_000, "newTab")).toBeNull()
    persist.set("nh:resume", JSON.stringify({ session: { id: "x" } }))
    expect(find(1_000, "newTab")).toBeNull()
  })
})
