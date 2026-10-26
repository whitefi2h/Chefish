import { test, expect } from "@playwright/test";
test("global back follows page and recipe visits, including menu recipe links", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.locator(".recipe-title").first().click();
  await expect(page.locator(".detail-hero")).toBeVisible();
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await expect(page.locator(".recipe-grid")).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await page.locator(".calendar .draggable").first().click({ button: "right" });
  const editor = page.getByRole("dialog");
  await expect(
    editor.getByRole("button", { name: /查看对应菜谱/ }),
  ).toBeVisible();
  await editor.getByRole("button", { name: /查看对应菜谱/ }).click();
  await expect(page.locator(".detail-hero")).toBeVisible();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".calendar")).toBeVisible();
});
test("back restores the departure scroll position and new pages start at the top", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.evaluate(() => window.scrollTo(0, 350));
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(100);
  const back = page.getByRole("button", { name: "返回上一页面", exact: true });
  await expect(back).toContainText("返回");
  expect((await back.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".recipe-grid")).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.getByRole("button", { name: "返回上一页面", exact: true }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.locator(".recipe-title").first().click();
  await expect(page.locator(".detail-hero")).toBeVisible();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 500));
  const detailScroll = await page.evaluate(() => scrollY);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(page.locator(".detail-hero")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeCloseTo(detailScroll, 0);
});
