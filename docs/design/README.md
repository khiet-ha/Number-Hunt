# Game Tìm Số — MVP 1 Design (bản hoàn thiện, protocol v2)

Đây là **source of truth** cho MVP 1, thay thế bản gốc ở `docs/design-original/`. Đọc `00-review.md` trước để biết bản gốc đã được sửa những gì và tại sao.

Code tương ứng: `src/` (xem `08-implementation-plan.md` cho bản đồ module). Test tương ứng: `tests/` + `e2e/` (xem `09-test-matrix.md`).

## Phạm vi MVP 1

- PWA tĩnh trên GitHub Pages, 2–8 người, không backend/signaling server.
- QR hai chiều để bootstrap WebRTC; signaling các cặp còn lại relay qua DataChannel.
- WebRTC full mesh, DataChannel reliable + ordered.
- Host-authoritative; log replicated kiểu Raft/Paxos-lite (một entry treo tại một thời điểm).
- Click race quyết định bởi thứ tự Host xử lý; commit khi đủ quorum ACK.
- Heartbeat mọi-tới-mọi; pre-vote + vote; ưu tiên joinSequence thấp nhất.
- Migration: freeze → bầu → reconcile (carry entry) → `HOST_CHANGED` → đếm ngược → chơi tiếp.
- Reconnect: tự nối lại qua relay; reload ⇒ vào lại bằng rejoin QR từ bất kỳ thành viên nào.
- Chế độ Truyền thống / Ngẫu nhiên; dãy số liên tiếp / bước cố định / bước ngẫu nhiên; bàn chơi deterministic.
- Không cho join giữa trận; có "Chơi ván mới" (REMATCH) với cùng thành viên.

## Quy tắc nền tảng (golden invariants)

1. Chỉ leader của term hiện tại tạo entry; mỗi term tối đa một leader (mỗi peer bầu một lần/term, persist).
2. Chỉ entry **đã commit** mới đi qua `applyEvent()`; không đường code nào khác sửa `GameState`.
3. Người thắng = `CLICK_REQUEST` hợp lệ được Host xử lý trước; `clientTimestamp` chỉ để chẩn đoán.
4. Log index tăng liên tục qua các term; một index trong một term chỉ có một giá trị.
5. Entry commit khi ⌊N/2⌋+1 thành viên (tính cả Host) đã ACK; N = membership cố định lúc `GAME_STARTED`.
6. Host mới phải re-propose entry accepted có term cao nhất trong quorum phiếu bầu.
7. `requestId` chống click trùng; `messageId` chống message trùng.
8. Không có leader còn sống ⇒ MIGRATING: không chơi, không đoán state.
9. Thiếu quorum ⇒ PAUSED, không bao giờ chạy hai lịch sử.
10. `GameState` là hàm thuần của chuỗi nội dung entry đã commit (cùng chuỗi ⇒ cùng `stateHash`).

## Thứ tự đọc

`00-review.md` → `01-architecture.md` → `02-game-state.md` → `03-wire-protocol.md` → `04-click-race-and-commit.md` → `05-host-migration.md` → `06-webrtc-and-qr.md` → `07-reconnect-and-failure.md` → `08-implementation-plan.md` → `09-test-matrix.md` → `10-agent-rules.md`. Tra nhanh: `PROTOCOL_QUICK_REFERENCE.md`.

## Non-goals

Account/auth server, matchmaking, database, join giữa trận, spectator, chat/voice, ranking, TURN bắt buộc, Raft đầy đủ (log compaction, membership change), anti-cheat.
