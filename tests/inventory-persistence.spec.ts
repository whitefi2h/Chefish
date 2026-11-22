import { answerAppDialog } from "./helpers/appDialog";
import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function inventoryIPC(page: Page, fail = false, coarse = false) {
  const s = initialState();
  if (coarse) s.preferences = { ...s.preferences!, inventoryMode: "rough" };
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
    await expect(page.locator("tbody")).not.toContainText("粗略");
    await expect(page.locator(".attention-items")).not.toContainText("牛肉");
    await expect(page.locator("tbody")).not.toContainText("已用完");
    await page.getByLabel("显示已用完").check();
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
    await expect(page.getByRole("dialog")).not.toContainText("待核对");
    await expect(
      page.getByRole("dialog").getByLabel("剩余数量", { exact: false }),
    ).toBeEditable();
    await expect(
      page.getByRole("heading", { name: "数量操作", exact: true }),
    ).toHaveCount(0);
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

test("direct edit keeps failed draft and needs no reason", async ({ page }) => {
  await inventoryIPC(page, true);
  await page
    .getByRole("button", { name: "查看牛肉批次", exact: true })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("剩余数量", { exact: false })
    .fill("20");
  await page.getByLabel("储存位置", { exact: true }).selectOption("冷冻");
  await page.getByLabel("到期日期", { exact: true }).fill("2026-11-01");
  await expect(page.getByLabel("操作说明", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("库存写入失败");
  await expect(
    page.getByRole("dialog").getByLabel("剩余数量", { exact: false }),
  ).toHaveValue("20");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { inventoryCommands: unknown[] })
          .inventoryCommands,
    ),
  ).toMatchObject([
    {
      type: "edit_lot",
      lot_id: "beef-1",
      expected_version: 1,
      draft: { quantity: "20", location: "冷冻", expires: "2026-11-01" },
    },
  ]);
});

test("list deletion requires confirmation and cancelling keeps the batch", async ({
  page,
}) => {
  await inventoryIPC(page);
  const response0 = answerAppDialog(page, false);
  await page
    .getByRole("button", { name: "删除牛肉批次", exact: true })
    .first()
    .click();
  await response0;
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { inventoryCommands: unknown[] })
          .inventoryCommands,
    ),
  ).toEqual([]);
  const response1 = answerAppDialog(page, true);
  await page
    .getByRole("button", { name: "删除牛肉批次", exact: true })
    .first()
    .click();
  await response1;
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { inventoryCommands: unknown[] })
          .inventoryCommands,
    ),
  ).toEqual([{ type: "delete_lot", lot_id: "beef-1", expected_version: 1 }]);
});

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

test("preview cells and detail share editing and deletion, with empty batches hidden by default", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await page.getByLabel("鸡蛋剩余数量", { exact: true }).fill("0");
  await page.getByLabel("鸡蛋剩余数量", { exact: true }).press("Enter");
  const rows = page.locator("tbody tr").filter({ hasText: "鸡蛋" });
  await expect(rows).toHaveCount(0);
  await page.getByLabel("显示已用完").check();
  await expect(rows).toContainText("已用完");
  await page.getByLabel("鸡蛋储存位置", { exact: true }).selectOption("常温");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("鸡蛋储存位置", { exact: true })).toHaveValue(
    "常温",
  );
  await page.getByRole("button", { name: "查看鸡蛋批次", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("储存位置", { exact: true })).toHaveValue(
    "常温",
  );
  const response2 = answerAppDialog(page, false);
  await dialog
    .getByRole("button", { name: "删除鸡蛋批次", exact: true })
    .click();
  await response2;
  await expect(dialog).toBeVisible();
  const response3 = answerAppDialog(page, true);
  await dialog
    .getByRole("button", { name: "删除鸡蛋批次", exact: true })
    .click();
  await response3;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(rows).toHaveCount(0);
});

test("inline quantity controls use unit steps and never open a dialog", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存", exact: true })
    .click();
  const beef = page.getByLabel("牛肉剩余数量", { exact: true });
  const eggs = page.getByLabel("鸡蛋剩余数量", { exact: true });
  await page.getByRole("button", { name: "减少牛肉数量", exact: true }).click();
  await expect(beef).toHaveValue("350");
  await page.getByRole("button", { name: "增加牛肉数量", exact: true }).click();
  await expect(beef).toHaveValue("400");
  await page.getByRole("button", { name: "减少鸡蛋数量", exact: true }).click();
  await expect(eggs).toHaveValue("5");
  await beef.fill("375.5");
  await beef.press("Enter");
  await expect(beef).toHaveValue("375.5");
  await beef.fill("9");
  await beef.press("Escape");
  await expect(beef).toHaveValue("375.5");
  await page.getByLabel("牛肉储存位置", { exact: true }).selectOption("常温");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator("tbody").getByRole("button", { name: /修改.*属性/ }),
  ).toHaveCount(0);
});

