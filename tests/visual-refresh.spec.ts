import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

const screenshots = `docs/screenshots/${process.env.CHEFISH_VISUAL_SUITE ?? "ui-refresh"}`;

for (const width of [1000, 1280, 1440, 1920]) {
  test(`visual surfaces preserve layout and controls ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const folder = process.env.CHEFISH_VISUAL_BASELINE ? "before" : "after";
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${screenshots}/${folder}/${width}-${name}.png`,
      });
    };
    const go = async (name: string) =>
      page
        .getByRole("navigation", { name: "全局导航" })
        .getByRole("button", { name, exact: false })
        .click();
    await go("首页");
    await shot("home");
    await go("我的菜谱");
    await expect(page.locator(".recipe-card").first()).toBeVisible();
    await shot("recipes");
    await page.locator(".recipe-title").first().click();
    await expect(page.locator(".ingredients-panel")).toBeVisible();
    await shot("recipe-detail");
    await go("食材库存");
    await expect(page.locator(".inventory-table")).toBeVisible();
    expect(
      (await page.locator(".lot-quantity").first().boundingBox())!.width,
    ).toBeLessThanOrEqual(126);
    await shot("inventory");
    await go("每周菜单");
    await expect(page.locator(".calendar")).toBeVisible();
    await shot("planner");
    await go("采购清单");
    await shot("shopping");
    await page.getByRole("button", { name: "打开厨房设置" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await shot("settings");
    await page.getByRole("button", { name: "关闭面板", exact: true }).click();
    await go("我的菜谱");
    await page.getByLabel("搜索我的菜谱").fill("没有此道菜的空状态");
    await expect(page.locator(".recipe-card")).toHaveCount(0);
    await shot("empty-recipes");
  });
}

for (const width of [1000, 1920]) {
  test(`long names, missing covers and keyboard focus ${width}`, async ({
    page,
  }) => {
    const snapshot = initialState();
    snapshot.recipes[0].name =
      "香煎黑椒芦笋牛排搭配蘑菇洋葱和自制香草酱汁的周末晚餐";
    snapshot.recipes[0].image = "missing-cover-for-visual-qa";
    await page.addInitScript((state) => {
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (name: string) =>
            name === "kitchen_bootstrap" ? state : null,
        },
      });
    }, snapshot);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    const card = page.locator(".recipe-card").first();
    await expect(card.locator(".food")).toHaveAttribute(
      "src",
      "/food/placeholder.svg",
    );
    expect(await card.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    const search = page.getByLabel("搜索我的菜谱");
    await search.focus();
    await page.keyboard.press("Tab");
    expect(
      await page
        .locator(":focus")
        .evaluate((e) => getComputedStyle(e).outlineStyle),
    ).toBe("solid");
    await page.screenshot({
      path: `${screenshots}/after/${width}-long-name-fallback.png`,
    });
    await page.setViewportSize({ width, height: 600 });
    await expect(
      page.getByRole("button", { name: "打开厨房设置" }),
    ).toBeInViewport();
    await page.getByRole("button", { name: "打开厨房设置" }).click();
    await expect(
      page.getByRole("button", { name: "保存设置", exact: true }),
    ).toBeInViewport();
    await page.getByRole("tab", { name: "用餐与偏好" }).press("Tab");
    expect(
      await page
        .locator(":focus")
        .evaluate((e) => getComputedStyle(e).outlineColor),
    ).toBe("rgb(207, 72, 24)");
  });
}
