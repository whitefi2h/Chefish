import { test, expect } from "@playwright/test";
test("week navigation preserves future and past meals and scopes shopping", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.locator(".calendar .planned-card")).toHaveCount(0);
  await page.getByRole("button", { name: "安排一餐", exact: true }).click();
  await page.getByLabel("日期", { exact: true }).selectOption("2026-10-20");
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  await expect(page.locator('[data-slot="2026-10-20|晚餐"]')).toContainText(
    "香煎黑椒芦笋牛排",
  );
  await page.getByRole("button", { name: "采购预览", exact: false }).click();
  await expect(page.locator(".page:visible")).toContainText("2026 / 10 / 19");
  await expect(
    page.locator(".shopping-row").filter({ hasText: "牛肉" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await page.getByRole("button", { name: "返回本周" }).click();
  await expect(page.locator(".calendar .planned-card")).toHaveCount(5);
  await page.getByRole("button", { name: "上一周", exact: true }).click();
  await page.getByRole("button", { name: "安排一餐", exact: true }).click();
  await page.getByLabel("日期", { exact: true }).selectOption("2026-10-06");
  await page.getByRole("button", { name: "确认安排", exact: true }).click();
  await expect(
    page.locator('[data-slot="2026-10-06|晚餐"] .planned-card'),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(
    page.locator('[data-slot="2026-10-20|晚餐"] .planned-card'),
  ).toHaveCount(1);
  await page.getByLabel("查看指定周").fill("2027-01-01");
  await expect(page.locator('[data-slot="2027-01-03|晚餐"]')).toBeVisible();
  await expect(page.locator(".week-toolbar")).toContainText("2026 / 12 / 28");
});
test("repeated non-inventory updates stay silent", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "采购清单" })
    .click();
  const refresh = page.getByRole("button", { name: "更新计划需求" });
  await refresh.click();
  await page.clock.runFor(4000);
  await expect(page.locator(".toast")).toHaveCount(0);
  await refresh.click();
  await page.clock.runFor(1500);
  await expect(page.locator(".toast")).toHaveCount(0);
  await page.clock.runFor(3500);
  await expect(page.locator(".toast")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销上一步" })).toBeEnabled();
});
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
])
  test(`all modal frames clip corners and bodies scroll without tracks ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    await page.getByRole("button", { name: "创建菜谱", exact: true }).click();
    for (let i = 0; i < 8; i++)
      await page.getByRole("button", { name: "添加食材", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const body = dialog.locator(".dialog-body");
    await expect(dialog).toHaveCSS("overflow", "hidden");
    await expect(body).toHaveCSS("scrollbar-width", "none");
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      true,
    );
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    const header = await dialog.locator(":scope > header").boundingBox();
    await body.hover();
    await page.mouse.wheel(0, 3000);
    await expect
      .poll(() => body.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect((await dialog.locator(":scope > header").boundingBox())!.y).toBe(header!.y);
    await page.screenshot({ path: `docs/screenshots/${width}-长表单弹窗.png` });
    await page.getByRole("button", { name: "关闭面板" }).click();
    for (const name of ["导入菜谱", "管理分类"]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCSS("overflow", "hidden");
      await page.getByRole("button", { name: "关闭面板" }).click();
    }
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "食材库存" })
      .click();
    await page.getByRole("button", { name: "食材购买", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page
      .getByRole("button", { name: "查看口蘑 / 鲜蘑菇批次" })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toHaveCSS("overflow", "hidden");
    await page.getByRole("button", { name: "关闭面板" }).click();
  });
