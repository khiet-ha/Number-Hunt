import "@/ui/styles.css"

import { render } from "preact"

import { AppController } from "@/app/controller"
import { persistentStore, sessionStore } from "@/app/identity"
import { App } from "@/ui/App"
import { initI18n } from "@/ui/i18n"

initI18n()

const params = new URLSearchParams(location.search)
const debug = params.has("debug")
const controller = new AppController({
  store: sessionStore(),
  persist: persistentStore(),
  baseUrl: location.origin + location.pathname,
  // ?nostun: LAN-only (host candidates), useful offline and in tests.
  iceServers: params.has("nostun") ? [] : undefined,
  debug,
})
;(globalThis as unknown as { __nh: AppController }).__nh = controller

render(
  <App c={controller} debug={debug} />,
  document.getElementById("app") as HTMLElement
)

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register("./sw.js")
}
