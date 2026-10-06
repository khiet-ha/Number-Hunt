import i18next from "i18next"
import { useEffect, useReducer } from "preact/hooks"

import enUS from "./locales/en-US/translation.json"
import loLA from "./locales/lo-LA/translation.json"
import viVN from "./locales/vi-VN/translation.json"

/** Supported UI languages; labels are written in their own language. */
export const LANGUAGES = [
  { code: "vi-VN", label: "Tiếng Việt" },
  { code: "en-US", label: "English" },
  { code: "lo-LA", label: "ພາສາລາວ" },
] as const

export type Language = (typeof LANGUAGES)[number]["code"]

const STORAGE_KEY = "nh:lang"
const FALLBACK: Language = "vi-VN"

function isLanguage(v: unknown): v is Language {
  return LANGUAGES.some((l) => l.code === v)
}

/** Saved choice → first browser language we support (by primary subtag) → vi-VN. */
export function detectLanguage(
  saved: string | null,
  browser: readonly string[]
): Language {
  if (isLanguage(saved)) return saved
  for (const tag of browser) {
    const primary = tag.toLowerCase().split("-")[0]
    const match = LANGUAGES.find((l) =>
      l.code.toLowerCase().startsWith(primary)
    )
    if (match) return match.code
  }
  return FALLBACK
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function applyDocument(lng: Language) {
  if (typeof document === "undefined") return
  document.documentElement.lang = lng
  document.title = i18next.t("app.title")
}

export function initI18n(
  lng: Language = detectLanguage(
    readSaved(),
    typeof navigator === "undefined" ? [] : navigator.languages
  )
) {
  void i18next.init({
    resources: {
      "vi-VN": { translation: viVN },
      "en-US": { translation: enUS },
      "lo-LA": { translation: loLA },
    },
    lng,
    fallbackLng: FALLBACK,
    initAsync: false,
    // Preact escapes text content already.
    interpolation: { escapeValue: false },
    returnNull: false,
  })
  applyDocument(lng)
}

export function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : FALLBACK
}

export function setLanguage(lng: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* private mode: choice lasts for this page only */
  }
  void i18next.changeLanguage(lng)
  applyDocument(lng)
}

/** Translation function that re-renders the component on language change. */
export function useT() {
  const [, force] = useReducer((x: number, _: unknown) => x + 1, 0)
  useEffect(() => {
    const onChange = () => force(undefined)
    i18next.on("languageChanged", onChange)
    return () => i18next.off("languageChanged", onChange)
  }, [])
  return i18next.t
}

/**
 * Translate a code that arrives at runtime (a reject reason from the Host, a
 * close reason, a start blocker). Unknown codes fall back to `<prefix>.unknown`
 * when that key exists, otherwise to the raw code.
 */
export function tCode(prefix: "blocker" | "close" | "reject", code: string) {
  const key = `${prefix}.${code}`
  if (i18next.exists(key)) return i18next.t(key as never) as string
  const unknown = `${prefix}.unknown`
  return i18next.exists(unknown)
    ? (i18next.t(unknown as never) as string)
    : code
}
