# Tìm Số — Number Hunt

Game "tìm số" nhiều người chơi (2–8) chạy trên trình duyệt điện thoại, **P2P qua WebRTC, không cần máy chủ**. Kết nối bằng QR hai chiều; Host-authoritative với log replicated theo quorum, tự bầu Host mới khi Host rớt.

- Thiết kế (source of truth): [`docs/design/`](docs/design/README.md) — bắt đầu từ [`00-review.md`](docs/design/00-review.md)
- Bản thiết kế gốc: [`docs/design-original/`](docs/design-original/README.md)

## Cách chơi

1. Host bấm **Tạo phòng** → hiện QR mời.
2. Người chơi quét QR bằng camera điện thoại → nhập tên → hiện **mã trả lời**.
3. Host bấm **Quét mã trả lời**. Lặp lại cho từng người.
4. Mọi người **Sẵn sàng** → Host **Bắt đầu**. Ai chạm đúng số cần tìm trước được 1 điểm.

Rớt mạng/reload giữa trận: một người trong phòng mở menu ☰ → **Mời người chơi bị rớt vào lại**.

## Phát triển

```bash
npm install
npm run dev        # http://localhost:5173  (?debug: overlay giao thức, ?nostun: chỉ LAN)
npm test           # engine + simulator mạng + stress
npm run test:e2e   # Playwright, WebRTC thật giữa nhiều browser context
npm run build      # dist/ cho GitHub Pages
```

Deploy: bật GitHub Pages với Source = **GitHub Actions**; workflow `.github/workflows/deploy.yml` test rồi publish khi push lên `main`.

Giới hạn MVP: không TURN (nên chơi chung Wi‑Fi), phòng 2 người dừng khi một người rớt, Host lobby rời trước khi bắt đầu thì phòng đóng. Xem `docs/design/00-review.md` §E.
