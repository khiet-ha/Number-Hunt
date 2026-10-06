# 00 — Review thiết kế MVP 1 (bản gốc) và các quyết định sửa đổi

Bản gốc nằm ở `docs/design-original/`. Hướng tổng thể đúng: full mesh, Host-authoritative, event log có `(term, seq)`, commit theo quorum, bầu Host deterministic, freeze khi migrate. Nhưng có một số lỗ hổng làm **mất tính đúng đắn** (2 lịch sử, mất điểm đã commit, kẹt game vĩnh viễn) hoặc **không implement được** như mô tả. Bảng dưới liệt kê từng vấn đề, mức độ, và cách bản thiết kế hoàn thiện (`docs/design/01..10`) xử lý.

Mức độ: 🔴 sai tính đúng đắn · 🟠 kẹt/không chạy được · 🟡 mơ hồ/thiếu.

## A. Đồng thuận & migration

| # | Vấn đề trong bản gốc | Mức | Cách sửa |
|---|---|---|---|
| A1 | **Commit chỉ tồn tại ở Host.** Peer ACK proposal nhưng không lưu lại nó; nếu Host commit rồi chết trước khi gửi `EVENT_COMMIT`, không ai có "commit certificate". Quy tắc "chọn version cao nhất có certificate" sẽ **làm mất điểm đã commit** (Host cũ đã hiện +1 cho người chơi). | 🔴 | Peer lưu proposal đã ACK thành `accepted` (persist). Khi bầu, mỗi phiếu `ELECTION_ACK` mang theo *snapshot đã commit* + *entry accepted*. Host mới chọn state commit cao nhất, rồi **re-propose entry accepted có term cao nhất** tại index kế tiếp (quy tắc Paxos). Giao nhau của 2 quorum đảm bảo entry đã commit luôn được giữ (test H07b, H08). |
| A2 | **Ứng viên = "joinSequence thấp nhất trong số peer đang connected"** — "connected" là quan sát cục bộ, mỗi peer thấy khác nhau ⇒ hai ứng viên cùng lúc. Bản gốc không có quy tắc "mỗi peer chỉ bầu một lần mỗi term", nên có thể có **2 Host cùng term**. | 🔴 | Giữ joinSequence làm *ưu tiên* (liveness), còn *an toàn* đến từ: `votedFor` persist, mỗi term một phiếu ⇒ tối đa một leader/term. |
| A3 | "Election term phải đúng bằng `currentTerm + 1`" — nếu một cuộc bầu thất bại, term đã tăng ở một số peer ⇒ cuộc bầu sau không bao giờ hợp lệ. | 🟠 | Chấp nhận `term > currentTerm`. |
| A4 | Peer bị cô lập liên tục tăng term; khi quay lại sẽ hất Host đang khoẻ (disruption). | 🟠 | Thêm **pre-vote**: chỉ tăng term khi đã có quorum đồng ý trước; peer từ chối pre-vote nếu vẫn nghe Host hiện tại ("leader stickiness"). Test H04 (term vẫn = 0), "asymmetric link loss". |
| A5 | `seq` restart từ 1 mỗi term ⇒ kiểm tra `event.seq <= lastAppliedSeq` / gap sai khi qua term mới. | 🔴 | Dùng **log index toàn cục** tăng liên tục qua các term; `term` chỉ để chặn leader cũ. eventId = `term:index`. |
| A6 | ACK timeout 150–300 ms rồi "reject/rollback, release reservation". Nhưng các peer đã ACK vẫn giữ proposal; Host sau đó propose event khác **cùng index** ⇒ hai giá trị khác nhau cùng index trong một term ⇒ migration có thể commit nhầm. Ngoài ra 300 ms quá ngắn với mạng 100–300 ms của chính test matrix. | 🔴 | Không bao giờ tái sử dụng index trong một term. Thiếu quorum ⇒ proposal vẫn treo, game **PAUSED**, resend định kỳ; có quorum lại thì commit. Host cũng từ chối click khi biết số người sống < quorum. (C10 được viết lại.) |
| A7 | `HOST_ELECTION` / `HOST_CHANGED` / `HOST_READY` / `HOST_READY_ACK` là message rời, không nằm trong log ⇒ leadership không có trong state đã hash, không có thứ tự với event khác. | 🟡 | Leadership mới là **entry `HOST_CHANGED` trong log** (no-op entry kiểu Raft), commit bằng quorum. Commit của nó = "HOST_READY". Bớt 3 loại message. |
| A8 | `HOST_CHANGED` nếu lấy term từ envelope của entry thì khi bị carry sang term mới sẽ cho state khác. (Phát hiện bằng stress test.) | 🔴 | `term` nằm trong payload của `HOST_CHANGED`; state không chứa term của entry ⇒ state là hàm thuần của nội dung chuỗi entry. |
| A9 | Host cũ reload/khởi động lại trong cùng term: các peer vẫn thấy nó "online" nên coi leader còn sống ⇒ kẹt. (Phát hiện bằng stress test.) | 🟠 | Liveness của leader tính theo message *có claim leadership* (heartbeat với `leaderId == sender`, propose, commit, snapshot). Heartbeat của leader cùng term mà không claim ⇒ coi như thoái vị, migrate ngay. |
| A10 | `GAME_STARTED`, `COUNTDOWN_STARTED`, `GAME_FINISHED` là message của Host, không qua quorum ⇒ Host chết giữa chừng thì peer không thống nhất trận đã bắt đầu/kết thúc chưa; H10 không định nghĩa được. | 🔴 | `GAME_STARTED`, `PLAY_BEGIN`, `REMATCH` là entry trong log. `FINISHED` được suy ra **trong cùng** entry `NUMBER_FOUND` cuối ⇒ không thể mất giữa hai event. Sau `HOST_CHANGED` luôn đếm ngược lại (công bằng sau freeze, giải H10). |
| A11 | Host chết sau khi propose `GAME_STARTED` nhưng trước commit: peer còn ở lobby, không ai đủ điều kiện bầu. | 🟠 | Peer ACK `GAME_STARTED` là chuyển sang chế độ game (membership đóng băng theo payload). Có thể bầu và carry `GAME_STARTED` như mọi entry khác (test H10b). |

