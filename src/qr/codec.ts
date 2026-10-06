/**
 * Compact text packing for QR codes: strip optional SDP lines, deflate-raw,
 * base64url. Falls back to plain base64url when CompressionStream is missing.
 */

function toB64url(bytes: Uint8Array): string {
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function fromB64url(s: string): Uint8Array {
  const b64 =
    s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function pipe(
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
  limit = 64 * 1024
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  void writer
    .write(bytes as unknown as BufferSource)
    .then(() => writer.close())
    .catch(() => {})
  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > limit) throw new Error("too large")
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

export async function pack(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  if (typeof CompressionStream !== "undefined") {
    try {
      return (
        "Z" + toB64url(await pipe(bytes, new CompressionStream("deflate-raw")))
      )
    } catch {
      /* fall through */
    }
  }
  return "P" + toB64url(bytes)
}

export async function unpack(packed: string): Promise<string> {
  const kind = packed[0]
  const body = fromB64url(packed.slice(1))
  if (kind === "P") return new TextDecoder().decode(body)
  if (kind === "Z")
    return new TextDecoder().decode(
      await pipe(body, new DecompressionStream("deflate-raw"))
    )
  throw new Error("unknown packing")
}

/** Remove SDP lines that are not needed for a data-channel-only session. */
export function minifySdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .filter((l) => !/^a=(extmap-allow-mixed|msid-semantic)/.test(l))
    .filter((l) => !(l.startsWith("a=candidate:") && / tcp /i.test(l)))
    .join("\r\n")
    .concat("\r\n")
}
