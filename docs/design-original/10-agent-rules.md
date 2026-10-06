# 10 — Rules for Coding Agents

This file is intentionally strict. Treat it as an implementation contract.

## Rule 1 — Do not move authority into UI

UI can send commands and render state.

UI must not:

- increment score
- select winner
- change currentTarget
- become Host

## Rule 2 — Do not use client timestamps for race resolution

`clientTimestamp` is diagnostics only.

Winner ordering is Host processing order.

## Rule 3 — Do not create a second source of truth

Authoritative game state comes from:

```text
GameEngine state
+
committed event log
```

Avoid parallel mutable score/target variables outside GameEngine.

## Rule 4 — Every mutation must be traceable

A mutation must answer:

```text
Which event caused this?
Which term?
Which seq?
Was it committed?
```

## Rule 5 — Never silently repair state

If:

```text
event gap
future term
state hash mismatch
```

request reconciliation/snapshot.

Do not invent local state.

## Rule 6 — Never self-elect arbitrarily

Host election must use:

```text
lowest joinSequence
+
new term
+
quorum
```

## Rule 7 — Freeze during migration

No gameplay progress while:

```text
phase === MIGRATING
```

## Rule 8 — Membership is fixed in PLAYING

Do not add a new player during a running match in MVP 1.

## Rule 9 — Transport and game logic stay separate

WebRTC code must not know game rules.

Game Engine must not import WebRTC.

## Rule 10 — Prefer explicit state machines

Avoid boolean soup such as:

```ts
isHost
isConnected
isMigrating
isReady
isPlaying
```

where contradictory combinations are possible.

Use explicit phase/leadership state.

## Rule 11 — All protocol changes are versioned

Increment protocol version if a breaking wire-format change is introduced.

## Rule 12 — Keep debug observability

Every multiplayer event should be loggable with:

```text
timestamp
term
seq
eventId/messageId
senderId
type
```

Never log private secrets/SDP unnecessarily in production.

## Rule 13 — Deterministic behavior

Given:

```text
same seed
same config
same committed event stream
```

all clients must reach the same GameState.

## Rule 14 — Do not replace the quorum protocol with "last message wins"

That breaks Host migration correctness.

## Rule 15 — If uncertain, preserve consistency over availability

For MVP:

```text
PAUSE
```

is preferable to:

```text
two different game histories
```

## Agent workflow

Before implementing a multiplayer change:

1. Read `01-architecture.md`.
2. Read `02-game-state.md`.
3. Read `03-wire-protocol.md`.
4. Check invariants in this file.
5. Add/update tests in `09-test-matrix.md`.
6. Keep GameEngine deterministic.
7. Keep transport independent.
8. Verify migration behavior.
