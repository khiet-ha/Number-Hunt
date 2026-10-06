import { describe, expect, it } from "vitest"

import { minifySdp, pack, unpack } from "@/qr/codec"
import {
  INVITE_TTL_MS,
  checkAnswer,
  decodeAnswer,
  decodeOffer,
  encodeAnswer,
  encodeOffer,
  offerUrl,
} from "@/qr/envelope"

const SDP = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
  "a=extmap-allow-mixed",
  "a=msid-semantic: WMS",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "c=IN IP4 0.0.0.0",
  "a=candidate:1 1 udp 2113937151 1f2e3d4c.local 54321 typ host generation 0 network-cost 999",
  "a=candidate:2 1 tcp 1518280447 1f2e3d4c.local 9 typ host tcptype active generation 0",
  "a=ice-ufrag:abcd",
  "a=ice-pwd:0123456789abcdefghijklmn",
  "a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
  "a=setup:actpass",
  "a=mid:0",
  "a=sctp-port:5000",
  "a=max-message-size:262144",
  "",
].join("\r\n")

describe("F. QR bootstrap", () => {
  it("pack/unpack roundtrip and compression", async () => {
    const p = await pack(SDP)
    expect(p[0]).toBe("Z")
    expect(p.length).toBeLessThan(SDP.length)
    expect(await unpack(p)).toBe(SDP)
  })

  it("minifySdp drops optional lines and tcp candidates", () => {
    const m = minifySdp(SDP)
    expect(m).not.toContain("extmap-allow-mixed")
    expect(m).not.toContain(" tcp ")
    expect(m).toContain("a=ice-ufrag:abcd")
    expect(m).toContain("a=fingerprint:")
  })

  it("W01 offer QR is valid (URL, fragment or bare)", async () => {
    const packed = await encodeOffer({
      r: "ABC123",
      h: "p_host",
      n: "nonce1",
      k: "join",
      s: SDP,
    })
    const url = offerUrl("https://x.github.io/Number-Hunt/#old", packed)
    expect(url).toMatch(/^https:\/\/x\.github\.io\/Number-Hunt\/#j=Z/)
    for (const input of [url, `#j=${packed}`, packed]) {
      const o = await decodeOffer(input)
      expect(o).toMatchObject({
        r: "ABC123",
        h: "p_host",
        n: "nonce1",
        k: "join",
      })
      expect(o.s).toContain("a=ice-pwd")
    }
    expect(url.length).toBeLessThan(1200)
  })

  it("W02 answer QR is valid", async () => {
    const txt = await encodeAnswer({
      r: "ABC123",
      h: "p_host",
      n: "nonce1",
      p: "p_alice",
      m: "Alice",
      x: "f".repeat(64),
      s: SDP,
    })
    const a = await decodeAnswer(txt)
    expect(a).toMatchObject({ p: "p_alice", m: "Alice" })
    const invite = { nonce: "nonce1", kind: "join" as const, createdAt: 1000 }
    expect(
      checkAnswer(a, { roomId: "ABC123", selfId: "p_host", invite, now: 2000 })
    ).toBeNull()
  })

  it("W03 wrong room / wrong host / wrong nonce rejected", async () => {
    const a = await decodeAnswer(
      await encodeAnswer({
        r: "OTHER1",
        h: "p_host",
        n: "nonce1",
        p: "p_a",
        m: "A",
        x: "x",
        s: SDP,
      })
    )
    const invite = { nonce: "nonce1", kind: "join" as const, createdAt: 0 }
    expect(
      checkAnswer(a, { roomId: "ABC123", selfId: "p_host", invite, now: 1 })
    ).toMatch(/phòng khác/)
    expect(
      checkAnswer(
        { ...a, r: "ABC123", h: "p_other" },
        { roomId: "ABC123", selfId: "p_host", invite, now: 1 }
      )
    ).toMatch(/người khác/)
    expect(
      checkAnswer(
        { ...a, r: "ABC123", n: "zzz" },
        { roomId: "ABC123", selfId: "p_host", invite, now: 1 }
      )
    ).toMatch(/hiệu lực/)
  })

  it("W04 expired invite rejected (Host clock)", async () => {
    const a = await decodeAnswer(
      await encodeAnswer({
        r: "ABC123",
        h: "p_host",
        n: "nonce1",
        p: "p_a",
        m: "A",
        x: "x",
        s: SDP,
      })
    )
    const invite = { nonce: "nonce1", kind: "join" as const, createdAt: 0 }
    expect(
      checkAnswer(a, {
        roomId: "ABC123",
        selfId: "p_host",
        invite,
        now: INVITE_TTL_MS + 1,
      })
    ).toMatch(/hết hạn/)
  })

  it("garbage is rejected safely", async () => {
    await expect(decodeOffer("hello")).rejects.toThrow()
    await expect(decodeAnswer("NH2:Zzzzz")).rejects.toThrow()
    await expect(
      decodeAnswer(
        await (async () =>
          "NH2:" + (await pack(JSON.stringify({ v: 1, t: "a" }))))()
      )
    ).rejects.toThrow(/Phiên bản/)
  })
})
