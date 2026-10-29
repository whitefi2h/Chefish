import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

async function stub(page: Page, failure = "") {
  await page.addInitScript(
    ({ state, failure }) => {
      const target = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
        savedCommands: unknown[];
        aiCalls: unknown[];
      };
      target.isTauri = true;
      target.savedCommands = [];
      target.aiCalls = [];
      let settings = {
        provider: "deepseek",
        model: "deepseek-flash",
        timeout: 90,
        maxTokens: 8192,
      };
      let configured = ["deepseek"];
      let history = {
        messages: [],
        candidates: [],
        input: "",
        pendingUrl: "",
        pasted: "",
      };
      target.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          if (name === "kitchen_ai_history") return history;
          if (name === "kitchen_ai_save_history") {
            history = args.history as typeof history;
            return null;
          }
          if (name === "kitchen_ai_verify") {
            target.aiCalls.push({ verifyUrl: args.url });
            if (failure === "rate")
              throw {
                code: "SITE_RATE_LIMIT",
                message: "下厨房限制了访问频率，请稍后重试",
              };
            throw { message: "测试原页暂时不可读取" };
          }
          if (name === "kitchen_open_recipe") {
            Object.assign(window, { openedRecipeUrl: args.url });
            return null;
          }
          if (name === "kitchen_bootstrap") return state;
          if (name === "kitchen_ai_settings") return { settings, configured };
          if (name === "kitchen_ai_save_settings") {
            settings = args.settings as typeof settings;
            if (args.remove)
              configured = configured.filter((p) => p !== settings.provider);
            else if (args.key && !configured.includes(settings.provider))
              configured.push(settings.provider);
            return { settings, configured };
          }
          if (name === "kitchen_ai_test") {
            if (failure === "connection")
              throw { message: "密钥无效，配置仍保留" };
            return null;
          }
          if (name === "kitchen_ai_route") {
            target.aiCalls.push(args);
            const messages = args.messages as { content: string }[];
            return messages.at(-1)?.content.includes("第二")
              ? {
                  message: "整理你选择的第二道菜。",
                  action: "import",
                  candidateId: "candidate-2",
                }
              : {
                  message: "按你的偏好检索。",
                  action: "search",
                  query: "新手 咸口 番茄炒蛋",
                };
          }
          if (name === "kitchen_ai_search") {
            if (failure === "search")
              throw { message: "搜索服务暂时不可用，请重试" };
            return (failure === "site" ? [1, 2, 3, 4, 5] : [1, 2]).map((n) => ({
              source: failure === "site" ? "xiachufang" : "deepseek",
              id: `candidate-${n}`,
              title: `合成测试菜谱 ${n}`,
              url: `https://www.xiachufang.com/recipe/12345${n}/`,
              snippet: "测试摘要，仅验证界面。",
              rating: n === 1 ? 8.9 : null,
              madeCount: n === 1 ? 118 : null,
              author: null,
            }));
          }
          if (name === "kitchen_import_images") {
            return failure === "images"
              ? {
                  media: {
                    cover:
                      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=",
                    steps: [],
                  },
                  warnings: [],
                }
              : { warnings: [] };
          }
          if (name === "kitchen_import_url") {
            if (failure === "fetch") throw { message: "网站未提供菜谱内容" };
            return '<h1 class="page-title">测试菜</h1><div class="ings"><table><tr><td class="name">鸡蛋</td><td class="unit">4个</td></tr></table></div><div class="steps"><li><p class="text">1.打蛋。2.炒熟。</p></li></div>';
          }
          if (name === "kitchen_ai_organize") {
            target.aiCalls.push(args);
            if (failure === "organize")
              throw { message: "模型输出格式无效，原文已保留" };
            return {
              warnings: ["人数和用时为建议值"],
              draft: {
                name: "整理好的番茄炒蛋",
                category: "家常菜",
                minutes: 15,
                servings: 2,
                subtitle: "原文整理",
                seasoning: "",
                ingredients: [{ name: "鸡蛋", quantity: "4", unit: "个" }],
                textIngredients: [
                  { name: "盐", amountText: "3小勺" },
                  { name: "油", amountText: "适量" },
                ],
                steps: ["打蛋搅匀。", "炒熟装盘。"],
                stepTitles: ["打蛋", "炒熟"],
                source: {
                  url: args.url,
                  author: "合成作者",
                  ingredientText: ["4个鸡蛋", "3小勺盐", "适量油"],
                },
              },
            };
          }
          if (name === "kitchen_execute") {
            target.savedCommands.push(args);
            return null;
          }
          if (name === "kitchen_shopping")
            return {
              weekStart: "2026-10-19",
              asOf: "2026-10-20",
              items: [],
              reviewNotes: [],
              pastPlanCount: 0,
            };
          throw { message: "未实现的测试命令" };
        },
      };
    },
    { state: initialState(), failure },
  );
}
async function assistant(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
}
async function search(page: Page) {
  await page
    .getByLabel("对厨房助手说")
    .fill("找几个高分番茄炒蛋，适合新手，咸口");
  await page.getByRole("button", { name: "发送", exact: true }).click();
}

