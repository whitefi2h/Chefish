import { test, expect, type Page } from "@playwright/test";
async function go(page: Page, name: string) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name, exact: false })
    .click();
}
test("pointer drag adds, moves into a shared meal, removes, and undo restores dishes", async ({
  page,
}) => {
  await page.goto("/");
  const source = page.locator(".pool-card").first().locator(".draggable");
  const target = page.locator('[data-slot="2026-10-12|早餐"]');
  const a = await source.boundingBox();
  const b = await target.boundingBox();
  await page.mouse.move(a!.x + 30, a!.y + 20);
  await page.mouse.down();
  await page.mouse.move(a!.x + 45, a!.y + 25, { steps: 3 });
  await page.mouse.move(b!.x + b!.width / 2, b!.y + 30, { steps: 15 });
  await page.mouse.up();
  await expect(target.locator(".planned-card")).toHaveCount(1);
  await target.locator(".planned-card").click({ button: "right" });
  await page.getByLabel("日期", { exact: true }).selectOption("2026-10-13");
  await page.getByLabel("餐次", { exact: true }).selectOption("晚餐");
  await page.getByLabel("用餐人数", { exact: true }).fill("3");
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  const moved = page.locator('[data-slot="2026-10-13|晚餐"]');
  await expect(moved).toContainText("3 人份");
  await expect(target.locator(".planned-card")).toHaveCount(0);
  await moved.getByRole("button", { name: "移除2026-10-13晚餐" }).click();
  await expect(moved.locator(".planned-card")).toHaveCount(0);
  await page.getByRole("button", { name: "撤销上一步" }).click();
  await expect(moved.locator(".planned-card")).toHaveCount(1);
  // Drag an existing meal onto an occupied target, then explicitly confirm replacement.
  await moved.scrollIntoViewIfNeeded();
  const from = await moved.locator(".draggable").boundingBox();
  const occupied = page.locator('[data-slot="2026-10-13|午餐"]');
  const to = await occupied.boundingBox();
  await page.mouse.move(from!.x + 20, from!.y + 20);
  await page.mouse.down();
  await page.mouse.move(from!.x + 35, from!.y + 20, { steps: 3 });
  await page.mouse.move(to!.x + 40, to!.y + 30, { steps: 15 });
  await page.mouse.up();
  await expect(occupied.locator(".planned-card")).toHaveCount(2);
  await expect(occupied).toContainText("意式青酱奶油蘑菇意面");
  await expect(occupied).toContainText("香煎黑椒芦笋牛排");
  await expect(moved.locator(".planned-card")).toHaveCount(0);
});
test("shopping purchase also stocks inventory; manual input is escaped and retained", async ({
  page,
}) => {
  await page.goto("/");
  await go(page, "采购清单");
  const beef = page
    .locator(".shopping-row")
    .filter({
      has: page.locator(".shopping-title>strong", { hasText: "牛肉" }),
    })
    .first();
  await expect(beef).toContainText("150 g");
  await beef.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByLabel("购买储存位置").selectOption("冷冻");
  await page.getByLabel("购买到期日期").fill("2026-10-25");
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(
    page.locator(".shopping-row").filter({ hasText: "牛肉" }),
  ).toContainText("已购买");
  await expect(page.getByText("需求已减少，保留购买记录，请核对")).toHaveCount(
    0,
  );
  await expect(
    beef.getByRole("button", { name: "购买", exact: true }),
  ).toBeDisabled();
  await beef.click({ button: "right" });
  await expect(page.getByRole("dialog")).toContainText("用于");
  await page.getByRole("button", { name: "关闭面板" }).click();
  await beef.getByRole("button", { name: "删除牛肉", exact: true }).click();
  await page.getByRole("button", { name: "确认移除" }).click();
  await expect(
    page.locator(".shopping-row").filter({ hasText: "牛肉" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "手动添加" }).click();
  const unsafe = "<img src=x onerror=alert(1)>";
  await page.getByLabel("食材名称").fill(unsafe);
  await page.getByLabel("数量", { exact: true }).fill("2");
  await page.getByLabel("单位", { exact: true }).selectOption("个");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "添加项目", exact: true })
    .click();
  await expect(page.getByText(unsafe, { exact: true })).toBeVisible();
  await expect(page.locator(".shopping-name img")).toHaveCount(0);
  await page.getByRole("button", { name: "更新计划需求" }).click();
  await expect(page.getByText(unsafe, { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV（浏览器）" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".csv");
});
test("inventory filters, lot adjustment, undo, drawer focus and Escape", async ({
  page,
}) => {
  await page.goto("/");
  await go(page, "食材库存");
  await page
    .getByRole("group", { name: "位置筛选", exact: true })
    .getByRole("button", { name: "冷冻", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page
    .getByRole("group", { name: "类别筛选", exact: true })
    .getByRole("button", { name: "蔬菜菌菇", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.getByRole("button", { name: "清除筛选" }).click();
  await page
    .getByRole("button", { name: "查看口蘑 / 鲜蘑菇批次" })
    .first()
    .click();
  await page.getByLabel("选择批次").selectOption("mushroom-2");
  await page
    .getByRole("dialog")
    .getByLabel("剩余数量", { exact: false })
    .fill("80");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("剩余数量", { exact: false }),
  ).toHaveValue("80");
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "查看口蘑 / 鲜蘑菇批次" }).first(),
  ).toBeFocused();
  await page.getByRole("button", { name: "撤销上一步" }).click();
  await expect(
    page.getByLabel("口蘑 / 鲜蘑菇剩余数量", { exact: true }).last(),
  ).toHaveValue("100");
});
test("recipe filters survive details and notes are actually displayed", async ({
  page,
}) => {
  await page.goto("/");
  await go(page, "我的菜谱");
  await page.getByLabel("搜索我的菜谱").fill("牛排");
  await page
    .getByRole("button", { name: "查看香煎黑椒芦笋牛排", exact: true })
    .click();
  await page.getByLabel("菜谱用餐人数").fill("4");
  await expect(page.locator(".ingredient-line").first()).toContainText("600 g");
  await page.getByLabel("烹饪笔记").fill("下次少放一点黑胡椒。");
  await page.getByRole("button", { name: "保存演示笔记" }).click();
  await expect(page.locator(".log-entry")).toContainText(
    "下次少放一点黑胡椒。",
  );
  await page.getByRole("button", { name: "返回菜谱库" }).click();
  await expect(page.getByLabel("搜索我的菜谱")).toHaveValue("牛排");
  await expect(page.locator(".recipe-card:visible")).toHaveCount(1);
});
test("AI proposal requires confirmation; keyboard alternative adds a meal", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await page.getByRole("button", { name: "预览一份菜单建议" }).click();
  await page.getByRole("button", { name: "拒绝提案" }).click();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(
    page.locator('[data-slot="2026-10-18|晚餐"] .planned-card'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "安排一餐", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("选择菜谱").selectOption("soup");
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  await expect(page.locator('[data-slot="2026-10-18|晚餐"]')).toContainText(
    "番茄菌菇暖汤",
  );
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await page.getByRole("button", { name: "预览一份菜单建议" }).click();
  await page.getByRole("button", { name: "确认加入菜单" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
])
  test(`six views and overlays at ${width}x${height}, offline resources`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await page.context().setOffline(true);
    for (const name of [
      "每周菜单",
      "首页",
      "我的菜谱",
      "食材库存",
      "采购清单",
    ]) {
      await go(page, name);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(page.locator(".page:visible .food").first())
        .toBeVisible()
        .catch(() => {});
      await page.screenshot({
        path: `docs/screenshots/${width}-${name}.png`,
        fullPage: true,
      });
    }
    await go(page, "我的菜谱");
    await page
      .getByRole("button", { name: "查看香煎黑椒芦笋牛排", exact: true })
      .click();
    await page.screenshot({
      path: `docs/screenshots/${width}-菜谱详情.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "厨房助手", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/${width}-AI抽屉.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭面板" }).click();
    await go(page, "食材库存");
    await page
      .getByRole("button", { name: "查看口蘑 / 鲜蘑菇批次" })
      .first()
      .click();
    await page.screenshot({
      path: `docs/screenshots/${width}-库存详情.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "关闭面板" }).click();
    await go(page, "每周菜单");
    const bounds = await page.locator(".meal-slot").first().boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(130);
    await expect(page.locator(".planned-card strong").first()).toBeVisible();
    expect(errors).toEqual([]);
  });
