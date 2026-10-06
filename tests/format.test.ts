import { describe, expect, it } from "vitest"

import { formatAgo, formatClock } from "@/ui/format"

describe("formatClock", () => {
  it("renders m:ss and rounds partial seconds up", () => {
    expect(formatClock(5 * 60_000)).toBe("5:00")
    expect(formatClock(61_000)).toBe("1:01")
    expect(formatClock(59_001)).toBe("1:00")
    expect(formatClock(900)).toBe("0:01")
  })

  it("never goes negative", () => {
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(-5000)).toBe("0:00")
  })
})

describe("formatAgo", () => {
  it("is language aware and picks a sensible unit", () => {
    expect(formatAgo(10_000, "en-US")).toBe("now")
    expect(formatAgo(3 * 60_000, "en-US")).toBe("3 minutes ago")
    expect(formatAgo(2 * 3_600_000, "en-US")).toBe("2 hours ago")
    expect(formatAgo(3 * 60_000, "vi-VN")).toMatch(/3 phút trước/)
    expect(formatAgo(3 * 60_000, "lo-LA")).toMatch(/3/)
  })

  it("never crashes on odd input", () => {
    expect(formatAgo(-1, "en-US")).toBe("now")
    expect(formatAgo(60_000, "not-a-locale-xx")).toBeTruthy()
  })
})
