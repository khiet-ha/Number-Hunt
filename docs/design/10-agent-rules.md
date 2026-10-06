# 10 — Quy tắc cho coding agent

Hợp đồng implement. Giữ nguyên tinh thần bản gốc, cập nhật theo protocol v2.

1. **Không đưa quyền vào UI.** UI chỉ gửi intent và render `NodeView`.
2. **Không dùng timestamp client** để phân xử. Thứ tự = thứ tự Host xử lý.
3. **Một nguồn sự thật:** `GameState` + log đã commit. Không biến score/target song song.
4. **Mọi thay đổi truy được:** chỉ `applyCommitted(entry, certificate)` sửa state; log `APPLY_<type>` kèm term/index.
5. **Không tự sửa state:** gap / term mới / hash sai ⇒ snapshot từ leader. Không tự bịa.
6. **Không tự phong Host:** pre-vote quorum → vote quorum, một phiếu mỗi term (persist), ưu tiên joinSequence thấp nhất còn sống.
7. **Freeze khi MIGRATING**, PAUSED khi thiếu quorum.
8. **Membership cố định** từ `GAME_STARTED` (kể cả khi mới accepted).
9. **Transport tách khỏi game:** `src/webrtc` không import `src/game`/`src/multiplayer`; `src/game` không import gì bên ngoài.
10. **State machine tường minh:** `LocalStatus` suy ra từ `kind`/`leaderId`/`election`/`syncing`/`desync`; không thêm cờ boolean rời rạc.
11. **Mọi thay đổi wire format** ⇒ tăng `PROTOCOL_VERSION` (và `QR_VERSION` nếu đổi QR).
12. **Quan sát được:** mọi message/entry log qua `EventLogger`; không log SDP/secret.
13. **Deterministic:** cùng chuỗi nội dung entry ⇒ cùng state. Không đưa term của entry, thời gian, `Math.random()` vào state.
14. **Không thay quorum bằng "message cuối thắng".**
15. **Phân vân thì chọn nhất quán:** PAUSE tốt hơn hai lịch sử.
16. **Không tái dùng index:** trong một term, một index chỉ có một giá trị; không "rollback rồi propose khác".
17. **Persist trước khi trả lời:** `votedFor`, `accepted` phải ghi trước khi gửi `ELECTION_ACK`/`EVENT_ACK`.
18. **Entry phải tự đủ:** nội dung entry không được phụ thuộc vào term nó được propose (xem `HOST_CHANGED.payload.term`).

## Quy trình khi sửa multiplayer

Đọc 01–05 → viết/đổi test trong simulator trước (`tests/multiplayer.test.ts`) → chạy `pnpm test` và `STRESS_SEEDS=100 pnpm exec vitest run tests/stress.test.ts` (SafetyMonitor phải sạch) → `pnpm test:e2e` nếu đụng WebRTC/QR/UI → cập nhật `09-test-matrix.md`.
