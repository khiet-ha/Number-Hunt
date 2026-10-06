# 03 — Wire Protocol

## 1. Message envelope

Every DataChannel message uses:

```ts
interface MessageEnvelope {
  protocol: 1;

  type: MessageType;

  roomId: string;

  senderId: PlayerId;

  term: number;

  messageId: string;

  payload: unknown;
}
```

`messageId` is for transport/application deduplication.

## 2. Commands

Client → Host:

```text
JOIN_REQUEST
READY
CLICK_REQUEST
STATE_REQUEST
RECONNECT_REQUEST
EVENT_ACK
ELECTION_ACK
HOST_READY_ACK
```

## 3. Events / control

Host → peers:

```text
JOIN_ACCEPT
JOIN_REJECT
PLAYER_STATUS
GAME_CONFIG
COUNTDOWN_STARTED
GAME_STARTED

EVENT_PROPOSE
EVENT_COMMIT
EVENT_REJECT

STATE_SNAPSHOT

HOST_HEARTBEAT
HOST_ELECTION
HOST_CHANGED
HOST_READY

GAME_FINISHED
```

## 4. Peer signaling

Used for establishing mesh connections:

```text
SIGNAL_OFFER
SIGNAL_ANSWER
SIGNAL_ICE
```

For initial QR bootstrap, the first Host ↔ Player offer/answer is carried out-of-band through QR.

## 5. CLICK_REQUEST

```ts
interface ClickRequestPayload {
  requestId: string;
  number: number;
  clientTimestamp?: number; // diagnostics only; never authoritative
}
```

Important:

- `senderId` comes from the actual peer connection.
- Host must not trust a payload claiming another `playerId`.
- `clientTimestamp` must never determine winner.

## 6. EVENT_PROPOSE

```ts
interface EventProposal {
  event: GameEvent;
}

interface GameEvent {
  term: number;
  seq: number;
  eventId: string;
  type: GameEventType;
  payload: unknown;
}
```

Example:

```json
{
  "term": 0,
  "seq": 51,
  "eventId": "0:51",
  "type": "NUMBER_FOUND",
  "payload": {
    "number": 17,
    "winner": "p_alice"
  }
}
```

## 7. EVENT_ACK

```ts
interface EventAckPayload {
  eventId: string;
}
```

ACK means:

> "I received and validated this proposal."

It does not mean the peer may mutate state.

## 8. EVENT_COMMIT

```ts
interface EventCommitPayload {
  event: GameEvent;
  certificate: CommitCertificate;
}

interface CommitCertificate {
  term: number;
  seq: number;
  eventId: string;
  acknowledgements: PlayerId[];
}
```

A peer applies an event only after commit.

## 9. STATE_SNAPSHOT

```ts
interface StateSnapshot {
  protocolVersion: 1;
  roomId: string;

  leadership: Leadership;

  committedVersion: {
    term: number;
    seq: number;
  };

  state: GameState;

  stateHash: string;

  recentEvents: GameEvent[];

  commitCertificates: CommitCertificate[];
}
```

## 10. Version validation

For an incoming authoritative event:

```ts
if (message.term < currentTerm) {
  ignore();
}

if (message.term > currentTerm) {
  freezeAndReconcile();
}

if (event.seq <= lastAppliedSeq) {
  ignoreDuplicate();
}

if (event.seq > lastAppliedSeq + 1) {
  requestSnapshot();
}
```

After a term change, sequence may restart from 1 because event identity includes term.
