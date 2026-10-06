# 03 — Wire Protocol (v2)

Định nghĩa + validate: `src/multiplayer/protocol.ts`. v1 → v2 là breaking change (log index toàn cục, pre-vote, phiếu bầu mang snapshot, `HOST_CHANGED` thành entry).

## 1. Envelope

```ts
interface Envelope {
  protocol: 2;
  type: MessageType;
  roomId: string;
  senderId: PlayerId;   // PHẢI bằng player gắn với DataChannel nhận được, nếu không ⇒ drop (S01)
  term: number;         // currentTerm của người gửi
  messageId: string;    // `${nonce}.${counter}`; dedupe theo (sender, messageId)
  payload: …;
}
```

Mọi message đi qua `decode()`: JSON hợp lệ, ≤ 64 KB, đúng protocol, type biết, payload đúng shape — sai là drop an toàn (S07). Sau đó: `senderId` = link, `roomId` đúng, người gửi là thành viên, chưa thấy `messageId`.

## 2. Danh mục message

| Nhóm     | Type                             | Hướng           | Payload                                                    |
| -------- | -------------------------------- | --------------- | ---------------------------------------------------------- |
| Lobby    | `LOBBY_STATE`                    | Host → all      | `{hostId, players[{…member, ready}], config}`              |
|          | `READY`                          | player → Host   | `{ready}`                                                  |
|          | `LEAVE`                          | any → all       | `{}`                                                       |
|          | `JOIN_REJECT`, `ROOM_CLOSED`     | Host → player   | `{reason}`                                                 |
| Lệnh     | `CLICK_REQUEST`                  | player → leader | `{requestId, number, clientTimestamp?}`                    |
|          | `CLICK_REJECT`                   | leader → player | `{requestId, reason}` (chỉ để UI phản hồi)                 |
| Log      | `EVENT_PROPOSE`                  | leader → all    | `{event, commitIndex}`                                     |
|          | `EVENT_ACK`                      | peer → leader   | `{eventId, index}`                                         |
|          | `EVENT_COMMIT`                   | leader → all    | `{event, certificate}`                                     |
|          | `STATE_REQUEST`                  | peer → leader   | `{haveIndex, reason: gap/reconnect/hash/behind}`           |
|          | `STATE_SNAPSHOT`                 | leader → peer   | `{state, stateHash, certificate}`                          |
| Sống/bầu | `HEARTBEAT`                      | all → all, 1 s  | `{leaderId, logIndex, stateHash, links[], paused}`         |
|          | `PRE_VOTE` / `PRE_VOTE_ACK`      | ứng viên ↔ all  | `{term, logIndex}` / `{term, granted}`                     |
|          | `HOST_ELECTION` / `ELECTION_ACK` | ứng viên ↔ all  | `{term, logIndex}` / `{term, granted, snapshot, accepted}` |
| Mesh     | `SIGNAL`                         | relay 1 bước    | `{origin, target, kind: offer/answer, sdp}`                |

Đổi tên so với bản gốc: `RECONNECT_REQUEST` ⇒ `STATE_REQUEST{reason:"reconnect"}` (danh tính đã được xác thực khi tạo link); `HOST_CHANGED/HOST_READY/HOST_READY_ACK` ⇒ entry `HOST_CHANGED`; `GAME_CONFIG/COUNTDOWN_STARTED/GAME_STARTED/GAME_FINISHED/PLAYER_STATUS` ⇒ `LOBBY_STATE` + entry log + suy ra trong reducer.

## 3. CommitCertificate

```ts
{ term, index, eventId: `${term}:${index}`, acknowledgements: PlayerId[] }  // ≥ quorum thành viên khác nhau
```

## 4. Quy tắc term (mọi message của game)

```text
term < currentTerm                        → stale, bỏ (E03, H06, S05)
term > currentTerm, người gửi claim leader → nhận term, leader = sender, step down nếu đang là leader,
                                             freeze (SYNCING) và xin snapshot (E04)
term > currentTerm, không claim            → nhận term, leader = null ⇒ MIGRATING
term = currentTerm, claim leader           → nếu chưa biết leader: học; nếu khác leader đã biết: bỏ
heartbeat từ leader đã biết, cùng term, không claim → leader đã thoái vị (restart) ⇒ MIGRATING
```

"Claim leader" = `EVENT_PROPOSE`, `EVENT_COMMIT`, `STATE_SNAPSHOT`, hoặc `HEARTBEAT` có `leaderId == senderId`. Nhận term cao hơn là an toàn vì leader của một term là duy nhất. `PRE_VOTE*`/`HOST_ELECTION`/`ELECTION_ACK` không đi qua quy tắc trên (xử lý riêng, xem 05).

## 5. Quy tắc index (follower)

```text
PROPOSE  index ≤ logIndex    → nếu trùng nội dung entry đã commit thì ACK lại, không thì bỏ
         index > logIndex+1  → STATE_REQUEST (gap)
         index = logIndex+1  → validateEvent; hợp lệ ⇒ accepted = entry (persist), ACK
COMMIT   index ≤ logIndex    → bỏ (trùng, E01)
         index > logIndex+1  → STATE_REQUEST (gap, E02)
         index = logIndex+1  → kiểm certificate (đủ quorum) + validateEvent ⇒ applyCommitted
```
