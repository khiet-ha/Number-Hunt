import { useMemo, useState } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { BOARD_H, BOARD_W, generateBoard } from "@/game/board"
import { currentTarget } from "@/game/reducer"
import type { GameState } from "@/game/types"
import type { NodeView } from "@/multiplayer/node"
import { useTicker } from "./hooks"
import { tCode, useT } from "./i18n"
import { InvitePanel } from "./InvitePanel"
import { ConfigForm } from "./Lobby"

function Board({
  state,
  v,
  onClick,
}: {
  state: GameState
  v: NodeView
  onClick: (n: number) => void
}) {
  const cells = useMemo(
    () =>
      generateBoard(
        state.seed,
        state.layoutVersion,
        state.targets,
        state.config.sizeMode
      ),
    [state.seed, state.layoutVersion, state.targets, state.config.sizeMode]
  )
  const colorOf = useMemo(
    () => Object.fromEntries(state.members.map((m) => [m.id, m.color])),
    [state.members]
  )
  const recentReject =
    v.lastReject && Date.now() - v.lastReject.at < 700 ? v.lastReject : null
  return (
    <div
      class="board"
      style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
      data-testid="board"
    >
      {cells.map((c) => {
        const winner = state.claimed[String(c.number)]
        const pending = v.pendingClick?.number === c.number
        const shake = recentReject?.number === c.number
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
              ...(winner
                ? { borderColor: colorOf[winner], color: colorOf[winner] }
                : {}),
            }}
            onPointerDown={(e) => {
              e.preventDefault()
              if (!winner) onClick(c.number)
            }}
          >
            {c.number}
          </button>
        )
      })}
    </div>
  )
}

function Scores({ state, v }: { state: GameState; v: NodeView }) {
  const alive = new Map(v.peers.map((p) => [p.id, p.alive]))
  return (
    <ul class="scores" data-testid="scores">
      {state.members.map((m) => (
        <li
          key={m.id}
          class={m.id === v.selfId || alive.get(m.id) ? "" : "offline"}
          style={{ borderColor: m.color }}
        >
          <span class="dot" style={{ background: m.color }} />
          {m.name}
          {m.id === v.leaderId && " 👑"}
          <b data-testid={`score-${m.id}`}>{state.scores[m.id] ?? 0}</b>
        </li>
      ))}
    </ul>
  )
}

function Overlay({ v, state }: { v: NodeView; state: GameState | null }) {
  const t = useT()
  const now = Date.now()
  const counts = {
    alive: String(v.aliveCount),
    total: String(v.members.length),
    quorum: String(v.quorum),
  }
  if (v.status === "MIGRATING")
    return (
      <div class="overlay" data-testid="overlay">
        <div class="spinner" />
        <p>{t("game.hostLost")}</p>
        <p class="muted">
          {v.aliveCount >= v.quorum
            ? t("game.electing", counts)
            : t("game.electingNoQuorum", counts)}
        </p>
      </div>
    )
  if (v.status === "PAUSED")
    return (
      <div class="overlay" data-testid="overlay">
        <p>{t("game.paused")}</p>
        <p class="muted">{t("game.pausedDetail", counts)}</p>
      </div>
    )
  if (v.status === "SYNCING")
    return (
      <div class="overlay" data-testid="overlay">
        <div class="spinner" />
        <p>{t("game.syncing")}</p>
      </div>
    )
  if (v.status === "DESYNC")
    return (
      <div class="overlay" data-testid="overlay">
        <p>{t("game.desync")}</p>
        <p class="muted">{t("game.desyncDetail")}</p>
      </div>
    )
  if (state?.phase === "COUNTDOWN") {
    const left = v.countdownEndsAt
      ? Math.ceil((v.countdownEndsAt - now) / 1000)
      : 0
    return (
      <div class="overlay countdown" data-testid="overlay">
        <p class="big">{left > 0 ? left : t("game.countdownGo")}</p>
        {state.leadership.term > 0 && (
          <p class="muted">{t("game.resumeNewHost")}</p>
        )}
      </div>
    )
  }
  return null
}

