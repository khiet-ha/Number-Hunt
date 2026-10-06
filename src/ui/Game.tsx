import { useMemo, useState } from "preact/hooks";
import type { AppController } from "@/app/controller";
import { BOARD_H, BOARD_W, generateBoard } from "@/game/board";
import { currentTarget } from "@/game/reducer";
import type { GameState } from "@/game/types";
import type { NodeView } from "@/multiplayer/node";
import { InvitePanel } from "./InvitePanel";
import { ConfigForm } from "./Lobby";
import { useTicker } from "./hooks";
import { REJECT_TEXT, STATUS_TEXT } from "./text";

function Board({ state, v, onClick }: { state: GameState; v: NodeView; onClick: (n: number) => void }) {
  const cells = useMemo(
    () => generateBoard(state.seed, state.layoutVersion, state.targets, state.config.sizeMode),
    [state.seed, state.layoutVersion, state.targets, state.config.sizeMode],
  );
  const colorOf = useMemo(() => Object.fromEntries(state.members.map((m) => [m.id, m.color])), [state.members]);
  const recentReject = v.lastReject && Date.now() - v.lastReject.at < 700 ? v.lastReject : null;
  return (
    <div class="board" style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }} data-testid="board">
      {cells.map((c) => {
        const winner = state.claimed[String(c.number)];
        const pending = v.pendingClick?.number === c.number;
        const shake = recentReject?.number === c.number;
        return (
          <button
            key={c.number}
            class={`num${winner ? " claimed" : ""}${pending ? " pending" : ""}${shake ? " shake" : ""}`}
            data-n={c.number}
            style={{
              left: `${(c.x / BOARD_W) * 100}%`,
              top: `${(c.y / BOARD_H) * 100}%`,
              fontSize: `${(c.size / BOARD_W) * 100}cqw`,
              transform: `translate(-50%, -50%) rotate(${c.rotate}deg)`,
              ...(winner ? { borderColor: colorOf[winner], color: colorOf[winner] } : {}),
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              if (!winner) onClick(c.number);
            }}
          >
            {c.number}
          </button>
        );
      })}
    </div>
  );
}

function Scores({ state, v }: { state: GameState; v: NodeView }) {
  const alive = new Map(v.peers.map((p) => [p.id, p.alive]));
  return (
    <ul class="scores" data-testid="scores">
      {state.members.map((m) => (
        <li key={m.id} class={m.id === v.selfId || alive.get(m.id) ? "" : "offline"} style={{ borderColor: m.color }}>
          <span class="dot" style={{ background: m.color }} />
          {m.name}
          {m.id === v.leaderId && " 👑"}
          <b data-testid={`score-${m.id}`}>{state.scores[m.id] ?? 0}</b>
        </li>
      ))}
    </ul>
  );
}

function Overlay({ v, state }: { v: NodeView; state: GameState | null }) {
  const now = Date.now();
  if (v.status === "MIGRATING")
    return (
      <div class="overlay" data-testid="overlay">
        <div class="spinner" />
        <p>Host mất kết nối</p>
        <p class="muted">
          {v.aliveCount >= v.quorum
            ? `Đang bầu Host mới (${v.aliveCount}/${v.members.length} người online)`
            : `Chưa đủ người để bầu Host mới: ${v.aliveCount}/${v.members.length} online, cần ${v.quorum}. Trận tạm dừng cho tới khi có người quay lại.`}
        </p>
      </div>
    );
  if (v.status === "PAUSED")
    return (
      <div class="overlay" data-testid="overlay">
        <p>Tạm dừng</p>
        <p class="muted">
          Cần ít nhất {v.quorum}/{v.members.length} người online để tiếp tục ({v.aliveCount} đang online)
        </p>
      </div>
    );
  if (v.status === "SYNCING")
    return (
      <div class="overlay" data-testid="overlay">
        <div class="spinner" />
        <p>Đang đồng bộ trận đấu…</p>
      </div>
    );
  if (v.status === "DESYNC")
    return (
      <div class="overlay" data-testid="overlay">
        <p>Lỗi đồng bộ dữ liệu</p>
        <p class="muted">Đang yêu cầu lại dữ liệu từ Host…</p>
      </div>
    );
  if (state?.phase === "COUNTDOWN") {
    const left = v.countdownEndsAt ? Math.ceil((v.countdownEndsAt - now) / 1000) : 0;
    return (
      <div class="overlay countdown" data-testid="overlay">
        <p class="big">{left > 0 ? left : "Bắt đầu!"}</p>
        {state.leadership.term > 0 && <p class="muted">Tiếp tục với Host mới</p>}
      </div>
    );
  }
  return null;
}

