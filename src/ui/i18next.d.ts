import "i18next"

import type translation from "./locales/vi-VN/translation.json"

// vi-VN is the reference locale: t() only accepts keys that exist in it, so a
// typo in a key fails `pnpm typecheck` instead of showing the raw key.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation"
    resources: { translation: typeof translation }
    returnNull: false
  }
}
