import { test, expect } from "@playwright/test";
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
  [2560, 1386],
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
    const tags = page.getByRole("group", { name: "类别筛选", exact: true });
    await expect(tags.getByRole("button")).toHaveText([
      "全部",
      "蔬菜菌菇",
      "肉禽蛋",
      "主食调味",
      "未分类",
    ]);
    const quantity = page.locator(".lot-quantity").first();
    expect((await quantity.boundingBox())!.width).toBeLessThanOrEqual(126);
    expect(
      (await page.locator(".lot-location").first().boundingBox())!.width,
    ).toBeLessThanOrEqual(70);
    const attention = page.getByRole("region", {
      name: "需要关注",
      exact: true,
    });
    expect((await attention.boundingBox())!.height).toBeLessThan(140);
    await attention.getByRole("button", { name: /在列表查看/ }).click();
    await expect(
      attention.getByRole("button", { name: "显示全部库存", exact: true }),
    ).toBeVisible();
    await attention
      .getByRole("button", { name: "显示全部库存", exact: true })
      .click();
    const table = page.locator(".inventory-table");
    const initial = await table.boundingBox();
    const columns = await table
      .locator("th")
      .evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().width),
      );
    await tags.getByRole("button", { name: "肉禽蛋", exact: true }).click();
    await expect(
      tags.getByRole("button", { name: "肉禽蛋", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("tbody")).toContainText("牛肉");
    await tags.getByRole("button", { name: "蔬菜菌菇", exact: true }).click();
    await expect(page.locator("tbody")).toContainText("牛肉");
    await expect(page.locator("tbody")).toContainText("口蘑");
    expect((await table.boundingBox())?.width).toBe(initial?.width);
    expect(
      await table
        .locator("th")
        .evaluateAll((items) =>
          items.map((item) => item.getBoundingClientRect().width),
        ),
    ).toEqual(columns);
    await page.screenshot({
      path: `docs/screenshots/inventory-refinement/${width}-tags-and-inline.png`,
      fullPage: true,
    });
  });
}
