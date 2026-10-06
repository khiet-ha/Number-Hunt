# Game Tìm Số — MVP 1 Design Pack

## Mục tiêu

Bộ tài liệu này là **source of truth** để các coding agent khác có thể tiếp tục implement MVP 1 mà không phải suy luận lại kiến trúc multiplayer.

MVP 1:

- PWA chạy trên GitHub Pages.
- 2–8 người chơi.
- Không cần backend/signaling server.
- QR two-way dùng cho bootstrap/signaling ban đầu.
- WebRTC full-mesh.
- Host-authoritative game logic.
- Event log + `(term, seq)` ordering.
- Click race được quyết định tại Host.
- Quorum ACK/commit cho authoritative event.
- Heartbeat + deterministic Host election.
- Host migration có freeze → election → state reconciliation → resume.
- Reconnect bằng player identity cũ.
- Traditional mode và Random mode.
- Deterministic board bằng seed/layoutVersion.
- Không cho join giữa trận.

## Quy tắc nền tảng

1. **Full mesh** là bắt buộc cho Host migration.
2. Client gửi command; Host tạo authoritative event.
3. Không dùng timestamp của client để quyết định ai click trước.
4. Winner là valid click request được authoritative Host xử lý trước.
5. Chỉ committed event mới được mutate replicated GameState.
6. Event có `term` và `seq`.
7. Command có `requestId` để chống duplicate.
8. Game freeze trong migration.
9. New Host phải là candidate deterministic và đạt quorum.
10. Membership cố định khi game đã `PLAYING`.

## Đọc tài liệu theo thứ tự

1. `01-architecture.md`
2. `02-game-state.md`
3. `03-wire-protocol.md`
4. `04-click-race-and-commit.md`
5. `05-host-migration.md`
6. `06-webrtc-and-qr.md`
7. `07-reconnect-and-failure.md`
8. `08-implementation-plan.md`
9. `09-test-matrix.md`
10. `10-agent-rules.md`

Sơ đồ:

- `images/architecture.png`
- `images/click-race.png`
- `images/host-migration.png`

## Non-goals

Không implement trong MVP 1:

- account/auth server
- matchmaking/public room
- database
- join giữa trận
- spectator
- chat/voice
- ranking
- TURN bắt buộc
- production-grade Raft/Paxos
- anti-cheat server-side
