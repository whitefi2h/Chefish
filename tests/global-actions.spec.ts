import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import { preferencesOf } from "../src/domain/preferences";
test.use({ timezoneId: "Asia/Shanghai" });

test("global undo works across pages while text Ctrl Z keeps its native behavior", async ({
  page,
}) => {
  const state = initialState();
  state.dataRevision = "10";
  state.lots[0].version = 1;
  await page.addInitScript((state) => {
    const original = structuredClone(state);
    const calls: string[] = [];
    Object.assign(window, {
      isTauri: true,
      undoCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (
          name: string,
          args: {
            command?: {
              type: string;
              lot_id: string;
              quantity: string;
              expected_version: number;
            };
          } = {},
        ) => {
          if (name === "kitchen_bootstrap") return structuredClone(state);
          if (name === "kitchen_execute") {
            const c = args.command!;
            calls.push(c.type);
            if (c.type === "undo") {
              state.lots = original.lots;
              state.undo = null;
              state.dataRevision = "12";
              return null;
            }
            const base = state.dataRevision!;
            const lot = state.lots.find((l) => l.id === c.lot_id)!;
            lot.quantity = Number(c.quantity);
            lot.version = c.expected_version + 1;
            state.dataRevision = String(Number(base) + 1);
            state.undo = {
              operationId: "00000000-0000-4000-8000-000000000001",
              label: "调整库存",
            };
            return {
              baseRevision: base,
              dataRevision: state.dataRevision,
              lots: state.lots.map((l) => ({
                ...l,
                quantity: String(l.quantity),
              })),
              inventoryEvents: [],
              undo: state.undo,
            };
          }
          return null;
        },
      },
    });
  }, state);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await page
    .getByRole("button", { name: "增加牛肉数量", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "撤销上一步", exact: true }),
  ).toBeEnabled();
  const search = page.getByPlaceholder(/搜索食材名称/);
  await search.fill("文字");
  await search.press("Control+z");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { undoCalls: string[] }).undoCalls.filter(
          (c) => c === "undo",
        ).length,
    ),
  ).toBe(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "采购清单" })
    .click();
  await page.keyboard.press("Control+z");
  await expect(
    page.getByRole("button", { name: "撤销上一步", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await search.fill("");
  await expect(page.getByLabel("牛肉剩余数量").first()).toHaveValue("400");
});

test("home next meal uses local time and excludes cooked dishes", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-26T11:30:00+08:00") });
  const state = initialState();
  state.preferences = {
    ...preferencesOf(state.preferences),
    startPage: "home",
  };
  state.plans = state.recipes.slice(0, 3).map((r, i) => ({
    id: `next-${i}`,
    recipeId: r.id,
    day: "2026-10-26",
    meal: (["早餐", "午餐", "晚餐"] as const)[i],
    servings: 2,
    cooking:
      i === 1
        ? {
            id: "done",
            date: "2026-10-26",
            servings: 2,
            note: "",
            untracked: false,
          }
        : null,
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
  await page.goto("/");
  await expect(page.locator(".next-meal h2")).toHaveText(state.recipes[2].name);
  await expect(page.locator(".next-meal")).toContainText("下一餐 · 晚餐");
});
