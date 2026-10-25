import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import { defaultPreferences } from "../src/domain/preferences";

async function fixture(page: Page) {
  await page.addInitScript(
    ({ original, defaults }) => {
      const state = structuredClone(original);
      state.preferences =
        JSON.parse(
          localStorage.getItem("settings-test-preferences") ?? "null",
        ) ?? defaults;
      const target = window as unknown as {
        isTauri: boolean;
        settingsCalls: string[];
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      target.isTauri = true;
      target.settingsCalls = [];
      let history: unknown = {
        messages: [],
        candidates: [],
        input: "",
        pendingUrl: "",
        pasted: "",
      };
      target.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          target.settingsCalls.push(name);
          if (name === "kitchen_bootstrap") return state;
          if (name === "kitchen_preferences_save") {
            state.preferences = args.preferences as typeof defaults;
            localStorage.setItem(
              "settings-test-preferences",
              JSON.stringify(state.preferences),
            );
            return null;
          }
          if (name === "kitchen_shopping")
            return {
              weekStart: args.weekStart,
              asOf: "2026-10-25",
              items: [],
              reviewNotes: [],
              pastPlanCount: 0,
            };
          if (name === "kitchen_backup_status")
            return {
              directory: "C:\\Synthetic\\Chefish\\backups",
              latest: 1792886400,
              count: 2,
            };
          if (name === "kitchen_backup_create") return "测试厨房备份.sqlite3";
          if (name === "kitchen_backup_preview")
            return {
              token: "synthetic-restore-token",
              fileName: "测试厨房备份.sqlite3",
              schemaVersion: 11,
              recipes: 12,
              inventoryLots: 8,
              plannedMeals: 16,
              cookingSessions: 4,
            };
          if (
            name === "kitchen_backup_cancel" ||
            name === "kitchen_backup_open_folder"
          )
            return null;
          if (name === "kitchen_backup_restore") {
            state.preferences = { ...defaults, defaultServings: 3 };
            return null;
          }
          if (name === "kitchen_ai_history") return history;
          if (name === "kitchen_ai_save_history") {
            history = args.history;
            return null;
          }
          if (name === "kitchen_ai_settings")
            return {
              settings: {
                provider: "deepseek",
                model: "synthetic-model",
                timeout: 90,
                maxTokens: 8192,
              },
              configured: ["deepseek"],
            };
          if (name === "kitchen_ai_route")
            return { action: "none", message: "这是临时数据下的固定回答。" };
          throw { message: `测试未提供命令 ${name}` };
        },
      };
    },
    {
      original: { ...initialState(), preferences: defaultPreferences },
      defaults: defaultPreferences,
    },
  );
  await page.goto("/");
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  return page.getByRole("dialog", { name: "厨房设置", exact: true });
}

test("settings move into profile and preferences persist, scale detail and prefill new menus", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page
      .getByRole("navigation", { name: "全局导航" })
      .getByRole("button", { name: "备份与恢复" }),
  ).toHaveCount(0);
  const dialog = await openSettings(page);
  await page.getByLabel("默认用餐人数").fill("5");
  await page
    .getByLabel("口味偏好", { exact: true })
    .fill("少辣，工作日半小时内做好");
  await page.getByLabel("忌口与饮食要求", { exact: true }).fill("不吃花生");
  await page
    .getByLabel("厨房与厨具", { exact: true })
    .fill("没有烤箱，有空气炸锅");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("设置已保存");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await openSettings(page);
  await expect(page.getByLabel("默认用餐人数")).toHaveValue("5");
  await expect(page.getByLabel("忌口与饮食要求", { exact: true })).toHaveValue(
    "不吃花生",
  );
  await page.getByRole("button", { name: "清空忌口与饮食要求" }).click();
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "全局导航" })
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.locator(".recipe-card .photo-link").first().click();
  await expect(page.getByLabel("菜谱用餐人数")).toHaveValue("5");
  await expect(page.locator(".detail-hero")).toContainText(
    `${initialState().recipes[0].servings} 标准份`,
  );
  await page.getByLabel("菜谱用餐人数").fill("4");
  await page.getByRole("button", { name: "加入周菜单", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByLabel("用餐人数", { exact: true }),
  ).toHaveValue("4");
});

