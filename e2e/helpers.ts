import { expect, type Browser, type Page } from "@playwright/test"

export const APP = "./?nostun&debug"

export async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log("pageerror", e.message))
  return page
}

export async function inviteUrl(host: Page): Promise<string> {
  const input = host.getByTestId("invite-url")
  await expect(input).toHaveCount(1, { timeout: 15000 })
  return input.inputValue()
}

/** Host shows an invite, the guest opens it, host pastes the reply code. */
export async function join(host: Page, guest: Page, name: string) {
  const url = await inviteUrl(host)
  const fragment = url.slice(url.indexOf("#"))
  await guest.goto(APP + fragment)
  await guest.getByTestId("name").fill(name)
  await guest.getByTestId("join").click()
  const answerBox = guest.getByTestId("answer-text")
  await expect(answerBox).toBeVisible({ timeout: 15000 })
  const answer = await answerBox.inputValue()
  expect(answer).toMatch(/^NH2:/)
  await submitAnswer(host, answer)
  await expect(guest.getByTestId("players")).toContainText(name, {
    timeout: 20000,
  })
}

/** Paste a reply code into whichever invite panel is open on `inviter`. */
export async function submitAnswer(inviter: Page, answer: string) {
  const panel = inviter.getByTestId("invite-panel")
  await panel.locator("details > summary").click()
  await inviter.getByTestId("answer-input").fill(answer)
  await inviter.getByTestId("answer-submit").click()
}

export async function startGame(host: Page, guests: Page[]) {
  for (const g of guests) await g.getByTestId("ready").click()
  const start = host.getByTestId("start")
  await expect(start).toBeEnabled({ timeout: 30000 })
  await start.click()
  for (const p of [host, ...guests])
    await expect(p.getByTestId("status")).toHaveText("Đã kết nối", {
      timeout: 15000,
    })
}

export async function currentTarget(page: Page): Promise<number> {
  const txt = await page.getByTestId("target").innerText()
  return Number(txt.match(/\d+/)![0])
}

export async function clickTarget(page: Page) {
  const n = await currentTarget(page)
  await page.locator(`.num[data-n="${n}"]`).dispatchEvent("pointerdown")
  return n
}

export const view = (p: Page) =>
  p.evaluate(() => (globalThis as any).__nh.node.getView())
