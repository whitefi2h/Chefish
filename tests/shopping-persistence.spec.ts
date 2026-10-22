import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import type { ShoppingLine, ShoppingForecast } from "../src/domain/shopping";
async function shoppingIPC(
  page: Page,
  fail: "" | "buy" | "receive" | "forecast" = "",
) {
  const state = initialState();
  state.dataRevision = "10";
  state.memo = "选新鲜的蔬菜";
  const row = (overrides: Partial<ShoppingLine>): ShoppingLine => ({
    id: null,
    version: 0,
    ingredientId: "beef",
    name: "牛肉",
    category: "肉禽蛋",
    unit: "g",
    source: "plan",
    weekStart: "2026-10-19",
    required: "550",
    covered: "400",
    shortage: "150",
    purchased: "0",
    received: "0",
    unreceived: "0",
    remaining: "150",
    review: false,
    hidden: false,
    surplus: false,
    sources: ["2026-10-19 晚餐 · 香煎牛排"],
    history: [],
    ...overrides,
  });
  const f: ShoppingForecast = {
    weekStart: "2026-10-19",
    asOf: "2026-10-19",
    pastPlanCount: 5,
    reviewNotes: [
      "2026-10-20 晚餐 · 临时菜：未录入用量",
      "调味请自行核对（盐适量）",
    ],
    items: [
      row({
        id: "plan-beef",
        version: 3,
        purchased: "70",
        received: "20",
        unreceived: "50",
        remaining: "100",
        history: [
          {
            id: "p1",
            kind: "purchase",
            quantity: "70",
            at: "2026-10-19T08:00:00Z",
            lotId: null,
          },
          {
            id: "r1",
            kind: "receive",
            quantity: "20",
            at: "2026-10-19T08:15:00Z",
            lotId: "lot1",
          },
        ],
      }),
      row({
        id: "manual-rice",
        version: 1,
        ingredientId: "rice",
        name: "大米",
        category: "主食调味",
        source: "manual",
        weekStart: null,
        required: "1000",
        covered: "0",
        shortage: "1000",
        remaining: "1000",
        sources: [],
      }),
      row({
        ingredientId: "mushroom",
        name: "口蘑",
        category: "蔬菜菌菇",
        required: "80",
        covered: "0",
        shortage: "80",
        remaining: "80",
        review: true,
      }),
      row({
        id: "surplus",
        ingredientId: "salmon",
        name: "三文鱼",
        required: "100",
        covered: "0",
        shortage: "100",
        purchased: "200",
        received: "200",
        unreceived: "0",
        remaining: "0",
        surplus: true,
        sources: [],
      }),
    ],
  };
  f.items.unshift(f.items.pop()!);
  await page.addInitScript(
    ({ state, f, fail }) => {
      const saved = JSON.parse(
        sessionStorage.getItem("shopping-fixture") ?? "null",
      );
      if (saved) {
        Object.assign(state, saved.state);
        Object.assign(f, saved.f);
      }
      Object.assign(window, {
        isTauri: true,
        shoppingCommands: [],
        __TAURI_INTERNALS__: {
          invoke: async (
            name: string,
            args: { weekStart?: string; command?: Record<string, unknown> },
          ) => {
            if (name === "kitchen_shopping") {
              if (fail === "forecast") throw { message: "测试：采购计算失败" };
              const items =
                args.weekStart === f.weekStart
                  ? f.items
                  : f.items.filter((i) => i.source === "manual");
              return { ...f, weekStart: args.weekStart, items };
            }
            if (name === "kitchen_bootstrap") return state;
            const c = args.command!;
            (
              window as unknown as { shoppingCommands: unknown[] }
            ).shoppingCommands.push(c);
            if (
              (fail === "buy" && c.type === "purchase_shopping") ||
              (fail === "receive" && c.type === "receive_shopping")
            )
              throw {
                code: "DATABASE_BUSY",
                message: "测试：写入失败，草稿保留",
              };
            if (
              c.type === "purchase_shopping" ||
              c.type === "receive_shopping"
            ) {
              const i = f.items.find((i) => i.id === c.line_id)!;
              const n = Number(c.quantity);
              if (c.type === "purchase_shopping") {
                i.purchased = String(Number(i.purchased) + n);
                i.received = String(Number(i.received) + n);
                i.remaining = String(Math.max(0, Number(i.remaining) - n));
              } else {
                i.received = String(Number(i.received) + n);
                i.unreceived = String(Number(i.unreceived) - n);
                if (i.source === "plan") {
                  i.covered = String(Number(i.covered) + n);
                  i.shortage = String(Math.max(0, Number(i.shortage) - n));
                }
              }
              i.version++;
              i.history.push({
                id: crypto.randomUUID(),
                kind: c.type === "purchase_shopping" ? "purchase" : "receive",
                quantity: String(c.quantity),
                at: new Date().toISOString(),
                lotId: c.type === "receive_shopping" ? "lot-new" : null,
              });
            }
            if (c.type === "hide_shopping")
              f.items.forEach((i) => {
                if (
                  i.ingredientId === c.ingredient_id &&
                  i.unit === c.unit &&
                  i.source === "plan"
                ) {
                  i.hidden = true;
                  i.remaining = "0";
                }
              });
            if (c.type === "remove_shopping")
              f.items = f.items.filter((i) => i.id !== c.line_id);
            if (c.type === "refresh_shopping")
              f.items.forEach((i) => {
                i.hidden = false;
              });
            if (c.type === "save_shopping_memo") state.memo = String(c.memo);
            state.dataRevision = String(Number(state.dataRevision) + 1);
            sessionStorage.setItem(
              "shopping-fixture",
              JSON.stringify({ state, f }),
            );
            return null;
          },
        },
      });
    },
    { state, f, fail },
  );
  await page.goto("/");
  await page.getByLabel("查看指定周").fill("2026-10-19");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "采购清单" })
    .click();
}
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
])
  test(`native shopping and partial receipt layout ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await shoppingIPC(page);
    const beef = page
      .locator(".shopping-row")
      .filter({ has: page.getByText("牛肉", { exact: true }) });
    await expect(beef).toContainText("总需 550 g · 库存 400 g · 仍缺 100 g");
    const purchased = page
      .locator(".shopping-row")
      .filter({ hasText: "三文鱼" });
    await expect(purchased).toContainText("总需 100 g · 库存 0 g · 仍缺 0 g");
    await expect(purchased).toContainText("已购买");
    await expect(
      purchased.getByRole("button", { name: "购买", exact: true }),
    ).toBeDisabled();
    await expect(
      page.locator(".shopping-row").filter({ hasText: "三文鱼" }),
    ).not.toContainText("超过当前缺口");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.locator(".shopping-summary .shopping-stats > div"),
    ).toHaveCount(3);
    await expect(page.getByText("采购之前，先看冰箱")).toHaveCount(0);
    const listBox = await page.locator(".shopping-list").boundingBox();
    const summaryBox = await page.locator(".shopping-summary").boundingBox();
    expect(Math.abs(listBox!.y - summaryBox!.y)).toBeLessThanOrEqual(1);
    await expect(page.getByRole("region", { name: "采购项目" })).toHaveCount(1);
    await expect(page.locator(".shopping-list h2")).toHaveText("购物清单 4");
    await expect(
      page.locator(".shopping-row .shopping-title > strong"),
    ).toHaveText(["牛肉", "大米", "口蘑", "三文鱼"]);
    await expect(page.getByRole("main")).not.toContainText("累计已买");
    await expect(page.getByRole("main")).not.toContainText("入库");
    await expect(page.getByText("需核对", { exact: true })).toBeVisible();
    expect(
      await beef
        .locator(".shopping-name small")
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    const controlSizes = await page
      .getByRole("main")
      .locator(".week-controls:visible")
      .evaluate((e) =>
        [...e.querySelectorAll("button,input")].map(
          (el) => el.getBoundingClientRect().height,
        ),
      );
    expect(
      Math.max(...controlSizes) - Math.min(...controlSizes),
    ).toBeLessThanOrEqual(1);
    const controlFonts = await page
      .getByRole("main")
      .locator(".week-controls:visible")
      .evaluate((e) =>
        [...e.querySelectorAll("button,input")].map(
          (el) => getComputedStyle(el).fontSize,
        ),
      );
    expect(new Set(controlFonts).size).toBe(1);
    await expect(
      page.getByRole("button", { name: "详情", exact: true }),
    ).toHaveCount(0);
    const columns = await page.locator(".shopping-row").evaluateAll((rows) =>
      rows.map((row) =>
        [...row.querySelectorAll(".row-actions button")].map((button) => {
          const r = button.getBoundingClientRect();
          return { x: r.x, width: r.width, height: r.height };
        }),
      ),
    );
    for (const row of columns) {
      expect(row).toHaveLength(2);
      expect(row[0].x).toBeCloseTo(columns[0][0].x, 0);
      expect(row[1].x).toBeCloseTo(columns[0][1].x, 0);
      expect(row[0].height).toEqual(row[1].height);
    }
    await page.screenshot({
      path: `docs/screenshots/shopping-polish/${width}-shopping.png`,
      fullPage: true,
    });
    expect(
      await beef.boundingBox().then((box) => box!.height),
    ).toBeLessThanOrEqual(90);
    await expect(beef).not.toContainText("香煎牛排");
    await expect(beef).not.toContainText("购买记录");
    await beef.click({ button: "right" });
    const detail = page.getByRole("dialog", { name: "采购详情 · 牛肉" });
    await expect(detail).toContainText("2026-10-19 晚餐 · 香煎牛排");
    await expect(detail).toContainText("购买 70 g");
    await expect(
      detail.getByRole("heading", { name: "用于", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/shopping-polish/${width}-detail.png`,
    });
    await page.keyboard.press("Escape");
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "完善信息", exact: true }).click();
    await expect(page.getByLabel("购买到期日期")).toHaveValue("");
    await page.getByLabel("本次购买数量").fill("20");
    await page.getByLabel("购买储存位置").selectOption("冷冻");
    const body = page.getByRole("dialog").locator(".dialog-body");
    expect(await body.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: `docs/screenshots/shopping-polish/${width}-legacy.png`,
    });
    await page.getByRole("button", { name: "保存购买信息" }).click();
    await beef.getByRole("button", { name: "购买" }).click();
    await expect(page.getByLabel("购买到期日期")).toHaveValue("");
    await page.getByLabel("本次购买数量").fill("10");
    await page.getByLabel("购买储存位置").selectOption("常温");
    await page.screenshot({
      path: `docs/screenshots/shopping-polish/${width}-purchase.png`,
    });
    await page.getByRole("button", { name: "确认购买" }).click();
    await expect(beef).not.toContainText("累计已买");
    await expect(beef).toContainText("待买 90 g");
    await page.getByRole("button", { name: "更新计划需求" }).click();
    await expect(beef).not.toContainText("累计已买");
    await page.reload();
    await page.getByLabel("查看指定周").fill("2026-10-19");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "采购清单" })
      .click();
  });
