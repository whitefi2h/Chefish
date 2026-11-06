import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

test("home and inventory share reminder scope, count and expiry order after inventory changes", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-05T12:00:00+08:00"));
  const state = initialState();
  const rows = [
    ["牛奶", "2026-10-29", 1],
    ["彩椒", "2026-11-05", 1],
    ["青蒜", "2026-11-01", 250],
    ["洋葱", "2026-10-31", 1],
    ["小米辣", "2026-10-31", 45],
    ["柠檬", "2026-11-02", 1.75],
    ["猕猴桃", "2026-11-04", 2],
    ["奶酪", "2026-10-28", 0],
    ["苹果", "2026-11-20", 1],
    ["盐", "2026-10-28", 1],
  ] as const;
  state.ingredients = rows.map(([name], i) => ({
    ...state.ingredients[0],
    id: `ingredient-${i}`,
    name,
  }));
  state.lots = rows.map(([, expires, quantity], i) => ({
    ...state.lots[0],
    id: `lot-${i}`,
    ingredientId: `ingredient-${i}`,
    expires,
    quantity,
    version: 1,
  }));
  state.seasonings = [{ id: "milk", name: "牛奶", missing: false }];
  state.plans = [];
  await page.addInitScript((state) => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (
          name: string,
          args: { command?: { lot_id: string; quantity: string } } = {},
        ) => {
          if (name === "kitchen_bootstrap") return structuredClone(state);
          if (name === "kitchen_execute") {
            const lot = state.lots.find((l) => l.id === args.command!.lot_id)!;
            lot.quantity = Number(args.command!.quantity);
            lot.version = (lot.version ?? 1) + 1;
            return null;
          }
          if (name === "kitchen_shopping")
            return { items: [], reviewNotes: [], pastPlanCount: 0 };
          return null;
        },
      },
    });
  }, state);
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "全局导航" });
  await nav.getByRole("button", { name: "首页", exact: true }).click();
  const home = page.locator(".dashboard-alert");
  await expect(home).toContainText("6 个提醒");
  await expect(home).not.toContainText("牛奶");
  await expect(home.locator(".inventory-ingredient")).toContainText([
    "洋葱",
    "小米辣",
    "青蒜",
  ]);
  await page.screenshot({
    path: "docs/screenshots/inventory/alerts-home-consistent.png",
  });
  await home.getByRole("button", { name: "查看食材库存" }).click();
  const attention = page.getByRole("region", { name: "需要关注" });
  await expect(attention.locator("h3, h2").first()).toContainText("6");
  await expect(attention.locator(".attention-item strong")).toHaveText([
    "洋葱",
    "小米辣",
    "青蒜",
    "柠檬",
    "猕猴桃",
    "彩椒",
  ]);
  await expect(page.locator("tbody")).not.toContainText("牛奶");
  await page.screenshot({
    path: "docs/screenshots/inventory/alerts-inventory-consistent.png",
  });
  // Setting an active batch to zero must remove its reminder on both pages.
  const quantity = page.getByLabel("洋葱剩余数量");
  await quantity.fill("0");
  await quantity.press("Enter");
  await expect(attention.locator(".attention-item strong")).not.toContainText([
    "洋葱",
  ]);
  await nav.getByRole("button", { name: "首页", exact: true }).click();
  await expect(home).toContainText("5 个提醒");
  await expect(home.locator(".inventory-ingredient")).toContainText([
    "小米辣",
    "青蒜",
    "柠檬",
  ]);
});
