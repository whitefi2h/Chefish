import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function cookingIPC(page: Page, fail = false, openCooking = true) {
  const state = initialState();
  const recipe = { ...state.recipes[0], revisionId: "rev-cook" };
  state.recipes = [recipe];
  state.dataRevision = "12";
  state.plans = [
    {
      id: "cook-plan",
      recipeId: recipe.id,
      recipeSnapshot: recipe,
      recipeRevisionId: recipe.revisionId,
      day: "2026-10-19",
      meal: "晚餐",
      servings: 2,
      version: 1,
    },
  ];
  await page.addInitScript(
    ({ state, fail }) => {
      const saved =
        JSON.parse(sessionStorage.getItem("cooking-fixture") ?? "null") ??
        state;
      const preview = {
        planVersion: 1,
        revision: "12",
        rows: [
          {
            ingredientId: "beef",
            name: "牛肉",
            unit: "g",
            required: "100",
            missing: "0",
            lots: [
              {
                id: "lot-early",
                version: 1,
                available: "60",
                location: "冷藏",
                expires: "2026-10-22",
                review: false,
                suggested: "60",
              },
              {
                id: "lot-later",
                version: 1,
                available: "80",
                location: "冷冻",
                expires: null,
                review: true,
                suggested: "40",
              },
            ],
          },
        ],
      };
      Object.assign(window, {
        isTauri: true,
        cookingCommands: [],
        __TAURI_INTERNALS__: {
          invoke: async (
            name: string,
            args: {
              command?: {
                type: string;
                draft?: {
                  servings: number;
                  date: string;
                  note: string;
                  consumptions: unknown[];
                };
              };
              servings?: number;
            },
          ) => {
            if (name === "kitchen_bootstrap") return saved;
            if (name === "kitchen_shopping")
              return {
                weekStart: "2026-10-19",
                asOf: "2026-10-19",
                items: [],
                reviewNotes: [],
                pastPlanCount: 0,
              };
            if (name === "kitchen_cooking")
              return {
                ...preview,
                rows: preview.rows.map((r) => ({
                  ...r,
                  required: String((100 * (args.servings ?? 2)) / 2),
                  lots: r.lots.map((l, i) => ({
                    ...l,
                    suggested: String(
                      i === 0
                        ? Math.min(60, 50 * (args.servings ?? 2))
                        : Math.min(
                            80,
                            Math.max(0, 50 * (args.servings ?? 2) - 60),
                          ),
                    ),
                  })),
                })),
              };
            const c = args.command!;
            (
              window as unknown as { cookingCommands: unknown[] }
            ).cookingCommands.push(c);
            if (fail) throw { message: "测试：烹饪保存失败，库存未扣减" };
            if (c.type === "complete_cooking") {
              saved.plans[0].cooking = {
                id: "session",
                date: c.draft!.date,
                servings: c.draft!.servings,
                note: c.draft!.note,
                untracked: true,
                consumptions: [{ name: "牛肉", quantity: "50", unit: "g" }],
              };
              saved.plans[0].version = 2;
            }
            if (c.type === "undo_cooking") {
              saved.plans[0].cooking = null;
              saved.plans[0].version = 3;
            }
            saved.dataRevision = String(Number(saved.dataRevision) + 1);
            sessionStorage.setItem("cooking-fixture", JSON.stringify(saved));
            return null;
          },
        },
      });
    },
    { state, fail },
  );
  await page.goto("/");
  await page.getByLabel("查看指定周").fill("2026-10-19");
  const card = page.getByRole("article", {
    name: `2026-10-19晚餐 · ${recipe.name}`,
  });
  await card.click({ button: "right" });
  await expect(page.getByRole("dialog", { name: "编辑这餐" })).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "完成烹饪" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭面板" }).click();
  const complete = card.getByRole("button", { name: "完成烹饪", exact: true });
  const remove = card.getByRole("button", { name: /移除/ });
  const completeBox = await complete.boundingBox();
  const removeBox = await remove.boundingBox();
  const titleBox = await card.locator("strong").first().boundingBox();
  expect(Math.abs(completeBox!.y - titleBox!.y)).toBeLessThan(10);
  expect(completeBox!.x).toBe(removeBox!.x);
  expect(completeBox!.y + completeBox!.height).toBeLessThanOrEqual(
    removeBox!.y,
  );
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/screenshots/cooking/${page.viewportSize()!.width}-card.png`,
  });
  if (openCooking) await complete.click();
  return recipe;
}
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
])
  test(`cooking confirm and record ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const recipe = await cookingIPC(page);
    await expect(page.getByRole("button", { name: "确认完成" })).toBeEnabled();
    await expect(page.getByLabel("牛肉 lot-early 实际用量")).toHaveValue("60");
    await expect(page.getByLabel("牛肉 lot-later 实际用量")).toHaveValue("40");
    await expect(page.getByLabel("烹饪日期", { exact: true })).toHaveValue(
      "2026-10-19",
    );
    await page.getByLabel("实际人数").fill("4");
    await expect(page.getByText("配方用量 200 g")).toBeVisible();
    await expect(page.getByLabel("牛肉 lot-later 实际用量")).toHaveValue("80");
    await page.getByLabel("牛肉 lot-early 实际用量").fill("50");
    await page.getByLabel("烹饪心得").fill("今天火候正好");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    expect(
      await page
        .locator(".cooking-lot")
        .first()
        .evaluate((e) => getComputedStyle(e).display),
    ).toBe("grid");
    await page.screenshot({
      path: `docs/screenshots/cooking/${width}-confirm.png`,
    });
    const body = page.getByRole("dialog").locator(".dialog-body");
    expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("烹饪心得")).toHaveValue("今天火候正好");
    await page.getByRole("button", { name: "确认完成" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const card = page.getByRole("article", {
      name: `2026-10-19晚餐 · ${recipe.name}`,
    });
    await expect(card).toContainText("已完成");
    await page.reload();
    await page.getByLabel("查看指定周").fill("2026-10-19");
    await card.getByRole("button", { name: "查看烹饪记录" }).click();
    await expect(page.getByRole("dialog")).toContainText("今天火候正好");
    await expect(page.getByRole("dialog")).toContainText("牛肉 · 50 g");
    await page.screenshot({
      path: `docs/screenshots/cooking/${width}-record.png`,
    });
    await page.getByRole("button", { name: "撤销本次烹饪" }).click();
    await expect(card).not.toContainText("已完成");
  });
test("cooking failure retains quantities and note", async ({ page }) => {
  await cookingIPC(page, true);
  await page.getByLabel("牛肉 lot-early 实际用量").fill("12.123456");
  await page.getByLabel("烹饪心得").fill("保留草稿");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.locator(".toast")).toContainText("保存失败");
  await expect(page.getByLabel("牛肉 lot-early 实际用量")).toHaveValue(
    "12.123456",
  );
  await expect(page.getByLabel("烹饪心得")).toHaveValue("保留草稿");
});

test("future plans hide cooking until their scheduled day", async ({
  page,
}) => {
  await cookingIPC(page, false, false);
  await page.clock.install({ time: new Date("2026-10-18T12:00:00") });
  await page.reload();
  await page.getByLabel("查看指定周").fill("2026-10-19");
  const card = page.getByRole("article");
  await expect(
    card.getByRole("button", { name: "完成烹饪", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/cooking/future-hidden.png",
    fullPage: true,
  });
  await page.clock.setSystemTime(new Date("2026-10-19T12:00:00"));
  await page.reload();
  await page.getByLabel("查看指定周").fill("2026-10-19");
  await expect(
    card.getByRole("button", { name: "完成烹饪", exact: true }),
  ).toBeVisible();
});