test("purchase waits for a sync refresh instead of dropping the action", async ({
  page,
}) => {
  await inventoryIPC(page);
  await page.getByRole("button", { name: "食材购买", exact: true }).click();
  await page.getByLabel("食材名称", { exact: true }).fill("同步期间购买");
  await page.evaluate(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (name: string, args: unknown) => Promise<unknown>;
      };
      releaseRefresh: () => void;
      refreshStarted: boolean;
    };
    const original = target.__TAURI_INTERNALS__.invoke;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    target.releaseRefresh = release;
    target.__TAURI_INTERNALS__.invoke = async (name, args) => {
      if (name === "kitchen_bootstrap" && !target.refreshStarted) {
        target.refreshStarted = true;
        await paused;
      }
      return original(name, args);
    };
    window.dispatchEvent(new Event("chefish:sync-data"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { refreshStarted: boolean }).refreshStarted,
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "确认购买", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { inventoryCommands: unknown[] })
          .inventoryCommands,
    ),
  ).toHaveLength(0);
  await expect(page.getByText("正在加载或保存，请稍候。")).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { releaseRefresh: () => void }).releaseRefresh(),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { inventoryCommands: unknown[] })
          .inventoryCommands,
    ),
  ).toMatchObject([{ type: "receive_lot", draft: { name: "同步期间购买" } }]);
});

test("rough inventory keeps the existing table and uses compact continuous stock controls", async ({
  page,
}) => {
  await inventoryIPC(page, false, true);
  const row = page.locator("tbody tr").first();
  const slider = row.getByRole("slider");
  await expect(slider).toBeVisible();
  await expect(row.locator(".lot-quantity")).toHaveCount(0);
  const box = await slider.boundingBox();
  expect(box!.width).toBeLessThan(240);
  await slider.focus();
  await page.keyboard.press("End");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { inventoryCommands: unknown[] })
            .inventoryCommands.length,
      ),
    )
    .toBe(1);
  const commands = await page.evaluate(
    () =>
      (window as unknown as { inventoryCommands: unknown[] }).inventoryCommands,
  );
  expect(commands).toMatchObject([
    { type: "set_stock_level", change: { level: 2 } },
  ]);
  await page.screenshot({ path: "docs/screenshots/rough-mode/inventory.png" });
});

test("background stock update preserves edits and requires explicit review before save", async ({
  page,
}) => {
  await inventoryIPC(page, false, true);
  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: /查看/ })
    .click();
  const form = page.locator(".lot-editor");
  const slider = form.getByRole("slider");
  await slider.focus();
  await page.keyboard.press("End");
  const received = form.locator('input[type="date"]').first();
  await received.fill("2026-10-01");
  await expect(slider).toHaveAttribute("aria-valuetext", "盈余");
  await page.evaluate(async () => {
    const t = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (n: string, a: unknown) => Promise<unknown>;
      };
    };
    const snapshot = (await t.__TAURI_INTERNALS__.invoke(
      "kitchen_bootstrap",
      {},
    )) as {
      lots: {
        id: string;
        version: number;
        measurement: string;
        level: number;
        quantity: string;
        received: string;
      }[];
    };
    const lot = snapshot.lots.find((l) => l.id === "beef-1")!;
    const date = lot.received;
    lot.version = 2;
    lot.measurement = "level";
    lot.level = 0;
    lot.quantity = "0";
    window.dispatchEvent(new Event("chefish:sync-data"));
    return date;
  });
  await expect(form.getByRole("slider")).toHaveAttribute(
    "aria-valuetext",
    "盈余",
  );
  await expect(received).toHaveValue("2026-10-01");
  await expect(form.getByRole("button", { name: "保存修改" })).toBeDisabled();
  await form.getByRole("button", { name: "保留修改并合并最新信息" }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "盈余");
  await expect(received).toHaveValue("2026-10-01");
  await form.getByRole("button", { name: "保存修改" }).click();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { inventoryCommands: unknown[] }).inventoryCommands,
  );
  expect(commands).toMatchObject([
    {
      type: "edit_level_lot",
      expected_version: 2,
      level: 2,
      draft: { received: "2026-10-01" },
    },
  ]);
});
