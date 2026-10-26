import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
async function setup(page: Page, destructive = false, failure = "") {
  await page.addInitScript(
    ({ state, destructive, failure }) => {
      const w = window as unknown as {
        isTauri: boolean;
        calls: { name: string; args: Record<string, unknown> }[];
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      w.isTauri = true;
      w.calls = [];
      let routeFailed = false;
      let history = {
        messages: [],
        candidates: [],
        input: "",
        pendingUrl: "",
        pasted: "",
      };
      let applied = false;
      w.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          w.calls.push({ name, args });
          if (name === "kitchen_bootstrap")
            return { ...state, dataRevision: applied ? "2" : "1" };
          if (name === "kitchen_shopping")
            return {
              weekStart: args.weekStart,
              asOf: "2026-10-22",
              items: [],
              reviewNotes: [],
              pastPlanCount: 0,
            };
          if (name === "kitchen_ai_settings")
            return {
              settings: { provider: "deepseek" },
              configured: ["deepseek"],
            };
          if (name === "kitchen_ai_history") return history;
          if (name === "kitchen_ai_save_history") {
            history = args.history as typeof history;
            return null;
          }
          if (
            name === "kitchen_ai_route" &&
            JSON.stringify((args.messages as unknown[]).at(-1)).includes(
              "打开库存",
            )
          )
            return {
              message: "已打开库存页面",
              action: "navigate",
              page: "pantry",
            };
          if (
            name === "kitchen_ai_route" &&
            JSON.stringify((args.messages as unknown[]).at(-1)).includes(
              "复制采购",
            )
          )
            return {
              message: "本周待购清单如下",
              action: "copy_shopping",
              copy: { title: "本周清单", text: "鸡蛋 2 个" },
            };
          if (
            name === "kitchen_ai_route" &&
            JSON.stringify(args.messages).includes("模拟一次失败") &&
            !routeFailed
          ) {
            routeFailed = true;
            throw { message: "服务暂时不可用" };
          }
          if (name === "kitchen_ai_route")
            return {
              message: "已根据本地菜谱生成待确认提案。",
              action: "operate",
              proposal: {
                id: "proposal-1",
                operations: [destructive ? "删除菜谱" : "安排晚餐"],
                expectedRevision: "1",
                destructive,
                changes: [
                  {
                    section: "菜单",
                    before: "无",
                    after: "2026-10-22 晚餐 · 番茄菌菇暖汤 · 2人",
                  },
                  {
                    section: "菜单",
                    before: "无",
                    after: "2026-10-23 晚餐 · 香煎牛排 · 1人",
                  },
                  {
                    section: "采购预测",
                    before: "无",
                    after: "鸡蛋 · 待购 2 个",
                  },
                ],
              },
            };
          if (name === "kitchen_ai_apply") {
            if (failure) throw { code: "STALE_REVISION", message: failure };
            applied = true;
            return null;
          }
          return null;
        },
      };
    },
    { state: initialState(), destructive, failure },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
}
async function send(page: Page, text: string) {
  await page.getByLabel("对厨房助手说").fill(text);
  await page.getByRole("button", { name: "发送", exact: true }).click();
}
test("local plan is previewed, can be adjusted in conversation and only applies after confirmation", async ({
  page,
}) => {
  await setup(page);
  await send(page, "用库存安排今天晚餐");
  const proposal = page.getByRole("region", { name: "待确认操作" });
  await expect(proposal).toContainText("番茄菌菇暖汤");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { calls: { name: string }[] }).calls.filter(
          (c) => c.name === "kitchen_ai_apply",
        ).length,
    ),
  ).toBe(0);
  await send(page, "改成两个人");
  const args = await page.evaluate(
    () =>
      (
        window as unknown as {
          calls: { name: string; args: Record<string, unknown> }[];
        }
      ).calls
        .filter((c) => c.name === "kitchen_ai_route")
        .at(-1)?.args,
  );
  expect(args?.proposalId).toBe("proposal-1");
  expect(args?.weekStart).toBeTruthy();
  await proposal
    .getByRole("button", { name: "同意并执行", exact: true })
    .click();
  await expect(proposal).toHaveCount(0);
  await expect(page.locator(".chat-message").last()).toContainText("已完成");
});
test("delete requires extra acknowledgement and failed execution retains proposal", async ({
  page,
}) => {
  await setup(page, true, "数据已变化，请重新生成提案");
  await send(page, "删除这个菜谱");
  const button = page.getByRole("button", { name: "同意并执行", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("再次确认删除、移除或丢弃的内容").check();
  await button.click();
  await expect(page.getByRole("alert")).toContainText("数据已变化");
  await expect(button).toBeVisible();
});
test("cancelling a proposal performs no writes", async ({ page }) => {
  await setup(page);
  await send(page, "安排今天晚餐");
  await page.getByRole("button", { name: "拒绝提案", exact: true }).click();
  await expect(page.getByRole("region", { name: "待确认操作" })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as unknown as { calls: { name: string }[] }).calls.some(
        (c) => c.name === "kitchen_ai_apply",
      ),
    ),
  ).toBe(false);
});
for (const width of [1280, 1920])
  test(`proposal layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await send(page, "安排今天晚餐");
    await expect(
      page.getByRole("button", { name: "同意并执行", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".proposal-meal")).toHaveCount(2);
    await expect(page.locator(".proposal-heading")).not.toContainText(
      "安排或调整菜单",
    );
    await expect(page.locator(".proposal-content")).not.toContainText("执行后");
    await expect(page.locator(".proposal-comparison")).toHaveCount(0);
    await page.screenshot({
      path: `docs/screenshots/assistant-pantry/${width}-proposal.png`,
    });
    expect(
      await page
        .locator(".dialog-body")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
  });

test("assistant opens application pages and offers the actual shopping copy text", async ({
  page,
}) => {
  await setup(page);
  await send(page, "打开库存");
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByRole("heading", { name: /食材库存/ })).toBeVisible();
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await send(page, "复制采购清单");
  await expect(
    page.getByRole("button", { name: "复制清单文本", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".assistant-proposal")).toContainText("鸡蛋 2 个");
});

test("retrying a retained draft does not duplicate the user message", async ({
  page,
}) => {
  await setup(page);
  await send(page, "模拟一次失败，帮我安排晚餐");
  await expect(page.getByRole("alert")).toContainText("暂时不可用");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("region", { name: "待确认操作" })).toBeVisible();
  await expect(page.locator(".chat-message.user")).toHaveCount(1);
});
