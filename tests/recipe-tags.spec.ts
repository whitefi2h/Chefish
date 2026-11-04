import { test, expect, type Page } from "@playwright/test";
async function library(page: Page) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
}
test("controlled catalog defaults, bulk switches, custom tags, delete and undo", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理菜谱标签" });
  await expect(
    manager.getByRole("button", { name: "展开中餐", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(
    manager.getByRole("button", { name: "展开西餐", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await manager.getByLabel("标签显示状态").selectOption("on");
  await expect(manager.locator(".tag-catalog-row")).toHaveCount(2);
  await manager.getByLabel("标签显示状态").selectOption("all");
  await manager.getByLabel("搜索标签目录").fill("川菜");
  await manager.getByLabel("选择当前结果").check();
  await manager.getByRole("button", { name: "开启", exact: true }).click();
  await expect(
    manager.getByRole("button", { name: "关闭标签川菜", exact: true }),
  ).toBeVisible();
  await manager.getByRole("button", { name: "添加标签", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加标签", exact: true });
  await editor.getByLabel("标签名称", { exact: true }).fill("工作日偏爱");
  await editor.getByLabel("标签类型", { exact: true }).selectOption("trait");
  await editor.getByRole("button", { name: "保存标签", exact: true }).click();
  await manager.getByRole("button", { name: /^菜品特性/ }).click();
  await manager.getByLabel("搜索标签目录").fill("工作日偏爱");
  await expect(manager.locator(".tag-catalog-row")).toHaveCount(1);
  await manager.getByLabel("选择当前结果").check();
  await manager.getByRole("button", { name: "删除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "删除所选标签？" })
    .getByRole("button", { name: "确认删除" })
    .click();
  await expect(manager.locator(".tag-catalog-row")).toHaveCount(0);
  await manager.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  await manager.getByRole("button", { name: /^菜品特性/ }).click();
  await manager.getByLabel("搜索标签目录").fill("工作日偏爱");
  await expect(manager.locator(".tag-catalog-row")).toHaveCount(1);
  await page.screenshot({ path: "docs/screenshots/recipe-tags/manager.png" });
});
test("recipe facets combine across groups and hidden child labels retain their parent", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理菜谱标签" });
  await manager.getByLabel("搜索标签目录").fill("川菜");
  await manager
    .getByRole("button", { name: "开启标签川菜", exact: true })
    .click();
  await manager.getByRole("button", { name: "关闭面板" }).click();
  const card = page.locator(".recipe-card").first();
  const name = await card.locator(".recipe-title").innerText();
  await card.locator(".recipe-title").click();
  await page.getByRole("button", { name: "编辑标签", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑菜谱标签" });
  for (const name of ["川菜", "快手菜", "煎"])
    await editor.getByRole("button", { name, exact: true }).click();
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "返回菜谱库", exact: true }).click();
  await page
    .locator(".tag-filter-controls")
    .getByRole("button", { name: "菜系", exact: true })
    .click();
  await page
    .locator(".tag-filter-popover")
    .getByRole("button", { name: "中餐", exact: true })
    .click();
  await page
    .locator(".tag-filter-controls")
    .getByRole("button", { name: "菜品特性", exact: true })
    .click();
  await page
    .locator(".tag-filter-popover")
    .getByRole("button", { name: "快手菜", exact: true })
    .click();
  await page
    .locator(".tag-filter-controls")
    .getByRole("button", { name: "烹饪方法", exact: true })
    .click();
  await page
    .locator(".tag-filter-popover")
    .getByRole("button", { name: "煎", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".recipe-card:visible")).toHaveCount(1);
  await expect(card).toContainText(name);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  await manager.getByLabel("搜索标签目录").fill("川菜");
  await manager
    .getByRole("button", { name: "关闭标签川菜", exact: true })
    .click();
  await manager.getByRole("button", { name: "关闭面板" }).click();
  await expect(card.locator(".recipe-tag-badges")).toContainText("中餐");
  await card.locator(".recipe-title").click();
  await expect(page.locator(".recipe-detail-tags")).toContainText("川菜未显示");
  await page.screenshot({
    path: "docs/screenshots/recipe-tags/recipe-detail.png",
  });
});
test("editor keeps its save action visible while its long content scrolls", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "创建菜谱", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("菜谱名称", { exact: true }).fill("标签检验菜谱");
  await editor.getByRole("button", { name: "中餐", exact: true }).click();
  await editor.getByRole("button", { name: "快手菜", exact: true }).click();
  await editor.getByLabel("食材1名称").fill("番茄");
  await editor.getByLabel("步骤1做法").fill("切块炒熟。".repeat(50));
  await editor.getByLabel("步骤1做法").scrollIntoViewIfNeeded();
  const save = editor.getByRole("button", {
    name: "创建演示菜谱",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await page.screenshot({
    path: "docs/screenshots/recipe-tags/editor-scrolled.png",
  });
  await save.click();
  const card = page.locator(".recipe-card").filter({ hasText: "标签检验菜谱" });
  await expect(card.locator(".recipe-tag-badges")).toContainText("中餐");
  await expect(card.locator(".recipe-tag-badges")).toContainText("快手菜");
});

test("unmapped legacy categories stay reviewable and can be assigned then undone", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "管理菜谱标签" });
  await manager.getByRole("button", { name: "待整理 2", exact: true }).click();
  await manager
    .locator(".tag-legacy-row")
    .filter({ hasText: "轻食沙拉" })
    .getByRole("button", { name: "归入标签" })
    .click();
  const resolve = page.getByRole("dialog", { name: "整理“轻食沙拉”" });
  await resolve
    .getByLabel("归入标签", { exact: true })
    .selectOption("trait.quick");
  await resolve.getByRole("button", { name: "归入所选标签" }).click();
  await expect(
    manager.getByRole("button", { name: "待整理 1", exact: true }),
  ).toBeVisible();
  await manager.getByRole("button", { name: "关闭面板" }).click();
  const card = page
    .locator(".recipe-card")
    .filter({ hasText: "地中海三文鱼温沙拉" });
  await expect(card.locator(".recipe-tag-badges")).toContainText("快手菜");
  await page.getByRole("button", { name: "撤销上一步", exact: true }).click();
  await expect(card.locator(".recipe-tag-badges")).not.toContainText("快手菜");
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  await expect(
    manager.getByRole("button", { name: "待整理 2", exact: true }),
  ).toBeVisible();
});

test("tag tree supports branch selection, inversion and simple parent checkboxes", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const m = page.getByRole("dialog", { name: "管理菜谱标签" });
  await expect(
    m.getByRole("button", { name: "开启标签川菜", exact: true }),
  ).toHaveCount(0);
  await m.getByRole("button", { name: "展开中餐", exact: true }).click();
  await expect(
    m.getByRole("button", { name: "开启标签川菜", exact: true }),
  ).toBeVisible();
  await m.getByRole("button", { name: "全选中餐及下级", exact: true }).click();
  await expect(m.getByLabel("选择标签川菜", { exact: true })).toBeChecked();
  await expect(m.getByLabel("选择标签西餐", { exact: true })).not.toBeChecked();
  await m.getByRole("button", { name: "反选中餐及下级", exact: true }).click();
  await expect(m.getByLabel("选择标签川菜", { exact: true })).not.toBeChecked();
  await m.getByRole("button", { name: "反选", exact: true }).click();
  await expect(m.getByLabel("选择标签西餐", { exact: true })).toBeChecked();
  await m.getByRole("button", { name: "清空", exact: true }).click();
  await page.screenshot({
    path: "docs/screenshots/tags-refinement/tree-expanded.png",
  });
  await m.getByRole("button", { name: "添加标签", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加标签", exact: true });
  await editor.getByLabel("标签名称", { exact: true }).fill("自家川味");
  await editor.getByLabel("搜索所属标签", { exact: true }).fill("川菜");
  await editor
    .locator(".tag-parent-options")
    .getByRole("checkbox", { name: "川菜", exact: true })
    .check();
  await expect(editor.locator("select[multiple]")).toHaveCount(0);
  await expect(editor.getByText("说明", { exact: true })).toHaveCount(0);
  for (const width of [1000, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(
      editor.getByRole("button", { name: "保存标签", exact: true }),
    ).toBeInViewport();
    await expect(
      editor
        .locator(":scope > header")
        .getByRole("button", { name: "保存标签", exact: true }),
    ).toBeVisible();
    expect(
      await editor.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({
    path: "docs/screenshots/tags-refinement/parent-picker.png",
  });
  await editor.getByRole("button", { name: "保存标签", exact: true }).click();
  await m.getByLabel("搜索标签目录").fill("自家川味");
  await expect(m.locator(".tag-catalog-row")).toContainText("自家川味");
  await expect(m.getByText("词条说明", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/tags-refinement/tree-custom.png",
  });
});

test("refined cuisines and independent custom group", async ({ page }) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const m = page.getByRole("dialog", { name: "管理菜谱标签" });
  await expect(
    m.getByRole("button", { name: "菜系 40", exact: true }),
  ).toBeVisible();
  await m.getByRole("button", { name: "展开异国风味", exact: true }).click();
  await expect(m.getByLabel("选择标签东南亚菜", { exact: true })).toBeVisible();
  await expect(
    m.getByRole("button", { name: "展开东南亚菜", exact: true }),
  ).toHaveCount(0);
  await m.getByLabel("搜索标签目录").fill("潮州菜");
  await expect(m.locator(".tag-catalog-row")).toHaveCount(0);
  await m.getByRole("button", { name: "自定义 0", exact: true }).click();
  await m.getByRole("button", { name: "添加标签", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "添加标签", exact: true });
  await expect(editor.getByLabel("标签类型")).toHaveValue("custom");
  await editor.getByLabel("标签名称", { exact: true }).fill("周末待试");
  await editor.getByRole("button", { name: "保存标签", exact: true }).click();
  await expect(m.getByLabel("选择标签周末待试", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/tags-refinement/custom-group.png",
  });
});

test("four tag groups use consistent distinct colors across picker cards and detail", async ({
  page,
}) => {
  await library(page);
  await page.getByRole("button", { name: "管理标签", exact: true }).click();
  const m = page.getByRole("dialog", { name: "管理菜谱标签" });
  await m.getByRole("button", { name: "自定义 0", exact: true }).click();
  await m.getByRole("button", { name: "添加标签", exact: true }).click();
  const e = page.getByRole("dialog", { name: "添加标签", exact: true });
  await e.getByLabel("标签名称", { exact: true }).fill("周末待试");
  await e.getByRole("button", { name: "保存标签", exact: true }).click();
  await m.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "创建菜谱", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("菜谱名称", { exact: true }).fill("四类标签配色");
  const groups = ["cuisine", "trait", "method", "custom"];
  const colors = [];
  for (const group of groups) {
    const choice = editor
      .locator(`.tag-choice[data-tag-group="${group}"]`)
      .first();
    await choice.click();
    colors.push(
      await choice.evaluate((el) => getComputedStyle(el).backgroundColor),
    );
  }
  expect(new Set(colors).size).toBe(4);
  await editor.getByLabel("食材1名称").fill("番茄");
  await editor.getByLabel("步骤1做法").fill("洗净切块炒熟。");
  await editor
    .getByRole("button", { name: "创建演示菜谱", exact: true })
    .click();
  const card = page.locator(".recipe-card").filter({ hasText: "四类标签配色" });
  await card.locator(".recipe-title").click();
  const detail = page.locator(".recipe-detail-tags");
  for (let i = 0; i < groups.length; i++)
    await expect(detail.locator(`[data-tag-group="${groups[i]}"]`)).toHaveCSS(
      "background-color",
      colors[i],
    );
  await page.screenshot({
    path: "docs/screenshots/tag-colors/four-groups-detail.png",
  });
});
