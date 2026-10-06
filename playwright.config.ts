import { defineConfig } from "@playwright/test"
import { existsSync } from "node:fs"

const localChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173/",
    launchOptions: {
      executablePath: existsSync(localChromium) ? localChromium : undefined,
      // Expose raw host candidates instead of mDNS names so contexts on one machine can connect.
      args: [
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: {
    command:
      "pnpm exec vite build && pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
