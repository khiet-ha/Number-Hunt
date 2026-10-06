import { useMemo } from "preact/hooks"
import qrcode from "qrcode-generator"

/** Renders text as an SVG QR code (low error correction = smallest code). */
export function QrCode({ text, label }: { text: string; label?: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, "L")
    qr.addData(text, "Byte")
    qr.make()
    return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true })
  }, [text])
  return (
    <div
      class="qr"
      role="img"
      aria-label={label ?? "QR code"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
