import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

async function setup(page: Page, conflict = false, empty = false) {
  await page.addInitScript(
    ({ kitchen, conflict, empty }) => {
      const target = window as unknown as {
        isTauri: boolean;
        stewardCalls: string[];
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      target.isTauri = true;
      target.stewardCalls = [];
      const settings = JSON.parse(
        localStorage.getItem("steward-settings") ?? "null",
      ) ?? {
        enabled: false,
        owner: "",
        doNotDisturb: false,
        autostart: false,
        weekly: true,
        weeklyNotify: true,
        weeklyDay: 6,
        weeklyTime: "18:00",
        maintenance: true,
        maintenanceNotify: true,
        maintenanceTime: "09:00",
        recommendations: true,
        recommendationsNotify: true,
        recommendationsDay: 3,
        recommendationsTime: "18:00",
        recommendationInterval: 7,
        meals: ["晚餐"],
        allowEstimates: true,
      };
      let draft = JSON.parse(
        localStorage.getItem("steward-draft") ?? "null",
      ) ?? {
        id: "draft-1",
        weekStart: "2026-11-02",
        messages: [],
        slots: [],
        version: 1,
        status: "draft",
      };
      let confirmed = false;
      const taskStatuses: Record<string, string> = {};
      const forecast = {
        weekStart: "2026-11-02",
        asOf: "2026-10-28",
        items: [],
        reviewNotes: ["西兰花少许：采用估计，请按实物调整"],
        pastPlanCount: 0,
      };
      target.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          target.stewardCalls.push(name);
          if (name === "kitchen_bootstrap")
            return { ...kitchen, dataRevision: confirmed ? "2" : "1" };
          if (name === "kitchen_shopping") return forecast;
          if (name === "sync_state")
            return {
              replicaId: "test-device",
              queuedOperations: 0,
              queuedBytes: 0,
              binding: null,
            };
          if (name === "kitchen_ai_history")
            return (
              JSON.parse(
                localStorage.getItem(`chat:${args.conversationId ?? "main"}`) ??
                  "null",
              ) ?? {
                messages: [],
                candidates: [],
                input: "",
                pendingUrl: "",
                pasted: "",
              }
            );
          if (name === "kitchen_ai_save_history") {
            localStorage.setItem(
              `chat:${args.conversationId ?? "main"}`,
              JSON.stringify(args.history),
            );
            return null;
          }
          if (name === "kitchen_ai_route")
            return { action: "none", message: "收到这项任务的补充。" };
          if (name === "kitchen_ai_settings")
            return {
              settings: { provider: "deepseek" },
              configured: ["deepseek"],
            };
          if (name === "kitchen_steward_state")
            return {
              settings,
              deviceId: "test-device",
              runs: [],
              items: empty
                ? []
                : [
                    ...["one", "two"].map((id) => ({
                      id,
                      kind: id === "one" ? "maintenance" : "recommendations",
                      title: id === "one" ? "厨房整理已完成" : "新菜谱与灵感",
                      body: "已自动整理食材信息。",
                      payload:
                        id === "one"
                          ? {
                              items: Array.from({ length: 8 }, (_, i) => ({
                                name: ["鸡蛋", "蘑菇", "意面", "鸡肉"][i % 4],
                                entityKind: "ingredient",
                                entityId: `fixture-${i}`,
                                metadata: { tags: ["已分类"] },
                              })),
                              questions: [],
                            }
                          : {
                              candidates: [
                                {
                                  id: "recipe-a",
                                  title: "泰式罗勒鸡肉饭",
                                  url: "https://www.xiachufang.com/recipe/1/",
                                  reason: "适合尝试的新风味。",
                                  verification: "模拟搜索结果",
                                },
                                {
                                  id: "recipe-b",
                                  title: "韩式辣酱炸鸡",
                                  url: "https://www.xiachufang.com/recipe/2/",
                                  reason: "可以利用现有鸡肉。",
                                  verification: "模拟搜索结果",
                                },
                              ],
                            },
                      status: taskStatuses[id] ?? "open",
                      unread: true,
                      createdAt: "2026-10-28",
                    })),
                    {
                      id: "weekly-1",
                      kind: "weekly",
                      title: "下周菜单规划",
                      body: "冰箱里还有蘑菇和鸡肉，下周有没有特别想吃的？",
                      payload: { weekStart: "2026-11-02", draftId: "draft-1" },
                      status: confirmed ? "done" : "open",
                      unread: true,
                      createdAt: "2026-10-28",
                    },
                  ],
            };
          if (name === "kitchen_steward_mark") {
            if (args.status !== "read")
              taskStatuses[String(args.id)] = String(args.status);
            return null;
          }
          if (name === "kitchen_steward_settings") {
            Object.assign(settings, args.settings);
            localStorage.setItem("steward-settings", JSON.stringify(settings));
            return null;
          }
          if (name === "kitchen_steward_draft") return draft;
          if (name === "kitchen_steward_reply") {
            draft = {
              ...draft,
              messages: [
                ...draft.messages,
                { role: "user", content: args.message },
                { role: "assistant", content: "草稿已调整，周三安排快手菜。" },
              ],
              slots: [
                {
                  planId: null,
                  recipeRevisionId: null,
                  customTitle: "清炒西兰花",
                  day: "2026-11-04",
                  meal: "晚餐",
                  servings: 2,
                },
              ],
              version: draft.version + 1,
            };
            localStorage.setItem("steward-draft", JSON.stringify(draft));
            return draft;
          }
          if (name === "kitchen_steward_preview") {
            if (conflict)
              throw {
                code: "DRAFT_CONFLICT",
                message: "正式菜单已有变化。草稿仍保留，请重新核对。",
              };
            return {
              before: forecast,
              after: forecast,
              expectedRevision: "1",
              changes: [],
            };
          }
          if (name === "kitchen_steward_confirm") {
            confirmed = true;
            draft.status = "confirmed";
            localStorage.setItem("steward-draft", JSON.stringify(draft));
            return forecast;
          }
          return null;
        },
      };
    },
    { kitchen: initialState(), conflict, empty },
  );
  await page.goto("/");
}
async function openInbox(page: Page) {
  await page.getByRole("button", { name: "厨房助手", exact: false }).click();
  await expect(page.getByRole("button", { name: /管家消息/ })).toHaveCount(0);
  await page.getByRole("button", { name: "下周菜单规划，查看任务" }).click();
}
test("weekly discussion survives reload and requires preview before confirmation", async ({
  page,
}) => {
  await setup(page);
  await openInbox(page);
  await page.getByLabel("告诉管家这周怎么安排").fill("周三简单一点，两个人");
  await page.getByRole("button", { name: "生成或调整草稿" }).click();
  await expect(page.getByRole("cell", { name: "清炒西兰花" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认菜单并生成采购需求" }),
  ).toBeDisabled();
  await page.reload();
  await openInbox(page);
  await expect(
    page.locator(".steward-messages").getByText(/周三简单一点，两个人/),
  ).toBeVisible();
  await page.getByRole("button", { name: "核对菜单与采购" }).click();
  await expect(
    page.getByText("西兰花少许：采用估计，请按实物调整"),
  ).toBeVisible();
  await page.getByRole("button", { name: "确认菜单并生成采购需求" }).click();
  await expect(page.getByText("菜单已确认，采购需求已更新")).toBeVisible();
});
test("official plan conflict preserves the editable draft", async ({
  page,
}) => {
  await setup(page, true);
  await openInbox(page);
  await page.getByLabel("告诉管家这周怎么安排").fill("安排周三晚餐");
  await page.getByRole("button", { name: "生成或调整草稿" }).click();
  await page.getByRole("button", { name: "核对菜单与采购" }).click();
  await expect(
    page.getByText("正式菜单已有变化。草稿仍保留，请重新核对。"),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: "清炒西兰花" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认菜单并生成采购需求" }),
  ).toBeDisabled();
});
test("steward settings are opt-in and quiet mode persists", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  await page.getByRole("tab", { name: "厨房管家" }).click();
  await expect(
    page.getByRole("switch", { name: "在这台电脑启用厨房管家", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("switch", { name: "在这台电脑启用厨房管家", exact: true })
    .check();
  await page.getByRole("switch", { name: "免打扰", exact: true }).check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("管家设置已保存")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "保存设置", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("switch", { name: "免打扰", exact: true }),
  ).toBeChecked();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("steward-settings")!),
    ),
  ).toMatchObject({
    enabled: true,
    doNotDisturb: true,
    meals: ["晚餐"],
    weeklyTime: "18:00",
  });
});

