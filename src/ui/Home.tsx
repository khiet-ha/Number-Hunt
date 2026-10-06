import { useState } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { loadName } from "@/app/identity"
import { formatAgo } from "./format"
import { useTicker } from "./hooks"
import { currentLanguage, useT } from "./i18n"
import { Scanner } from "./Scanner"

type ScanTarget = "invite" | "rejoin" | null

/** A started game this device can come back to (e.g. the app was closed). */
function ResumeCard({ c, onScan }: { c: AppController; onScan: () => void }) {
  const t = useT()
  const [paste, setPaste] = useState("")
  useTicker(15_000)
  const resume = c.resumable()
  if (!resume) return null
  const ago = formatAgo(Date.now() - resume.lastActiveAt, currentLanguage())
  return (
    <section class="card resume" data-testid="resume">
      <h3>{t("resume.title", { roomId: resume.roomId })}</h3>
      <p class="muted">{t("resume.lastSeen", { ago })}</p>
      {resume.status === "openElsewhere" ? (
        <p class="error">{t("resume.openElsewhere")}</p>
      ) : (
        <>
          <p>{t("resume.keepScore")}</p>
          <ol class="steps">
            <li>{t("resume.step1")}</li>
            <li>{t("resume.step2")}</li>
          </ol>
          <button data-testid="resume-scan" onClick={onScan}>
            {t("home.scanRejoin")}
          </button>
          <details>
            <summary>{t("resume.pasteCode")}</summary>
            <textarea
              data-testid="resume-input"
              rows={3}
              value={paste}
              onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
            />
            <button
              data-testid="resume-submit"
              disabled={!paste.trim()}
              onClick={() => c.openJoin(paste)}
            >
              {t("join.rejoinAction")}
            </button>
          </details>
        </>
      )}
      <button
        class="link"
        data-testid="resume-forget"
        onClick={() => confirm(t("resume.forgetConfirm")) && c.forgetSession()}
      >
        {t("home.forgetGame")}
      </button>
    </section>
  )
}

export function Home({ c }: { c: AppController }) {
  const t = useT()
  const [name, setName] = useState(loadName())
  const [scan, setScan] = useState<ScanTarget>(null)
  const [paste, setPaste] = useState("")
  const valid = name.trim().length > 0
  return (
    <div class="home">
      <h1>{t("app.title")}</h1>
      <p class="muted">{t("app.tagline")}</p>
      <ResumeCard c={c} onScan={() => setScan("rejoin")} />
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
      <button
        class="secondary"
        disabled={!valid}
        onClick={() => setScan("invite")}
      >
        {t("home.scanInvite")}
      </button>
      {scan && (
        <Scanner
          onResult={(text) => {
            setScan(null)
            // The join screen shows which room this is before committing.
            c.openJoin(text)
          }}
          onClose={() => setScan(null)}
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
          onClick={() => c.openJoin(paste)}
        >
          {t("common.join")}
        </button>
      </details>
    </div>
  )
}
