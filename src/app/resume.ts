import type { KeyValueStore } from "@/multiplayer/env"
import { loadPersisted } from "@/multiplayer/node"
import { loadSession, randomToken, saveSession, type Session } from "./identity"

/**
 * Resuming a game after the app was closed.
 *
 * Two stores are involved:
 *  - the TAB store (sessionStorage): identifies the session of this tab and
 *    survives a reload, but not closing the tab/app;
 *  - the PERSISTENT store (localStorage): holds the replicated state of the
 *    game (written by GameNode) plus a ResumeRecord pointing at the session,
 *    so a fresh tab can offer to rejoin.
 *
 * Only games that already started are resumable: the lobby has no replicated
 * state (its guests give up when the Host disappears, design 07 §12).
 */

const RESUME_KEY = "nh:resume"
const TAB_KEY = "nh:tab"

/** A saved game older than this is discarded. */
export const RESUME_TTL_MS = 12 * 60 * 60 * 1000
/** A record touched this recently belongs to a tab that is still open. */
export const TAB_LOCK_MS = 6_000
/** How often an open tab refreshes its record. */
export const RESUME_BEAT_MS = 2_000

export interface ResumeRecord {
  session: Session
  /** Last time the owning tab was alive. */
  activeAt: number
  tabId: string
}

export type ResumeStatus = "ready" | "openElsewhere"

export interface ResumeInfo {
  session: Session
  roomId: string
  /** Last time this device was in the game (for "left x minutes ago"). */
  lastActiveAt: number
  status: ResumeStatus
}

export interface ResumeDeps {
  /** sessionStorage-backed. */
  tab: KeyValueStore
  /** localStorage-backed. */
  persist: KeyValueStore
  now: number
}

/** Stable per tab (survives reload), different for every new tab/app launch. */
export function getTabId(tab: KeyValueStore): string {
  try {
    const existing = tab.get(TAB_KEY)
    if (existing) return existing
    const id = randomToken(10)
    tab.set(TAB_KEY, id)
    return id
  } catch {
    return randomToken(10)
  }
}

function isSession(v: unknown): v is Session {
  if (typeof v !== "object" || v === null) return false
  const s = v as Record<string, unknown>
  return ["roomId", "id", "name", "secret", "secretHash"].every(
    (k) => typeof s[k] === "string" && (s[k] as string).length > 0
  )
}

export function readResume(persist: KeyValueStore): ResumeRecord | null {
  try {
    const raw = persist.get(RESUME_KEY)
    if (!raw) return null
    const r = JSON.parse(raw) as Partial<ResumeRecord>
    if (
      !isSession(r.session) ||
      typeof r.activeAt !== "number" ||
      typeof r.tabId !== "string"
    )
      return null
    return r as ResumeRecord
  } catch {
    return null
  }
}

export function writeResume(persist: KeyValueStore, rec: ResumeRecord): void {
  try {
    persist.set(RESUME_KEY, JSON.stringify(rec))
  } catch {
    /* storage full / blocked: the game itself keeps running */
  }
}

export function clearResume(persist: KeyValueStore): void {
  try {
    persist.remove(RESUME_KEY)
  } catch {
    /* ignore */
  }
}

/** Refresh the record from the tab that is currently in a started game. */
export function touchResume(
  persist: KeyValueStore,
  session: Session,
  tabId: string,
  now: number
): void {
  writeResume(persist, { session, activeAt: now, tabId })
}

/**
 * The game this tab could rejoin, or null. Cleans up what can never be
 * resumed (expired, finished, or state that vanished).
 */
export function findResumable(
  deps: ResumeDeps,
  tabId: string,
  discard: (session: Session) => void
): ResumeInfo | null {
  const { tab, persist, now } = deps
  const tabSession = loadSession(tab)
  const record = readResume(persist)

  let session: Session
  let lastActiveAt: number
  let fromSavedRecord = false
  if (tabSession) {
    session = tabSession
    lastActiveAt = record?.session.id === tabSession.id ? record.activeAt : now
  } else if (record) {
    session = record.session
    lastActiveAt = record.activeAt
    fromSavedRecord = true
  } else return null

  const drop = () => {
    discard(session)
    clearResume(persist)
    saveSession(tab, null)
  }

  if (now - lastActiveAt > RESUME_TTL_MS) {
    drop()
    return null
  }
  const saved = loadPersisted(persist, session.roomId, session.id)
  if (!saved?.state || saved.state.phase === "FINISHED") {
    // A tab that has just created/joined a room has no state yet: keep its
    // pointer. Only a stale saved record is thrown away.
    if (fromSavedRecord) drop()
    return null
  }

  const heldByOtherTab =
    fromSavedRecord &&
    record!.tabId !== tabId &&
    now - record!.activeAt < TAB_LOCK_MS
  return {
    session,
    roomId: session.roomId,
    lastActiveAt,
    status: heldByOtherTab ? "openElsewhere" : "ready",
  }
}
