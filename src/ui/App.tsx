import { useEffect } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { Answer } from "./Answer"
import { Debug } from "./Debug"
import { Game } from "./Game"
import { Home } from "./Home"
import { useController } from "./hooks"
import { tCode, useT } from "./i18n"
import { Join } from "./Join"
import { LanguageSelect } from "./LanguageSelect"
import { Lobby } from "./Lobby"

export function App({ c, debug }: { c: AppController; debug: boolean }) {
  const t = useT()
  useController(c)
  useEffect(() => {
    // Invite links carry the offer in the URL fragment (never sent to a server).
    const check = () => {
      if (
        /[#&]j=/.test(location.hash) &&
        (c.state.screen.name === "home" || c.state.screen.name === "join")
      ) {
        c.openJoin(location.href)
        history.replaceState(null, "", location.pathname + location.search)
      }
    }
    check()
    addEventListener("hashchange", check)
    return () => removeEventListener("hashchange", check)
  }, [c])
  const s = c.state.screen
  const v = c.node?.getView() ?? null
  return (
    <main>
      <LanguageSelect />
      {c.state.error && (
        <div class="banner error" onClick={() => c.clearError()}>
          {t(`errors.${c.state.error.code}`, c.state.error.params)}{" "}
          <span class="close">×</span>
        </div>
      )}
      {c.state.notice && !c.state.error && s.name === "room" && (
        <div
          class={`banner ${c.state.notice.code === "connecting" ? "" : "ok"}`}
          data-testid="notice"
          onClick={() => c.clearError()}
        >
          {t(`notice.${c.state.notice.code}`, c.state.notice.params)}
        </div>
      )}
      {s.name === "home" && <Home c={c} />}
      {s.name === "join" && (
        <Join
          c={c}
          offerText={s.offerText}
          offer={s.offer}
          offerError={s.offerError}
        />
      )}
      {s.name === "answer" && (
        <Answer
          c={c}
          answerText={s.answerText}
          rejoin={s.rejoin}
          startedAt={s.startedAt}
        />
      )}
      {s.name === "room" && v && v.status === "CLOSED" && (
        <section class="card">
          <p>{tCode("close", v.closedReason ?? "")}</p>
          <button onClick={() => c.leave()}>{t("close.backHome")}</button>
        </section>
      )}
      {s.name === "room" && v && v.status === "LOBBY" && <Lobby c={c} v={v} />}
      {s.name === "room" &&
        v &&
        v.status !== "LOBBY" &&
        v.status !== "CLOSED" && <Game c={c} v={v} />}
      {debug && <Debug c={c} v={v} />}
    </main>
  )
}
