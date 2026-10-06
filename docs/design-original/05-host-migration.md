# 05 — Host Migration

## 1. Goal

If current Host disappears, the game should:

1. freeze input
2. detect failure
3. elect deterministic candidate
4. create a new term
5. reconcile state
6. publish new Host
7. resume

Never change Host instantly.

## 2. Detection

Each peer tracks:

```ts
lastHostHeartbeat
```

Host heartbeat:

```text
~1 second
```

Recommended timeout:

```text
~5 seconds
```

Also inspect WebRTC connection state.

`disconnected` may be transient. `failed`/`closed` is stronger evidence.

## 3. Freeze

On Host timeout:

```text
phase = MIGRATING
```

During migration:

- ignore local clicks
- reject gameplay commands
- do not apply speculative state
- do not advance target

## 4. Deterministic candidate

Each player has immutable `joinSequence`.

Candidate:

```ts
lowest joinSequence among currently connected members
```

Example:

```text
Alice = 1 (dead)
Bob   = 2
Carol = 3
David = 4

candidate = Bob
```

All peers must independently calculate the same candidate.

## 5. New term

Old:

```text
term = 0
host = Alice
```

New:

```text
term = 1
host = Bob
```

Any message with:

```text
message.term < 1
```

is stale.

## 6. Election message

```json
{
  "type": "HOST_ELECTION",
  "term": 1,
  "candidateId": "p_bob",
  "candidateJoinSequence": 2
}
```

Peers validate:

- term is exactly currentTerm + 1
- candidate exists
- candidate is connected
- candidate has lowest valid joinSequence

## 7. Election quorum

New Host becomes authoritative only after majority ACK.

```text
quorum = floor(initialMembership / 2) + 1
```

If no majority is available:

```text
MIGRATING / PAUSED
```

Do not create two independent game histories.

## 8. State reconciliation

Different peers may have different last received events.

Example:

```text
Bob   = term 0 seq 51
Carol = term 0 seq 50
David = term 0 seq 51
```

A committed version with quorum certificate is authoritative.

New Host gathers:

```text
lastCommittedVersion
commitCertificates
stateHash
```

Choose the highest version that is proven committed by quorum.

Then create the new-term leadership record.

## 9. Why commit certificates matter

Host may die:

```text
after deciding an event
but before broadcasting it to every peer
```

Without commit evidence, another peer cannot know whether the event was authoritative.

A quorum certificate records the peers that acknowledged the proposal.

## 10. Migration sequence

```text
HOST_TIMEOUT
    |
    v
MIGRATING
    |
    v
deterministic candidate
    |
    v
HOST_ELECTION
    |
    v
majority ACK
    |
    v
STATE_RECONCILIATION
    |
    v
NEW TERM
    |
    v
HOST_CHANGED
    |
    v
STATE_SNAPSHOT
    |
    v
HOST_READY
    |
    v
PLAYING
```

## 11. Old Host returns

Old Host has:

```text
term = 0
```

Current game:

```text
term = 1
```

Old Host becomes a normal peer.

It must not reclaim leadership.

It receives a snapshot from current Host.

## 12. Split-brain protection

Do not allow arbitrary self-promotion.

Only deterministic candidate may propose leadership for a given term.

A peer seeing another candidate with lower joinSequence must reject itself as candidate.

## 13. Network partition

MVP does not support independent progress in a partition.

If a group lacks quorum:

```text
PAUSED / MIGRATING
```

rather than running two histories.

This is intentional.

## 14. Membership freeze

Quorum membership is fixed at `GAME_STARTED`.

A disconnected player remains a member.

This prevents quorum size from changing unexpectedly during the match.
