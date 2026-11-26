import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function cookingIPC(
  page: Page,
  fail = false,
  openCooking = true,
  coarse = false,
) {
  const state = initialState();
  if (coarse)
    state.preferences = { ...state.preferences!, inventoryMode: "rough" };
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
    ({ state, fail, coarse }) => {
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
                ...(coarse ? { measurement: "level", level: 1 } : {}),
                version: 1,
                available: "60",
                location: "冷藏",
                expires: "2026-10-22",
                review: false,
                suggested: "60",
              },
              {
                id: "lot-later",
                ...(coarse ? { measurement: "level", level: 2 } : {}),
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
                  record?: string;
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
            if (name === "kitchen_cooking_interpret")
              return {
                preview,
                quantities: { "lot-early": "25", "lot-later": "0" },
                summary: "牛肉用了25克",
                assumptions: ["少许按25克估计"],
              };
            if (name !== "kitchen_execute") return null;
            const c = args.command!;
            (
              window as unknown as { cookingCommands: unknown[] }
            ).cookingCommands.push(c);
            if (fail) throw { message: "测试：烹饪保存失败，库存未扣减" };
            if (
              c.type === "complete_cooking" ||
              c.type === "complete_level_cooking"
            ) {
              saved.plans[0].cooking = {
                id: "session",
                date: c.draft!.date,
                servings: c.draft!.servings,
                note: c.draft!.note,
                record: c.draft!.record,
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
    { state, fail, coarse },
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
    await page.getByText("手动调整实际用量", { exact: true }).click();
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
    await expect(
      card.getByRole("button", { name: "查看烹饪记录" }),
    ).toHaveClass(/completed/);
    await expect(card).not.toContainText("已完成");
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
  await page.getByText("手动调整实际用量", { exact: true }).click();
  await page.getByLabel("牛肉 lot-early 实际用量").fill("12.123456");
  await page.getByLabel("烹饪心得").fill("保留草稿");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.locator(".toast")).toContainText("保存失败");
  await expect(page.getByLabel("牛肉 lot-early 实际用量")).toHaveValue(
    "12.123456",
  );
  await expect(page.getByLabel("烹饪心得")).toHaveValue("保留草稿");
  await page.screenshot({
    path: "docs/screenshots/ui-coherence/cooking-failure.png",
  });
});

for (const width of [1000, 1440]) {
  test(`cooking AI result typography and expanded quantities ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await cookingIPC(page);
    await page.getByLabel("烹饪记录", { exact: true }).fill("牛肉只用了一点点");
    await page
      .getByRole("button", { name: "AI 整理实际用量", exact: true })
      .click();
    const result = page.locator(".cooking-ai-summary");
    await expect(result).toContainText("牛肉用了25克");
    expect(await result.evaluate((e) => getComputedStyle(e).fontSize)).toBe(
      "14px",
    );
    expect(
      await result
        .locator(".hint")
        .evaluate((e) => getComputedStyle(e).fontSize),
    ).toBe("13px");
    await result.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/ui-coherence/${width}-cooking-ai-result.png`,
    });
    await page.getByText("手动调整实际用量", { exact: true }).click();
    await page.getByLabel("牛肉 lot-later 实际用量").scrollIntoViewIfNeeded();
    const body = page.getByRole("dialog").locator(".dialog-body");
    expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `docs/screenshots/ui-coherence/${width}-cooking-expanded.png`,
    });
  });
}

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

test("written cooking record is interpreted on submit even after opening manual preview", async ({
  page,
}) => {
  const recipe = await cookingIPC(page);
  const manual = page.getByText("手动调整实际用量", { exact: true });
  await manual.click();
  await manual.click();
  await page.getByLabel("烹饪记录", { exact: true }).fill("牛肉只用了一点点");
  await page.getByLabel("烹饪心得").fill("火候正好，下次少放盐");
  await page.screenshot({ path: "docs/screenshots/cooking/text-first.png" });
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          cookingCommands: {
            type: string;
            draft: {
              record: string;
              note: string;
              consumptions: { lot_id: string; quantity: string }[];
            };
          }[];
        }
      ).cookingCommands,
  );
  const done = commands.find((c) => c.type === "complete_cooking")!;
  expect(done.draft.record).toBe("牛肉只用了一点点");
  expect(done.draft.note).toContain("少放盐");
  expect(done.draft.consumptions).toEqual([
    { lot_id: "lot-early", expected_version: 1, quantity: "25" },
  ]);
  const card = page.getByRole("article", {
    name: `2026-10-19晚餐 · ${recipe.name}`,
  });
  await card.getByRole("button", { name: "查看烹饪记录" }).click();
  await expect(page.getByRole("dialog")).toContainText("牛肉只用了一点点");
});