test("general settings apply on restart and Ctrl Enter sends while Enter inserts newline", async ({
  page,
}) => {
  await fixture(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByLabel("启动页面").selectOption("home");
  await page.getByRole("radio", { name: "Ctrl + Enter 发送" }).check();
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page
      .getByRole("navigation", { name: "全局导航" })
      .getByRole("button", { name: "每周菜单" }),
  ).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(
    page
      .getByRole("navigation", { name: "全局导航" })
      .getByRole("button", { name: "首页" }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  const input = page.getByLabel("对厨房助手说");
  await expect(input).toBeEnabled();
  await input.fill("今天吃什么");
  await input.press("Enter");
  await expect(input).toHaveValue("今天吃什么\n");
  await input.press("Control+Enter");
  await expect(
    page.getByText("这是临时数据下的固定回答。", { exact: true }),
  ).toBeVisible();
});

test("backup preview, directory access and restore confirmation stay inside settings", async ({
  page,
}) => {
  await fixture(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "数据与备份" }).click();
  await expect(dialog.getByText(/2 份备份/)).toBeVisible();
  await page.getByRole("switch", { name: "每日自动备份" }).uncheck();
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.getByRole("button", { name: "打开备份目录" }).click();
  await page.getByRole("button", { name: "立即备份" }).click();
  await expect(
    dialog.locator(".settings-backup").getByRole("status"),
  ).toContainText("备份已保存");
  await page.getByRole("button", { name: "选择备份", exact: true }).click();
  await expect(page.getByRole("region", { name: "恢复预览" })).toContainText(
    "12",
  );
  page.once("dialog", (prompt) => prompt.accept());
  await page.getByRole("button", { name: "确认恢复", exact: true }).click();
  await expect(
    dialog.getByText("数据已恢复，恢复前的内容也已留存备份。", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "用餐与偏好" }).click();
  await expect(page.getByLabel("默认用餐人数")).toHaveValue("3");
});

test("settings layout fits supported sizes and keyboard navigation keeps footer accessible", async ({
  page,
}) => {
  await fixture(page);
  const dialog = await openSettings(page);
  await page
    .getByLabel("口味偏好", { exact: true })
    .fill("喜欢家常菜，稍微清淡一些");
  for (const [width, height] of [
    [1000, 700],
    [1280, 800],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      dialog.getByRole("button", { name: "保存设置", exact: true }),
    ).toBeInViewport();
    expect(
      await dialog.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return (
          box.left >= 0 &&
          box.right <= innerWidth &&
          box.top >= 0 &&
          box.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: `docs/screenshots/settings/preferences-${width}.png`,
    });
  }
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await dialog.getByRole("tab", { name: "用餐与偏好" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    dialog.getByRole("tab", { name: "通用", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: "docs/screenshots/settings/general-1440.png" });
  await dialog.getByRole("tab", { name: "数据与备份" }).click();
  await page.getByRole("button", { name: "选择备份", exact: true }).click();
  await page.screenshot({ path: "docs/screenshots/settings/data-1440.png" });
});

test("dragging a new dish uses the saved default without rewriting existing meals", async ({
  page,
}) => {
  await page.goto("/");
  const dialog = await openSettings(page);
  await page.getByLabel("默认用餐人数").fill("4");
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.keyboard.press("Escape");
  const source = page.locator(".pool-card .draggable").first();
  const target = page.locator('[data-slot="2026-10-12|早餐"]');
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 25, from.y + 20);
  await page.mouse.down();
  await page.mouse.move(from.x + 45, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + 35, to.y + 30, { steps: 15 });
  await page.mouse.up();
  await expect(target.locator(".planned-card")).toContainText("4 人份");
  await expect(
    page.locator('[data-slot="2026-10-13|午餐"] .planned-card'),
  ).toContainText("2 人份");
});

test("cloud settings explain an unconnected project without changing local data", async ({
  page,
}) => {
  await fixture(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "账户与云端", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "云服务尚未连接" }),
  ).toBeVisible();
  await expect(dialog).toContainText("Chefish 独立云项目");
  await expect(dialog).toContainText("本机数据与本地备份仍可正常使用");
  const calls = await page.evaluate(
    () => (window as unknown as { settingsCalls: string[] }).settingsCalls,
  );
  expect(calls.filter((name) => name.startsWith("cloud_backup_"))).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/settings/cloud-unconfigured.png",
  });
  await dialog.getByRole("tab", { name: "数据与备份", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "立即备份", exact: true }),
  ).toBeEnabled();
});

