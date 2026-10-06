# Protocol Quick Reference

## Message envelope

```ts
{
  protocol: 1,
  type,
  roomId,
  senderId,
  term,
  messageId,
  payload
}
```

## Click

```text
CLIENT
  CLICK_REQUEST
      ↓
HOST
  validate
      ↓
  reserve target
      ↓
  EVENT_PROPOSE
      ↓
  ACK majority
      ↓
  EVENT_COMMIT
      ↓
ALL PEERS
  applyEvent()
```

## Migration

```text
HOST TIMEOUT
  ↓
MIGRATING
  ↓
lowest joinSequence candidate
  ↓
new term
  ↓
majority election ACK
  ↓
state reconciliation
  ↓
HOST_CHANGED
  ↓
snapshot
  ↓
HOST_READY
  ↓
PLAYING
```

## Golden invariants

```text
Only Host creates authoritative events.
Only COMMIT mutates state.
Winner = Host processing order.
Term prevents stale leadership.
Seq prevents duplicate/out-of-order application.
RequestId prevents duplicate commands.
Quorum prevents minority history.
Migration freezes gameplay.
Membership freezes after GAME_STARTED.
