# 07 — Reconnect và xử lý lỗi

## 1. Danh tính bền vững

Mỗi tab giữ trong `sessionStorage`: `{roomId, id, name, secret, secretHash}` và trạng thái replication `{currentTerm, votedFor, state đã commit, accepted, certificate, startMembers}` (ghi mỗi lần đổi). Persist `votedFor`/`accepted` là **yêu cầu an toàn** (không được quên phiếu đã bầu hay entry đã ACK).

## 2. Mất một vài link

Mesh maintainer nối lại qua relay (06 §4). Khi link tới leader mở lại: `STATE_REQUEST{reason: reconnect}` → snapshot → so hash → ACTIVE (R01–R03).

## 3. Reload / mất hết link

Trang chủ hiện "Bạn đang có một trận dở". Một thành viên bất kỳ mở menu → "Mời người chơi bị rớt vào lại" (offer `k: rejoin`). Người reload quét → mã trả lời chứa secret → thành viên kiểm `sha256(secret)` → bind link → node ở chế độ `restore` (term/phiếu/state từ storage) → học leader từ heartbeat → snapshot → mesh tự nối phần còn lại. Cùng slot, cùng joinSequence, cùng điểm (e2e "reload mid-game").

Không có session (tab khác/thiết bị khác) ⇒ không thể vào lại (không có secret).

## 4. Các tình huống

| Tình huống                          | Xử lý                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------- |
| Gap: nhận index > logIndex+1        | không áp dụng; `STATE_REQUEST` (E02)                                                     |
| Commit bị lỡ                        | heartbeat leader có `logIndex` lớn hơn ⇒ `STATE_REQUEST`                                 |
| Trùng                               | index ≤ logIndex ⇒ bỏ; messageId trùng ⇒ bỏ (E01)                                        |
| Term cũ                             | bỏ (E03)                                                                                 |
| Term mới                            | nhận term, freeze, reconcile (E04)                                                       |
| Hash snapshot sai                   | xin lại; 3 lần liên tiếp ⇒ **DESYNC** (khoá input, hiện lỗi, tiếp tục xin mỗi 5 s) (R04) |
| Hash heartbeat khác ở cùng logIndex | bug cục bộ ⇒ xin snapshot, thay state (R04b)                                             |
| Leader treo không có quorum         | PAUSED (04 §5)                                                                           |
| Không bầu được                      | MIGRATING, hiện số người cần (05 §8)                                                     |
| Người chơi rời giữa trận            | vẫn là member, giữ điểm & joinSequence, có thể vào lại                                   |
| Host lobby rời trước khi start      | phòng đóng (giới hạn MVP)                                                                |
| Host rời/chết trong trận            | migration (05)                                                                           |
