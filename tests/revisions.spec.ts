import { test, expect } from "@playwright/test";
test("center modal retains draft on backdrop and Escape; X closes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "安排一餐", exact: true }).click();
  await page.getByLabel("用餐人数", { exact: true }).fill("4");
  await page.mouse.click(10, 10);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("用餐人数", { exact: true })).toHaveValue("4");
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("carousel arrows move one card, retain boundaries and native horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const prev = page.getByRole("button", { name: "上一张灵感菜谱" });
  const next = page.getByRole("button", { name: "下一张灵感菜谱" });
  const row = page.locator(".pool-row");
  await expect(prev).toBeDisabled();
  await expect(next).toBeEnabled();
  const step = await row.evaluate(
    (el) =>
      el.children[0].getBoundingClientRect().width +
      parseFloat(getComputedStyle(el).columnGap),
  );
  await next.click();
  await expect
    .poll(() => row.evaluate((el) => el.scrollLeft))
    .toBeCloseTo(step, 0);
  await expect(prev).toBeEnabled();
  await row.hover();
  await page.mouse.wheel(1500, 0);
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(next).toBeEnabled();
  await expect(row).toHaveCSS("scrollbar-width", "none");
  await page.getByLabel("搜索候选菜谱").fill("牛排");
  await expect(prev).toBeDisabled();
  await expect(next).toBeDisabled();
});
test("create recipe, share inspiration from list and detail, arrange outside inspiration", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "创建菜谱", exact: true }).click();
  await page.getByLabel("菜谱名称", { exact: true }).fill("家常西兰花");
  await page.getByLabel("食材1名称").fill("西兰花");
  await page.getByLabel("步骤1做法").fill("洗净。\n炒熟。");
  await page.getByRole("button", { name: "创建演示菜谱" }).click();
  await expect(
    page.getByRole("button", { name: "家常西兰花", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "加入周灵感家常西兰花" }).click();
  await page
    .getByRole("button", { name: "查看家常西兰花", exact: true })
    .click();
  await page.getByRole("button", { name: "移出周灵感家常西兰花" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await expect(page.locator(".pool-row")).not.toContainText("家常西兰花");
  await page.getByRole("button", { name: "安排一餐", exact: true }).click();
  await page.getByLabel("选择菜谱").selectOption({ label: "家常西兰花" });
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  await expect(page.locator('[data-slot="2026-10-18|晚餐"]')).toContainText(
    "家常西兰花",
  );
  await page.getByRole("button", { name: "为2026-10-18晚餐加一道菜" }).click();
  await page.getByLabel("选择菜谱").selectOption("__custom");
  await page.getByLabel("菜名", { exact: true }).fill("清蒸鱼");
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  const slot = page.locator('[data-slot="2026-10-18|晚餐"]');
  await expect(slot.locator(".planned-card")).toHaveCount(2);
  await expect(slot).toContainText("清蒸鱼");
  await expect(slot).toContainText("家常西兰花");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "采购清单" })
    .click();
  await expect(
    page.locator(".shopping-row").filter({ hasText: "西兰花" }),
  ).toContainText("100 g");
});
test("JSON file import validates then previews before confirmation", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "导入菜谱", exact: true }).click();
  await page.getByLabel("菜谱 JSON").fill('{"name":"broken"}');
  await page.getByRole("button", { name: "预览导入" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认导入" })).toHaveCount(0);
  const recipe = {
    name: "导入的冬瓜汤",
    category: "汤羹",
    minutes: 20,
    servings: 2,
    steps: ["煮熟冬瓜。"],
    ingredients: [{ name: "冬瓜", quantity: 300, unit: "g" }],
  };
  await page.getByLabel("选择 JSON 文件").setInputFiles({
    name: "recipe.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(recipe)),
  });
  await expect(page.getByRole("button", { name: "确认导入" })).toBeVisible();
  await expect(
    page.locator(".recipe-card").filter({ hasText: "导入的冬瓜汤" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.locator(".recipe-card").filter({ hasText: "导入的冬瓜汤" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "汤羹", exact: true }).click();
  await expect(page.locator(".recipe-card:visible")).toHaveCount(1);
});
test("recipe and pantry categories can be added renamed assigned and removed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "管理分类" }).click();
  await page.getByLabel("新分类名称").fill("快手菜");
  await page.getByRole("button", { name: "添加分类" }).click();
  await page.getByLabel("分类名称快手菜", { exact: true }).fill("工作日晚餐");
  await page.getByRole("button", { name: "保存分类", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "工作日晚餐", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看香煎黑椒芦笋牛排", exact: true })
    .click();
  await page.getByLabel("菜谱所属分类").selectOption("工作日晚餐");
  await page.getByRole("button", { name: "返回菜谱库" }).click();
  await page.getByRole("button", { name: "工作日晚餐", exact: true }).click();
  await expect(page.locator(".recipe-card:visible")).toHaveCount(1);
  await page.getByRole("button", { name: "管理分类" }).click();
  await page.getByRole("button", { name: "移除分类工作日晚餐" }).click();
  await page.getByRole("button", { name: "保存分类", exact: true }).click();
  await page.getByRole("button", { name: "未分类", exact: true }).click();
  await expect(page.locator(".recipe-card:visible")).toHaveCount(1);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await page.getByRole("button", { name: "管理分类" }).click();
  await page.getByLabel("新分类名称").fill("烘焙");
  await page.getByRole("button", { name: "添加分类" }).click();
  await page.getByRole("button", { name: "保存分类", exact: true }).click();
  await page
    .getByRole("button", { name: "查看口蘑 / 鲜蘑菇批次" })
    .first()
    .click();
  await page.getByLabel("食材所属分类").selectOption("烘焙");
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByLabel("筛选食材类别").selectOption("烘焙");
  await expect(page.locator("tbody tr")).toHaveCount(2);
});
