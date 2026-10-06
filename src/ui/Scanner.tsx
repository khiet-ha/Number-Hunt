import jsQR from "jsqr"
import { useEffect, useRef, useState } from "preact/hooks"

import { useT } from "./i18n"
import { Sheet } from "./Sheet"

interface BarcodeDetectorLike {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

/**
 * QR scanner shown as a push-up sheet. Uses the native BarcodeDetector when
 * present, else jsQR. Without a usable camera (or on request) the same sheet
 * takes the code pasted as text, so no flow depends on having a camera.
 */
export function Scanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void
  onClose: () => void
}) {
  const t = useT()
  const video = useRef<HTMLVideoElement>(null)
  // Latest callback without restarting the camera when the parent re-renders.
  const onResultRef = useRef(onResult)
  onResultRef.current = onResult
  const [error, setError] = useState<"noPermission" | "unsupported" | null>(
    null
  )
  const [mode, setMode] = useState<"camera" | "paste">("camera")
  const [paste, setPaste] = useState("")

  useEffect(() => {
    // Leaving camera mode releases the camera right away.
    if (mode !== "camera") return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    const BD = (
      globalThis as unknown as {
        BarcodeDetector?: new (o: unknown) => BarcodeDetectorLike
      }
    ).BarcodeDetector
    let detector: BarcodeDetectorLike | null = null
    try {
      detector = BD ? new BD({ formats: ["qr_code"] }) : null
    } catch {
      detector = null
    }

    const scan = async () => {
      if (stopped) return
      const v = video.current
      if (v && v.readyState >= 2 && ctx) {
        try {
          let text: string | null = null
          if (detector) {
            const codes = await detector.detect(v)
            text = codes[0]?.rawValue ?? null
          } else {
            const w = v.videoWidth
            const h = v.videoHeight
            const scale = Math.min(1, 800 / Math.max(w, h))
            canvas.width = Math.floor(w * scale)
            canvas.height = Math.floor(h * scale)
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
            text =
              jsQR(img.data, img.width, img.height, {
                inversionAttempts: "dontInvert",
              })?.data ?? null
          }
          if (text && !stopped) {
            stopped = true
            onResultRef.current(text)
            return
          }
        } catch {
          /* keep scanning */
        }
      }
      raf = requestAnimationFrame(() => void scan())
    }

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s
        if (video.current) {
          video.current.srcObject = s
          void video.current.play()
        }
        raf = requestAnimationFrame(() => void scan())
      })
      .catch(() => {
        setError("noPermission")
        setMode("paste")
      })
    if (!navigator.mediaDevices) {
      setError("unsupported")
      setMode("paste")
    }

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [mode])

  return (
    <Sheet title={t("scanner.title")} onClose={onClose} testId="scanner-sheet">
      <div class="scanner">
        {mode === "camera" ? (
          <>
            <div class="scan-frame">
              <video ref={video} playsInline muted />
            </div>
            <p class="muted">{t("scanner.hint")}</p>
            <button
              class="link"
              data-testid="scanner-paste-toggle"
              onClick={() => setMode("paste")}
            >
              {t("scanner.paste")}
            </button>
          </>
        ) : (
          <>
            {error && <p class="error">{t(`scanner.${error}`)}</p>}
            <p class="muted">{t("scanner.pasteHint")}</p>
            <textarea
              data-testid="scanner-paste-input"
              rows={4}
              value={paste}
              autoFocus
              onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)}
              placeholder="NH2:…"
            />
            <button
              data-testid="scanner-paste-submit"
              disabled={!paste.trim()}
              onClick={() => onResult(paste.trim())}
            >
              {t("invite.submit")}
            </button>
            {!error && (
              <button class="link" onClick={() => setMode("camera")}>
                {t("scanner.useCamera")}
              </button>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
