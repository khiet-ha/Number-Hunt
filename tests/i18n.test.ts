import { describe, expect, it } from "vitest"

import { detectLanguage, initI18n, LANGUAGES, tCode } from "@/ui/i18n"
import enUS from "@/ui/locales/en-US/translation.json"
import loLA from "@/ui/locales/lo-LA/translation.json"
import viVN from "@/ui/locales/vi-VN/translation.json"

type Tree = { [k: string]: string | Tree }

const locales: Record<string, Tree> = {
  "vi-VN": viVN,
  "en-US": enUS,
  "lo-LA": loLA,
}

function flatten(t: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === "string") out[key] = v
    else Object.assign(out, flatten(v, key))
  }
  return out
}

function sortedDeep(t: Tree): Tree {
  return Object.fromEntries(
    Object.keys(t)
      .sort()
      .map((k) => {
        const v = t[k]
        return [k, typeof v === "string" ? v : sortedDeep(v)]
      })
  )
}

const placeholders = (s: string) =>
  [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort()

describe("locales", () => {
  const reference = flatten(viVN)

  it("every supported language has a locale file", () => {
    expect(Object.keys(locales).sort()).toEqual(
      LANGUAGES.map((l) => l.code).sort()
    )
  })

  for (const [lng, tree] of Object.entries(locales)) {
    it(`${lng}: same keys as vi-VN, no empty values, same placeholders`, () => {
      const flat = flatten(tree)
      expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort())
      for (const [k, v] of Object.entries(flat)) {
        expect(v.trim(), `${lng} ${k}`).not.toBe("")
        expect(placeholders(v), `${lng} ${k}`).toEqual(
          placeholders(reference[k])
        )
      }
    })

    it(`${lng}: keys are sorted recursively`, () => {
      expect(JSON.stringify(tree)).toBe(JSON.stringify(sortedDeep(tree)))
    })
  }
})

describe("language detection", () => {
  it("prefers a saved, supported choice", () => {
    expect(detectLanguage("lo-LA", ["en-US"])).toBe("lo-LA")
  })

  it("matches browser languages by primary subtag", () => {
    expect(detectLanguage(null, ["fr-FR", "en-GB"])).toBe("en-US")
    expect(detectLanguage("xx", ["lo"])).toBe("lo-LA")
    expect(detectLanguage(null, ["vi"])).toBe("vi-VN")
  })

  it("falls back to vi-VN", () => {
    expect(detectLanguage(null, ["fr-FR"])).toBe("vi-VN")
    expect(detectLanguage(null, [])).toBe("vi-VN")
  })
})

describe("runtime codes", () => {
  it("translates known codes and falls back for unknown ones", () => {
    initI18n("en-US")
    expect(tCode("reject", "wrongNumber")).toBe("Wrong number!")
    expect(tCode("reject", "somethingNew")).toBe("Tap not accepted")
    expect(tCode("close", "removed")).toBe("You were removed from the room.")
    expect(tCode("blocker", "somethingNew")).toBe("somethingNew")
  })
})