test("failed interpretation still saves written record without deducting suggested stock", async ({
  page,
}) => {
  await cookingIPC(page);
  await page.evaluate(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (name: string, args: unknown) => Promise<unknown>;
      };
    };
    const original = target.__TAURI_INTERNALS__.invoke;
    target.__TAURI_INTERNALS__.invoke = async (name, args) => {
      if (name === "kitchen_cooking_interpret")
        throw { message: "暂未整理出有效用量" };
      return original(name, args);
    };
  });
  await page
    .getByLabel("烹饪记录", { exact: true })
    .fill("排骨用完了，玉米用了一个。");
  await page.getByRole("button", { name: "AI 整理实际用量" }).click();
  await expect(page.getByRole("alert")).toContainText("暂未整理");
  await page.getByRole("button", { name: "确认完成" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          cookingCommands: {
            draft: { record: string; consumptions: unknown[] };
          }[];
        }
      ).cookingCommands,
  );
  expect(commands.at(-1)?.draft.record).toBe("排骨用完了，玉米用了一个。");
  expect(commands.at(-1)?.draft.consumptions).toEqual([]);
});

test("rough cooking uses manual sliders and never calls AI on confirmation", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  const dialog = page.getByRole("dialog", { name: "完成烹饪", exact: true });
  await expect(dialog.getByRole("slider")).toHaveCount(2);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const original = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = (name, args) => {
      if (name === "kitchen_cooking_interpret") throw Error("Must not call AI");
      return original(name, args);
    };
  });
  const slider = dialog.getByRole("slider").first();
  await slider.focus();
  await page.keyboard.press("Home");
  await dialog.getByRole("button", { name: "确认完成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    {
      type: "complete_level_cooking",
      changes: [{ lot_id: "lot-early", expected_version: 1, level: 0 }],
      draft: { consumptions: [] },
    },
  ]);
});

test("AI results cannot overwrite manual levels, including edits made while AI is pending", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
      resolveAI: () => void;
    };
    const original = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (name, args) => {
      if (name !== "kitchen_cooking_interpret") return original(name, args);
      await new Promise<void>((resolve) => {
        t.resolveAI = resolve;
      });
      const preview = (await original("kitchen_cooking", {})) as unknown;
      return {
        preview,
        levels: [
          { lot_id: "lot-early", expected_version: 1, level: -1 },
          { lot_id: "lot-later", expected_version: 1, level: 0 },
        ],
        quantities: {},
        summary: "已整理",
        assumptions: [],
      };
    };
  });
  await page.getByLabel("烹饪记录", { exact: true }).fill("牛肉用完了");
  await page.getByRole("button", { name: "AI 识别剩余情况" }).click();
  const sliders = page.getByRole("slider");
  await sliders.first().focus();
  await page.keyboard.press("End");
  await page.evaluate(() =>
    (window as unknown as { resolveAI: () => void }).resolveAI(),
  );
  await expect(sliders.first()).toHaveAttribute("aria-valuetext", "盈余");
  await expect(sliders.nth(1)).toHaveAttribute("aria-valuetext", "缺乏");
  await page.screenshot({ path: "docs/screenshots/rough-mode/cooking.png" });
});

