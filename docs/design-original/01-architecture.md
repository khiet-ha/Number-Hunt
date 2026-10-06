# 01 — Architecture

## 1. Logical layers

```text
UI / PWA
   |
Game Engine
   |
Multiplayer Core
   |
WebRTC Transport
   |
QR Bootstrap / Signaling
```

### UI

Chỉ render state và gửi user intent:

- click number
- ready
- start
- leave

UI không được tự sửa score/currentTarget/winner.

### Game Engine

Pure-ish state reducer:

```ts
applyEvent(state, event): state
```

Không biết WebRTC tồn tại.

### Multiplayer Core

Quản lý:

- Host authority
- commands
- event log
- commit certificates
- term/sequence
- heartbeat
- election
- migration
- snapshots
- reconnect

### WebRTC Transport

Chỉ quản lý:

- `RTCPeerConnection`
- `RTCDataChannel`
- connection state
- signaling messages

### QR Bootstrap

Chỉ dùng để thiết lập WebRTC ban đầu:

```text
Host offer QR
  -> Player scans
  -> Player answer QR
  -> Host scans
  -> peer connection
```

Sau khi có connection, signaling cho các peer khác có thể được relay qua DataChannel.

## 2. Topology

MVP dùng full mesh.

Với N player:

```text
connections = N * (N - 1) / 2
```

8 players = 28 peer connections.

Lý do: nếu chỉ dùng Host-star, khi Host chết các peer còn lại không có đường liên lạc để bầu Host mới.

## 3. Authority

Tại mọi thời điểm `PLAYING`, đúng một leadership record hợp lệ:

```ts
{
  hostId: PlayerId,
  term: number
}
```

Chỉ Host hiện tại được tạo authoritative event.

## 4. Membership

`LOBBY`:

- player có thể join/leave.

Sau `GAME_STARTED`:

- membership được freeze.
- disconnect không xóa player khỏi membership.
- join mới bị từ chối.

Điều này làm quorum và migration deterministic.

## 5. State ownership

### Client-owned

- local UI state
- local pointer/touch state
- pending visual click
- local WebRTC connection state

### Authoritative

- player list
- joinSequence
- game config
- target sequence
- currentTarget
- scores
- claimed numbers
- board seed/layoutVersion
- phase
- hostId
- term
- committed event version

## 6. Critical invariant

```text
Only:
  EVENT_COMMIT(NUMBER_FOUND)
can change score/currentTarget.
```

Không có đường code nào khác được phép tăng score.
