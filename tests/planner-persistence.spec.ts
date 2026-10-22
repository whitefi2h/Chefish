import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function plannerIPC(
  page: Page,
  fail = false,
  existing = false,
  delay = 0,
) {
  const state = initialState();
  state.plans = [];
  state.recipes = state.recipes.map((r) => ({
    ...r,
    revisionId: `revision-${r.id}`,
  }));
  if (existing)
    state.plans = [
      {
        id: "plan-existing",
        recipeId: state.recipes[0].id,
        recipeRevisionId: state.recipes[0].revisionId,
        recipeSnapshot: state.recipes[0],
        day: "2026-12-28",
        meal: "早餐",
        servings: 2,
        version: 1,
      },
    ];
  await page.addInitScript(
    ({ state, fail, delay }) => {
      const snapshot =
        JSON.parse(sessionStorage.getItem("planner-fixture") ?? "null") ??
        state;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            name: string,
            args: {
              command: {
                type: string;
                plan_id: string | null;
                expected_version: number | null;
                draft: {
                  recipe_revision_id: string | null;
                  custom_title: string | null;
                  day: string;
                  meal: string;
                  servings: number;
                };
              };
              requestId: string;
            },
          ) => {
            if (name === "kitchen_execute") {
              if (fail)
                throw { code: "DATABASE_BUSY", message: "测试：菜单保存失败" };
              if (delay)
                await new Promise((resolve) => setTimeout(resolve, delay));
              const c = args.command;
              const index = snapshot.plans.findIndex(
                (p: { id: string }) => p.id === c.plan_id,
              );
              if (c.type === "remove_plan") snapshot.plans.splice(index, 1);
              if (c.type === "save_plan") {
                const recipe = snapshot.recipes.find(
                  (r: { revisionId: string }) =>
                    r.revisionId === c.draft.recipe_revision_id,
                );
                const plan = {
                  id: c.plan_id ?? args.requestId,
                  recipeId: recipe?.id ?? "",
                  recipeRevisionId: c.draft.recipe_revision_id,
                  recipeSnapshot: recipe,
                  customTitle: c.draft.custom_title,
                  day: c.draft.day,
                  meal: c.draft.meal,
                  servings: c.draft.servings,
                  version: (index >= 0 ? snapshot.plans[index].version : 0) + 1,
                };
                if (index >= 0) snapshot.plans[index] = plan;
                else snapshot.plans.push(plan);
              }
              sessionStorage.setItem(
                "planner-fixture",
                JSON.stringify(snapshot),
              );
              return null;
            }
            return snapshot;
          },
        },
      });
    },
    { state, fail, delay },
  );
  await page.goto("/");
  await page.getByLabel("查看指定周").fill("2026-12-28");
}
async function addCustom(page: Page, title: string) {
  await page.getByRole("button", { name: "安排一餐", exact: true }).click();
  await page.getByLabel("选择菜谱", { exact: true }).selectOption("__custom");
  await page.getByLabel("菜名", { exact: true }).fill(title);
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
}
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`native planner multiple dishes and visual acceptance ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await plannerIPC(page);
    await expect(page.locator(".pool-card button")).toHaveCount(0);
    await page.getByRole("button", { name: "安排一餐", exact: true }).click();
    await page.getByRole("button", { name: "确认安排", exact: true }).click();
    await addCustom(page, "清炒时蔬 · 临时配餐");
    const slot = page.locator('[data-slot="2026-12-28|晚餐"]');
    // Check immediately: waiting for disappearance would hide the return animation.
    expect(await page.locator(".drag-preview").count()).toBe(0);
    await expect(slot.locator(".planned-card")).toHaveCount(2);
    await expect(slot).toContainText("清炒时蔬");
    await expect(page.getByRole("button", { name: /编辑.*晚餐/ })).toHaveCount(
      0,
    );
    const title = slot.locator(".planned-card strong").first();
    expect((await title.boundingBox())!.height).toBeLessThan(32);
    await slot.locator(".planned-card .draggable").first().focus();
    await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("dialog")).toContainText("编辑这餐");
    await page.getByRole("button", { name: "关闭面板" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `docs/screenshots/planner-m3/${width}-planner.png`,
      fullPage: true,
    });
    await slot.locator(".planned-card").last().click({ button: "right" });
    await expect(page.getByLabel("菜名", { exact: true })).toHaveValue(
      "清炒时蔬 · 临时配餐",
    );
    await expect(page.getByRole("dialog").locator(".dialog-body")).toHaveCSS(
      "scrollbar-width",
      "none",
    );
    expect(
      await page
        .getByRole("dialog")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/planner-m3/${width}-form.png`,
    });
    await page.getByLabel("跳转配餐周").fill("2027-01-05");
    await page.getByRole("button", { name: "确认安排", exact: true }).click();
    await expect(slot.locator(".planned-card")).toHaveCount(1);
    await page.reload();
    await page.getByLabel("查看指定周").fill("2027-01-05");
    const target = page.locator('[data-slot="2027-01-05|晚餐"]');
    await expect(target).toContainText("清炒时蔬");
    await target.getByRole("button", { name: /移除/ }).click();
    await expect(target.locator(".planned-card")).toHaveCount(0);
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    await expect(page.locator(".recipe-card")).toHaveCount(6);
  });
}
test("native planner failed save retains draft and failed drag keeps original card", async ({
  page,
}) => {
  await plannerIPC(page, true, true);
  await addCustom(page, "保留这份草稿");
  await expect(page.locator(".toast")).toContainText("菜单保存失败");
  await expect(page.getByLabel("菜名", { exact: true })).toHaveValue(
    "保留这份草稿",
  );
  await expect(page.locator(".planned-card")).toHaveCount(1);
  await page.getByRole("button", { name: "关闭面板" }).click();
  const origin = page.locator(".planned-card .draggable").first();
  const dest = page.locator('[data-slot="2026-12-29|早餐"]');
  await origin.scrollIntoViewIfNeeded();
  const a = (await origin.boundingBox())!;
  const b = (await dest.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect(page.locator(".toast")).toContainText("菜单保存失败");
  await expect(page.locator(".planned-card")).toHaveCount(1);
  await expect(
    page.locator('[data-slot="2026-12-28|早餐"] .planned-card'),
  ).toHaveCount(1);
  await expect(dest.locator(".planned-card")).toHaveCount(0);
});

test("native pointer drop appends to occupied meal and moves one dish durably", async ({
  page,
}) => {
  await plannerIPC(page, false, true, 150);
  const slot = page.locator('[data-slot="2026-12-28|早餐"]');
  const origin = page.locator(".pool-card .draggable").first();
  const a = (await origin.boundingBox())!;
  const b = (await slot.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".drag-preview")).toBeVisible();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  // Check immediately: waiting for disappearance would hide the return animation.
  expect(await page.locator(".drag-preview").count()).toBe(0);
  await expect(slot.locator(".planned-card")).toHaveCount(2);
  const card = slot.locator(".draggable").last();
  const target = page.locator('[data-slot="2026-12-29|早餐"]');
  await card.scrollIntoViewIfNeeded();
  const c = (await card.boundingBox())!;
  const d = (await target.boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(c.x + c.width / 2 + 12, c.y + c.height / 2, {
    steps: 3,
  });
  await expect(page.locator(".drag-preview")).toBeVisible();
  await page.mouse.move(d.x + d.width / 2, c.y + c.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(await page.locator(".drag-preview").count()).toBe(0);
  await expect(slot.locator(".planned-card")).toHaveCount(1);
  await expect(target.locator(".planned-card")).toHaveCount(1);
  await page.screenshot({
    path: "docs/screenshots/planner-m3/drop-without-return.png",
  });
  await page.reload();
  await page.getByLabel("查看指定周").fill("2026-12-28");
  await expect(target.locator(".planned-card")).toHaveCount(1);
});
