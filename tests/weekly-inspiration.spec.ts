import { test, expect } from "@playwright/test";
test("weekly inspiration resets and remains separate when selecting future and past weeks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".pool-card")).toHaveCount(6);
  const plans = await page.locator(".planned-card").count();
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.locator(".pool-card")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  const card = page.locator(".recipe-card").first();
  await card.locator(".inspiration-button").click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await expect(page.locator(".pool-card")).toHaveCount(1);
  await page.getByRole("button", { name: "上一周", exact: true }).click();
  await expect(page.locator(".pool-card")).toHaveCount(6);
  await expect(page.locator(".planned-card")).toHaveCount(plans);
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.locator(".pool-card")).toHaveCount(1);
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.locator(".pool-card")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/tags-refinement/new-week.png",
  });
});
