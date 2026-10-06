import { expect, test, type Browser, type Page } from "@playwright/test"

const APP = "./?nostun&debug"

async function newPlayer(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  page.on("pageerror", (e) => console.log("pageerror", e.message))
  return page
}

async function inviteUrl(host: Page): Promise<string> {
  const input = host.getByTestId("invite-url")
  await expect(input).toHaveCount(1, { timeout: 15000 })
  return input.inputValue()
}

async function join(host: Page, guest: Page, name: string) {
  const url = await inviteUrl(host)
  const fragment = url.slice(url.indexOf("#"))
  await guest.goto(APP + fragment)
  await guest.getByTestId("name").fill(name)
  await guest.getByTestId("join").click()
  const answerBox = guest.getByTestId("answer-text")
  await expect(answerBox).toBeVisible({ timeout: 15000 })
  const answer = await answerBox.inputValue()
  expect(answer).toMatch(/^NH2:/)
  await host
    .locator("details", { hasText: "Dán mã trả lời" })
    .locator("summary")
    .click()
  await host.getByTestId("answer-input").fill(answer)
  await host.getByTestId("answer-submit").click()
  await expect(guest.getByTestId("players")).toContainText(name, {
    timeout: 20000,
  })
}

async function currentTarget(page: Page): Promise<number> {
  const txt = await page.getByTestId("target").innerText()
  return Number(txt.match(/\d+/)![0])
}

async function clickTarget(page: Page) {
  const n = await currentTarget(page)
  await page.locator(`.num[data-n="${n}"]`).dispatchEvent("pointerdown")
  return n
}

const view = (p: Page) =>
  p.evaluate(() => (globalThis as any).__nh.node.getView())

test("3 players: QR bootstrap, full mesh, play, Host migration over real WebRTC", async ({
  browser,
}) => {
  const host = await newPlayer(browser)
  const bob = await newPlayer(browser)
  const carol = await newPlayer(browser)

  await host.goto(APP)
  await host.getByTestId("name").fill("Alice")
  await host.getByTestId("create").click()
  await expect(host.getByTestId("room-id")).toBeVisible()

  await join(host, bob, "Bob")
  await join(host, carol, "Carol")

  // Bob <-> Carol mesh link is negotiated through the Host relay.
  await bob.getByTestId("ready").click()
  await carol.getByTestId("ready").click()
  const start = host.getByTestId("start")
  await expect(start).toBeEnabled({ timeout: 30000 })
  await start.click()

  for (const p of [host, bob, carol])
    await expect(p.getByTestId("status")).toHaveText("Đã kết nối", {
      timeout: 15000,
    })
  await expect(bob.locator(".overlay")).toHaveCount(0, { timeout: 10000 })

  const n1 = await clickTarget(bob)
  for (const p of [host, bob, carol]) {
    await expect(p.locator(`.num[data-n="${n1}"]`)).toHaveClass(/claimed/, {
      timeout: 5000,
    })
  }
  const bobId = (await view(bob)).selfId
  await expect(carol.getByTestId(`score-${bobId}`)).toHaveText("1")

  // Kill the Host: remaining two (quorum 2/3) must elect Bob (lowest joinSequence) and continue.
  await host.context().close()
  await expect
    .poll(async () => (await view(carol)).leaderId, { timeout: 30000 })
    .toBe(bobId)
  await expect(carol.getByTestId("status")).toHaveText("Đã kết nối", {
    timeout: 15000,
  })
  await expect(carol.locator(".overlay")).toHaveCount(0, { timeout: 10000 })

  const n2 = await clickTarget(carol)
  await expect(bob.locator(`.num[data-n="${n2}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })
  const carolId = (await view(carol)).selfId
  await expect(bob.getByTestId(`score-${carolId}`)).toHaveText("1")
  await expect(bob.getByTestId(`score-${bobId}`)).toHaveText("1")
  expect((await view(bob)).term).toBe(1)
})

test("reload mid-game: rejoin via a member's QR keeps the same slot and score", async ({
  browser,
}) => {
  const host = await newPlayer(browser)
  const bob = await newPlayer(browser)
  const carol = await newPlayer(browser)
  await host.goto(APP)
  await host.getByTestId("name").fill("Alice")
  await host.getByTestId("create").click()
  await join(host, bob, "Bob")
  await join(host, carol, "Carol")
  await bob.getByTestId("ready").click()
  await carol.getByTestId("ready").click()
  await expect(host.getByTestId("start")).toBeEnabled({ timeout: 30000 })
  await host.getByTestId("start").click()
  await expect(carol.locator(".overlay")).toHaveCount(0, { timeout: 15000 })

  const n1 = await clickTarget(carol)
  await expect(host.locator(`.num[data-n="${n1}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })
  const carolId = (await view(carol)).selfId

  // Carol reloads the tab (sessionStorage keeps identity + persisted log state).
  await carol.goto(APP)
  await expect(carol.getByText("Bạn đang có một trận dở")).toBeVisible()
  // The game continues without her (quorum 2/3).
  const n2 = await clickTarget(bob)
  await expect(host.locator(`.num[data-n="${n2}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })

  // Bob (any member) issues a rejoin invite.
  await bob.getByRole("button", { name: "Menu" }).click()
  await bob
    .getByRole("button", { name: "Mời người chơi bị rớt vào lại" })
    .click()
  const url = await inviteUrl(bob)
  console.log("offer URL length", url.length)
  await carol.goto(APP + url.slice(url.indexOf("#")))
  await carol.getByTestId("name").fill("whatever")
  await carol.getByTestId("join").click()
  const answerBox = carol.getByTestId("answer-text")
  await expect(answerBox).toBeVisible({ timeout: 15000 })
  const answer = await answerBox.inputValue()
  console.log("answer length", answer.length)
  await bob
    .locator("details", { hasText: "Dán mã trả lời" })
    .locator("summary")
    .click()
  await bob.getByTestId("answer-input").fill(answer)
  await bob.getByTestId("answer-submit").click()

  await expect(carol.getByTestId("status")).toHaveText("Đã kết nối", {
    timeout: 30000,
  })
  expect((await view(carol)).selfId).toBe(carolId)
  await expect(carol.getByTestId(`score-${carolId}`)).toHaveText("1")
  await expect(carol.locator(`.num[data-n="${n2}"]`)).toHaveClass(/claimed/)
  // Carol reconnects to the Host too (mesh repair via relay) and can score again.
  await expect
    .poll(
      async () =>
        (await view(carol)).peers.every((p: any) => p.link === "connected"),
      { timeout: 30000 }
    )
    .toBe(true)
  await expect(carol.locator(".overlay")).toHaveCount(0, { timeout: 10000 })
  const n3 = await clickTarget(carol)
  await expect(host.locator(`.num[data-n="${n3}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })
  await expect(host.getByTestId(`score-${carolId}`)).toHaveText("2")
})
