# 04 — Click Race, Ordering, and Commit

## 1. Definition of "first"

MVP rule:

> The winner is the player whose valid `CLICK_REQUEST` is first processed by the authoritative Host.

Do NOT compare client timestamps.

Why:

- clocks differ
- network latency differs
- browser scheduling differs
- timestamps do not prove physical click order

## 2. Race example

Current target:

```text
17
```

Alice and Bob both click.

Host receives:

```text
Alice CLICK_REQUEST
Bob CLICK_REQUEST
```

Host processes Alice first:

```text
reserve target 17 for Alice
```

Bob then arrives:

```text
currentTarget is already changing / target is reserved
```

Bob loses.

Exactly one `NUMBER_FOUND` may be committed.

## 3. Host-side validation

```ts
function handleClickRequest(command: ClickRequest) {
  validateSender(command);

  if (state.phase !== "PLAYING") return reject();

  if (command.term !== state.leadership.term) return reject();

  if (command.number !== state.currentTarget) return reject();

  if (pendingClaims.has(command.number)) return reject();

  if (claimedNumbers[command.number] != null) return reject();

  pendingClaims.set(command.number, command.requestId);

  proposeNumberFound(
    command.number,
    command.senderId,
    command.requestId
  );
}
```

## 4. Reservation

Reservation happens before quorum:

```text
CLICK_REQUEST
   |
   v
validate
   |
   v
reserve currentTarget
   |
   v
EVENT_PROPOSE
```

This prevents two proposals for the same target.

## 5. Commit

Recommended MVP flow:

```text
CLICK_REQUEST
      |
      v
validate
      |
      v
reserve target
      |
      v
EVENT_PROPOSE
      |
      +----> peers
      |
      v
collect ACK
      |
      v
majority?
  |       |
 yes      no
  |       |
  v       v
COMMIT   reject/rollback
  |
  v
applyEvent()
```

## 6. Quorum

Membership is fixed after game start.

For N players:

```ts
quorum = Math.floor(N / 2) + 1;
```

Examples:

```text
2 players -> 2
3 players -> 2
4 players -> 3
5 players -> 3
8 players -> 5
```

A disconnected player remains part of membership for quorum purposes.

If a majority cannot be reached, do not commit the event.

## 7. ACK timeout

MVP recommendation:

```text
event ACK timeout: 150–300 ms on normal LAN
```

If quorum is not reached:

- reject proposal
- release reservation
- do not mutate GameState

If network conditions are poor, increase timeout rather than weakening consistency.

## 8. Client optimistic UI

Allowed:

```text
show local click as "pending"
```

Not allowed:

```text
increment score
advance target
declare winner
```

until `EVENT_COMMIT`.

## 9. Duplicate click

Every click has a unique `requestId`.

Host stores processed request IDs.

Duplicate request:

```text
same requestId
```

→ ignored.

Different request IDs for same target:

```text
first valid request reserves target
later requests rejected
```

## 10. Event application

Only:

```text
EVENT_COMMIT(NUMBER_FOUND)
```

may:

```text
score[winner]++
targetIndex++
currentTarget = targets[targetIndex]
```

In Random mode:

```text
layoutVersion++
```

after the committed event.

## 11. Final event

When the final target is committed:

```text
NUMBER_FOUND
   |
   v
GAME_FINISHED
```

The finish event must also be authoritative and ordered.
