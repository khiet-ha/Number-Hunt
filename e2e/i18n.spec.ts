import { expect, test } from "@playwright/test"

test("language follows the browser and can be switched and remembered", async ({
  browser,
}) => {
  const ctx = await browser.newContext({ locale: "en-US" })
  const page = await ctx.newPage()
  await page.goto("./")
  await expect(page.getByTestId("create")).toHaveText("Create room")
  await expect(page).toHaveTitle("Number Hunt")
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US")

  await page.getByTestId("language").selectOption("lo-LA")
  await expect(page.getByTestId("create")).toHaveText("ສ້າງຫ້ອງ")
  await expect(page.locator("html")).toHaveAttribute("lang", "lo-LA")

  await page.reload()
  await expect(page.getByTestId("create")).toHaveText("ສ້າງຫ້ອງ")

  await page.getByTestId("language").selectOption("vi-VN")
  await expect(page.getByTestId("create")).toHaveText("Tạo phòng")
  await expect(page).toHaveTitle("Tìm Số")
  await ctx.close()
})
