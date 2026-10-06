# 08 — Implementation Plan

## Phase 1 — Game Engine

Implement without WebRTC.

### Files

Suggested:

```text
src/game/
  types.ts
  reducer.ts
  generator.ts
  board.ts
  invariants.ts
```

### Requirements

- GameState
- GameConfig
- target generation
- deterministic board
- event reducer
- score
- target progression
- traditional/random modes

### Unit tests

- same seed => same board
- random layoutVersion changes layout
- traditional layoutVersion remains fixed
- target sequence generation
- final target => FINISHED

---

## Phase 2 — WebRTC transport

Suggested:

```text
src/network/
  peer-connection.ts
  data-channel.ts
  transport.ts
  connection-manager.ts
```

Implement:

- one-to-one WebRTC
- reliable ordered DataChannel
- connection lifecycle
- message encode/decode
- message validation

Do not implement game logic here.

---

## Phase 3 — QR bootstrap

Suggested:

```text
src/signaling/
  qr-envelope.ts
  qr-host.ts
  qr-player.ts
  ice-gathering.ts
```

Implement:

- Host offer QR
- Player answer QR
- validation
- expiry
- SDP encode/decode

---

## Phase 4 — Full mesh

Implement:

```text
PeerManager
Map<PlayerId, PeerConnection>
```

Requirements:

- every player eventually connects to every other player
- duplicate connections prevented
- pair identity deterministic
- signaling relay through existing peers during lobby

Test with 8 players.

---

## Phase 5 — Multiplayer event protocol

Implement:

```text
CLICK_REQUEST
EVENT_PROPOSE
EVENT_ACK
EVENT_COMMIT
STATE_SNAPSHOT
```

Then:

- Host authority
- sequence
- requestId dedupe
- target reservation
- quorum commit

---

## Phase 6 — Heartbeat

Implement:

```text
HEARTBEAT
HOST_HEARTBEAT
```

Track:

```text
lastSeen
connectionState
```

Add configurable timeout constants.

---

## Phase 7 — Host migration

Implement:

```text
MIGRATING
HOST_ELECTION
ELECTION_ACK
HOST_CHANGED
STATE_RECONCILIATION
HOST_READY
```

Critical tests:

- kill Host
- kill Host during proposal
- kill Host after commit
- old Host reconnect
- stale term messages
- partition without quorum

---

## Phase 8 — Reconnect

Implement:

```text
RECONNECT_REQUEST
STATE_SNAPSHOT
stateHash
```

Test:

- player leaves and returns
- Host leaves and returns
- missed events
- event gaps

---

## Phase 9 — UI

UI should consume GameState and multiplayer status.

Suggested screens:

```text
Lobby
  - room QR
  - player list
  - ready state
  - start

Countdown

Playing
  - board
  - scores
  - connection status

Migrating
  - reconnect/election indicator

Finished
  - final ranking
```

---

## Phase 10 — Hardening

Add:

- state hash
- structured logs
- debug overlay
- network simulation
- artificial latency
- packet duplication
- packet delay
- packet drop

---

## Suggested module boundaries

```text
src/
  game/
    types.ts
    reducer.ts
    generator.ts
    board.ts
    invariants.ts

  multiplayer/
    protocol.ts
    host.ts
    client.ts
    event-log.ts
    quorum.ts
    election.ts
    heartbeat.ts
    snapshot.ts
    reconnect.ts

  webrtc/
    transport.ts
    peer.ts
    peer-manager.ts
    negotiation.ts

  qr/
    envelope.ts
    host-bootstrap.ts
    player-bootstrap.ts

  ui/
    ...
```

The exact framework is not mandated by this design.

---

## Definition of done for MVP 1

A build is MVP-complete only if all tests in `09-test-matrix.md` pass.
