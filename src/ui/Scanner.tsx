import jsQR from "jsqr"
import { useEffect, useRef, useState } from "preact/hooks"

import { useT } from "./i18n"

interface BarcodeDetectorLike {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>
}

/** Camera QR scanner. Uses the native BarcodeDetector when present, else jsQR. */
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

  useEffect(() => {
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
      .catch(() => setError("noPermission"))
    if (!navigator.mediaDevices) setError("unsupported")

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div class="scanner">
      {error ? (
        <p class="error">{t(`scanner.${error}`)}</p>
      ) : (
        <>
          <div class="scan-frame">
            <video ref={video} playsInline muted />
          </div>
          <p class="muted">{t("scanner.hint")}</p>
        </>
      )}
      <button class="secondary" onClick={onClose}>
        {t("scanner.close")}
      </button>
    </div>
  )
}
