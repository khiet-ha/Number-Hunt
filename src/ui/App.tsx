import { useEffect, useState } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { loadName } from "@/app/identity"
import { Debug } from "./Debug"
import { Game } from "./Game"
import { useController } from "./hooks"
import { tCode, useT } from "./i18n"
import { LanguageSelect } from "./LanguageSelect"
import { Lobby } from "./Lobby"
import { QrCode } from "./QrCode"
import { Scanner } from "./Scanner"

function Home({ c }: { c: AppController }) {
  const t = useT()
  const [name, setName] = useState(loadName())
  const [scan, setScan] = useState(false)
  const [paste, setPaste] = useState("")
  const resume = c.resumable()
  const valid = name.trim().length > 0
  return (
    <div class="home">
      <h1>{t("app.title")}</h1>
      <p class="muted">{t("app.tagline")}</p>
      <label>
        {t("common.yourName")}
        <input
          data-testid="name"
          maxLength={16}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder={t("home.namePlaceholder")}
        />
      </label>
      <button
        data-testid="create"
        disabled={!valid || c.state.busy}
        onClick={() => void c.createRoom(name)}
      >
        {t("home.create")}
      </button>
      <button class="secondary" disabled={!valid} onClick={() => setScan(true)}>
        {t("home.scanInvite")}
      </button>
      {scan && (
        <Scanner
          onResult={(t) => {
            setScan(false)
            void c.acceptOffer(t, name)
          }}
          onClose={() => setScan(false)}
        />
      )}
      <details>
        <summary>{t("home.pasteInvite")}</summary>
        <textarea
          data-testid="offer-input"
          rows={3}
          value={paste}
          onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
        />
        <button
          data-testid="offer-submit"
          disabled={!valid || !paste.trim()}
          onClick={() => void c.acceptOffer(paste, name)}
        >
          {t("common.join")}
        </button>
      </details>
      {resume && (
        <section class="card">
          <p>{t("home.resume", { roomId: resume.roomId })}</p>
          <button class="secondary" onClick={() => setScan(true)}>
            {t("home.scanRejoin")}
          </button>
          <button class="link" onClick={() => c.forgetSession()}>
            {t("home.forgetGame")}
          </button>
        </section>
      )}
    </div>
  )
}

function Join({ c, offerText }: { c: AppController; offerText: string }) {
  const t = useT()
  const [name, setName] = useState(loadName())
  return (
    <div class="home">
      <h1>{t("join.title")}</h1>
      <label>
        {t("common.yourName")}
        <input
          data-testid="name"
          maxLength={16}
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <button
        data-testid="join"
        disabled={!name.trim() || c.state.busy}
        onClick={() => void c.acceptOffer(offerText, name)}
      >
        {c.state.busy ? t("join.preparing") : t("common.join")}
      </button>
      <button class="link" onClick={() => c.backHome()}>
        {t("common.cancel")}
      </button>
    </div>
  )
}

function Answer({
  c,
  answerText,
  rejoin,
}: {
  c: AppController
  answerText: string
  rejoin: boolean
}) {
  const t = useT()
  return (
    <div class="home">
      <h2>{rejoin ? t("answer.titleRejoin") : t("answer.title")}</h2>
      <p>{rejoin ? t("answer.showToInviter") : t("answer.showToHost")}</p>
      <QrCode text={answerText} label={t("answer.qrLabel")} />
      <button
        class="secondary"
        onClick={() => void navigator.clipboard?.writeText(answerText)}
      >
        {t("answer.copy")}
      </button>
      <textarea
        readOnly
        data-testid="answer-text"
        rows={2}
        value={answerText}
      />
      <p class="muted">
        <span class="spinner small" /> {t("answer.waiting")}
      </p>
      <button class="link" onClick={() => c.backHome()}>
        {t("common.cancel")}
      </button>
    </div>
  )
}

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
      {c.state.notice && !c.state.error && v?.status === "LOBBY" && (
        <div class="banner" onClick={() => c.clearError()}>
          {t(`notice.${c.state.notice.code}`, c.state.notice.params)}
        </div>
      )}
      {s.name === "home" && <Home c={c} />}
      {s.name === "join" && <Join c={c} offerText={s.offerText} />}
      {s.name === "answer" && (
        <Answer c={c} answerText={s.answerText} rejoin={s.rejoin} />
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