test("task cards open isolated conversations and restore each conversation", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "厨房助手", exact: false }).click();
  await expect(page.locator(".steward-task-detail")).toHaveCount(0);
  const openTask = async (name: string) => {
    if (
      (await page
        .getByRole("button", { name: `${name}，查看任务`, exact: true })
        .count()) === 0
    )
      await page.getByRole("button", { name: "历史会话", exact: true }).click();
    await page
      .getByRole("button", { name: `${name}，查看任务`, exact: true })
      .click();
  };
  await openTask("厨房整理已完成");
  await expect(page.getByLabel("对厨房助手说")).toHaveCount(1);
  await page.getByLabel("对厨房助手说").fill("第一项任务的独立补充");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("收到这项任务的补充。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回助手" }).click();
  await openTask("新菜谱与灵感");
  await expect(
    page.getByText("第一项任务的独立补充", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "返回助手" }).click();
  await openTask("厨房整理已完成");
  await expect(
    page.getByText("第一项任务的独立补充", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "厨房助手", exact: false }).click();
  await openTask("厨房整理已完成");
  await expect(
    page.getByText("第一项任务的独立补充", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回助手" }).click();
  await expect(
    page.getByText("第一项任务的独立补充", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/assistant-redesign/tasks.png",
  });
});

for (const width of [1000, 1440, 1920])
  test(`clean chat empty state and compact task banners at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, false, true);
    await page.getByRole("button", { name: "厨房助手", exact: false }).click();
    await expect(page.locator(".task-banner")).toHaveCount(0);
    await expect(page.getByText("主动任务与建议", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      page.getByText("菜单规划与厨房整理", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /历史会话/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("button", { name: "规划当前周" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("heading", { name: "今天想吃点什么？" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "历史会话", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/assistant-redesign/${width}-empty.png`,
    });
    await page.getByRole("button", { name: "历史会话", exact: true }).click();
    await expect(page.getByText("最近 30 天没有任务会话")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/assistant-redesign/${width}-history.png`,
    });
  });
test("banners, history and task chat retain a fixed compact composer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.getByRole("button", { name: "厨房助手", exact: false }).click();
  await expect(page.locator(".task-banner")).toHaveCount(3);
  for (const banner of await page.locator(".task-banner").all()) {
    expect((await banner.boundingBox())!.height).toBeLessThan(85);
  }
  await page.screenshot({
    path: "docs/screenshots/assistant-redesign/1440-tasks.png",
  });
  await page.locator(".assistant-dialog").screenshot({
    path: "docs/screenshots/assistant-redesign/task-banners-panel.png",
  });
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "历史任务会话" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下周菜单规划，查看任务" }).click();
  await page
    .getByLabel("告诉管家这周怎么安排")
    .fill("周三做一道简单的素菜，两个人。");
  await page.getByRole("button", { name: "生成或调整草稿" }).click();
  await expect(page.getByRole("cell", { name: "清炒西兰花" })).toBeVisible();
  const composer = (await page.locator(".weekly-compose-wrap").boundingBox())!;
  expect(composer.y + composer.height).toBeLessThanOrEqual(900);
  await page.screenshot({
    path: "docs/screenshots/assistant-redesign/1440-weekly-chat.png",
  });
});

test("handled tasks leave banners and remain in history, drawer reaches viewport edge", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "厨房助手", exact: false }).click();
  const bounds = (await page.locator(".assistant-dialog").boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(
    Math.abs(bounds.x + bounds.width - viewport.width),
  ).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "厨房整理已完成，查看任务" }).click();
  await page.getByLabel("对厨房助手说").fill("已经补充完成，谢谢");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("收到这项任务的补充。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回助手", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "厨房整理已完成，查看任务" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "历史会话", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "厨房整理已完成，查看任务" }),
  ).toBeVisible();
});

for (const width of [1000, 1440, 1920])
  test(`assistant overlay preserves background geometry at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await setup(page);
    await page.getByRole("button", { name: "首页", exact: true }).click();
    const measure = () =>
      page.locator(".workspace").evaluate((el) => {
        const rect = (node: Element) => {
          const b = node.getBoundingClientRect();
          return { x: b.x, width: b.width };
        };
        return [
          rect(el),
          rect(el.querySelector(".topbar")!),
          rect(el.querySelector("main")!),
          rect(el.querySelector(".dashboard-top")!),
        ];
      });
    const before = await measure();
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole("button", { name: "厨房助手", exact: false })
        .click();
      expect(await measure()).toEqual(before);
      const drawer = (await page.locator(".assistant-dialog").boundingBox())!;
      expect(Math.abs(drawer.x + drawer.width - width)).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "关闭面板", exact: true }).click();
      expect(await measure()).toEqual(before);
    }
  });

test("autostart can be enabled independently of proactive kitchen jobs", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  await page.getByRole("tab", { name: "厨房管家" }).click();
  await page
    .getByRole("switch", { name: "随 Windows 启动并留在托盘", exact: true })
    .check();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.getByText("管家设置已保存")).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("steward-settings")!),
    ),
  ).toMatchObject({ enabled: false, autostart: true });
});
