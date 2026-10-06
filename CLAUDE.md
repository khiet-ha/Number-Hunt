# CLAUDE.md

## Project Overview

**Tìm Số (Number Hunt)** — game tìm số nhiều người chơi (2–8) chạy trên trình duyệt điện thoại, P2P qua WebRTC, **không có backend**. PWA tĩnh deploy lên GitHub Pages. Kết nối bằng QR hai chiều; Host-authoritative với log replicated theo quorum và tự bầu Host mới khi Host rớt.

Source of truth của thiết kế: `docs/design/` (đọc `00-review.md` → `10-agent-rules.md`). Bản gốc giữ nguyên ở `docs/design-original/`.

## Tech Stack

- **Runtime**: Vite 7, TypeScript 5.9 (strict), Preact (hooks)
- **P2P**: WebRTC DataChannel (reliable, ordered), không signaling server
- **QR**: `qrcode-generator` (hiển thị), `BarcodeDetector` → fallback `jsqr` (quét)
- **Test**: Vitest (engine + network simulator + stress), Playwright (WebRTC thật trên Chromium)
- **Release**: semantic-release (master = stable, develop = beta), GitHub Pages
- **Package Manager**: pnpm (version khoá trong `packageManager`, Node trong `.nvmrc`)

## Architecture (layered)

```
src/
  game/          # Engine thuần, deterministic: types, rng, generator, board, reducer, invariants
  multiplayer/   # GameNode: lobby, log/quorum, heartbeat, pre-vote/vote, reconcile, relay signaling
  webrtc/        # PeerLink (RTCPeerConnection + DataChannel), WebRtcTransport
  qr/            # Envelope offer/answer, nén SDP
  app/           # Controller nối QR ↔ transport ↔ GameNode, session/identity
  ui/            # Preact components, chỉ render NodeView + gửi intent
tests/           # Vitest: game, multiplayer (simulator), stress, qr
e2e/             # Playwright
```

### Architecture Rules (ESLint `no-restricted-imports` enforce)

- `game` không import layer nào khác.
- `multiplayer` chỉ dùng `game` (+ interface `Transport`/`Clock`/`KeyValueStore` trong `multiplayer/env.ts`); không import `webrtc`, `qr`, `app`, `ui`.
- `webrtc` không biết luật chơi: chỉ được `import type` từ `game`/`multiplayer`.
- `qr` không import `multiplayer`, `webrtc`, `app`, `ui`.
- `app` không import `ui`.
- Import khác layer dùng alias `@/`, không dùng `../`.

### Multiplayer invariants (bắt buộc — chi tiết ở `docs/design/10-agent-rules.md`)

- Chỉ `applyCommitted()` trong `GameNode` được gọi `applyEvent()`; UI không bao giờ sửa score/target/winner.
- Không dùng timestamp client để phân xử; thứ tự = thứ tự Host xử lý.
- Không tái dùng log index trong một term; thiếu quorum ⇒ PAUSED, không rollback.
- Persist `votedFor`/`accepted` trước khi gửi ACK.
- `GameState` là hàm thuần của chuỗi nội dung entry đã commit (không chứa term của entry, thời gian, `Math.random()`).
- Đổi wire format ⇒ tăng `PROTOCOL_VERSION` (và `QR_VERSION` nếu đổi QR).

## Path Aliases

- `@/*` → `./src/*` (tsconfig.json + vite.config.ts).

## Code Conventions

- Prettier: không semicolon, nháy kép, trailing comma `es5`, 80 cột (YAML giữ nháy đơn).
- ESLint: `typescript-eslint` recommended + `react-hooks` (cho Preact hooks) + luật ranh giới layer.
- Chỉ named export (trừ file config bắt buộc default export như `vite.config.ts`).
- Component: PascalCase (`InvitePanel.tsx`). Module/hook/util: camelCase (`node.ts`, `hooks.ts`).

## Import Convention

Hai nhóm, cách nhau 1 dòng trống:

1. **External** (node_modules, kể cả `node:*`) — alphabetical, case-insensitive
2. **Internal** (`@/*` và `./`) — alphabetical, case-insensitive, không tách alias/relative

- Side-effect import (`import "./styles.css"`) đặt trên cùng.
- `import type` trộn chung theo nguồn, không tách riêng.
- Format thủ công, không enforce bằng tool.

```ts
import "./ui/styles.css"

import { render } from "preact"
import { useMemo } from "preact/hooks"

import { AppController } from "@/app/controller"
import type { GameState } from "@/game/types"
import { QrCode } from "./QrCode"
```

## UI Text

- Ngôn ngữ hiển thị: tiếng Việt **có dấu đầy đủ**.
- Chuỗi trạng thái/lỗi dùng lại phải nằm trong `src/ui/text.ts` (map theo mã lý do), không rải trong component. (Chưa có i18n; nếu thêm, dùng key sort alphabet và không `defaultValue`.)

## Key Commands

- `pnpm dev` — dev server (`?debug` overlay giao thức, `?nostun` chỉ LAN)
- `pnpm build` — typecheck + build
- `pnpm typecheck` · `pnpm lint` · `pnpm format` · `pnpm format:check`
- `pnpm test` — unit + simulator + stress · `pnpm test:ci` — kèm coverage
- `pnpm test:e2e` — Playwright, WebRTC thật
- `STRESS_SEEDS=100 pnpm exec vitest run tests/stress.test.ts` — stress mở rộng (bắt buộc khi sửa `src/multiplayer`)

## Git Workflow

- `master`: production (stable release + GitHub Pages). `develop`: tích hợp (beta release).
- Mọi việc làm trên nhánh `<prefix>/<scope>-<mô-tả>` tạo từ `origin/develop`; `hotfix/*` tạo từ `origin/master`. Prefix hợp lệ: `feat/ fix/ refactor/ perf/ docs/ test/ chore/ ci/ hotfix/` (workflow `pr-auto` chỉ chạy với các prefix này và tự mở PR).
- Không commit thẳng vào `master`/`develop`. Không tự tạo PR (workflow tự tạo). Release PR `develop → master` mở bằng workflow `Release PR`.
- Conventional commits, mỗi commit đúng một `type` + một `scope` (commitlint + husky enforce). Scope: `game multiplayer webrtc qr app ui config deps ci docs security`.

## Custom Skills

- `/commit` — tách thay đổi thành semantic commits (`.claude/skills/commit/SKILL.md`)