function Finished({ c, v, state }: { c: AppController; v: NodeView; state: GameState }) {
  const ranking = [...state.members].sort((a, b) => (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0) || a.joinSequence - b.joinSequence);
  const node = c.node!;
  return (
    <section class="card finished" data-testid="finished">
      <h2>Kết thúc!</h2>
      <ol class="ranking">
        {ranking.map((m, i) => (
          <li key={m.id}>
            <span class="medal">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
            <span class="dot" style={{ background: m.color }} /> {m.name} <b>{state.scores[m.id] ?? 0}</b>
          </li>
        ))}
      </ol>
      {v.isLeader ? (
        <>
          <details>
            <summary>Đổi luật cho ván sau</summary>
            <ConfigForm config={v.nextConfig ?? state.config} onChange={(cfg) => node.setConfig({ ...cfg, playerLimit: state.config.playerLimit })} />
          </details>
          <button data-testid="rematch" onClick={() => node.rematch()}>
            Chơi ván mới
          </button>
        </>
      ) : (
        <p class="muted">Chờ Host bắt đầu ván mới…</p>
      )}
    </section>
  );
}

export function Game({ c, v }: { c: AppController; v: NodeView }) {
  const state = v.state;
  const [menu, setMenu] = useState(false);
  useTicker(200, state?.phase === "COUNTDOWN" || v.status !== "ACTIVE" || !!v.lastReject);
  const node = c.node!;
  const target = state ? currentTarget(state) : null;
  const reject = v.lastReject && Date.now() - v.lastReject.at < 1500 ? v.lastReject : null;
  return (
    <div class="game">
      <header class="hud">
        <div class="target" data-testid="target">
          {state?.phase === "PLAYING" || state?.phase === "COUNTDOWN" ? (
            <>
              Tìm <b>{target}</b>
            </>
          ) : state?.phase === "FINISHED" ? (
            "Hết số!"
          ) : (
            "…"
          )}
        </div>
        <span class={`status s-${v.status}`} data-testid="status">
          {STATUS_TEXT[v.status]}
        </span>
        <button class="icon" aria-label="Menu" onClick={() => setMenu(!menu)}>
          ☰
        </button>
      </header>
      {state && <Scores state={state} v={v} />}
      {reject && <div class={`toast ${reject.reason}`}>{REJECT_TEXT[reject.reason] ?? reject.reason}</div>}
      {menu && (
        <section class="card menu">
          <p class="muted">
            Phòng {v.roomId} · term {v.term} · {v.aliveCount}/{v.members.length} online
          </p>
          <button
            class="secondary"
            onClick={() => {
              void c.createInvite("rejoin");
            }}
          >
            Mời người chơi bị rớt vào lại
          </button>
          {c.state.invite?.kind === "rejoin" && <InvitePanel c={c} title="Mời vào lại" />}
          <button class="danger" onClick={() => confirm("Rời trận? Bạn vẫn được tính trong số người chơi.") && c.leave()}>
            Rời phòng
          </button>
        </section>
      )}
      <div class="board-wrap">
        {state && state.phase !== "FINISHED" && <Board state={state} v={v} onClick={(n) => node.click(n)} />}
        {state?.phase !== "FINISHED" && <Overlay v={v} state={state} />}
      </div>
      {state?.phase === "FINISHED" && <Finished c={c} v={v} state={state} />}
    </div>
  );
}
