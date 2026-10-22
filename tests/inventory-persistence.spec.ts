import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function inventoryIPC(page: Page, fail = false) {
  const s = initialState();
  s.ingredientCategories.push("未分类");
  s.inventoryEvents = [
    {
      id: "receive-test",
      lotId: "beef-1",
      kind: "receive",
      before: "0",
      after: "400",
      beforeLocation: "冷藏",
      afterLocation: "冷藏",
      afterVersion: 1,
      reason: "验收购买",
      reversedEventId: null,
      occurredAt: "2026-10-19T08:00:00Z",
    },
  ];
  s.lots = s.lots.map((l) => ({ ...l, version: 1 }));
  s.lots[0].expires = null;
  s.lots[1].quantity = 0;
  await page.addInitScript(
    ({ snapshot, fail }) => {
      Object.assign(window, {
        isTauri: true,
        inventoryCommands: [],
        __TAURI_INTERNALS__: {
          invoke: async (name: string, args: { command: unknown }) => {
            if (name === "kitchen_execute") {
              (
                window as unknown as { inventoryCommands: unknown[] }
              ).inventoryCommands.push(args.command);
              if (fail)
                throw { code: "DATABASE_BUSY", message: "测试：库存写入失败" };
              return null;
            }
            return snapshot;
          },
        },
      });
    },
    { snapshot: s, fail },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
}
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`native inventory layout and forms ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await inventoryIPC(page);
    await expect(
      page.getByRole("button", { name: "食材购买", exact: true }),
    ).toBeEnabled();
    await expect(page.locator("tbody")).toContainText("未记录有效期");
    await expect(page.locator("tbody tr").last()).toContainText("已用完");
    await page.screenshot({
      path: `docs/screenshots/inventory-m2/${width}-inventory.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "食材购买", exact: true }).click();
    await expect(page.getByLabel("到期日期")).toHaveValue("");
    await expect(page.getByLabel("购买日期", { exact: true })).not.toHaveValue(
      "",
    );
    const body = page.getByRole("dialog").locator(".dialog-body");
    expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `docs/screenshots/inventory-m2/${width}-receive.png`,
    });
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page
      .getByRole("button", { name: "查看牛肉批次", exact: true })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toContainText("未记录有效期");
    await expect(
      page.getByRole("button", { name: "确认校正", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: `docs/screenshots/inventory-m2/${width}-lot.png`,
    });
    await page.locator(".inventory-history").scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", { name: "撤销上次操作", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "历史操作", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("反向流水说明")).toHaveCount(0);
    await page.screenshot({
      path: `docs/screenshots/inventory-m2/${width}-history.png`,
    });
    expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "每周菜单" })
      .click();
    await expect(
      page.getByRole("button", { name: "安排一餐", exact: true }),
    ).toBeEnabled();
  });
}
test("failed native receipt retains draft and sends explicit unknown expiry", async ({
  page,
}) => {
  await inventoryIPC(page, true);
  await page.getByRole("button", { name: "食材购买", exact: true }).click();
  await page.getByLabel("食材名称", { exact: true }).fill("失败保留草稿");
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("库存写入失败");
  await expect(page.getByLabel("食材名称", { exact: true })).toHaveValue(
    "失败保留草稿",
  );
  const commands = await page.evaluate(
    () =>
      (window as unknown as { inventoryCommands: unknown[] }).inventoryCommands,
  );
  expect(commands).toMatchObject([
    { type: "receive_lot", draft: { expires: null, quantity: "100" } },
  ]);
});

for (const operation of ["校正", "使用", "丢弃"]) {
  test(`inventory ${operation} submits with no operation note`, async ({
    page,
  }) => {
    await inventoryIPC(page, true);
    await page
      .getByRole("button", { name: "查看牛肉批次", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: operation, exact: true }).click();
    const reason = page.getByLabel("操作说明（选填）");
    await expect(reason).toHaveValue("");
    await expect(reason).not.toHaveAttribute("required", "");
    await page
      .getByLabel(operation === "校正" ? "校正后剩余量" : `${operation}数量`, {
        exact: false,
      })
      .fill("20");
    await page
      .getByRole("button", { name: `确认${operation}`, exact: true })
      .click();
    await expect(page.locator(".toast")).toContainText("库存写入失败");
    const commands = await page.evaluate(
      () =>
        (
          window as unknown as {
            inventoryCommands: { reason: string; operation: string }[];
          }
        ).inventoryCommands,
    );
    expect(commands.at(-1)).toMatchObject({
      reason: "",
      operation:
        operation === "校正"
          ? "correct"
          : operation === "使用"
            ? "use"
            : "discard",
    });
    if (operation === "丢弃")
      await page.screenshot({
        path: "docs/screenshots/inventory-optional-note.png",
      });
  });
}
test("undo last action submits immediately without a reason field", async ({
  page,
}) => {
  await inventoryIPC(page);
  await page
    .getByRole("button", { name: "查看牛肉批次", exact: true })
    .first()
    .click();
  await page.locator(".inventory-history").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "撤销上次操作", exact: true }).click();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { inventoryCommands: unknown[] }).inventoryCommands,
  );
  expect(commands).toEqual([
    { type: "undo_inventory", lot_id: "beef-1", expected_version: 1 },
  ]);
});
