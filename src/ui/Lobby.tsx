import type { AppController } from "@/app/controller"
import type { GameConfig } from "@/game/types"
import { LIMITS } from "@/game/types"
import type { NodeView } from "@/multiplayer/node"
import { tCode, useT } from "./i18n"
import { InvitePanel } from "./InvitePanel"

export function ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: GameConfig
  onChange: (c: GameConfig) => void
  disabled?: boolean
}) {
  const t = useT()
  const set = (patch: Partial<GameConfig>) => onChange({ ...config, ...patch })
  const num = (v: string, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(Number(v) || min)))
  return (
    <fieldset class="config" disabled={disabled}>
      <label>
        {t("config.numberCount")}
        <input
          type="number"
          min={LIMITS.minNumbers}
          max={LIMITS.maxNumbers}
          value={config.numberCount}
          onChange={(e) =>
            set({
              numberCount: num(
                (e.target as HTMLInputElement).value,
                LIMITS.minNumbers,
                LIMITS.maxNumbers
              ),
            })
          }
        />
      </label>
      <label>
        {t("config.playerLimit")}
        <input
          type="number"
          min={2}
          max={8}
          value={config.playerLimit}
          onChange={(e) =>
            set({
              playerLimit: num((e.target as HTMLInputElement).value, 2, 8),
            })
          }
        />
      </label>
      <label>
        {t("config.mode")}
        <select
          value={config.mode}
          onChange={(e) =>
            set({
              mode: (e.target as HTMLSelectElement).value as GameConfig["mode"],
            })
          }
        >
          <option value="TRADITIONAL">{t("config.modeTraditional")}</option>
          <option value="RANDOM">{t("config.modeRandom")}</option>
        </select>
      </label>
      <label>
        {t("config.numberMode")}
        <select
          value={config.numberMode}
          onChange={(e) =>
            set({
              numberMode: (e.target as HTMLSelectElement)
                .value as GameConfig["numberMode"],
            })
          }
        >
          <option value="SEQUENTIAL">{t("config.sequential")}</option>
          <option value="FIXED_STEP">{t("config.fixedStep")}</option>
          <option value="RANDOM_STEP">{t("config.randomStep")}</option>
        </select>
      </label>
      {config.numberMode === "FIXED_STEP" && (
        <label>
          {t("config.step")}
          <input
            type="number"
            min={1}
            max={LIMITS.maxStep}
            value={config.step}
            onChange={(e) =>
              set({
                step: num(
                  (e.target as HTMLInputElement).value,
                  1,
                  LIMITS.maxStep
                ),
              })
            }
          />
        </label>
      )}
      {config.numberMode === "RANDOM_STEP" && (
        <label>
          {t("config.randomSteps")}
          <input
            value={config.randomSteps.join(", ")}
            onChange={(e) => {
              const steps = (e.target as HTMLInputElement).value
                .split(/[,\s]+/)
                .map((x) => Math.round(Number(x)))
                .filter((x) => x >= 1 && x <= LIMITS.maxStep)
                .slice(0, 20)
              if (steps.length) set({ randomSteps: steps })
            }}
          />
        </label>
      )}
      <label>
        {t("config.sizeMode")}
        <select
          value={config.sizeMode}
          onChange={(e) =>
            set({
              sizeMode: (e.target as HTMLSelectElement)
                .value as GameConfig["sizeMode"],
            })
          }
        >
          <option value="SMALL">{t("config.sizeSmall")}</option>
          <option value="LARGE">{t("config.sizeLarge")}</option>
          <option value="RANDOM">{t("config.sizeRandom")}</option>
        </select>
      </label>
    </fieldset>
  )
}

export function Lobby({ c, v }: { c: AppController; v: NodeView }) {
  const t = useT()
  const lobby = v.lobby
  const node = c.node!
  if (!lobby)
    return (
      <section class="card">
        <p>{t("lobby.entering")}</p>
      </section>
    )
  const isHost = lobby.hostId === v.selfId
  const me = lobby.players.find((p) => p.id === v.selfId)
  const peer = (id: string) => v.peers.find((p) => p.id === id)
  return (
    <div class="lobby">
      <section class="card">
        <h2>
          {t("lobby.room")}{" "}
          <span class="room-id" data-testid="room-id">
            {v.roomId}
          </span>
        </h2>
        <ul class="players" data-testid="players">
          {lobby.players.map((p) => {
            const pv = peer(p.id)
            const linked = p.id === v.selfId || pv?.link === "connected"
            return (
              <li key={p.id}>
                <span class="dot" style={{ background: p.color }} />
                <span class="name">
                  {p.name}
                  {p.id === v.selfId && ` ${t("lobby.you")}`}
                  {p.id === lobby.hostId && " 👑"}
                </span>
                <span class={`tag ${linked ? "ok" : "warn"}`}>
                  {linked ? t("lobby.linked") : t("lobby.linking")}
                </span>
                <span class={`tag ${p.ready ? "ok" : ""}`}>
                  {p.ready ? t("lobby.ready") : t("lobby.notReady")}
                </span>
                {isHost && p.id !== v.selfId && (
                  <button
                    class="kick"
                    data-testid={`kick-${p.id}`}
                    aria-label={`${t("lobby.kick")} ${p.name}`}
                    title={t("lobby.kick")}
                    onClick={() =>
                      confirm(t("lobby.kickConfirm", { name: p.name })) &&
                      node.kickGuest(p.id)
                    }
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {isHost && lobby.players.length === 1 && (
          <p class="muted">{t("lobby.waitingFirst")}</p>
        )}
        {!isHost && me && (
          <button
            data-testid="ready"
            class={me.ready ? "secondary" : ""}
            onClick={() => node.setReady(!me.ready)}
          >
            {me.ready ? t("lobby.unsetReady") : t("lobby.setReady")}
          </button>
        )}
        {isHost && (
          <>
            <button
              data-testid="start"
              disabled={v.startBlockers.length > 0}
              onClick={() => node.startGame()}
            >
              {t("lobby.start")}
            </button>
            {v.startBlockers.length > 0 && (
              <p class="muted">
                {v.startBlockers.map((b) => tCode("blocker", b)).join(" · ")}
              </p>
            )}
          </>
        )}
      </section>
      {isHost && node.canAcceptGuests() && (
        <InvitePanel c={c} title={t("invite.titleJoin")} />
      )}
      <section class="card">
        <h3>{t("lobby.rules")}</h3>
        <ConfigForm
          config={lobby.config}
          disabled={!isHost}
          onChange={(cfg) => node.setConfig(cfg)}
        />
      </section>
    </div>
  )
}
