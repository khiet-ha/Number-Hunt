# 08 — Implementation (trạng thái: đã implement)

Stack: TypeScript strict, Vite, Preact, Vitest, Playwright. Phụ thuộc runtime: `preact`, `qrcode-generator`, `jsqr`.

## Bản đồ module

```text
src/game/          (Phase 1 — engine, không import gì ngoài chính nó)
  types.ts         GameState, GameConfig, Member, GameEvent, hằng số
  rng.ts           mulberry32, mixSeed, shuffle, cyrb53
  generator.ts     generateTargets
  board.ts         generateBoard (toạ độ nguyên, bàn 3000×4000)
  reducer.ts       validateEvent, applyEvent, canonicalJson, stateHash, quorumSize
  invariants.ts    checkInvariants (test/debug)

src/multiplayer/   (Phase 5–8 — lõi, không import WebRTC)
  env.ts           Transport / Clock / KeyValueStore / EventLogger / LruSet
  protocol.ts      envelope v2, payload types, decode() có validate
  node.ts          GameNode: lobby, click, propose/ACK/commit, snapshot, heartbeat,
                   pre-vote/vote/reconcile, persist, mesh maintainer + relay SIGNAL

src/webrtc/        (Phase 2, 4)
  peer.ts          PeerLink: RTCPeerConnection + DataChannel negotiated, non-trickle ICE
  transport.ts     WebRtcTransport: Map<PlayerId, PeerLink>, dial/acceptDial/completeDial

src/qr/            (Phase 3)
  codec.ts         minifySdp, pack/unpack (deflate-raw + base64url)
  envelope.ts      offer/answer envelope, checkAnswer (room/host/nonce/expiry)

src/app/           identity.ts (session, secret, sha256), controller.ts (luồng mời/tham gia/vào lại)
src/ui/            App, Lobby, Game (board/scores/overlay/finish/menu), InvitePanel, QrCode, Scanner, Debug
public/            manifest, service worker, icon
```

Gộp so với gợi ý gốc: `host.ts/client.ts/event-log.ts/quorum.ts/election.ts/heartbeat.ts/snapshot.ts/reconnect.ts` nằm chung trong `node.ts` vì chúng chia sẻ một state machine (tách ra sẽ thành "boolean soup" xuyên file — Rule 10). Mỗi phần là một section có tiêu đề trong file.

## Quan sát / debug (Phase 10)

- `EventLogger` ring buffer: `{t, dir, type, term, index, messageId, peer, note}`; không log SDP.
- `?debug` hiện overlay: status, term, leader, logIndex, quorum, link từng peer, 14 sự kiện gần nhất.
- `window.__nh` = controller (để kiểm tra trong DevTools/e2e).
- Network simulator (`tests/sim.ts`): latency, drop, duplicate, reorder, blackhole, partition, kill/revive với storage bền.

## Chạy

```bash
pnpm install
pnpm dev             # http://localhost:5173 (thêm ?debug, ?nostun)
pnpm test            # unit + simulator + stress (Vitest)
pnpm test:e2e        # Playwright: WebRTC thật giữa nhiều context
pnpm lint            # gồm luật ranh giới layer (no-restricted-imports)
pnpm build           # dist/ cho GitHub Pages
STRESS_SEEDS=300 pnpm exec vitest run tests/stress.test.ts   # stress mở rộng
```

CI/CD: `.github/workflows/ci.yml` (commitlint, typecheck/lint/format, test + coverage, e2e, build, audit) chạy trên PR; `release.yml` dùng semantic-release (master = stable + deploy GitHub Pages, develop = beta).

## Definition of done

Mọi dòng trong `09-test-matrix.md` có test tự động và đang xanh.
