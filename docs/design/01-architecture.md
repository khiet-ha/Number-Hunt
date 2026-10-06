# 01 — Architecture

## 1. Các lớp

```text
UI (Preact)            src/ui/        render NodeView, gửi intent (click, ready, start, rematch, leave)
App controller         src/app/       nối QR ↔ transport ↔ GameNode, session/identity
Multiplayer core       src/multiplayer/  GameNode: lobby, log, quorum, heartbeat, bầu, reconcile, relay signaling
Game engine            src/game/      applyEvent / validateEvent / generator / board — thuần, deterministic
WebRTC transport       src/webrtc/    PeerLink (RTCPeerConnection + DataChannel), WebRtcTransport (Map<PlayerId, PeerLink>)
QR bootstrap           src/qr/        envelope offer/answer, nén SDP
```

Phụ thuộc chỉ đi xuống. `GameNode` chỉ thấy interface `Transport`, `Clock`, `KeyValueStore` (`src/multiplayer/env.ts`) nên chạy y hệt trên WebRTC thật và trên network simulator trong test.

UI không bao giờ sửa score/target/winner, không tự làm Host. UI chỉ đọc `NodeView` và gọi `node.click(n)` / `setReady` / `startGame` / `rematch` / `leave`.

## 2. Topology

Full mesh: N(N−1)/2 link (8 người = 28). Bắt buộc vì khi Host chết, các peer còn lại phải nói chuyện trực tiếp để bầu.

Link đầu tiên Host↔player qua QR. Các link player↔player được negotiate qua **relay signaling** (`SIGNAL`) qua một peer chung (trong lobby là Host). Bên có joinSequence thấp hơn chủ động (initiator). Link nào đứt thì cũng được nối lại theo cùng cơ chế miễn còn một peer chung.

## 3. Authority

- **Lobby**: Host lobby quyết định danh sách, joinSequence, màu, config, ready. Không quorum.
- **Game**: một log replicated. Leader của term T là duy nhất. Leadership hiện hành nằm trong `GameState.leadership` (do entry `GAME_STARTED` / `HOST_CHANGED` đặt).

## 4. Membership

- Lobby: join/leave tự do (tới `playerLimit`).
- Từ `GAME_STARTED` (kể cả khi mới accepted, chưa commit): đóng băng. Rớt mạng/rời không xoá khỏi membership, không đổi joinSequence; join mới bị từ chối. Quorum luôn tính trên membership này.
- `REMATCH` giữ nguyên membership.

## 5. Sở hữu trạng thái

| Replicated (trong `GameState`, hash được)           | Cục bộ (không replicate)                                         |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| members (id, name, color, joinSequence, secretHash) | LocalStatus (ACTIVE/MIGRATING/PAUSED/…)                          |
| config, round, seed, targets, targetIndex           | link state, lastSeen, peer links                                 |
| layoutVersion, scores, claimed                      | pendingClick, lastReject, countdownEndsAt                        |
| phase (COUNTDOWN/PLAYING/FINISHED)                  | currentTerm, votedFor, accepted (persist, nhưng không replicate) |
| leadership {hostId, term}, logIndex                 | leaderId đang biết, election đang chạy                           |

## 6. Bất biến then chốt

```text
score/target/layout/phase chỉ đổi trong applyCommitted(entry, certificate)
— hàm duy nhất gọi applyEvent() trong GameNode.
```