test("rough completion remains usable after refreshing a changed plan version", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const original = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const r = await original(n, a);
      return n === "kitchen_cooking"
        ? { ...(r as object), planVersion: 2, revision: "13" }
        : r;
    };
  });
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认完成", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "完成烹饪" })).toHaveCount(0);
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    {
      type: "complete_level_cooking",
      draft: { expected_version: 2, expected_revision: "13" },
    },
  ]);
});
test("rough AI preview changes cannot silently upgrade a manual level version", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("Home");
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const original = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      if (n !== "kitchen_cooking_interpret") return original(n, a);
      const p = (await original("kitchen_cooking", {})) as {
        rows: { lots: { version: number }[] }[];
      };
      p.rows[0].lots[0].version = 2;
      return {
        preview: p,
        levels: [],
        quantities: {},
        summary: "已整理",
        assumptions: [],
      };
    };
  });
  await page.getByLabel("烹饪记录", { exact: true }).fill("其他食材未变");
  await page.getByRole("button", { name: "AI 识别剩余情况" }).click();
  await expect(page.getByText("已整理", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认完成", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "保留我的选择" }).click();
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    { changes: [{ lot_id: "lot-early", level: 0, expected_version: 2 }] },
  ]);
});
test("rough save failure retains manual levels and text with an inline retry message", async ({
  page,
}) => {
  await cookingIPC(page, true, true, true);
  await page.getByLabel("烹饪心得").fill("保留我的手记");
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("Home");
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "本次未保存",
  );
  await expect(page.getByLabel("烹饪心得")).toHaveValue("保留我的手记");
  await expect(page.getByRole("slider").first()).toHaveAttribute(
    "aria-valuetext",
    "缺乏",
  );
  await expect(
    page.getByRole("button", { name: "确认完成", exact: true }),
  ).toBeEnabled();
});

test("manual levels for an extra ingredient survive another AI interpretation without crashing save", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const original = t.__TAURI_INTERNALS__.invoke;
    let calls = 0;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      if (n !== "kitchen_cooking_interpret") return original(n, a);
      calls++;
      const p = (await original("kitchen_cooking", {})) as {
        rows: {
          ingredientId: string;
          name: string;
          unit: string;
          required: string;
          missing: string;
          lots: {
            id: string;
            version: number;
            level: number;
            stockRevision?: string;
          }[];
        }[];
      };
      if (calls === 1)
        p.rows.push({
          ...p.rows[0],
          ingredientId: "corn",
          name: "玉米",
          lots: [
            { ...p.rows[0].lots[0], id: "extra-corn", version: 7, level: 1 },
          ],
        });
      return {
        preview: p,
        levels:
          calls === 1
            ? [{ lot_id: "extra-corn", expected_version: 7, level: 0 }]
            : [],
        quantities: {},
        summary: `整理${calls}`,
        assumptions: [],
      };
    };
  });
  await page.getByLabel("烹饪记录", { exact: true }).fill("玉米只剩一点");
  await page.getByRole("button", { name: "AI 识别剩余情况" }).click();
  const slider = page.getByRole("slider", { name: "玉米存量" });
  await slider.focus();
  await page.keyboard.press("End");
  await page.getByRole("button", { name: "AI 识别剩余情况" }).click();
  await expect(page.getByText("整理2", { exact: true })).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "盈余");
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "完成烹饪" })).toHaveCount(0);
  const commands = await page.evaluate(
    () =>
      (window as unknown as { cookingCommands: { changes: unknown[] }[] })
        .cookingCommands,
  );
  expect(commands[0].changes).toContainEqual({
    lot_id: "extra-corn",
    level: 2,
    expected_version: 7,
  });
});

test("refreshing rough suggestions ignores a late AI response", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
      releaseCookingAI: () => void;
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      if (n !== "kitchen_cooking_interpret") return old(n, a);
      await new Promise<void>((resolve) => {
        t.releaseCookingAI = resolve;
      });
      return {
        preview: await old("kitchen_cooking", {}),
        levels: [{ lot_id: "lot-early", expected_version: 1, level: -1 }],
        quantities: {},
        summary: "过时的识别结果",
        assumptions: [],
      };
    };
  });
  await page.getByLabel("烹饪记录", { exact: true }).fill("牛肉用完了");
  await page.getByRole("button", { name: "AI 识别剩余情况" }).click();
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("End");
  await page.evaluate(() =>
    (window as unknown as { releaseCookingAI: () => void }).releaseCookingAI(),
  );
  await expect(page.getByRole("slider").first()).toHaveAttribute(
    "aria-valuetext",
    "盈余",
  );
  await expect(page.getByText("过时的识别结果", { exact: true })).toHaveCount(
    0,
  );
});
test("repeated rough completion submission saves only once", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("form.cooking-form")!;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByRole("dialog", { name: "完成烹饪" })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
    ),
  ).toHaveLength(1);
});

