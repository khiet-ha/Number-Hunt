import { useState } from "preact/hooks"

import type { AppController, OfferPeek } from "@/app/controller"
import type { AppErrorCode } from "@/app/controller"
import { loadName } from "@/app/identity"
import { useT } from "./i18n"

/** Shown after an invite was scanned/opened; says what it is before joining. */
export function Join({
  c,
  offerText,
  offer,
  offerError,
}: {
  c: AppController
  offerText: string
  offer: OfferPeek | null
  offerError: AppErrorCode | null
}) {
  const t = useT()
  const [name, setName] = useState(loadName())
  const back = (
    <button class="link" onClick={() => c.backHome()}>
      {t("common.cancel")}
    </button>
  )

  if (offerError)
    return (
      <div class="home" data-testid="join-error">
        <h1>{t("join.title")}</h1>
        <p class="error">{t(`errors.${offerError}`)}</p>
        {back}
      </div>
    )

  if (!offer)
    return (
      <div class="home">
        <h1>{t("join.title")}</h1>
        <p class="muted">
          <span class="spinner small" /> {t("join.decoding")}
        </p>
        {back}
      </div>
    )

  if (offer.kind === "rejoin") {
    const resume = c.resumable()
    const usable = resume && resume.roomId === offer.roomId
    return (
      <div class="home" data-testid="join-rejoin">
        <h1>{t("join.rejoinTitle", { roomId: offer.roomId })}</h1>
        {!usable ? (
          <p class="error">
            {t("errors.noPreviousSession", { roomId: offer.roomId })}
          </p>
        ) : resume.status === "openElsewhere" ? (
          <p class="error">{t("errors.openElsewhere")}</p>
        ) : (
          <>
            <p>{t("join.rejoinBody", { name: resume.session.name })}</p>
            <button
              data-testid="join"
              disabled={c.state.busy}
              onClick={() => void c.acceptOffer(offerText, resume.session.name)}
            >
              {c.state.busy ? t("join.preparing") : t("join.rejoinAction")}
            </button>
          </>
        )}
        {back}
      </div>
    )
  }

  return (
    <div class="home">
      <h1>{t("join.title")}</h1>
      <p class="room-chip" data-testid="join-room">
        {t("join.roomLabel", { roomId: offer.roomId })}
      </p>
      <label>
        {t("common.yourName")}
        <input
          data-testid="name"
          maxLength={16}
          value={name}
          autoFocus
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
      <p class="muted">{t("join.hint")}</p>
      {back}
    </div>
  )
}
