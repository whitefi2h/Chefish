import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
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
    await expect(
      attention.getByRole("button", { name: "上一张临期食材" }),
    ).toBeVisible();
    await expect(
      attention.getByRole("button", { name: "下一张临期食材" }),
    ).toBeVisible();
    await expect(
      attention.getByRole("button", { name: /在列表查看/ }),
    ).toHaveCount(0);
    expect(
      await attention
        .locator(".attention-items")
        .evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe("none");
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

test("attention carousel moves in both directions without a scrollbar", async ({
  page,
}) => {
  const state = initialState();
  const source = state.lots.find(
    (l) =>
      state.ingredients.find((i) => i.id === l.ingredientId)?.name === "牛肉",
  )!;
  state.lots = Array.from({ length: 12 }, (_, i) => ({
    ...source,
    id: `alert-${i}`,
    expires: "2026-10-17",
  }));
  await page.addInitScript(
    (state) =>
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (name: string) =>
            name === "kitchen_bootstrap" ? state : null,
        },
      }),
    state,
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  const strip = page.locator(".attention-items");
  const previous = page.getByRole("button", { name: "上一张临期食材" });
  await expect(previous).toBeDisabled();
  await page.getByRole("button", { name: "下一张临期食材" }).click();
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(100);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect
    .poll(() => strip.evaluate((el) => el.scrollLeft))
    .toBeLessThan(2);
});

test("default ingredient units respect manual choices and an existing lot can be corrected", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await page.getByRole("button", { name: "食材购买", exact: true }).click();
  const form = page.getByRole("dialog");
  await form.getByLabel("食材名称", { exact: true }).fill("洋葱");
  await expect(form.getByLabel("单位", { exact: true })).toHaveValue("个");
  await form.getByLabel("单位", { exact: true }).selectOption("g");
  await form.getByLabel("食材名称", { exact: true }).fill("青椒");
  await expect(form.getByLabel("单位", { exact: true })).toHaveValue("g");
  await form.getByLabel("食材名称", { exact: true }).fill("洋葱");
  await form.getByLabel("数量", { exact: true }).fill("1");
  await form.getByRole("button", { name: "确认演示购买", exact: true }).click();
  await page.getByRole("button", { name: "查看洋葱批次", exact: true }).click();
  await page.getByLabel("库存单位", { exact: true }).selectOption("个");
  await page.getByLabel("剩余数量（个）", { exact: true }).fill("1");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByLabel("库存单位", { exact: true })).toHaveValue("个");
  await page.screenshot({
    path: "docs/screenshots/ui-kitchen-refinement/unit-correction.png",
  });
});
