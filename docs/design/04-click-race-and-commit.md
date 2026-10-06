# 04 — Click race, ordering, commit

## 1. "Ai trước"

Người thắng là người có `CLICK_REQUEST` hợp lệ được **Host xử lý trước**. Không so `clientTimestamp` (đồng hồ lệch, latency khác, timestamp không chứng minh thứ tự vật lý).

## 2. Host xử lý click (`GameNode.handleClick`)

```text
(sender, requestId) đã xử lý?           → bỏ im lặng (C06)
không phải leader / chưa vào game       → reject notHost
sender không phải member                → reject
envelope.term ≠ currentTerm             → reject staleTerm (C08)
phase ≠ PLAYING                         → reject phase (C07 ở phía Host)
đang có entry treo hoặc trong hàng đợi  → reject reserved   ← reservation
số người sống < quorum                  → reject noQuorum
number ≠ currentTarget                  → reject wrongNumber (C04)
đã claimed                              → reject claimed (C09)
ngược lại                               → propose NUMBER_FOUND{number, winner: sender, requestId}
```

`winner` luôn là sender của link, mọi trường khác trong payload bị bỏ qua (E06, S02, S03). Host tự click đi đúng hàm này.

## 3. Reservation = entry đang treo

Mỗi lúc chỉ có **tối đa một entry treo**. Khi `NUMBER_FOUND` cho target hiện tại đang treo, mọi click khác bị từ chối ⇒ không bao giờ có hai proposal cho cùng một target (C02, C03).

## 4. Commit

```text
CLICK_REQUEST → validate → propose(index = logIndex+1, term = currentTerm)
  Host tự ACK; accepted = entry (persist); gửi EVENT_PROPOSE cho mọi thành viên
  peer: validate ⇒ accepted = entry (persist) ⇒ EVENT_ACK
  Host: acks ≥ ⌊N/2⌋+1 ⇒ applyCommitted() ⇒ EVENT_COMMIT{event, certificate} ⇒ entry tiếp theo
```

ACK nghĩa là "tôi đã nhận, đã validate và **đã lưu** proposal này" — chưa được sửa state. Việc lưu là bắt buộc để migration không làm mất entry đã commit (05 §6).

## 5. Thiếu quorum (thay cho "reject/rollback" của bản gốc)

- Host gửi lại `EVENT_PROPOSE` cho ai chưa ACK mỗi `resendMs` (600 ms) và khi link nối lại.
- Treo quá `pauseAfterMs` (2.5 s) hoặc số người sống < quorum ⇒ Host báo `paused` trong heartbeat ⇒ mọi người hiện **PAUSED**.
- Không bao giờ propose giá trị khác ở cùng index trong cùng term. Có quorum trở lại ⇒ commit đúng entry đó. Nếu Host đổi trước đó, entry có thể được Host mới carry hoặc bị bỏ — nhưng không bao giờ commit hai lần (C10, H07).
- Lý do: rollback rồi tái dùng index tạo ra hai giá trị cho một index mà một số peer đã ACK ⇒ migration không biết chọn cái nào.

## 6. Quorum

`quorum = ⌊N/2⌋ + 1`, N = membership cố định (2→2, 3→2, 4→3, 5→3, 8→5). Người rớt vẫn tính vào N. Leader tính chính mình.

## 7. UI lạc quan

Được: đánh dấu số vừa bấm là "pending". Không được: tăng điểm, chuyển target, báo thắng trước khi commit. Thua race ⇒ UI hiện "Chậm hơn một chút!" khi nhận commit của người khác hoặc `CLICK_REJECT`. Client tự lọc số sai trước khi gửi (chỉ UX — Host vẫn kiểm).

## 8. Kết thúc

`NUMBER_FOUND` cho target cuối chuyển phase sang FINISHED **trong cùng entry** (không có entry `GAME_FINISHED` riêng có thể bị mất giữa chừng). Leader có thể commit `REMATCH`.

## 9. Đếm ngược

Sau `GAME_STARTED`, `HOST_CHANGED`, `REMATCH` phase là COUNTDOWN. Mỗi peer đếm 3 s theo đồng hồ của mình kể từ lúc apply; leader commit `PLAY_BEGIN` sau 3 s của nó. Click chỉ hợp lệ sau `PLAY_BEGIN` đã commit, nên lệch đồng hồ không tạo lợi thế.
