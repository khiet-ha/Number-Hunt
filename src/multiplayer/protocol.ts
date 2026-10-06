import type {
  GameConfig,
  GameEvent,
  GameState,
  Member,
  PlayerId,
} from "@/game/types"

/**
 * Wire protocol v2 (see docs/design/03-wire-protocol.md).
 * v1 → v2 is a breaking change: global log index instead of per-term seq,
 * pre-vote, snapshot-carrying election ACKs.
 */
export const PROTOCOL_VERSION = 2
export const MAX_MESSAGE_BYTES = 64 * 1024

export interface Envelope<T extends MessageType = MessageType> {
  protocol: typeof PROTOCOL_VERSION
  type: T
  roomId: string
  senderId: PlayerId
  term: number
  messageId: string
  payload: PayloadOf<T>
}

export interface LobbyPlayer extends Member {
  ready: boolean
}

export interface CommitCertificate {
  term: number
  index: number
  eventId: string
  acknowledgements: PlayerId[]
}

export interface Snapshot {
  state: GameState
  stateHash: string
  certificate: CommitCertificate | null
}

export type LocalStatus =
  "LOBBY" | "SYNCING" | "ACTIVE" | "MIGRATING" | "PAUSED" | "DESYNC" | "CLOSED"

export interface Payloads {
  // Lobby (Host-authoritative, not quorum-replicated)
  LOBBY_STATE: { hostId: PlayerId; players: LobbyPlayer[]; config: GameConfig }
  READY: { ready: boolean }
  LEAVE: Record<string, never>
  JOIN_REJECT: { reason: string }
  ROOM_CLOSED: { reason: string }
  // Gameplay commands
  CLICK_REQUEST: { requestId: string; number: number; clientTimestamp?: number }
  CLICK_REJECT: { requestId: string; reason: string }
  // Replicated log
  EVENT_PROPOSE: { event: GameEvent; commitIndex: number }
  EVENT_ACK: { eventId: string; index: number }
  EVENT_COMMIT: { event: GameEvent; certificate: CommitCertificate }
  STATE_REQUEST: {
    haveIndex: number
    reason: "gap" | "reconnect" | "hash" | "behind"
  }
  STATE_SNAPSHOT: Snapshot
  // Liveness / election
  HEARTBEAT: {
    leaderId: PlayerId | null
    logIndex: number
    stateHash: string | null
    links: PlayerId[]
    paused: boolean
  }
  PRE_VOTE: { term: number; logIndex: number }
  PRE_VOTE_ACK: { term: number; granted: boolean }
  HOST_ELECTION: { term: number; logIndex: number }
  ELECTION_ACK: {
    term: number
    granted: boolean
    snapshot: Snapshot | null
    accepted: GameEvent | null
  }
  // Mesh signaling relay
  SIGNAL: {
    origin: PlayerId
    target: PlayerId
    kind: "offer" | "answer"
    sdp: string
  }
}

export type MessageType = keyof Payloads
export type PayloadOf<T extends MessageType> = Payloads[T]

// ---------------------------------------------------------------------------
// Validation. Every inbound message goes through decode(); anything that does
// not match the expected shape is dropped (test S07). Semantic validation of
// game events happens in the reducer (validateEvent).
// ---------------------------------------------------------------------------

type Check = (v: unknown) => boolean
const isStr: Check = (v) => typeof v === "string" && v.length <= 4096
const isId: Check = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 64
const isInt: Check = (v) => Number.isSafeInteger(v)
const isNat: Check = (v) => Number.isSafeInteger(v) && (v as number) >= 0
const isBool: Check = (v) => typeof v === "boolean"
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const arrOf =
  (c: Check, max = 256): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(c)
const oneOf =
  (...vals: unknown[]): Check =>
  (v) =>
    vals.includes(v)
const opt =
  (c: Check): Check =>
  (v) =>
    v === undefined || c(v)
const nullable =
  (c: Check): Check =>
  (v) =>
    v === null || c(v)
const shape =
  (fields: Record<string, Check>): Check =>
  (v) =>
    isObj(v) && Object.entries(fields).every(([k, c]) => c(v[k]))

const configShape = shape({
  playerLimit: isInt,
  numberCount: isInt,
  mode: oneOf("TRADITIONAL", "RANDOM"),
  numberMode: oneOf("SEQUENTIAL", "FIXED_STEP", "RANDOM_STEP"),
  step: isInt,
  randomSteps: arrOf(isInt, 20),
  sizeMode: oneOf("SMALL", "LARGE", "RANDOM"),
})
const memberFields = {
  id: isId,
  name: isStr,
  color: isStr,
  joinSequence: isInt,
  secretHash: isStr,
}
const memberShape = shape(memberFields)
const lobbyPlayerShape = shape({ ...memberFields, ready: isBool })

