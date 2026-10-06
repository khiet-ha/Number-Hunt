import { currentTarget } from "./reducer"
import type { GameState } from "./types"

/** Throws if a state violates a design invariant (02 §6). Used by tests and debug builds. */
export function checkInvariants(s: GameState, prev?: GameState): void {
  const fail = (msg: string) => {
    throw new Error(`invariant violated: ${msg}`)
  }
  const memberIds = new Set(s.members.map((m) => m.id))
  let total = 0
  for (const [id, score] of Object.entries(s.scores)) {
    if (!memberIds.has(id)) fail(`score for non-member ${id}`)
    if (!Number.isInteger(score) || score < 0) fail(`score ${id}=${score}`)
    total += score
  }
  const claimed = Object.entries(s.claimed)
  if (claimed.length !== s.targetIndex) fail("claimed count != targetIndex")
  if (total !== s.targetIndex) fail("sum(scores) != targetIndex")
  for (let i = 0; i < s.targetIndex; i++) {
    if (s.claimed[String(s.targets[i])] == null)
      fail(`target ${s.targets[i]} passed but unclaimed`)
  }
  if (s.phase === "FINISHED" && currentTarget(s) !== null)
    fail("finished with remaining target")
  if (s.phase !== "FINISHED" && currentTarget(s) === null)
    fail("no target but not finished")
  if (s.config.mode === "TRADITIONAL" && s.layoutVersion !== 0)
    fail("traditional layout changed")
  if (prev) {
    if (s.leadership.term < prev.leadership.term) fail("term decreased")
    if (s.logIndex < prev.logIndex) fail("logIndex decreased")
    if (prev.round === s.round) {
      if (JSON.stringify(prev.members) !== JSON.stringify(s.members))
        fail("membership changed")
      for (const [n, w] of Object.entries(prev.claimed))
        if (s.claimed[n] !== w) fail(`winner of ${n} changed`)
    }
  }
}
