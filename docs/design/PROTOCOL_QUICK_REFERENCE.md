# Protocol quick reference (v2)

```text
Envelope { protocol: 2, type, roomId, senderId (= link), term, messageId, payload }

CLICK
  player  CLICK_REQUEST{requestId, number}
  Host    dedupe → validate → reserve (= entry treo duy nhất) → EVENT_PROPOSE{index = logIndex+1}
  peers   validate → accepted (persist) → EVENT_ACK
  Host    ⌊N/2⌋+1 ACK → applyCommitted → EVENT_COMMIT{event, certificate}
  thiếu quorum → resend, PAUSED (không rollback, không tái dùng index)

MIGRATION
  không nghe leader 5 s (hoặc link failed 1.5 s) → MIGRATING
  peer có joinSequence thấp nhất còn sống → PRE_VOTE{T+1} → quorum
  → term = T, votedFor = self → HOST_ELECTION{T} → quorum ELECTION_ACK{snapshot, accepted}
  → state = snapshot cao nhất; carry accepted term cao nhất ở index kế; + HOST_CHANGED{self, T}
  → commit → COUNTDOWN → PLAY_BEGIN → PLAYING

TERM:  thấp → bỏ · cao + claim leader → nhận, freeze, snapshot · cao không claim → nhận, MIGRATING
INDEX: ≤ logIndex → trùng · > logIndex+1 → STATE_REQUEST · = logIndex+1 → xử lý

ENTRIES: GAME_STARTED · PLAY_BEGIN · NUMBER_FOUND (→ FINISHED khi hết) · HOST_CHANGED{hostId, term} · REMATCH
LOCAL STATUS: LOBBY · SYNCING · ACTIVE · MIGRATING · PAUSED · DESYNC · CLOSED
QR: offer URL #j=Z<deflate> {r,h,n,k,s} · answer "NH2:Z…" {r,h,n,p,m,x,s} · nonce 1 lần, TTL 5 phút (đồng hồ bên mời)
```