const eventShape: Check = (v) => {
  if (!shape({ term: isNat, index: isNat, type: isStr, payload: isObj })(v))
    return false
  const e = v as { type: string; payload: unknown }
  switch (e.type) {
    case "GAME_STARTED":
      return shape({
        roomId: isId,
        hostId: isId,
        config: configShape,
        members: arrOf(memberShape, 8),
        seed: isNat,
      })(e.payload)
    case "PLAY_BEGIN":
      return true
    case "NUMBER_FOUND":
      return shape({ number: isInt, winner: isId, requestId: isId })(e.payload)
    case "HOST_CHANGED":
      return shape({ hostId: isId, term: isNat })(e.payload)
    case "REMATCH":
      return shape({ config: configShape, seed: isNat })(e.payload)
    default:
      return false
  }
}

const certShape = shape({
  term: isNat,
  index: isNat,
  eventId: isStr,
  acknowledgements: arrOf(isId, 8),
})

const stateShape = shape({
  protocolVersion: oneOf(PROTOCOL_VERSION),
  roomId: isId,
  phase: oneOf("COUNTDOWN", "PLAYING", "FINISHED"),
  config: configShape,
  members: arrOf(memberShape, 8),
  round: isNat,
  seed: isNat,
  targets: arrOf(isInt, 200),
  targetIndex: isNat,
  layoutVersion: isNat,
  scores: isObj,
  claimed: isObj,
  leadership: shape({ hostId: isId, term: isNat }),
  logIndex: isNat,
})
const snapshotShape = shape({
  state: stateShape,
  stateHash: isStr,
  certificate: nullable(certShape),
})

const payloadChecks: { [K in MessageType]: Check } = {
  LOBBY_STATE: shape({
    hostId: isId,
    players: arrOf(lobbyPlayerShape, 8),
    config: configShape,
  }),
  READY: shape({ ready: isBool }),
  LEAVE: isObj,
  JOIN_REJECT: shape({ reason: isStr }),
  ROOM_CLOSED: shape({ reason: isStr }),
  CLICK_REQUEST: shape({
    requestId: isId,
    number: isInt,
    clientTimestamp: opt(isInt),
  }),
  CLICK_REJECT: shape({ requestId: isId, reason: isStr }),
  EVENT_PROPOSE: shape({ event: eventShape, commitIndex: isNat }),
  EVENT_ACK: shape({ eventId: isStr, index: isNat }),
  EVENT_COMMIT: shape({ event: eventShape, certificate: certShape }),
  STATE_REQUEST: shape({
    haveIndex: isNat,
    reason: oneOf("gap", "reconnect", "hash", "behind"),
  }),
  STATE_SNAPSHOT: snapshotShape,
  HEARTBEAT: shape({
    leaderId: nullable(isId),
    logIndex: isNat,
    stateHash: nullable(isStr),
    links: arrOf(isId, 8),
    paused: isBool,
  }),
  PRE_VOTE: shape({ term: isNat, logIndex: isNat }),
  PRE_VOTE_ACK: shape({ term: isNat, granted: isBool }),
  HOST_ELECTION: shape({ term: isNat, logIndex: isNat }),
  ELECTION_ACK: shape({
    term: isNat,
    granted: isBool,
    snapshot: nullable(snapshotShape),
    accepted: nullable(eventShape),
  }),
  SIGNAL: shape({
    origin: isId,
    target: isId,
    kind: oneOf("offer", "answer"),
    // Relayed SDP is not minified (multiplayer must not depend on qr) and
    // may list many candidates; the 64 KB message cap still applies.
    sdp: (v) => typeof v === "string" && v.length > 0 && v.length <= 32768,
  }),
}

export function isMessageType(t: unknown): t is MessageType {
  return (
    typeof t === "string" &&
    Object.prototype.hasOwnProperty.call(payloadChecks, t)
  )
}

export function encode(env: Envelope): string {
  return JSON.stringify(env)
}

/** Parse + validate. Returns null for anything malformed. Never throws. */
export function decode(raw: unknown): Envelope | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObj(v)) return null
  if (v.protocol !== PROTOCOL_VERSION) return null
  if (!isMessageType(v.type)) return null
  if (
    !isId(v.roomId) ||
    !isId(v.senderId) ||
    !isNat(v.term) ||
    !isId(v.messageId)
  )
    return null
  if (!payloadChecks[v.type](v.payload)) return null
  return v as unknown as Envelope
}
