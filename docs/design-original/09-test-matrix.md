# 09 — Test Matrix

## A. Game engine

| ID | Scenario | Expected |
|---|---|---|
| G01 | sequential targets | exact sequence |
| G02 | fixed step | exact step |
| G03 | random steps | deterministic given seed/config |
| G04 | traditional board | position unchanged |
| G05 | random board | layout changes after commit |
| G06 | final target | FINISHED |
| G07 | same seed | same board on all peers |

## B. Click race

| ID | Scenario | Expected |
|---|---|---|
| C01 | one valid click | one point |
| C02 | two simultaneous clicks | exactly one winner |
| C03 | eight simultaneous clicks | exactly one winner |
| C04 | wrong number | no state change |
| C05 | double click | one point |
| C06 | duplicate requestId | ignored |
| C07 | click during migration | ignored |
| C08 | stale-term click | rejected |
| C09 | already claimed number | rejected |
| C10 | proposal loses quorum | rollback, no point |

## C. Event ordering

| ID | Scenario | Expected |
|---|---|---|
| E01 | duplicate event | ignored |
| E02 | event gap | snapshot requested |
| E03 | stale term | ignored |
| E04 | future term | freeze/reconcile |
| E05 | invalid sender identity | rejected |
| E06 | client-supplied score | ignored |

## D. Host migration

| ID | Scenario | Expected |
|---|---|---|
| H01 | Host disconnects | game freezes |
| H02 | deterministic candidate | same candidate everywhere |
| H03 | candidate gets quorum | new Host |
| H04 | no quorum | remains paused |
| H05 | old Host returns | normal peer |
| H06 | old-term event arrives | ignored |
| H07 | Host dies during proposal | no duplicate score |
| H08 | Host dies after commit | committed state preserved |
| H09 | network partition | minority cannot progress |
| H10 | Host dies during countdown | countdown recovered/restarted |

## E. Reconnect

| ID | Scenario | Expected |
|---|---|---|
| R01 | player reconnects | same player identity |
| R02 | player reconnects | same joinSequence |
| R03 | missed events | snapshot |
| R04 | state hash mismatch | recovery |
| R05 | Host reconnects after migration | no leadership reclaim |

## F. WebRTC

| ID | Scenario | Expected |
|---|---|---|
| W01 | QR offer | valid |
| W02 | QR answer | valid |
| W03 | wrong room QR | reject |
| W04 | expired QR | reject |
| W05 | duplicate peer connection | prevented |
| W06 | 8-player mesh | 28 pair connections |
| W07 | transient disconnect | no immediate migration |
| W08 | failed connection | reconnect/election path |

## G. Security / trust boundaries

| ID | Scenario | Expected |
|---|---|---|
| S01 | spoof senderId | reject |
| S02 | fake winner | reject |
| S03 | fake score | reject |
| S04 | fake target | reject |
| S05 | stale Host message | reject |
| S06 | invalid term | reject |
| S07 | malformed message | reject safely |

## Stress scenarios

1. 8 players.
2. All click target within same 100 ms window.
3. 5–10% artificial packet drop.
4. 100–300 ms artificial latency.
5. Duplicate packets.
6. Delayed packets.
7. Kill Host at random point.
8. Kill Host immediately after proposal.
9. Kill Host immediately after commit.
10. Reconnect multiple players simultaneously.
