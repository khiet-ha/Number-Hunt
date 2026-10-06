import type { AppController } from "@/app/controller"
import { useTicker } from "./hooks"
import { useT } from "./i18n"
import { QrCode } from "./QrCode"
import { Steps } from "./Steps"

/** After this long without a link, show what usually goes wrong. */
const SLOW_AFTER_S = 20

/** The player's reply code, to be scanned by whoever created the invite. */
export function Answer({
  c,
  answerText,
  rejoin,
  startedAt,
}: {
  c: AppController
  answerText: string
  rejoin: boolean
  startedAt: number
}) {
  const t = useT()
  useTicker(1000)
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return (
    <div class="home" data-testid="answer">
      <h2>{rejoin ? t("answer.titleRejoin") : t("answer.title")}</h2>
      <Steps
        labels={[
          t("steps.guestScan"),
          rejoin ? t("steps.guestShowRejoin") : t("steps.guestShow"),
          t("steps.guestWait"),
        ]}
        current={1}
      />
      <QrCode text={answerText} label={t("answer.qrLabel")} zoomable />
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
        <span class="spinner small" /> {t("answer.waiting")} ·{" "}
        {t("answer.elapsed", { seconds: String(seconds) })}
      </p>
      {seconds >= SLOW_AFTER_S && (
        <p class="hint" data-testid="slow-hint">
          {t("answer.slowHint")}
        </p>
      )}
      <button class="link" onClick={() => c.backHome()}>
        {t("common.cancel")}
      </button>
    </div>
  )
}
