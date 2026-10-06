import { useState } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { useT } from "./i18n"
import { QrCode } from "./QrCode"
import { Scanner } from "./Scanner"

/** Two-way QR: show our offer, then scan (or paste) the player's answer. */
export function InvitePanel({ c, title }: { c: AppController; title: string }) {
  const t = useT()
  const inv = c.state.invite
  const [scanning, setScanning] = useState(false)
  const [paste, setPaste] = useState("")
  const [copied, setCopied] = useState(false)
  if (!inv)
    return <p class="muted">{c.state.busy ? t("invite.creating") : ""}</p>

  const submit = async (text: string) => {
    setScanning(false)
    if (await c.submitAnswer(text)) setPaste("")
  }

  return (
    <section class="card invite">
      <h3>{title}</h3>
      <ol class="steps">
        <li>{t("invite.step1")}</li>
        <li>{t("invite.step2")}</li>
      </ol>
      <QrCode text={inv.url} label={t("invite.qrLabel")} />
      <div class="row">
        <button
          class="secondary"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(inv.url)
              .then(() => setCopied(true))
          }}
        >
          {copied ? t("common.copied") : t("invite.copyLink")}
        </button>
        <button onClick={() => setScanning(true)}>
          {t("invite.scanAnswer")}
        </button>
      </div>
      {scanning && (
        <Scanner
          onResult={(t) => void submit(t)}
          onClose={() => setScanning(false)}
        />
      )}
      <details>
        <summary>{t("invite.pasteAnswer")}</summary>
        <textarea
          data-testid="answer-input"
          rows={3}
          value={paste}
          onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
          placeholder="NH2:…"
        />
        <button
          data-testid="answer-submit"
          disabled={!paste.trim()}
          onClick={() => void submit(paste)}
        >
          {t("invite.submit")}
        </button>
      </details>
      <input type="hidden" data-testid="invite-url" value={inv.url} />
    </section>
  )
}
