/**
 * Replicated game model. Everything in this file is part of the authoritative,
 * hashed state that every peer must agree on. Local/transport observations
 * (connected, migrating, ...) deliberately do NOT live here — see
 * docs/design/02-game-state.md §1.
 */

export type PlayerId = string;

/** Replicated phase. MIGRATING/PAUSED are local session statuses, not phases. */
export type GamePhase = "COUNTDOWN" | "PLAYING" | "FINISHED";

export type GameMode = "TRADITIONAL" | "RANDOM";
export type NumberMode = "SEQUENTIAL" | "FIXED_STEP" | "RANDOM_STEP";
export type SizeMode = "SMALL" | "LARGE" | "RANDOM";

export interface GameConfig {
  playerLimit: number;
  numberCount: number;
  mode: GameMode;
  numberMode: NumberMode;
  /** FIXED_STEP: targets[k] = 1 + k * step. */
  step: number;
  /** RANDOM_STEP: each increment is picked (seeded) from this list. */
  randomSteps: number[];
  sizeMode: SizeMode;
}

/** Immutable after GAME_STARTED. */
export interface Member {
  id: PlayerId;
  name: string;
  color: string;
  joinSequence: number;
  /** SHA-256 (hex) of the player's local secret; used to authorise rejoin. */
  secretHash: string;
}

export interface Leadership {
  hostId: PlayerId;
  term: number;
}

export interface GameState {
  protocolVersion: 2;
  roomId: string;
  phase: GamePhase;
  config: GameConfig;
  /** Sorted by joinSequence. */
  members: Member[];
  /** Round number, increments on REMATCH. */
  round: number;
  seed: number;
  targets: number[];
  targetIndex: number;
  layoutVersion: number;
  scores: Record<PlayerId, number>;
  /** number (as string key) -> winner. */
  claimed: Record<string, PlayerId>;
  leadership: Leadership;
  /** Index of the last committed log entry applied to this state. The entry's
   * term is deliberately not stored: state is a pure function of the committed
   * entry contents, independent of which term (re-)proposed them. */
  logIndex: number;
}

export type GameEventType =
  | "GAME_STARTED"
  | "PLAY_BEGIN"
  | "NUMBER_FOUND"
  | "HOST_CHANGED"
  | "REMATCH";

export interface GameStartedPayload {
  roomId: string;
  hostId: PlayerId;
  config: GameConfig;
  members: Member[];
  seed: number;
}
export interface NumberFoundPayload {
  number: number;
  winner: PlayerId;
  requestId: string;
}
export interface HostChangedPayload {
  hostId: PlayerId;
  /** Term of the new leadership. Carried in the payload (not taken from the
   * entry's term) so re-proposing a carried entry yields the same state. */
  term: number;
}
export interface RematchPayload {
  config: GameConfig;
  seed: number;
}

export type GameEventPayload =
  | { type: "GAME_STARTED"; payload: GameStartedPayload }
  | { type: "PLAY_BEGIN"; payload: Record<string, never> }
  | { type: "NUMBER_FOUND"; payload: NumberFoundPayload }
  | { type: "HOST_CHANGED"; payload: HostChangedPayload }
  | { type: "REMATCH"; payload: RematchPayload };

/** A log entry. `term` is the term of the Host that proposed it. */
export type GameEvent = GameEventPayload & {
  term: number;
  index: number;
};

export const eventId = (e: { term: number; index: number }): string => `${e.term}:${e.index}`;

export const DEFAULT_CONFIG: GameConfig = {
  playerLimit: 8,
  numberCount: 50,
  mode: "TRADITIONAL",
  numberMode: "SEQUENTIAL",
  step: 2,
  randomSteps: [1, 2, 3, 4, 5],
  sizeMode: "RANDOM",
};

export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 8,
  minNumbers: 5,
  maxNumbers: 100,
  maxStep: 50,
  maxNameLength: 16,
} as const;

export const PLAYER_COLORS = [
  "#e6194b",
  "#3cb44b",
  "#4363d8",
  "#f58231",
  "#911eb4",
  "#16a5a5",
  "#d6338a",
  "#8a6d00",
];
