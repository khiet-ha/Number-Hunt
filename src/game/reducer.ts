import { generateTargets } from "./generator";
import { cyrb53 } from "./rng";
import type { GameConfig, GameEvent, GameState, Member, PlayerId } from "./types";
import { LIMITS } from "./types";

/**
 * The only way GameState changes: applyEvent(state, committedEvent).
 * validateEvent() is used by peers before ACKing a proposal and by applyEvent
 * itself, so an invalid event can never mutate state.
 */

export function currentTarget(state: GameState): number | null {
  return state.targetIndex < state.targets.length ? state.targets[state.targetIndex] : null;
}

export function isMember(state: GameState, id: PlayerId): boolean {
  return state.members.some((m) => m.id === id);
}

export function quorumSize(memberCount: number): number {
  return Math.floor(memberCount / 2) + 1;
}

export function validateConfig(c: GameConfig): string | null {
  if (!Number.isInteger(c.playerLimit) || c.playerLimit < LIMITS.minPlayers || c.playerLimit > LIMITS.maxPlayers)
    return "playerLimit";
  if (!Number.isInteger(c.numberCount) || c.numberCount < LIMITS.minNumbers || c.numberCount > LIMITS.maxNumbers)
    return "numberCount";
  if (c.mode !== "TRADITIONAL" && c.mode !== "RANDOM") return "mode";
  if (!["SEQUENTIAL", "FIXED_STEP", "RANDOM_STEP"].includes(c.numberMode)) return "numberMode";
  if (!["SMALL", "LARGE", "RANDOM"].includes(c.sizeMode)) return "sizeMode";
  if (!Number.isInteger(c.step) || c.step < 1 || c.step > LIMITS.maxStep) return "step";
  if (
    !Array.isArray(c.randomSteps) ||
    c.randomSteps.length < 1 ||
    c.randomSteps.length > 20 ||
    !c.randomSteps.every((s) => Number.isInteger(s) && s >= 1 && s <= LIMITS.maxStep)
  )
    return "randomSteps";
  return null;
}

function validateMembers(members: Member[], limit: number): string | null {
  if (!Array.isArray(members) || members.length < LIMITS.minPlayers || members.length > limit) return "memberCount";
  const ids = new Set<string>();
  let prev = -Infinity;
  for (const m of members) {
    if (typeof m.id !== "string" || !m.id || ids.has(m.id)) return "memberId";
    if (!Number.isInteger(m.joinSequence) || m.joinSequence <= prev) return "joinSequence";
    if (typeof m.name !== "string" || m.name.length > LIMITS.maxNameLength) return "memberName";
    ids.add(m.id);
    prev = m.joinSequence;
  }
  return null;
}

/** Returns null if `event` may be applied to `state`, otherwise a reason. */
export function validateEvent(state: GameState | null, event: GameEvent): string | null {
  const expectedIndex = state ? state.logIndex + 1 : 1;
  if (event.index !== expectedIndex) return "index";

  if (event.type === "GAME_STARTED") {
    if (state) return "alreadyStarted";
    const p = event.payload;
    const cfgErr = validateConfig(p.config);
    if (cfgErr) return cfgErr;
    const mErr = validateMembers(p.members, p.config.playerLimit);
    if (mErr) return mErr;
    if (!p.members.some((m) => m.id === p.hostId)) return "hostNotMember";
    return null;
  }
  if (!state) return "notStarted";

  switch (event.type) {
    case "PLAY_BEGIN":
      return state.phase === "COUNTDOWN" ? null : "phase";
    case "NUMBER_FOUND": {
      const p = event.payload;
      if (state.phase !== "PLAYING") return "phase";
      if (!isMember(state, p.winner)) return "winner";
      if (p.number !== currentTarget(state)) return "notCurrentTarget";
      if (state.claimed[String(p.number)] != null) return "alreadyClaimed";
      return null;
    }
    case "HOST_CHANGED":
      if (!isMember(state, event.payload.hostId)) return "hostNotMember";
      if (event.payload.term <= state.leadership.term || event.payload.term > event.term) return "staleTerm";
      return null;
    case "REMATCH": {
      if (state.phase !== "FINISHED") return "phase";
      return validateConfig(event.payload.config);
    }
  }
}

export function applyEvent(state: GameState | null, event: GameEvent): GameState {
  const err = validateEvent(state, event);
  if (err) throw new Error(`invalid event ${event.term}:${event.index} ${event.type}: ${err}`);

  if (event.type === "GAME_STARTED") {
    const p = event.payload;
    const members = p.members.map((m) => ({ ...m }));
    return {
      protocolVersion: 2,
      roomId: p.roomId,
      phase: "COUNTDOWN",
      config: { ...p.config, randomSteps: p.config.randomSteps.slice() },
      members,
      round: 1,
      seed: p.seed >>> 0,
      targets: generateTargets(p.config, p.seed >>> 0),
      targetIndex: 0,
      layoutVersion: 0,
      scores: Object.fromEntries(members.map((m) => [m.id, 0])),
      claimed: {},
      leadership: { hostId: p.hostId, term: event.term },
      logIndex: event.index,
    };
  }

  const s = state as GameState;
  const base = { ...s, logIndex: event.index };
  switch (event.type) {
    case "PLAY_BEGIN":
      return { ...base, phase: "PLAYING" };
    case "NUMBER_FOUND": {
      const { number, winner } = event.payload;
      const targetIndex = s.targetIndex + 1;
      return {
        ...base,
        scores: { ...s.scores, [winner]: s.scores[winner] + 1 },
        claimed: { ...s.claimed, [String(number)]: winner },
        targetIndex,
        layoutVersion: s.config.mode === "RANDOM" ? s.layoutVersion + 1 : s.layoutVersion,
        // Finishing is part of the same committed event, so it can never be lost
        // between two events during a Host failure.
        phase: targetIndex >= s.targets.length ? "FINISHED" : s.phase,
      };
    }
    case "HOST_CHANGED":
      return {
        ...base,
        leadership: { hostId: event.payload.hostId, term: event.payload.term },
        // Resume with a fresh countdown so nobody gets a head start after a freeze.
        phase: s.phase === "FINISHED" ? "FINISHED" : "COUNTDOWN",
      };
    case "REMATCH": {
      const p = event.payload;
      return {
        ...base,
        phase: "COUNTDOWN",
        config: { ...p.config, playerLimit: s.config.playerLimit, randomSteps: p.config.randomSteps.slice() },
        round: s.round + 1,
        seed: p.seed >>> 0,
        targets: generateTargets(p.config, p.seed >>> 0),
        targetIndex: 0,
        layoutVersion: 0,
        scores: Object.fromEntries(s.members.map((m) => [m.id, 0])),
        claimed: {},
      };
    }
  }
}

/** Canonical JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function stateHash(state: GameState): string {
  return cyrb53(canonicalJson(state));
}

/** Same event content regardless of the term it was (re-)proposed in. */
export function sameEventContent(a: GameEvent, b: GameEvent): boolean {
  return a.type === b.type && canonicalJson(a.payload) === canonicalJson(b.payload);
}