test("refresh preserves selected rough level and record", async ({ page }) => {
  await cookingIPC(page, false, true, true);
  await page.getByLabel("烹饪记录", { exact: true }).fill("保留我的文字");
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("Home");
  await expect(page.getByRole("slider").first()).toHaveAttribute(
    "aria-valuetext",
    "缺乏",
  );
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await expect(page.getByRole("slider").first()).toHaveAttribute(
    "aria-valuetext",
    "缺乏",
  );
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () =>
      (
        window as unknown as {
          cookingCommands: { changes: unknown[]; draft: { record: string } }[];
        }
      ).cookingCommands,
  );
  expect(commands[0].changes).toEqual([
    { lot_id: "lot-early", expected_version: 1, level: 0 },
  ]);
  expect(commands[0].draft.record).toBe("保留我的文字");
});
test("exact cooking preserves qualitative batches without displaying false zero quantities", async ({
  page,
}) => {
  await cookingIPC(page, false, true, false);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const p = await old(n, a);
      if (n !== "kitchen_cooking") return p;
      const preview = p as { rows: { lots: unknown[] }[] };
      preview.rows[0].lots = [
        {
          id: "rough",
          version: 1,
          available: "0",
          suggested: "0",
          unit: "g",
          factor: "1",
          measurement: "level",
          level: 2,
          location: "冷藏",
          expires: null,
          review: false,
        },
      ];
      return preview;
    };
  });
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await page.getByText("手动调整实际用量", { exact: true }).click();
  await expect(
    page.getByLabel("牛肉 rough 实际用量", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("仍按档位记录 · 盈余", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "补填当前数量" }),
  ).toBeVisible();
});

test("refresh keeps changed stock choices pending until explicitly reviewed", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const p = await old(n, a);
      if (n === "kitchen_cooking")
        (
          p as { rows: { lots: { stockRevision: string }[] }[] }
        ).rows[0].lots[0].stockRevision = '["level",1,2]';
      return p;
    };
  });
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("Home");
  await page.evaluate(() => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const p = await old(n, a);
      if (n === "kitchen_cooking")
        (
          p as {
            rows: {
              lots: {
                version: number;
                level: number;
                stockRevision?: string;
              }[];
            }[];
          }
        ).rows[0].lots[0] = {
          ...(
            p as {
              rows: {
                lots: {
                  version: number;
                  level: number;
                  stockRevision?: string;
                }[];
              }[];
            }
          ).rows[0].lots[0],
          version: 1,
          level: 2,
          stockRevision: '["level",2,2]',
        };
      return p;
    };
  });
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await expect(
    page.getByText("牛肉的库存已变化，请核对。你的选择仍保留。"),
  ).toBeVisible();
  await expect(page.getByRole("slider").first()).toHaveAttribute(
    "aria-valuetext",
    "缺乏",
  );
  await expect(
    page.getByRole("button", { name: "确认完成", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "review/rough-compat-stock-conflict.png" });
  await page.getByRole("button", { name: "保留我的选择" }).click();
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    {
      changes: [
        {
          lot_id: "lot-early",
          level: 0,
          expected_version: 1,
          expected_stock_revision: '["level",2,2]',
        },
      ],
    },
  ]);
});

