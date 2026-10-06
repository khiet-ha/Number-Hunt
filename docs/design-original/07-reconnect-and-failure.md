# 07 — Reconnect and Failure Handling

## 1. Player reconnect

A player retains:

```text
playerId
joinSequence
name
color
```

A reconnect request:

```text
RECONNECT_REQUEST
```

must identify the existing player.

Do not create a new player slot.

## 2. Reconnect flow

```text
peer returns
    |
RECONNECT_REQUEST
    |
validate identity
    |
STATE_SNAPSHOT
    |
apply snapshot
    |
stateHash check
    |
RECONNECTED
```

## 3. Reload

MVP recommendation:

```text
page reload = leave current session
```

Persistent browser session recovery is a later feature.

## 4. Host reconnect after migration

Old Host returns:

```text
old term < current term
```

It becomes a normal player.

No automatic leadership reclaim.

## 5. Event gap

If peer has:

```text
lastSeq = 50
```

and receives:

```text
seq = 52
```

do not apply 52.

Send:

```text
STATE_REQUEST
```

New Host sends snapshot.

## 6. Duplicate event

If:

```text
event.seq <= lastAppliedSeq
```

ignore it.

## 7. Stale term

If:

```text
event.term < currentTerm
```

ignore it.

## 8. Future term

If:

```text
event.term > currentTerm
```

freeze and reconcile.

Do not blindly advance local term.

## 9. State hash mismatch

After snapshot:

```text
computedHash !== snapshot.stateHash
```

then:

```text
DESYNC
```

Request a fresh snapshot.

If repeated, pause the game and surface a recovery error.

## 10. Player disconnect

A disconnected player:

- remains in membership
- keeps score
- keeps joinSequence
- may reconnect

No joinSequence reassignment.

## 11. Loss of quorum

If current Host cannot reach quorum for a commit or migration:

```text
MIGRATING / PAUSED
```

Do not continue authoritative gameplay.

## 12. Host leaves intentionally

Treat as Host failure for MVP:

```text
freeze
election
reconcile
resume
```
