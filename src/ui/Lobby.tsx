import type { AppController } from "@/app/controller"
import type { GameConfig } from "@/game/types"
import { LIMITS } from "@/game/types"
import type { NodeView } from "@/multiplayer/node"
import { InvitePanel } from "./InvitePanel"
import { BLOCKER_TEXT } from "./text"

export function ConfigForm({
  config,
  onChange,
  disabled,
}: {
  config: GameConfig
  onChange: (c: GameConfig) => void
  disabled?: boolean
}) {
  const set = (patch: Partial<GameConfig>) => onChange({ ...config, ...patch })
  const num = (v: string, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.round(Number(v) || min)))
  return (
    <fieldset class="config" disabled={disabled}>
      <label>
        Số lượng số
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
        Số người tối đa
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
        Chế độ
        <select
          value={config.mode}
          onChange={(e) =>
            set({
              mode: (e.target as HTMLSelectElement).value as GameConfig["mode"],
            })
          }
        >
          <option value="TRADITIONAL">Truyền thống (bàn cố định)</option>
          <option value="RANDOM">Ngẫu nhiên (xáo bàn sau mỗi số)</option>
        </select>
      </label>
      <label>
        Dãy số
        <select
          value={config.numberMode}
          onChange={(e) =>
            set({
              numberMode: (e.target as HTMLSelectElement)
                .value as GameConfig["numberMode"],
            })
          }
        >
          <option value="SEQUENTIAL">Liên tiếp 1, 2, 3…</option>
          <option value="FIXED_STEP">Bước cố định</option>
          <option value="RANDOM_STEP">Bước ngẫu nhiên</option>
        </select>
      </label>
      {config.numberMode === "FIXED_STEP" && (
        <label>
          Bước
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
          Các bước có thể (phân cách bằng dấu phẩy)
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
        Cỡ chữ
        <select
          value={config.sizeMode}
          onChange={(e) =>
            set({
              sizeMode: (e.target as HTMLSelectElement)
                .value as GameConfig["sizeMode"],
            })
          }
        >
          <option value="SMALL">Nhỏ</option>
          <option value="LARGE">Lớn</option>
          <option value="RANDOM">Ngẫu nhiên</option>
        </select>
      </label>
    </fieldset>
  )
}

export function Lobby({ c, v }: { c: AppController; v: NodeView }) {
  const lobby = v.lobby
  const node = c.node!
  if (!lobby)
    return (
      <section class="card">
        <p>Đang vào phòng…</p>
      </section>
    )
  const isHost = lobby.hostId === v.selfId
  const me = lobby.players.find((p) => p.id === v.selfId)
  const peer = (id: string) => v.peers.find((p) => p.id === id)
  return (
    <div class="lobby">
      <section class="card">
        <h2>
          Phòng{" "}
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
                  {p.id === v.selfId && " (bạn)"}
                  {p.id === lobby.hostId && " 👑"}
                </span>
                <span class={`tag ${linked ? "ok" : "warn"}`}>
                  {linked ? "kết nối" : "đang nối…"}
                </span>
                <span class={`tag ${p.ready ? "ok" : ""}`}>
                  {p.ready ? "Sẵn sàng" : "Chưa sẵn sàng"}
                </span>
              </li>
            )
          })}
        </ul>
        {!isHost && me && (
          <button
            data-testid="ready"
            class={me.ready ? "secondary" : ""}
            onClick={() => node.setReady(!me.ready)}
          >
            {me.ready ? "Huỷ sẵn sàng" : "Sẵn sàng"}
          </button>
        )}
        {isHost && (
          <>
            <button
              data-testid="start"
              disabled={v.startBlockers.length > 0}
              onClick={() => node.startGame()}
            >
              Bắt đầu
            </button>
            {v.startBlockers.length > 0 && (
              <p class="muted">
                {v.startBlockers.map((b) => BLOCKER_TEXT[b] ?? b).join(" · ")}
              </p>
            )}
          </>
        )}
      </section>
      {isHost && node.canAcceptGuests() && (
        <InvitePanel c={c} title="Mời người chơi" />
      )}
      <section class="card">
        <h3>Luật chơi</h3>
        <ConfigForm
          config={lobby.config}
          disabled={!isHost}
          onChange={(cfg) => node.setConfig(cfg)}
        />
      </section>
    </div>
  )
}