function Finished({
  c,
  v,
  state,
}: {
  c: AppController
  v: NodeView
  state: GameState
}) {
  const ranking = [...state.members].sort(
    (a, b) =>
      (state.scores[b.id] ?? 0) - (state.scores[a.id] ?? 0) ||
      a.joinSequence - b.joinSequence
  )
  const t = useT()
  const node = c.node!
  return (
    <section class="card finished" data-testid="finished">
      <h2>{t("game.finished")}</h2>
      <ol class="ranking">
        {ranking.map((m, i) => (
          <li key={m.id}>
            <span class="medal">{["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`}</span>
            <span class="dot" style={{ background: m.color }} /> {m.name}{" "}
            <b>{state.scores[m.id] ?? 0}</b>
          </li>
        ))}
      </ol>
      {v.isLeader ? (
        <>
          <details>
            <summary>{t("game.nextRules")}</summary>
            <ConfigForm
              config={v.nextConfig ?? state.config}
              onChange={(cfg) =>
                node.setConfig({
                  ...cfg,
                  playerLimit: state.config.playerLimit,
                })
              }
            />
          </details>
          <button data-testid="rematch" onClick={() => node.rematch()}>
            {t("game.rematch")}
          </button>
        </>
      ) : (
        <p class="muted">{t("game.waitRematch")}</p>
      )}
    </section>
  )
}

export function Game({ c, v }: { c: AppController; v: NodeView }) {
  const t = useT()
  const state = v.state
  const [menu, setMenu] = useState(false)
  useTicker(
    200,
    state?.phase === "COUNTDOWN" || v.status !== "ACTIVE" || !!v.lastReject
  )
  const node = c.node!
  const target = state ? currentTarget(state) : null
  // Members whose connection is down: anyone in the room can invite them back.
  const offline = v.peers
    .filter((p) => !p.alive)
    .map((p) => state?.members.find((m) => m.id === p.id)?.name ?? p.id)
  const reject =
    v.lastReject && Date.now() - v.lastReject.at < 1500 ? v.lastReject : null
  return (
    <div class="game">
      <header class="hud">
        <div class="target" data-testid="target">
          {state?.phase === "PLAYING" || state?.phase === "COUNTDOWN" ? (
            <>
              {t("game.find")} <b>{target}</b>
            </>
          ) : state?.phase === "FINISHED" ? (
            t("game.noTarget")
          ) : (
            "…"
          )}
        </div>
        <span class={`status s-${v.status}`} data-testid="status">
          {t(`status.${v.status}`)}
        </span>
        <button
          class="icon"
          aria-label={t("game.menu")}
          onClick={() => setMenu(!menu)}
        >
          ☰
        </button>
      </header>
      {state && <Scores state={state} v={v} />}
      {offline.length > 0 && state?.phase !== "FINISHED" && (
        <div class="offline-bar" data-testid="offline-bar">
          <span>{t("game.offline", { names: offline.join(", ") })}</span>
          <button
            class="secondary"
            data-testid="invite-back"
            onClick={() => void c.createInvite("rejoin")}
          >
            {t("game.inviteBack")}
          </button>
        </div>
      )}
      {c.state.invite?.kind === "rejoin" && (
        <InvitePanel c={c} title={t("invite.titleRejoin")} />
      )}
      {reject && (
        <div class={`toast ${reject.reason}`}>
          {tCode("reject", reject.reason)}
        </div>
      )}
      {menu && (
        <section class="card menu">
          <p class="muted">
            {t("game.roomInfo", {
              roomId: v.roomId,
              term: String(v.term),
              alive: String(v.aliveCount),
              total: String(v.members.length),
            })}
          </p>
          <button
            class="secondary"
            onClick={() => {
              void c.createInvite("rejoin")
            }}
          >
            {t("game.inviteBack")}
          </button>
          <button
            class="danger"
            onClick={() => confirm(t("game.leaveConfirm")) && c.leave()}
          >
            {t("game.leave")}
          </button>
        </section>
      )}
      <div class="board-wrap">
        {state && state.phase !== "FINISHED" && (
          <Board state={state} v={v} onClick={(n) => node.click(n)} />
        )}
        {state?.phase !== "FINISHED" && <Overlay v={v} state={state} />}
      </div>
      {state?.phase === "FINISHED" && <Finished c={c} v={v} state={state} />}
    </div>
  )
}
