import { describe, expect, it, vi } from "vitest"

import type { LinkState } from "@/multiplayer/env"
import type { PeerLink } from "@/webrtc/peer"
import { WebRtcTransport } from "@/webrtc/transport"

/** Minimal stand-in for PeerLink: only what WebRtcTransport touches. */
function fakeLink(state: LinkState = "connecting") {
  const link = {
    state,
    onState: (_s: LinkState) => {},
    onMessage: (_d: string) => {},
    send: () => true,
    close() {
      this.state = "closed"
      this.onState("closed")
    },
    open() {
      this.state = "connected"
      this.onState("connected")
    },
  }
  return link
}

function setup() {
  const t = new WebRtcTransport({ iceServers: [], gatherTimeoutMs: 0 })
  const events: string[] = []
  t.setHandlers({
    onMessage: () => {},
    onLinkState: (peer, s) => events.push(`${peer}:${s}`),
  })
  return { t, events }
}

describe("WebRtcTransport", () => {
  it("W05: replacing a link does not report the old one as closed", () => {
    const { t, events } = setup()
    const a = fakeLink("connected")
    t.bind("b", a as unknown as PeerLink)
    events.length = 0
    const b = fakeLink()
    t.bind("b", b as unknown as PeerLink)
    expect(a.state).toBe("closed")
    expect(events).toEqual([])
    expect(t.linkState("b")).toBe("connecting")
    b.open()
    expect(events).toEqual(["b:connected"])
  })

  it("waitOpen resolves on connect and cleans up on timeout or closeAll", async () => {
    vi.useFakeTimers()
    try {
      const { t } = setup()
      const link = fakeLink()
      t.bind("h", link as unknown as PeerLink)

      const timedOut = t.waitOpen("h", 1000)
      vi.advanceTimersByTime(1001)
      await expect(timedOut).rejects.toThrow("timeout")

      const closed = t.waitOpen("h", 60_000)
      t.closeAll()
      await expect(closed).rejects.toThrow("closed")

      const link2 = fakeLink()
      t.bind("h", link2 as unknown as PeerLink)
      const opened = t.waitOpen("h", 60_000)
      link2.open()
      await expect(opened).resolves.toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
