# 02 — Game State

Định nghĩa thật: `src/game/types.ts`. Reducer: `src/game/reducer.ts`.

## 1. Kiểu dữ liệu

```ts
type GamePhase = "COUNTDOWN" | "PLAYING" | "FINISHED" // MIGRATING/PAUSED KHÔNG nằm ở đây

interface GameConfig {
  playerLimit: number // 2..8
  numberCount: number // 5..100
  mode: "TRADITIONAL" | "RANDOM"
  numberMode: "SEQUENTIAL" | "FIXED_STEP" | "RANDOM_STEP"
  step: number // FIXED_STEP: targets[k] = 1 + k*step
  randomSteps: number[] // RANDOM_STEP: mỗi bước chọn (theo seed) từ danh sách này
  sizeMode: "SMALL" | "LARGE" | "RANDOM"
}

interface Member {
  id
  name
  color
  joinSequence
  secretHash
} // bất biến sau GAME_STARTED

interface GameState {
  protocolVersion: 2
  roomId: string
  phase: GamePhase
  config: GameConfig
  members: Member[] // sắp theo joinSequence
  round: number // tăng khi REMATCH
  seed: number
  targets: number[] // sinh một lần lúc start/rematch
  targetIndex: number // currentTarget = targets[targetIndex] (suy ra, không lưu)
  layoutVersion: number
  scores: Record<PlayerId, number>
  claimed: Record<string, PlayerId> // số → người tìm được
  leadership: { hostId: PlayerId; term: number }
  logIndex: number // index entry commit cuối
}
```

Không lưu term của entry, `connected`, hay bất cứ quan sát cục bộ nào ⇒ hai peer áp dụng cùng chuỗi nội dung entry luôn có cùng `stateHash`, kể cả khi một entry được re-propose ở term khác.

## 2. Entry (log)

```ts
type GameEvent = { term: number; index: number } & (
  | { type: "GAME_STARTED"; payload: { roomId; hostId; config; members; seed } }
  | { type: "PLAY_BEGIN"; payload: {} }
  | { type: "NUMBER_FOUND"; payload: { number; winner; requestId } }
  | { type: "HOST_CHANGED"; payload: { hostId; term } }
  | { type: "REMATCH"; payload: { config; seed } }
)
```

| Entry        | Điều kiện hợp lệ                                                      | Hiệu ứng                                                                                          |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GAME_STARTED | index = 1, config & members hợp lệ, host là member                    | tạo state, phase COUNTDOWN                                                                        |
| PLAY_BEGIN   | phase = COUNTDOWN                                                     | phase PLAYING                                                                                     |
| NUMBER_FOUND | phase PLAYING, winner là member, number = currentTarget, chưa claimed | score++, claimed, targetIndex++, RANDOM ⇒ layoutVersion++, hết số ⇒ **FINISHED trong cùng entry** |
| HOST_CHANGED | hostId là member, `leadership.term < payload.term ≤ entry.term`       | leadership mới; nếu chưa FINISHED ⇒ COUNTDOWN (đếm ngược lại sau freeze)                          |
| REMATCH      | phase FINISHED                                                        | round++, seed/targets mới, reset điểm, COUNTDOWN                                                  |

Mọi entry yêu cầu `index = logIndex + 1`.

## 3. Sinh số & bàn chơi

- PRNG: `mulberry32`, chỉ phép toán số nguyên. Cấm `Math.random()` cho dữ liệu replicated.
- `generateTargets(config, seed)`; `generateBoard(seed, layoutVersion, targets, sizeMode)` trả toạ độ nguyên trên bàn 3000×4000 (tỉ lệ 3:4). UI scale theo `cqw` nên mọi máy thấy cùng bố cục.
- Lưới cols×rows ≥ N, mỗi số một ô (xáo theo `mix(seed, layoutVersion)`), jitter + xoay ±30° trong ô, cỡ chữ theo sizeMode. Cỡ chữ RANDOM gắn với _số_ (seed theo `number`) nên ổn định khi xáo bàn.
- TRADITIONAL: layoutVersion luôn 0. RANDOM: +1 sau mỗi `NUMBER_FOUND` đã commit.

## 4. State hash

`stateHash = cyrb53(canonicalJson(state))` (key sắp xếp đệ quy). Dùng trong snapshot, heartbeat (phát hiện desync), phiếu bầu.

## 5. Bất biến (`src/game/invariants.ts`, chạy trong mọi stress test)

score ≥ 0 · tổng điểm = targetIndex = số lượng claimed · mọi target trước targetIndex đã claimed · FINISHED ⇔ hết target · TRADITIONAL ⇒ layoutVersion = 0 · term không giảm · logIndex không giảm · trong một round: membership và người thắng của một số không bao giờ đổi.
