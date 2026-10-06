# 05 — Host migration

## 1. Mục tiêu

Host biến mất ⇒ freeze → phát hiện → bầu (pre-vote, vote) → reconcile → entry `HOST_CHANGED` → đếm ngược → chơi tiếp. Không đổi Host tức thì; không bao giờ có hai lịch sử.

## 2. Phát hiện

| Hằng số (`DEFAULT_TIMINGS`) | Giá trị |
|---|---|
| heartbeat (mọi peer → mọi peer) | 1 s |
| peer coi là chết (để tính "sống" / ưu tiên) | 4 s không nghe gì |
| leader coi là chết | 5 s không có message *claim leader*, **hoặc** link `failed/closed` quá 1.5 s |
| pre-vote timeout / election timeout | 1 s / 3 s |

`disconnected` của WebRTC chỉ là tạm thời ⇒ không migrate ngay (W07). `failed/closed` là bằng chứng mạnh ⇒ đường nhanh 1.5 s (W08).

## 3. Freeze

Không có leader sống ⇒ `LocalStatus = MIGRATING`: bỏ click cục bộ (C07), Host cũ (nếu còn) cũng không commit được vì thiếu quorum, không áp dụng gì suy đoán.

## 4. Ứng viên (liveness) và an toàn (safety)

- **Ưu tiên deterministic**: một peer chỉ tự ứng cử khi *trong góc nhìn của nó* không có thành viên còn sống nào có joinSequence thấp hơn.
- **An toàn** không dựa vào việc mọi người thấy giống nhau: mỗi peer bầu tối đa **một lần mỗi term** (`votedFor`, persist) ⇒ mỗi term tối đa một leader. Ưu tiên sai lệch chỉ làm chậm, không làm sai.

## 5. Pre-vote

```text
ứng viên: PRE_VOTE{term: currentTerm+1}  (KHÔNG đổi state của chính nó)
peer đồng ý nếu: term > currentTerm, ứng viên là member,
                 peer không còn nghe leader hiện tại (leader stickiness),
                 không có thành viên sống nào joinSequence thấp hơn ứng viên
đủ quorum ⇒ sang vote; không đủ trong 1 s ⇒ thử lại (jitter ≤ 500 ms)
```

Ngăn peer bị cô lập thổi phồng term rồi hất Host đang khoẻ (H04: term vẫn 0; "asymmetric link loss").

## 6. Vote + reconcile

```text
ứng viên: currentTerm = T, votedFor = self (persist), HOST_ELECTION{T}
peer cấp phiếu nếu: T ≥ currentTerm, member, ưu tiên ok, và (T > currentTerm hoặc votedFor ∈ {null, ứng viên})
  cấp ⇒ currentTerm = T, votedFor = ứng viên (persist)
  ELECTION_ACK{T, granted, snapshot(đã commit), accepted}
ứng viên có quorum phiếu (tính chính mình):
  best    = snapshot có logIndex cao nhất (hash phải khớp)
  carried = trong các accepted có index = best.logIndex+1, chọn term cao nhất
  state   = best
  queue   = [carried (re-propose với term T, cùng nội dung)] + [HOST_CHANGED{hostId: self, term: T}]
```

**Vì sao đúng.** Một entry ở index i đã commit ⇒ một quorum Q1 đã lưu nó (accepted) khi logIndex của họ = i−1, và Host chỉ propose i+1 sau khi commit i. Quorum phiếu Q2 giao Q1 ⇒ ứng viên thấy hoặc state đã commit ≥ i, hoặc entry i dạng accepted (term cao nhất trong Q2 chính là giá trị đã commit, theo quy nạp như Paxos). Không có entry nào ở i+2 có thể đã commit mà ứng viên không thấy i+1. Vì state không chứa term của entry, re-propose dưới term mới cho đúng state cũ.

## 7. Hoàn tất

`HOST_CHANGED` commit = Host mới chính thức (thay cho `HOST_READY`). Phase ⇒ COUNTDOWN (H10: chết lúc đang đếm ngược ⇒ đếm lại), rồi leader commit `PLAY_BEGIN`. Peer không bỏ phiếu biết leader mới qua heartbeat/propose term cao hơn, xin snapshot, rồi ACK.

## 8. Không có quorum

Không ai qua được pre-vote ⇒ mọi người MIGRATING vô thời hạn, UI hiện "cần k/N người online". Phần thiểu số khi chia mạng không tiến được; phần đa số bầu Host mới và chơi tiếp; khi nối lại, thiểu số nhận term cao hơn và snapshot (H09).

## 9. Host cũ quay lại

Có term cũ ⇒ message của nó bị bỏ (H06). Nó nhận term mới từ heartbeat, thành peer thường, xin snapshot (H05, R05). Không tự giành lại quyền. Nếu Host khởi động lại *trong cùng term* (reload), heartbeat của nó không claim leader ⇒ các peer migrate ngay.

## 10. Host chủ động rời

Gửi `LEAVE` ⇒ các peer coi là chết ngay (không chờ 5 s) ⇒ quy trình như trên.