for (const fail of ["buy", "receive"] as const)
  test(`native shopping ${fail} failure retains exact draft`, async ({
    page,
  }) => {
    await shoppingIPC(page, fail);
    const beef = page
      .locator(".shopping-row")
      .filter({ has: page.getByText("牛肉", { exact: true }) });
    if (fail === "receive") await beef.click({ button: "right" });
    await (fail === "receive" ? page.getByRole("dialog") : beef)
      .getByRole("button", {
        name: fail === "buy" ? "购买" : "完善信息",
        exact: true,
      })
      .click();
    const field = page.getByLabel(
      fail === "buy" ? "本次购买数量" : "本次购买数量",
    );
    await field.fill("0.123456");
    await page
      .getByRole("button", {
        name: fail === "buy" ? "确认购买" : "保存购买信息",
      })
      .click();
    await expect(page.locator(".toast")).toContainText("写入失败");
    await expect(field).toHaveValue("0.123456");
    await expect(beef).toContainText("待买 100 g");
  });
test("native forecast failure is explicit and does not fabricate covered needs", async ({
  page,
}) => {
  await shoppingIPC(page, "forecast");
  await expect(page.getByRole("alert")).toContainText("采购计算失败");
  await expect(
    page.getByRole("button", { name: "更新计划需求" }),
  ).toBeDisabled();
  await expect(page.locator(".shopping-row")).toHaveCount(0);
});
test("native manual items remain visible across weeks and memo saves", async ({
  page,
}) => {
  await shoppingIPC(page);
  await page.getByLabel("采购备忘").fill("记得带购物袋");
  await page.getByRole("button", { name: "保存备忘" }).click();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "每周菜单" })
    .click();
  await page.getByLabel("查看指定周").fill("2026-10-26");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "采购清单" })
    .click();
  await expect(page.locator(".shopping-row")).toHaveCount(1);
  await expect(page.locator(".shopping-row")).toContainText("大米");
  await expect(page.getByLabel("采购备忘")).toHaveValue("记得带购物袋");
});