test("exact cooking can refill a qualitative batch without losing the cooking record", async ({
  page,
}) => {
  await cookingIPC(page);
  await page.getByLabel("烹饪记录", { exact: true }).fill("保留我的记录");
  await page.evaluate(async () => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    const snapshot = (await old("kitchen_bootstrap", {})) as {
      lots: {
        id: string;
        measurement: string;
        level: number;
        quantity: string;
        unit: string;
        version: number;
      }[];
    };
    const lot = snapshot.lots.find((l) => l.id === "beef-1")!;
    lot.measurement = "level";
    lot.level = 2;
    lot.quantity = "0";
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const command = (
        a as { command?: { type: string; draft: { quantity: string } } }
      )?.command;
      if (n === "kitchen_execute" && command?.type === "edit_lot") {
        lot.measurement = "exact";
        lot.quantity = command.draft.quantity;
        lot.version = 2;
      }
      const p = await old(n, a);
      if (n === "kitchen_cooking")
        (p as { rows: { lots: unknown[] }[] }).rows[0].lots = [
          {
            id: lot.id,
            version: lot.version ?? 1,
            available: lot.quantity,
            suggested: "0",
            measurement: lot.measurement,
            level: lot.level,
            unit: "g",
            location: "冷藏",
            expires: null,
            review: false,
          },
        ];
      return p;
    };
    window.dispatchEvent(new Event("chefish:sync-data"));
  });
  await page.getByRole("button", { name: "刷新建议", exact: true }).click();
  await page.getByText("手动调整实际用量", { exact: true }).click();
  await page.getByRole("button", { name: "补填当前数量" }).click();
  const detail = page.getByRole("dialog", { name: "食材详情 · 牛肉" });
  await detail.getByLabel("剩余数量", { exact: false }).fill("300");
  await detail.getByRole("button", { name: "保存修改" }).click();
  await expect(detail.getByLabel("剩余数量", { exact: false })).toHaveValue(
    "300",
  );
  await detail.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByLabel("烹饪记录", { exact: true })).toHaveValue(
    "保留我的记录",
  );
  await expect(
    page.getByLabel("牛肉 beef-1 实际用量", { exact: true }),
  ).toHaveAttribute("max", "300");
  await page.getByLabel("牛肉 beef-1 实际用量", { exact: true }).fill("50");
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    { type: "edit_lot" },
    {
      type: "complete_cooking",
      draft: {
        record: "保留我的记录",
        consumptions: [
          { lot_id: "beef-1", expected_version: 2, quantity: "50" },
        ],
      },
    },
  ]);
});

test("background removal drops obsolete cooking controls but keeps the written record", async ({
  page,
}) => {
  await cookingIPC(page, false, true, true);
  await page.getByLabel("烹饪记录", { exact: true }).fill("保留记录");
  await page.getByRole("slider").first().focus();
  await page.keyboard.press("Home");
  await page.evaluate(async () => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const old = t.__TAURI_INTERNALS__.invoke;
    t.__TAURI_INTERNALS__.invoke = async (n, a) => {
      const p = await old(n, a);
      return n === "kitchen_cooking" ? { ...(p as object), rows: [] } : p;
    };
    const s = (await old("kitchen_bootstrap", {})) as { dataRevision: string };
    s.dataRevision = "13";
    window.dispatchEvent(new Event("chefish:sync-data"));
  });
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByLabel("烹饪记录", { exact: true })).toHaveValue(
    "保留记录",
  );
  await expect(
    page.getByRole("button", { name: "确认完成", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([
    { changes: [], draft: { record: "保留记录" } },
  ]);
});

test("exact cooking removes depleted batches on background refresh", async ({
  page,
}) => {
  await cookingIPC(page);
  await page.getByText("手动调整实际用量").click();
  const amount = page.getByLabel("牛肉 lot-early 实际用量");
  await expect(amount).toBeVisible();
  await amount.fill("25");
  await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, args: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = async (command, args) => {
      const result = await invoke(command, args);
      return command === "kitchen_cooking"
        ? {
            ...(result as object),
            rows: [
              {
                ingredientId: "beef",
                name: "牛肉",
                unit: "g",
                required: "100",
                missing: "100",
                lots: [],
              },
            ],
          }
        : result;
    };
    const state = (await invoke("kitchen_bootstrap", {})) as {
      dataRevision: string;
    };
    state.dataRevision = "13";
    window.dispatchEvent(new Event("chefish:sync-data"));
  });
  await expect(amount).toHaveCount(0);
  await page.getByRole("button", { name: "确认完成", exact: true }).click();
  const commands = await page.evaluate(
    () => (window as unknown as { cookingCommands: unknown[] }).cookingCommands,
  );
  expect(commands).toMatchObject([{ draft: { consumptions: [] } }]);
});