## B. Trạng thái

| # | Vấn đề | Mức | Cách sửa |
|---|---|---|---|
| B1 | `MIGRATING` là một `GamePhase` trong replicated state; `Player.connected` cũng nằm trong state. Đây là quan sát cục bộ — mỗi peer khác nhau ⇒ `stateHash` không bao giờ khớp. | 🔴 | Tách: `GameState.phase ∈ {COUNTDOWN, PLAYING, FINISHED}` (replicated) và `LocalStatus ∈ {LOBBY, SYNCING, ACTIVE, MIGRATING, PAUSED, DESYNC, CLOSED}` (cục bộ, suy ra). |
| B2 | Hai nguồn sự thật: `Player.score` và `scores`; `seed` và `board.seed`; `currentTarget` lưu riêng với `targetIndex`. Vi phạm chính Rule 3. | 🟡 | Một nguồn: `scores`, `seed`, `currentTarget()` là hàm suy ra. |
| B3 | Lobby (trước khi đóng membership) không có mô hình: ai quyết joinSequence, khi nào đủ điều kiện start, Host lobby chết thì sao. | 🟡 | Lobby là Host-authoritative không quorum (`LOBBY_STATE`). Chỉ start khi ≥2 người, tất cả ready, **full mesh hoàn chỉnh**. Host lobby rời ⇒ phòng đóng (giới hạn MVP). |

## C. WebRTC / QR / reconnect

| # | Vấn đề | Mức | Cách sửa |
|---|---|---|---|
| C1 | **Reconnect không có kênh signaling.** Không có server; peer rớt hết kết nối thì không thể tạo lại WebRTC. `RECONNECT_REQUEST` không có đường đi. | 🟠 | (1) Mất một số link: tự nối lại qua **relay signaling** của bất kỳ peer chung (bên joinSequence thấp hơn chủ động). (2) Mất hết / reload: **rejoin QR** — *bất kỳ* thành viên nào (không chỉ Host) tạo mã mời "vào lại". |
| C2 | "Reload = rời phiên" nhưng membership cố định và quorum vẫn tính người đó ⇒ một lần reload có thể làm phòng 2–3 người kẹt vĩnh viễn. | 🟠 | Identity + `currentTerm`, `votedFor`, state đã commit, entry accepted được **persist trong sessionStorage** (cũng là yêu cầu an toàn của Raft: không được quên phiếu bầu). Reload ⇒ vào lại đúng slot. |
| C3 | Không có cơ chế chứng minh danh tính khi vào lại ⇒ ai cũng có thể chiếm slot. | 🟡 | Mỗi người có `secret`; state lưu `SHA-256(secret)`. Rejoin QR phải chứa secret khớp hash. |
| C4 | Expiry dựa trên `timestamp` của thiết bị kia — đồng hồ hai máy lệch nhau. | 🟡 | Mã trả lời phải echo `nonce` của lời mời đang mở; hạn dùng tính theo đồng hồ của bên tạo lời mời. Mỗi lời mời dùng một lần. |
| C5 | Full SDP trong QR quá lớn/khó quét; Host phải có camera scanner trong app; người chơi phải mở app trước rồi mới quét. | 🟡 | Lọc dòng SDP thừa + deflate-raw + base64url (~600 ký tự). Mã mời là **URL** (`#j=…`) nên camera mặc định của điện thoại mở thẳng app; mã trả lời quét bằng scanner trong app (BarcodeDetector → fallback jsQR). Có ô dán tay. |
| C6 | Mỗi `RTCPeerConnection` cần offer riêng — bản gốc không nói Host mời nhiều người thế nào. | 🟡 | Host luôn giữ đúng **một lời mời mở**; dùng xong tự tạo lời mời mới cho tới khi đủ người. |
| C7 | Chỉ có heartbeat của Host; không đủ để tính "ai còn sống" cho ưu tiên ứng viên, cũng không biết topology để relay. | 🟡 | Mọi peer heartbeat 1 s tới mọi peer, kèm `links` (danh sách peer đang nối), `logIndex`, `stateHash`, `paused`. |

## D. Những điểm giữ nguyên

Full mesh; Host xử lý trước = thắng; không dùng timestamp client; `requestId` chống trùng; reservation trước quorum; quorum = ⌊N/2⌋+1 trên membership cố định; deterministic board theo `(seed, layoutVersion)`; ưu tiên nhất quán hơn sẵn sàng (PAUSE thay vì hai lịch sử); tách transport/engine.

## E. Giới hạn đã biết của MVP (chấp nhận)

- Phòng 2 người: quorum = 2 ⇒ một người rớt là trận dừng (đúng thiết kế: không thể phân biệt "bạn chết" với "mình bị cắt mạng").
- Host lobby rời trước khi start ⇒ phòng đóng.
- Không TURN: một số NAT/mạng di động sẽ không nối P2P được. Tốt nhất chơi chung Wi‑Fi.
- iOS/Android tạm dừng JS khi tắt màn hình/chuyển app ⇒ người đó bị coi là rớt (Host thì sẽ migrate).
- Không chống gian lận: Host độc hại có thể làm giả certificate. Tin tưởng giữa các thành viên trong phòng (non-goal của MVP).
- Người chơi rời giữa trận vẫn được tính trong quorum (membership cố định).
