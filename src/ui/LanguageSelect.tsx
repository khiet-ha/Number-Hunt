import {
  currentLanguage,
  LANGUAGES,
  setLanguage,
  useT,
  type Language,
} from "./i18n"

export function LanguageSelect() {
  const t = useT()
  return (
    <label class="lang">
      <span class="sr-only">{t("common.language")}</span>
      <select
        data-testid="language"
        aria-label={t("common.language")}
        value={currentLanguage()}
        onChange={(e) =>
          setLanguage((e.target as HTMLSelectElement).value as Language)
        }
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  )
}
