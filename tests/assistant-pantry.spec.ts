import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

async function setup(page: Page) {
  const data = initialState();
  data.recipes[0].revisionId = "recipe-revision-test";
  data.recipes[0].requirements.push({
    ingredientId: "salt-fixture",
    quantity: 2,
    unit: "g",
  });
  data.ingredients.push({ id: "salt-fixture", name: "盐", category: "未分类" });
  await page.addInitScript(
    ({ data }) => {
      const w = window as unknown as {
        isTauri: boolean;
        calls: { name: string; args: Record<string, unknown> }[];
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      w.isTauri = true;
      w.calls = [];
      const state = {
        ...data,
        dataRevision: "1",
        seasonings: [
          { id: "盐", name: "盐", missing: false },
          { id: "生抽", name: "生抽", missing: false },
        ],
      };
      let history: unknown = { messages: [], candidates: [], input: "" };
      let search = 0;
      w.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          w.calls.push({ name, args });
          if (name === "kitchen_bootstrap") return state;
          if (name === "kitchen_shopping")
            return {
              weekStart: args.weekStart,
              items: [],
              reviewNotes: [],
              pastPlanCount: 0,
            };
          if (name === "kitchen_ai_history") return history;
          if (name === "kitchen_ai_save_history") {
            history = args.history;
            return null;
          }
          if (name === "kitchen_ai_settings")
            return {
              settings: { provider: "deepseek" },
              configured: ["deepseek"],
            };
          if (name === "kitchen_execute") {
            const c = args.command as {
              type: string;
              name: string;
              missing: boolean;
            };
            if (c.type === "set_seasoning")
              state.seasonings = state.seasonings.map((s) =>
                s.name === c.name ? { ...s, missing: c.missing } : s,
              );
            if (c.type === "remove_seasoning")
              state.seasonings = state.seasonings.filter(
                (s) => s.name !== c.name,
              );
            state.dataRevision = String(Number(state.dataRevision) + 1);
            return null;
          }
          if (name === "kitchen_ai_route") {
            const message =
              (args.messages as { content: string }[]).at(-1)?.content ?? "";
            return message.includes("搜索")
              ? {
                  action: "search",
                  message: "开始搜索",
                  query: "鸡蛋",
                  limit: 10,
                }
              : { action: "none", message: "最新对话：可以先用冰箱里的鸡蛋。" };
          }
          if (name === "kitchen_ai_search")
            return Array.from({ length: 10 }, (_, i) => ({
              id: `${++search}`,
              title: `菜谱${i + 1}`,
              url: `https://www.xiachufang.com/recipe/${i + 1}/`,
              snippet: "用料",
              source: "xiachufang",
              rating: 8,
              madeCount: 100,
              author: "作者",
            }));
          return null;
        },
      };
    },
    { data },
  );
  await page.goto("/");
}
async function send(page: Page, text: string) {
  await page.getByLabel("对厨房助手说").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

test("search results stay with their reply, default to three and respect an explicit count", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await send(page, "搜索番茄炒蛋");
  await expect(page.locator(".recipe-candidate")).toHaveCount(3);
  await send(page, "安排晚餐");
  await expect(page.locator(".assistant-turn").last()).toContainText(
    "最新对话",
  );
  await expect(
    page.locator(".assistant-turn").last().locator(".recipe-candidate"),
  ).toHaveCount(0);
  await send(page, "搜索5道菜");
  await expect(
    page.locator(".assistant-turn").last().locator(".recipe-candidate"),
  ).toHaveCount(5);
  await expect(page.locator(".past-search")).toContainText("此前推荐 · 3 道菜");
  const counts = await page.evaluate(() =>
    (
      window as unknown as {
        calls: { name: string; args: { limit: number } }[];
      }
    ).calls
      .filter((c) => c.name === "kitchen_ai_search")
      .map((c) => c.args.limit),
  );
  expect(counts).toEqual([3, 5]);
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await expect(
    page.locator(".assistant-turn").last().locator(".recipe-candidate"),
  ).toHaveCount(5);
});

for (const width of [1280, 1920])
  test(`pantry sidebar, missing first and reminders ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.getByRole("button", { name: "食材库存", exact: true }).click();
    const sidebar = page.getByRole("region", { name: "调料区" });
    await expect(sidebar).toBeVisible();
    const box = await sidebar.boundingBox();
    expect(box!.width).toBeLessThan(300);
    await page
      .getByRole("button", { name: "生抽标记缺少", exact: true })
      .click();
    await expect(sidebar.locator(".seasoning-row").first()).toContainText(
      "生抽",
    );
    await expect(sidebar.locator(".seasoning-row").first()).toContainText(
      "缺货",
    );
    await page.screenshot({
      path: `docs/screenshots/assistant-pantry/${width}-pantry.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "首页", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "调料采购提醒" }),
    ).toContainText("生抽");
    await page.getByRole("button", { name: /^采购清单/ }).click();
    await expect(
      page.getByRole("region", { name: "调料采购提醒" }),
    ).toContainText("生抽");
    await page.getByRole("button", { name: "生抽已补齐", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "调料采购提醒" }),
    ).toHaveCount(0);
  });

test("recipe editor separates seasonings, allows correction and submits one ingredient row", async ({
  page,
}) => {
  await setup(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: /我的菜谱/ })
    .click();
  await page.locator(".recipe-card").first().locator(".recipe-title").click();
  await page.getByRole("button", { name: "编辑菜谱", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑菜谱", exact: true });
  const spices = editor.locator(".recipe-ingredient-group").filter({
    has: page.getByRole("heading", { name: "调料用量", exact: true }),
  });
  await expect(spices.locator('input[value="盐"]')).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/assistant-pantry/recipe-editor-seasonings.png",
  });
  await spices.getByRole("combobox").selectOption("food");
  await expect(spices.locator('input[value="盐"]')).toHaveCount(0);
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  const command = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: {
            name: string;
            args: {
              command: {
                draft: {
                  ingredientKinds: Record<string, boolean>;
                  ingredients: { name: string }[];
                };
              };
            };
          }[];
        }
      ).calls
        .filter((c) => c.name === "kitchen_execute")
        .at(-1)?.args.command,
  );
  expect(command?.draft.ingredientKinds["盐"]).toBe(false);
  expect(
    command?.draft.ingredients.filter((i) => i.name === "盐"),
  ).toHaveLength(1);
});

test("seasoning warning toggles red with no rail and deletion removes the supply", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "食材库存", exact: true }).click();
  const toggle = page.getByRole("button", { name: "盐标记缺少", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(toggle.locator("svg")).toHaveCount(1);
  await toggle.click();
  const active = page.getByRole("button", { name: "盐已补齐", exact: true });
  await expect(active).toHaveAttribute("aria-pressed", "true");
  await expect(active).toHaveClass(/is-missing/);
  expect(
    await page
      .getByRole("region", { name: "调料区" })
      .locator(".seasoning-row.missing")
      .evaluate((e) => getComputedStyle(e).borderLeftWidth),
  ).toBe("0px");
  await active.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "删除调料盐", exact: true }).click();
  await expect(page.getByRole("region", { name: "调料区" })).not.toContainText(
    "盐",
  );
});
