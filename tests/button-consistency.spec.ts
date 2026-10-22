import { test, expect, type Locator } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

async function checkActionGroup(group: Locator) {
  const buttons = group.locator(":scope > button");
  await expect(buttons).toHaveCount(2);
  const metrics = await buttons.evaluateAll((items) =>
    items.map((item) => {
      const style = getComputedStyle(item);
      const bounds = item.getBoundingClientRect();
      const icon = item.querySelector("svg")!.getBoundingClientRect();
      return {
        height: bounds.height,
        top: bounds.top,
        font: style.fontSize,
        lineHeight: style.lineHeight,
        radius: style.borderRadius,
        iconWidth: icon.width,
        iconHeight: icon.height,
      };
    }),
  );
  expect(metrics[0]).toEqual(metrics[1]);
  expect(metrics[0].height).toBe(40);
  expect(metrics[0].font).toBe("14px");
  expect(metrics[0].iconWidth).toBe(16);
  expect(metrics[0].iconHeight).toBe(16);
}

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  for (const native of [false, true]) {
    test(`recipe action consistency ${native ? "native IPC fixture" : "demo"} ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      if (native) {
        const state = initialState();
        // This fixture exercises the real native presentation and disabled state,
        // not SQLite persistence, which is covered by Rust / native smoke checks.
        await page.addInitScript((snapshot) => {
          Object.assign(window, {
            isTauri: true,
            __TAURI_INTERNALS__: {
              invoke: async () => snapshot,
            },
          });
        }, state);
      }
      await page.goto("/");
      await page
        .getByRole("navigation")
        .getByRole("button", { name: "我的菜谱" })
        .click();
      const heading = page.locator(".page:visible .page-heading");
      await checkActionGroup(heading.locator(".actions"));
      await expect(heading.locator(".actions .badge")).toHaveCount(0);
      await expect(heading.locator(".page-count")).toContainText("道菜谱");
      const mode = native ? "native-fixture" : "demo";
      await page.screenshot({
        path: `docs/screenshots/button-consistency/${mode}-${width}-recipes.png`,
      });
      await page
        .getByRole("button", { name: "查看香煎黑椒芦笋牛排", exact: true })
        .click();
      await checkActionGroup(page.locator(".detail-actions"));
      await expect(page.locator(".detail-actions .primary")).toBeEnabled();
      await page.screenshot({
        path: `docs/screenshots/button-consistency/${mode}-${width}-detail.png`,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  }
}
