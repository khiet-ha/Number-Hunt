# 02 — Game State

## 1. Core types

```ts
type PlayerId = string;

type GamePhase =
  | "LOBBY"
  | "COUNTDOWN"
  | "PLAYING"
  | "MIGRATING"
  | "FINISHED";

interface Player {
  id: PlayerId;
  name: string;
  joinSequence: number;
  color: string;
  connected: boolean;
  score: number;
}

interface GameConfig {
  playerLimit: number;
  numberCount: number;

  mode: "TRADITIONAL" | "RANDOM";

  numberMode:
    | "SEQUENTIAL"
    | "FIXED_STEP"
    | "RANDOM_STEP";

  step?: number;
  randomSteps?: number[];

  sizeMode:
    | "SMALL"
    | "LARGE"
    | "RANDOM";
}

interface BoardState {
  seed: number;
  layoutVersion: number;
}

interface Leadership {
  hostId: PlayerId;
  term: number;
}

interface GameState {
  protocolVersion: 1;
  roomId: string;

  phase: GamePhase;

  config: GameConfig;

  seed: number;
  targets: number[];
  targetIndex: number;

  currentTarget: number;

  board: BoardState;

  players: Player[];

  leadership: Leadership;

  scores: Record<PlayerId, number>;

  claimedNumbers: Record<string, PlayerId>;

  eventSeq: number;

  startedAt?: number;
  finishedAt?: number;
}
```

## 2. Why `targets[]`

For MVP, generate the complete target sequence once at game start.

Example:

```ts
targets = [1, 4, 14, 34, 55, ...]
```

100 integers are tiny. This is easier to debug than reproducing random target generation independently.

## 3. Board generation

Board positions should be deterministic:

```ts
position = generateBoard(seed, layoutVersion, targets)
```

Traditional:

```text
layoutVersion = 0 for entire game
```

Random:

```text
layoutVersion++
after each committed NUMBER_FOUND
```

All clients use the same deterministic generator.

Do not use `Math.random()` independently on each client.

## 4. State version

A replicated state version is:

```ts
{
  term: number;
  seq: number;
}
```

Event identity:

```text
`${term}:${seq}`
```

Example:

```text
0:51
1:1
1:2
```

## 5. State hash

Snapshots should contain:

```ts
stateHash: string
```

Hash a canonical serialization of the authoritative state.

Purpose:

- detect desync
- verify migration
- debug race conditions

## 6. Invariants

```text
score[p] >= 0

A number has at most one winner.

NUMBER_FOUND is valid only for currentTarget.

currentTarget is derived from targetIndex.

Only committed events mutate scores/target/layout.

term never decreases.

Within one term, committed seq increases strictly.

Membership is immutable after GAME_STARTED.
```