test("new household purchase confirms quantity and storage in one action", async ({
  page,
}) => {
  await shoppingIPC(page);
  const rice = page
    .locator(".shopping-row")
    .filter({ has: page.getByText("大米", { exact: true }) });
  await expect(rice.getByRole("button", { name: "完善信息" })).toHaveCount(0);
  await rice.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByLabel("本次购买数量").fill("1000");
  await page.getByLabel("购买储存位置").selectOption("常温");
  await expect(page.getByLabel("购买到期日期")).toHaveValue("");
  await page.getByRole("button", { name: "确认购买" }).click();
  await expect(rice).toContainText("已购买");
  await expect(
    page.locator(".shopping-row .shopping-title > strong"),
  ).toHaveText(["牛肉", "口蘑", "三文鱼", "大米"]);
  await expect(rice.getByRole("button", { name: "完善信息" })).toHaveCount(0);
  await expect(
    rice.getByRole("button", { name: "购买", exact: true }),
  ).toBeDisabled();
  const commands = await page.evaluate(
    () =>
      (window as unknown as { shoppingCommands: Record<string, unknown>[] })
        .shoppingCommands,
  );
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({
    type: "purchase_shopping",
    quantity: "1000",
    location: "常温",
    expires: null,
  });
});

test("purchased rows can be removed and keyboard opens details", async ({
  page,
}) => {
  await shoppingIPC(page);
  const salmon = page.getByRole("group", {
    name: "采购项目 · 三文鱼",
    exact: true,
  });
  await salmon.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("dialog", { name: "采购详情 · 三文鱼" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await salmon.getByRole("button", { name: "删除三文鱼" }).click();
  await expect(page.getByRole("dialog")).toContainText("库存和记录会保留");
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(salmon).toHaveCount(0);
  await page.getByRole("button", { name: "更新计划需求" }).click();
  await expect(salmon).toBeVisible();
  const rice = page.getByRole("group", {
    name: "采购项目 · 大米",
    exact: true,
  });
  await rice.getByRole("button", { name: "购买", exact: true }).click();
  await page.getByRole("button", { name: "确认购买" }).click();
  await expect(
    rice.getByRole("button", { name: "购买", exact: true }),
  ).toBeDisabled();
  await rice.getByRole("button", { name: "删除大米" }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(rice).toHaveCount(0);
});
