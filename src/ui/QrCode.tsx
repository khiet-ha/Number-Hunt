import qrcode from "qrcode-generator"
import { useEffect, useMemo, useState } from "preact/hooks"

import { useT } from "./i18n"

function qrSvg(text: string): string {
  // Low error correction = the smallest, easiest-to-scan code.
  const qr = qrcode(0, "L")
  qr.addData(text, "Byte")
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })
}

/**
 * Renders text as an SVG QR code. `zoomable` adds a full-screen view, which
 * is much easier to scan across a table or from a dim phone screen.
 */
export function QrCode({
  text,
  label,
  zoomable = false,
}: {
  text: string
  label?: string
  zoomable?: boolean
}) {
  const t = useT()
  const [zoom, setZoom] = useState(false)
  const svg = useMemo(() => qrSvg(text), [text])

  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoom(false)
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [zoom])

  return (
    <>
      <div
        class="qr"
        role="img"
        aria-label={label ?? "QR code"}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {zoomable && (
        <button class="secondary" onClick={() => setZoom(true)}>
          {t("qr.zoom")}
        </button>
      )}
      {zoom && (
        <div
          class="qr-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={label ?? "QR code"}
          data-testid="qr-zoom"
          onClick={() => setZoom(false)}
        >
          <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} />
          <p>{t("qr.brightness")}</p>
          <button onClick={() => setZoom(false)}>{t("qr.shrink")}</button>
        </div>
      )}
    </>
  )
}
