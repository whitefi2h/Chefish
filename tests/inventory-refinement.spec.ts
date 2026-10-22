import { test, expect } from "@playwright/test";
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`category ordering and focus appearance ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "食材库存" })
      .click();
    await page.getByRole("button", { name: "管理分类", exact: true }).click();
    await page
      .getByRole("button", { name: "拖动分类肉禽蛋", exact: true })
      .press("Alt+ArrowDown");
    await expect(page.locator(".category-row input").first()).toHaveValue(
      "蔬菜菌菇",
    );
    const row = page.locator(".category-row").first();
    const heights = await row
      .locator("button")
      .evaluateAll((items) =>
        items.map((e) => e.getBoundingClientRect().height),
      );
    expect(heights).toEqual([40, 40]);
    expect(
      await page
        .locator(".dialog-body")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/inventory-refinement/${width}-categories.png`,
    });
    await page.getByRole("button", { name: "保存分类", exact: true }).click();
    const select = page.getByLabel("筛选食材类别");
    await expect(select.locator("option")).toHaveText([
      "全部类别",
      "蔬菜菌菇",
      "肉禽蛋",
      "主食调味",
      "未分类",
    ]);
    await select.focus();
    await expect(select).toHaveCSS("outline-style", "none");
    await expect(select).toHaveCSS("box-shadow", "none");
  });
}
