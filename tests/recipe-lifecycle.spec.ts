import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

test("native edit and history failures preserve draft and offer retry", async ({
  page,
}) => {
  const state = initialState();
  state.recipes = state.recipes.map((r) => ({
    ...r,
    revisionId: `rev-${r.id}`,
    revisionNumber: 1,
  }));
  await page.addInitScript((state) => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (name: string) => {
          if (name === "kitchen_execute")
            throw { code: "STALE_REVISION", message: "菜谱已变化，请保留草稿" };
          if (name === "kitchen_recipe_history")
            throw { message: "历史读取失败" };
          if (name === "kitchen_bootstrap") return state;
          throw { message: "未实现测试命令" };
        },
      },
    });
  }, state);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.locator(".recipe-title").first().click();
  await page.getByRole("button", { name: "编辑菜谱", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑菜谱", exact: true });
  await editor.getByLabel("菜谱名称", { exact: true }).fill("保留修改草稿");
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("保留草稿");
  await expect(editor.getByLabel("菜谱名称", { exact: true })).toHaveValue(
    "保留修改草稿",
  );
  await editor.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("历史读取失败");
  await page.getByRole("button", { name: "重试读取" }).click();
  await expect(page.getByRole("alert")).toContainText("历史读取失败");
});

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`recipe lifecycle and visuals ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    const first = page.locator(".recipe-card").first();
    const name = await first.locator(".recipe-title").innerText();
    await first.locator(".recipe-title").click();
    await expect(page.locator(".steps-panel .step h3")).toHaveCount(0);
    await page.getByRole("button", { name: "编辑菜谱", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑菜谱", exact: true });
    await expect(editor.getByLabel("菜谱名称", { exact: true })).toHaveValue(
      name,
    );
    await editor.getByLabel("菜谱名称", { exact: true }).fill("新版·" + name);
    await editor.getByLabel("食材1用量", { exact: true }).fill("0.123456 g");
    await editor.getByLabel("步骤1标题").fill("小火慢煎");
    await editor.getByLabel("步骤1做法").fill("第一行做法。\n第二行做法。");
    for (let i = 0; i < 2; i++) {
      await editor
        .getByRole("button", { name: "添加步骤", exact: true })
        .click();
    }
    await editor.getByLabel("步骤4标题").fill("静置入味");
    await editor.getByLabel("步骤4做法").fill("静置五分钟。");
    await editor.getByLabel("步骤5标题").fill("最后装盘");
    await editor.getByLabel("步骤5做法").fill("撒上葱花。");
    await editor.getByLabel("步骤4标题").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/recipe-lifecycle/${width}-step-editor.png`,
    });
    await editor.locator(".dialog-body").evaluate((el) => (el.scrollTop = 0));
    await page.screenshot({
      path: `docs/screenshots/recipe-lifecycle/${width}-editor.png`,
    });
    await editor.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "新版·" + name, exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ingredients-panel")).toContainText("0.12");
    await expect(
      page
        .locator(".steps-panel")
        .getByRole("heading", { name: "小火慢煎", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".steps-panel")
        .getByRole("heading", { name: "静置入味", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".steps-panel")
        .getByRole("heading", { name: "最后装盘", exact: true }),
    ).toBeVisible();
    await page.locator(".steps-panel").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/recipe-lifecycle/${width}-steps.png`,
    });
    await page.getByRole("button", { name: "历史版本", exact: true }).click();
    const history = page.getByRole("dialog", { name: "菜谱历史版本" });
    await expect(history.getByLabel("查看版本")).toContainText("第 2 版");
    await history.getByLabel("查看版本").selectOption("1");
    await expect(
      history.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/recipe-lifecycle/${width}-history.png`,
    });
    await history.getByRole("button", { name: "用此版本编辑" }).click();
    await expect(editor.getByLabel("菜谱名称", { exact: true })).toHaveValue(
      name,
    );
    await editor.getByRole("button", { name: "关闭面板" }).click();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "删除菜谱" })).toBeVisible();
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "新版·" + name, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "删除", exact: true }).click();
    await page.screenshot({
      path: `docs/screenshots/recipe-lifecycle/${width}-delete.png`,
    });
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(
      page.locator(".recipe-card").filter({ hasText: "新版·" + name }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "已归档", exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".toast")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("same-name JSON import requires an explicit choice", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  const first = page.locator(".recipe-card").first();
  const name = await first.locator(".recipe-title").innerText();
  await page.getByRole("button", { name: "导入菜谱", exact: true }).click();
  await page.getByLabel("菜谱 JSON").fill(
    JSON.stringify({
      name,
      category: "家常菜",
      minutes: 10,
      servings: 2,
      ingredients: [],
      steps: ["轻轻翻炒。"],
    }),
  );
  await page.getByRole("button", { name: "预览导入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认导入", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("导入方式").selectOption({ index: 1 });
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".recipe-card").filter({ hasText: name }),
  ).toHaveCount(1);
  await page.locator(".recipe-card").first().locator(".recipe-title").click();
  await page.getByRole("button", { name: "历史版本", exact: true }).click();
  await expect(page.getByLabel("查看版本")).toContainText("第 2 版");
});