test("conversation searches, selects second by stable ID and saves only after editable confirmation", async ({
  page,
}) => {
  await stub(page);
  await assistant(page);
  await search(page);
  await expect(page.locator(".recipe-candidate")).toHaveCount(2);
  await expect(page.locator(".recipe-candidate").nth(1)).toContainText(
    "评分未核验",
  );
  await page.getByLabel("对厨房助手说").fill("整理第二个");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑后导入" })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedCommands: unknown[] }).savedCommands
          .length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "编辑后导入" }).click();
  await expect(page.getByLabel("菜谱分类")).toHaveValue("家常菜");
  await expect(page.getByLabel("食材1用量")).toHaveValue("4 个");
  await expect(page.getByLabel("食材2用量")).toHaveValue("3小勺");
  await expect(page.getByLabel("步骤2做法")).toHaveValue("炒熟装盘。");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          savedCommands: {
            command: {
              draft: {
                source: { url: string };
                textIngredients: { amountText: string }[];
              };
            };
          }[];
        }
      ).savedCommands,
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].command.draft.source.url).toContain("123452");
  expect(calls[0].command.draft.textIngredients[0].amountText).toBe("3小勺");
});

test("failed search preserves input, failed reading offers selected URL paste fallback", async ({
  page,
}) => {
  await stub(page, "fetch");
  await assistant(page);
  await search(page);
  await page.getByRole("button", { name: "整理这道菜" }).nth(1).click();
  await expect(page.getByRole("alert")).toContainText("网站未提供");
  await page
    .getByText("无法读取？粘贴所选菜谱正文继续", { exact: true })
    .click();
  await page.getByLabel("所选菜谱正文").fill("4个鸡蛋，3小勺盐。打蛋后炒熟。");
  await page.getByRole("button", { name: "整理正文", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑后导入" })).toBeVisible();
});

test("settings support DeepSeek, OpenAI and Gemini without echoing keys", async ({
  page,
}) => {
  await stub(page);
  await assistant(page);
  await page.getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByLabel("模型名称")).toHaveValue("deepseek-flash");
  await page.getByLabel("模型服务").selectOption("gemini");
  await page.getByLabel("模型名称").fill("user-selected-model");
  await page.getByLabel("API 密钥").fill("test-only-not-real");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(page.getByLabel("API 密钥")).toHaveValue("");
  await page.getByRole("button", { name: "测试已保存配置" }).click();
  await expect(page.locator(".ai-settings").getByRole("status")).toContainText(
    "连接正常",
  );
  await expect(page.getByLabel("模型服务").locator("option")).toHaveCount(3);
});

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
])
  test(`assistant layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await stub(page);
    await assistant(page);
    await search(page);
    await expect(page.locator(".recipe-candidate")).toHaveCount(2);
    await page.screenshot({
      path: `docs/screenshots/ai-assistant/${width}-search.png`,
    });
    await page.getByRole("button", { name: "模型设置", exact: true }).click();
    await page.screenshot({
      path: `docs/screenshots/ai-assistant/${width}-settings.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });

