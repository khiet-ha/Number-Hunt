import { expect, test } from "@playwright/test"

import { APP, inviteUrl, newPlayer } from "./helpers"

const PHONE = { width: 390, height: 844 }

test("the scanner is a push-up sheet that keeps the page where it was", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ viewport: PHONE })
  const host = await ctx.newPage()
  await host.goto(APP)
  await host.getByTestId("name").fill("Alice")
  await host.getByTestId("create").click()
  await expect(host.getByTestId("invite-panel")).toBeVisible()

  // The user has scrolled to the button; opening the scanner must not move the page.
  const scan = host.getByTestId("scan-answer")
  await scan.scrollIntoViewIfNeeded()
  const before = await host.evaluate(() => window.scrollY)
  expect(before).toBeGreaterThan(0)

  await scan.click()
  const dialog = host.getByRole("dialog")
  await expect(dialog).toBeVisible()
  await expect(dialog.locator("video")).toBeVisible()
  expect(await host.evaluate(() => window.scrollY)).toBe(before)
  expect(await host.evaluate(() => document.body.style.overflow)).toBe("hidden")

  // It sits on the bottom edge and never wider than the screen.
  await expect
    .poll(async () => {
      const box = await dialog.boundingBox()
      return box ? Math.round(box.y + box.height) : 0
    })
    .toBe(PHONE.height)
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(PHONE.width)

  // Esc, the ✕ button and a tap on the dimmed area all close it.
  await host.keyboard.press("Escape")
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => host.evaluate(() => document.body.style.overflow))
    .toBe("")
  expect(await host.evaluate(() => window.scrollY)).toBe(before)

  await scan.click()
  await host.getByTestId("sheet-close").click()
  await expect(dialog).toHaveCount(0)

  await scan.click()
  await host.getByTestId("scanner-sheet").click({ position: { x: 10, y: 10 } })
  await expect(dialog).toHaveCount(0)
  expect(await host.evaluate(() => window.scrollY)).toBe(before)
})

test("a guest can be added through the sheet's paste mode, no camera needed", async ({
  browser,
}) => {
  const hostCtx = await browser.newContext({ viewport: PHONE })
  const host = await hostCtx.newPage()
  const bob = await newPlayer(browser)
  await host.goto(APP)
  await host.getByTestId("name").fill("Alice")
  await host.getByTestId("create").click()

  const url = await inviteUrl(host)
  await bob.goto(APP + url.slice(url.indexOf("#")))
  await bob.getByTestId("name").fill("Bob")
  await bob.getByTestId("join").click()
  const answer = await bob.getByTestId("answer-text").inputValue()

  await host.getByTestId("scan-answer").click()
  await host.getByTestId("scanner-paste-toggle").click()
  // The submit button waits for a code; a wrong one explains itself and the
  // sheet closes so the host can try again.
  await expect(host.getByTestId("scanner-paste-submit")).toBeDisabled()
  await host.getByTestId("scanner-paste-input").fill(answer)
  await host.getByTestId("scanner-paste-submit").click()

  await expect(host.getByRole("dialog")).toHaveCount(0)
  await expect(bob.getByTestId("players")).toContainText("Bob", {
    timeout: 20000,
  })
  await expect(host.getByTestId("notice")).toBeVisible()
})
