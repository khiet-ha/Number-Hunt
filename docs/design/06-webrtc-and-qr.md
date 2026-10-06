# 06 — WebRTC và QR

## 1. Bootstrap hai chiều (không signaling server)

```text
Host: tạo PeerLink, createOffer, chờ ICE gathering xong (non-trickle, tối đa 4 s)
      → mã mời = URL  https://…/Number-Hunt/#j=<packed offer>   (hiện QR + nút copy)
Player: quét bằng camera hệ thống → mở app → nhập tên → acceptOffer → mã trả lời "NH2:<packed answer>" (QR + text)
Host: "Quét mã trả lời" (camera trong app) hoặc dán → validate → addGuest → bind link → setRemoteDescription
      → DataChannel mở → LOBBY_STATE
```

Offer nằm trong fragment `#…` nên không bao giờ gửi lên server GitHub Pages. Host luôn giữ **một** lời mời mở; dùng xong tự tạo lời mời mới tới khi đủ `playerLimit`.

## 2. Envelope QR (`src/qr/envelope.ts`)

```ts
offer = {
  v: 2,
  t: "o",
  r: roomId,
  h: offererId,
  n: nonce,
  k: "join" | "rejoin",
  s: sdp,
}
answer = {
  v: 2,
  t: "a",
  r: roomId,
  h: offererId,
  n: nonce,
  p: playerId,
  m: name,
  x: join ? sha256(secret) : secret,
  s: sdp,
}
```

Đóng gói: lọc SDP (bỏ `a=extmap-allow-mixed`, `a=msid-semantic`, candidate TCP) → JSON → `deflate-raw` (CompressionStream) → base64url; tiền tố `Z` (nén) hoặc `P` (fallback không nén). Thực đo trên Chromium: offer URL ~600 ký tự, answer ~630 ký tự (QR ~version 16, mức L).

## 3. Validate mã trả lời (bên tạo lời mời)

roomId đúng (W03) · `h` = chính mình · `n` khớp lời mời đang mở và chưa dùng · tuổi lời mời ≤ 5 phút **theo đồng hồ của bên tạo** (W04) · không tự join · phòng chưa đủ / chưa start · tên ≤ 16 ký tự (được làm sạch). Rejoin: `sha256(x)` phải bằng `secretHash` của thành viên `p`.

## 4. Mesh qua relay

Mỗi heartbeat mang `links`. Mỗi 2.5 s, với thành viên chưa nối mà mình có joinSequence thấp hơn: tìm peer `r` đang nối với cả hai, `dial()` tạo offer (non-trickle), gửi `SIGNAL{origin: me, target, kind: offer}` cho `r`; `r` chuyển tiếp đúng một bước; target `acceptDial()` và trả `answer` theo đường ngược lại. Bên nhận chỉ chấp nhận offer từ joinSequence thấp hơn ⇒ không có hai link cho một cặp (W05). Link mới cho cùng người chơi thay link cũ; sự kiện từ link cũ bị bỏ qua.

Lobby chỉ cho Start khi full mesh hoàn chỉnh (W06: 8 người = 28 link).

## 5. DataChannel

`createDataChannel("game", { negotiated: true, id: 0, ordered: true })` — reliable, ordered; hai bên cùng tạo nên không có race `ondatachannel`. Lớp WebRTC chỉ biết `send/receive/linkState`, không biết game.

## 6. Trạng thái link → core

`connected` (DataChannel mở) · `disconnected` (tạm, chờ heartbeat timeout) · `failed`/`closed` (đường nhanh 1.5 s).

## 7. ICE / TURN

Mặc định STUN `stun.l.google.com:19302`; `?nostun` để chỉ dùng host candidate (LAN/offline/test). Không TURN: một số NAT đối xứng / 4G sẽ không nối được — giới hạn đã biết, không thay đổi game engine vì việc này.