test("web importer uses configured AI automatically and retains HTML on organize failure", async ({
  page,
}) => {
  await stub(page, "organize");
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "导入菜谱", exact: true }).click();
  await page.getByRole("button", { name: "下厨房链接 / HTML" }).click();
  await page
    .getByLabel("下厨房菜谱链接")
    .fill("https://www.xiachufang.com/recipe/123451/");
  await page.getByRole("button", { name: "读取链接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("原文已保留");
  await expect(page.getByLabel("下厨房菜谱链接")).toHaveValue(
    "https://www.xiachufang.com/recipe/123451/",
  );
});

test("chat and candidate IDs restore after close, manual clear persists and original link uses native browser command", async ({
  page,
}) => {
  await stub(page);
  await assistant(page);
  await search(page);
  await expect(page.locator(".recipe-candidate")).toHaveCount(2);
  await page
    .getByRole("button", { name: "原始链接", exact: true })
    .first()
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { openedRecipeUrl: string }).openedRecipeUrl,
    ),
  ).toContain("123451");
  await page.getByLabel("对厨房助手说").fill("下次继续");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await expect(page.locator(".recipe-candidate")).toHaveCount(2);
  await expect(page.getByLabel("对厨房助手说")).toHaveValue("下次继续");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "清除聊天记录", exact: true })
    .click();
  await expect(page.locator(".recipe-candidate")).toHaveCount(0);
  await expect(page.getByLabel("对厨房助手说")).toHaveValue("");
  await page.getByRole("button", { name: "关闭面板", exact: true }).click();
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  await expect(page.locator(".chat-message")).toHaveCount(0);
});

test("site metadata is read directly without requesting all detail pages", async ({
  page,
}) => {
  await stub(page, "site");
  await assistant(page);
  await search(page);
  await expect(page.locator(".recipe-candidate")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "核验原页", exact: true }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as { aiCalls: { verifyUrl?: string }[] }
          ).aiCalls.filter((c) => c.verifyUrl).length,
      ),
    )
    .toBe(0);
  await expect(
    page.getByText("下厨房站内搜索 · 当前页按做过人数排序", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".recipe-candidate").last()).toContainText(
    "已读取下厨房站内搜索页",
  );
});

test("AI import carries downloaded cover through editable draft and final confirmation", async ({
  page,
}) => {
  await stub(page, "images");
  await assistant(page);
  await search(page);
  await page.getByRole("button", { name: "整理这道菜" }).first().click();
  await expect(page.locator(".import-cover-preview")).toHaveAttribute(
    "src",
    /^data:image\/png/,
  );
  await page.getByRole("button", { name: "编辑后导入" }).click();
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          savedCommands: { command: { draft: { media: { cover: string } } } }[];
        }
      ).savedCommands,
  );
  expect(calls[0].command.draft.media.cover).toMatch(/^data:image\/png/);
});

test("Enter sends, Shift Enter inserts a newline, and Chinese composition does not submit", async ({
  page,
}) => {
  await stub(page);
  await assistant(page);
  const input = page.getByLabel("对厨房助手说");
  await input.fill("搜索番茄炒蛋");
  await input.press("Shift+Enter");
  await expect(input).toHaveValue("搜索番茄炒蛋\n");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    isComposing: true,
    keyCode: 229,
  });
  await expect(page.locator(".recipe-candidate")).toHaveCount(0);
  await input.press("Enter");
  await expect(page.locator(".recipe-candidate")).toHaveCount(2);
});

test("rate limiting pauses remaining external candidate detail requests", async ({
  page,
}) => {
  await stub(page, "rate");
  await assistant(page);
  await search(page);
  await expect(page.locator(".recipe-candidate").first()).toContainText(
    "限制了访问频率",
  );
  await expect(
    page.getByRole("button", { name: "重试搜索", exact: true }),
  ).toBeEnabled();
  const count = await page.evaluate(
    () =>
      (
        window as unknown as { aiCalls: { verifyUrl?: string }[] }
      ).aiCalls.filter((c) => c.verifyUrl).length,
  );
  expect(count).toBe(1);
});