test("cloud verification, upload, preview and confirmed restore keep settings usable", async ({
  page,
}) => {
  // Service fixture for account/UI states; transport and rules use real emulators.
  await page.route("**/src/services/cloudClient.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      export const cloudConfigured = true;
      export const cloudError = e => e.message || '测试错误';
      let listener, user = null;
      export function watchAccount(next) { listener = next; queueMicrotask(() => next(user)); return () => { listener = null; }; }
      export async function login(email, password, register) { user = { uid: 'synthetic-user', email, emailVerified: !register }; listener?.(user); }
      export async function logout() { user = null; listener?.(null); }
      export async function resetPassword() {}
      export async function verifyEmail() {}
      export async function refreshAccount() { user.emailVerified = true; return user; }
      export const snapshotBridge = {};
      const backup = { id: 'synthetic-backup', createdAt: 1792886400, sizeBytes: 102400, chunks: [] };
      export const repository = () => ({
        list: async () => [backup],
        upload: async (_, progress) => { progress('正在上传 1 / 1…'); await new Promise(resolve => setTimeout(resolve, 600)); return backup; },
        download: async () => ({ token: 'cloud-preview-token', recipes: 4, inventoryLots: 2, plannedMeals: 3, cookingSessions: 1, fileName: '云端厨房备份' })
      });
    `,
    }),
  );
  await fixture(page);
  const dialog = await openSettings(page);
  await dialog.getByRole("tab", { name: "账户与云端", exact: true }).click();
  await dialog.getByRole("button", { name: "注册新账户", exact: true }).click();
  await dialog
    .getByLabel("邮箱", { exact: true })
    .fill("synthetic@example.test");
  await dialog.getByLabel("密码", { exact: true }).fill("synthetic-password");
  await dialog.getByRole("button", { name: "创建账户", exact: true }).click();
  await expect(dialog).toContainText("请先验证邮箱");
  await expect(
    dialog.getByRole("button", { name: "上传备份", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "我已验证，刷新", exact: true })
    .click();
  await dialog.getByRole("button", { name: "上传备份", exact: true }).click();
  await expect(dialog.getByRole("tab", { name: "数据与备份" })).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("厨房备份已上传。");
  await dialog.getByRole("button", { name: "下载预览", exact: true }).click();
  const preview = dialog.getByRole("region", { name: "云备份恢复预览" });
  await expect(preview).toContainText("本机聊天记录、通用设置及模型密钥会保留");
  await page.screenshot({
    path: "docs/screenshots/settings/cloud-preview-fixture.png",
  });
  page.once("dialog", (prompt) => prompt.dismiss());
  await preview.getByRole("button", { name: "确认恢复云备份" }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { settingsCalls: string[] }).settingsCalls.filter(
        (c) => c === "kitchen_backup_restore",
      ),
    ),
  ).toHaveLength(0);
  page.once("dialog", (prompt) => prompt.accept());
  await preview.getByRole("button", { name: "确认恢复云备份" }).click();
  await expect(dialog.getByRole("status")).toContainText("厨房数据已恢复");
  await dialog.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "登录", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "用餐与偏好", exact: true }).click();
  await expect(dialog.getByLabel("默认用餐人数")).toHaveValue("3");
});
