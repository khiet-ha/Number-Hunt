import { expect, test } from "@playwright/test"

import {
  APP,
  clickTarget,
  inviteUrl,
  join,
  newPlayer,
  startGame,
  submitAnswer,
  view,
} from "./helpers"

test("Host closes the app mid-game, others carry on, Host comes back to the same seat", async ({
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
  await startGame(host, [bob, carol])
  await expect(host.locator(".overlay")).toHaveCount(0, { timeout: 15000 })

  const n1 = await clickTarget(host)
  await expect(carol.locator(`.num[data-n="${n1}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })
  const aliceId = (await view(host)).selfId
  const bobId = (await view(bob)).selfId
  const roomId = (await view(host)).roomId
  await expect(carol.getByTestId(`score-${aliceId}`)).toHaveText("1")

  // The app is closed by accident: the page goes away, the browser profile stays.
  const hostContext = host.context()
  await host.close()

  // Everyone else notices, elects Bob and keeps playing.
  await expect(carol.getByTestId("offline-bar")).toContainText("Alice", {
    timeout: 20000,
  })
  await expect
    .poll(async () => (await view(carol)).leaderId, { timeout: 30000 })
    .toBe(bobId)
  await expect(carol.getByTestId("status")).toHaveText("Đã kết nối", {
    timeout: 15000,
  })
  await expect(carol.locator(".overlay")).toHaveCount(0, { timeout: 15000 })
  const n2 = await clickTarget(carol)
  await expect(bob.locator(`.num[data-n="${n2}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })

  // Alice opens the app again: it offers to resume the room.
  const host2 = await hostContext.newPage()
  host2.on("pageerror", (e) => console.log("pageerror", e.message))
  await host2.goto(APP)
  const resume = host2.getByTestId("resume")
  await expect(resume).toBeVisible()
  await expect(resume).toContainText(roomId)

  // Bob invites her back straight from the warning bar and she pastes the code.
  await bob.getByTestId("invite-back").click()
  const url = await inviteUrl(bob)
  await resume.locator("details > summary").click()
  await host2.getByTestId("resume-input").fill(url)
  await host2.getByTestId("resume-submit").click()
  const answerBox = host2.getByTestId("answer-text")
  await expect(answerBox).toBeVisible({ timeout: 15000 })
  await submitAnswer(bob, await answerBox.inputValue())

  // Same identity, same score, and the room sees her again.
  await expect(host2.getByTestId("status")).toHaveText("Đã kết nối", {
    timeout: 30000,
  })
  expect((await view(host2)).selfId).toBe(aliceId)
  await expect(host2.getByTestId(`score-${aliceId}`)).toHaveText("1")
  await expect(host2.locator(`.num[data-n="${n2}"]`)).toHaveClass(/claimed/)
  await expect(carol.getByTestId("offline-bar")).toHaveCount(0, {
    timeout: 30000,
  })
  await expect(bob.getByTestId("notice")).toContainText("Alice")

  // She is a full player again: she can score, and the new Host stays Host.
  await expect(host2.locator(".overlay")).toHaveCount(0, { timeout: 15000 })
  const n3 = await clickTarget(host2)
  await expect(bob.locator(`.num[data-n="${n3}"]`)).toHaveClass(/claimed/, {
    timeout: 5000,
  })
  await expect(bob.getByTestId(`score-${aliceId}`)).toHaveText("2")
  expect((await view(host2)).leaderId).toBe(bobId)
})

test("a game that is still open in another tab cannot be taken over", async ({
  browser,
}) => {
  const host = await newPlayer(browser)
  const bob = await newPlayer(browser)
  await host.goto(APP)
  await host.getByTestId("name").fill("Alice")
  await host.getByTestId("create").click()
  await join(host, bob, "Bob")
  await startGame(host, [bob])

  const other = await host.context().newPage()
  await other.goto(APP)
  await expect(other.getByTestId("resume")).toContainText(/tab khác/)
  await expect(other.getByTestId("resume-scan")).toHaveCount(0)

  // Once the first tab is gone the lock lapses and the game can be resumed.
  await host.close()
  await expect(async () => {
    await other.reload()
    await expect(other.getByTestId("resume-scan")).toBeVisible()
  }).toPass({ timeout: 20000, intervals: [2000] })
})
