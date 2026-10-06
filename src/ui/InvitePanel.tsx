import { useState } from "preact/hooks"

import type { AppController } from "@/app/controller"
import { INVITE_TTL_MS } from "@/qr/envelope"
import { formatClock } from "./format"
import { useTicker } from "./hooks"
import { useT } from "./i18n"
import { QrCode } from "./QrCode"
import { Scanner } from "./Scanner"
import { Steps } from "./Steps"

/** Two-way QR: show our offer, then scan (or paste) the player's answer. */
export function InvitePanel({ c, title }: { c: AppController; title: string }) {
  const t = useT()
  const inv = c.state.invite
  const [scanning, setScanning] = useState(false)
  const [paste, setPaste] = useState("")
  const [copied, setCopied] = useState(false)
  useTicker(1000, !!inv)
  if (!inv)
    return <p class="muted">{c.state.busy ? t("invite.creating") : ""}</p>

  const remaining = inv.createdAt + INVITE_TTL_MS - Date.now()
  const expired = remaining <= 0
  const roomId = c.node?.roomId ?? ""
  const canShare = typeof navigator.share === "function"

  const submit = async (text: string) => {
    setScanning(false)
    if (await c.submitAnswer(text)) setPaste("")
  }

  return (
    <section class="card invite" data-testid="invite-panel">
      <h3>{title}</h3>
      <Steps
        labels={[t("steps.hostShow"), t("steps.hostScan"), t("steps.hostDone")]}
        current={scanning ? 1 : 0}
      />
      {expired ? (
        <div class="qr-expired">
          <p class="error">{t("invite.expired")}</p>
          <button onClick={() => void c.createInvite(inv.kind)}>
            {t("invite.renew")}
          </button>
        </div>
      ) : (
        <>
          <QrCode text={inv.url} label={t("invite.qrLabel")} zoomable />
          <p class="muted countdown" data-testid="invite-countdown">
            {t("invite.expiresIn", { time: formatClock(remaining) })}
            {inv.kind === "join" && ` · ${t("invite.autoRenew")}`}
          </p>
        </>
      )}
      <div class="row">
        {canShare ? (
          <button
            class="secondary"
            onClick={() =>
              void navigator
                .share({
                  title: t("app.title"),
                  text: t("invite.shareText", { roomId }),
                  url: inv.url,
                })
                .catch(() => {
                  /* dismissed by the user */
                })
            }
          >
            {t("invite.share")}
          </button>
        ) : (
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
        )}
        <button disabled={expired} onClick={() => setScanning(true)}>
          {t("invite.scanAnswer")}
        </button>
      </div>
      {scanning && (
        <Scanner
          onResult={(text) => void submit(text)}
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
      {inv.kind === "rejoin" && (
        <button class="link" onClick={() => c.cancelInvite()}>
          {t("common.cancel")}
        </button>
      )}
      <input type="hidden" data-testid="invite-url" value={inv.url} />
    </section>
  )
}
