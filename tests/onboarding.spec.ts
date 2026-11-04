import { test, expect, type Page } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import { defaultPreferences } from "../src/domain/preferences";
import { readFileSync } from "node:fs";
import type { RecipeTag } from "../src/domain/recipeTags";
const builtinRecipeTags: RecipeTag[] = JSON.parse(
  readFileSync("resources/recipe-tags/catalog.v1.json", "utf8"),
).tags.map((t: RecipeTag, position: number) => ({
  ...t,
  enabled: t.defaultEnabled,
  deleted: false,
  builtin: true,
  position,
}));

async function setup(
  page: Page,
  existing = false,
  failPreferences = false,
  holdStartup = false,
) {
  await page.route("**/src/services/cloudClient.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    export const cloudConfigured = true, cloudError = e => e.message;
    let user = null; const listeners = new Set();
    export function watchAccount(next) { listeners.add(next); queueMicrotask(() => next(user)); return () => listeners.delete(next); }
    export async function login(email, password, register) { user = {uid:'synthetic',email,emailVerified:!register}; listeners.forEach(next => next(user)); }
    export async function refreshAccount() { user.emailVerified = true; return user; }
    export async function verifyEmail() {} export async function logout() {} export async function resetPassword() {}
    export const syncRepository = () => ({head:async () => null}), repository = () => ({}), snapshotBridge = {};
  `,
    }),
  );
  const kitchen = initialState();
  if (!existing)
    Object.assign(kitchen, {
      recipes: [],
      ingredients: [],
      plans: [],
      lots: [],
      logs: [],
      seasonings: [],
    });
  kitchen.preferences = { ...defaultPreferences };
  kitchen.recipeTags = builtinRecipeTags;
  await page.addInitScript(
    ({ kitchen, failPreferences, holdStartup }) => {
      const state =
        JSON.parse(localStorage.getItem("onboarding-test-kitchen") ?? "null") ??
        kitchen;
      const settings = JSON.parse(
        localStorage.getItem("onboarding-test-steward") ?? "null",
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
        recommendationsDay: 0,
        recommendationsTime: "18:00",
        recommendationInterval: 7,
        meals: ["晚餐"],
        allowEstimates: true,
        allowAutoEnableTags: false,
      };
      const model = {
        settings: {
          provider: "deepseek",
          model: "deepseek-flash",
          timeout: 90,
          maxTokens: 8192,
        },
        configured: [] as string[],
      };
      const target = window as unknown as {
        isTauri: boolean;
        onboardingWrites: string[];
        preferenceFails: boolean;
        releaseStartup: (fail?: boolean) => void;
        __TAURI_INTERNALS__: {
          invoke: (
            name: string,
            args: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
      target.isTauri = true;
      target.onboardingWrites = [];
      target.preferenceFails = failPreferences;
      let failStartup = false;
      const startupGate = new Promise<void>((resolve) => {
        target.releaseStartup = (fail = false) => {
          failStartup = fail;
          resolve();
        };
        if (!holdStartup) resolve();
      });
      target.__TAURI_INTERNALS__ = {
        invoke: async (name, args) => {
          if (name === "kitchen_bootstrap") {
            await startupGate;
            if (failStartup) {
              throw Error("本机数据暂时无法读取，请重试。");
            }
            return state;
          }
          if (name === "kitchen_shopping")
            return {
              weekStart: args.weekStart,
              asOf: "2026-11-03",
              items: [],
              reviewNotes: [],
              pastPlanCount: 0,
            };
          if (name === "sync_state")
            return {
              replicaId: "synthetic",
              queuedOperations: 0,
              queuedBytes: 0,
              binding: null,
            };
          if (name === "kitchen_steward_state")
            return { settings, deviceId: "synthetic", items: [], runs: [] };
          if (name === "kitchen_ai_settings") return model;
          if (name === "kitchen_ai_save_settings") {
            model.configured = ["deepseek"];
            model.settings = args.settings as typeof model.settings;
            target.onboardingWrites.push(name);
            return model;
          }
          if (name === "kitchen_ai_test") return null;
          if (name === "kitchen_onboarding_interpret")
            return {
              defaultServings: 3,
              taste: "喜欢清淡",
              restrictions: "不吃香菜",
              equipment: "电磁炉",
              cuisineIds: ["cuisine.sichuan"],
            };
          if (name === "kitchen_preferences_save") {
            if (target.preferenceFails) throw { message: "模拟保存失败" };
            state.preferences = args.preferences;
            target.onboardingWrites.push(name);
            localStorage.setItem(
              "onboarding-test-kitchen",
              JSON.stringify(state),
            );
            return null;
          }
          if (name === "kitchen_execute") {
            const cmd = args.command as {
              type: string;
              entries: typeof kitchen.recipeTags;
            };
            if (cmd.type !== "save_recipe_tag_definitions")
              throw Error("unexpected command");
            state.recipeTags = state.recipeTags.map(
              (t: (typeof builtinRecipeTags)[number]) =>
                cmd.entries!.find((e) => e.id === t.id) ?? t,
            );
            target.onboardingWrites.push(cmd.type);
            localStorage.setItem(
              "onboarding-test-kitchen",
              JSON.stringify(state),
            );
            return {};
          }
          if (name === "kitchen_steward_settings") {
            Object.assign(settings, args.settings);
            target.onboardingWrites.push(name);
            localStorage.setItem(
              "onboarding-test-steward",
              JSON.stringify(settings),
            );
            return null;
          }
          return null;
        },
      };
    },
    { kitchen, failPreferences, holdStartup },
  );
  await page.goto("/");
}
const wizard = (page: Page) =>
  page.getByRole("dialog", { name: "设置我的厨房" });
const clickNext = (page: Page) =>
  wizard(page)
    .locator(".onboarding-footer")
    .getByRole("button", { name: /^(继续|保存并继续|识别并继续|手动填写)$/ })
    .click();

test("empty kitchen opens setup, every step can be skipped, completed setup stays dismissed", async ({
  page,
}) => {
  await setup(page);
  await expect(wizard(page)).toBeVisible();
  for (const width of [1000, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: `docs/screenshots/onboarding/${width}-welcome.png`,
      animations: "disabled",
    });
  }
  await wizard(page).getByRole("button", { name: "开始设置" }).click();
  for (let i = 0; i < 5; i++) {
    if (i === 1)
      await wizard(page)
        .getByRole("button", { name: "跳过描述", exact: true })
        .click();
    await wizard(page)
      .getByRole("button", { name: "跳过这步", exact: true })
      .click();
  }
  await expect(
    wizard(page).getByText("你的厨房，准备好了。", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { onboardingWrites: string[] }).onboardingWrites,
    ),
  ).toEqual([]);
  await wizard(page).getByRole("button", { name: "进入我的厨房" }).click();
  await page.reload();
  await expect(wizard(page)).toHaveCount(0);
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByRole("button", { name: "重新开始初始化" }).click();
  await expect(wizard(page)).toBeVisible();
  await wizard(page).getByRole("button", { name: "稍后设置" }).click();
  await page.reload();
  await expect(wizard(page)).toHaveCount(0);
});

test("model credentials, reviewed AI preferences, cuisine switches, steward and account use existing saves", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await wizard(page).getByRole("button", { name: "开始设置" }).click();
  await wizard(page)
    .getByLabel("API 密钥", { exact: true })
    .fill("synthetic-key-not-for-storage");
  await wizard(page)
    .getByRole("button", { name: "保存并继续", exact: true })
    .click();
  await wizard(page)
    .getByLabel("随心说说你的习惯")
    .fill("三个人，清淡，不吃香菜，只有电磁炉，常吃川菜");
  await expect(wizard(page).getByLabel("平常用餐人数")).toHaveCount(0);
  await wizard(page).getByRole("button", { name: "识别并继续" }).click();
  await expect(wizard(page).getByLabel("平常用餐人数")).toHaveValue("3");
  await expect(
    wizard(page).getByLabel("早餐", { exact: true }),
  ).not.toBeChecked();
  await expect(wizard(page).getByLabel("午餐", { exact: true })).toBeChecked();
  await expect(wizard(page).getByLabel("晚餐", { exact: true })).toBeChecked();
  await wizard(page)
    .getByLabel("口味偏好", { exact: true })
    .fill("喜欢清淡，周末可以吃辣");
  await page.screenshot({
    path: "docs/screenshots/onboarding/preferences.png",
    animations: "disabled",
  });
  await clickNext(page);
  await wizard(page).getByRole("button", { name: "西餐", exact: true }).click();
  await wizard(page).locator(".onboarding-cuisines summary").first().click();
  await expect(
    wizard(page).getByRole("button", { name: "川菜", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: "docs/screenshots/onboarding/cuisines.png",
    animations: "disabled",
  });
  await clickNext(page);
  await page.reload();
  await expect(
    wizard(page).getByText("让管家照看一些小事", { exact: true }),
  ).toBeVisible();
  await wizard(page)
    .getByRole("switch", { name: "开机时在后台运行", exact: true })
    .check();
  await wizard(page)
    .getByRole("button", { name: "保存并继续", exact: true })
    .click();
  await wizard(page)
    .getByLabel("邮箱", { exact: true })
    .fill("synthetic@example.test");
  await wizard(page)
    .getByLabel("密码", { exact: true })
    .fill("synthetic-password");
  await wizard(page)
    .getByRole("button", { name: "注册并发送验证邮件" })
    .click();
  await wizard(page)
    .getByRole("button", { name: "我已验证", exact: true })
    .click();
  await expect(
    wizard(page).getByText("邮箱已验证", { exact: true }),
  ).toBeVisible();
  await clickNext(page);
  const saved = await page.evaluate(() => ({
    state: JSON.parse(localStorage.getItem("onboarding-test-kitchen")!),
    steward: JSON.parse(localStorage.getItem("onboarding-test-steward")!),
    storage: JSON.stringify(localStorage),
  }));
  expect(saved.state.preferences).toMatchObject({
    defaultServings: 3,
    restrictions: "不吃香菜",
    taste: "喜欢清淡，周末可以吃辣",
    equipment: "电磁炉",
  });
  expect(
    saved.state.recipeTags.find(
      (t: { id: string }) => t.id === "cuisine.sichuan",
    ).enabled,
  ).toBe(true);
  expect(
    saved.state.recipeTags.find(
      (t: { id: string }) => t.id === "cuisine.western",
    ).enabled,
  ).toBe(false);
  expect(saved.steward).toMatchObject({
    enabled: false,
    autostart: true,
    allowAutoEnableTags: false,
  });
  expect(saved.storage).not.toContain("synthetic-key-not-for-storage");
  expect(saved.storage).not.toContain("synthetic-password");
  await page.screenshot({
    path: "docs/screenshots/onboarding/finish.png",
    animations: "disabled",
  });
});

test("existing kitchen is untouched and preference save failure retains input", async ({
  page,
}) => {
  await setup(page, true, true);
  await expect(wizard(page)).toHaveCount(0);
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  await page.getByRole("tab", { name: "通用", exact: true }).click();
  await page.getByRole("button", { name: "重新开始初始化" }).click();
  await wizard(page).getByRole("button", { name: "开始设置" }).click();
  await wizard(page).getByRole("button", { name: "跳过这步" }).click();
  await wizard(page).getByRole("button", { name: "跳过描述" }).click();
  await wizard(page)
    .getByLabel("忌口与饮食要求", { exact: true })
    .fill("保留我填的忌口");
  await clickNext(page);
  await expect(wizard(page).getByRole("alert")).toContainText("偏好未保存");
  await expect(
    wizard(page).getByLabel("忌口与饮食要求", { exact: true }),
  ).toHaveValue("保留我填的忌口");
  await page.evaluate(() => {
    (window as unknown as { preferenceFails: boolean }).preferenceFails = false;
  });
  await clickNext(page);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("onboarding-test-kitchen")!),
  );
  expect(saved.recipes).toHaveLength(initialState().recipes.length);
  expect(saved.preferences.restrictions).toBe("保留我填的忌口");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.screenshot({
    path: "docs/screenshots/onboarding/reduced-motion.png",
    animations: "disabled",
  });
});

test("compact setup fits every step including scaled short windows and shows completion motion", async ({
  page,
}) => {
  test.setTimeout(60000);
  await setup(page);
  for (const [width, height] of [
    [571, 400],
    [1000, 700],
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => localStorage.removeItem("chefish:onboarding:v1"));
    await page.reload();
    await expect(wizard(page)).toBeVisible();
    const baseline = await wizard(page).boundingBox();
    for (let step = 0; step <= 6; step++) {
      const dialog = wizard(page);
      await expect(dialog).toHaveClass(new RegExp(`onboarding-step-${step}`));
      await expect
        .poll(() =>
          dialog.evaluate((el, baseline) => {
            const r = el.getBoundingClientRect();
            const footer = el
              .querySelector(".onboarding-footer")!
              .getBoundingClientRect();
            return (
              Math.abs(r.width - baseline!.width) < 1 &&
              Math.abs(r.height - baseline!.height) < 1 &&
              r.top >= 15 &&
              r.bottom <= innerHeight - 15 &&
              footer.bottom <= innerHeight - 15
            );
          }, baseline),
        )
        .toBe(true);
      if (step === 0 || step === 6) {
        await expect
          .poll(() =>
            dialog
              .locator(".onboarding-content")
              .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
          )
          .toBe(true);
      }
      if (step === 2) {
        await page.screenshot({
          path: `docs/screenshots/onboarding-round4/${width}-${height}-description.png`,
          animations: "disabled",
        });
        await dialog
          .getByRole("button", { name: "跳过描述", exact: true })
          .click();
        await expect(dialog.getByLabel("平常用餐人数")).toBeVisible();
        const equipment = dialog.getByLabel("厨房与厨具", { exact: true });
        expect(
          await equipment.evaluate((el) => {
            const css = getComputedStyle(el);
            return (
              el.clientHeight >=
              2 * parseFloat(css.lineHeight) +
                parseFloat(css.paddingTop) +
                parseFloat(css.paddingBottom)
            );
          }),
        ).toBe(true);
        await expect(
          dialog.getByText("未提到的选项保留原值，你可以继续修改。", {
            exact: true,
          }),
        ).toHaveCount(0);
        const reviewBox = await dialog.boundingBox();
        expect(reviewBox!.width).toBeCloseTo(baseline!.width, 0);
        expect(reviewBox!.height).toBeCloseTo(baseline!.height, 0);
      }
      if (step === 4) {
        await expect(dialog.getByRole("switch")).toHaveCount(2);
        await expect(dialog.getByText("询问时间", { exact: true })).toHaveCount(
          0,
        );
        await dialog
          .getByRole("switch", { name: "启用厨房管家", exact: true })
          .check();
        await expect(dialog.locator(".onboarding-tasks input")).toHaveCount(3);
      }
      if (step === 6) {
        const path = dialog.locator(".onboarding-success path");
        if (width === 1000) {
          expect(
            await path.evaluate((el) => el.getAnimations().length),
          ).toBeGreaterThan(0);
        }
      }
      await page.screenshot({
        path: `docs/screenshots/onboarding-round4/${width}-${height}-step-${step}.png`,
        animations: "disabled",
      });
      if (step === 0)
        await dialog.getByRole("button", { name: "开始设置" }).click();
      else if (step < 6)
        await dialog
          .getByRole("button", { name: "跳过这步", exact: true })
          .click();
    }
  }
});

test("preference interpretation preserves fields the user did not mention", async ({
  page,
}) => {
  await setup(page);
  await wizard(page).getByRole("button", { name: "开始设置" }).click();
  await wizard(page).getByRole("button", { name: "跳过这步" }).click();
  await wizard(page).getByRole("button", { name: "跳过描述" }).click();
  await wizard(page).getByLabel("平常用餐人数").fill("3");
  await wizard(page)
    .getByLabel("忌口与饮食要求", { exact: true })
    .fill("不吃花生");
  await wizard(page).getByLabel("厨房与厨具", { exact: true }).fill("蒸锅");
  await wizard(page).getByLabel("早餐", { exact: true }).check();
  await wizard(page).getByRole("button", { name: "上一步" }).click();
  await page.evaluate(() => {
    const target = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (
          name: string,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
    const original = target.__TAURI_INTERNALS__.invoke;
    target.__TAURI_INTERNALS__.invoke = async (name, args) =>
      name === "kitchen_onboarding_interpret"
        ? {
            defaultServings: null,
            taste: "少油",
            restrictions: "",
            equipment: "",
            cuisineIds: [],
          }
        : original(name, args);
  });
  await wizard(page).getByLabel("随心说说你的习惯").fill("喜欢少油一点");
  await wizard(page).getByRole("button", { name: "识别并继续" }).click();
  await expect(
    wizard(page).getByLabel("口味偏好", { exact: true }),
  ).toHaveValue("少油");
  await expect(wizard(page).getByLabel("平常用餐人数")).toHaveValue("3");
  await expect(
    wizard(page).getByLabel("忌口与饮食要求", { exact: true }),
  ).toHaveValue("不吃花生");
  await expect(
    wizard(page).getByLabel("厨房与厨具", { exact: true }),
  ).toHaveValue("蒸锅");
  await expect(wizard(page).getByLabel("早餐", { exact: true })).toBeChecked();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { onboardingWrites: string[] }).onboardingWrites,
    ),
  ).toEqual([]);
});

test("startup screen fits, respects reduced motion, and retries a failed load", async ({
  page,
}) => {
  await setup(page, true, false, true);
  for (const [width, height] of [
    [571, 400],
    [1000, 700],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByRole("status")).toHaveText("正在读取本机数据");
    await page.screenshot({
      path: `docs/screenshots/onboarding-motion/${width}-startup.png`,
      animations: "allow",
    });
    expect(
      await page
        .locator(".startup-screen")
        .evaluate(
          (el) =>
            el.scrollHeight <= innerHeight && el.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".startup-screen")
      .evaluate((el) => el.getAnimations({ subtree: true }).length),
  ).toBe(0);
  await page.evaluate(() =>
    (
      window as unknown as { releaseStartup: (fail: boolean) => void }
    ).releaseStartup(true),
  );
  await expect(page.getByRole("alert")).toContainText("本机数据暂时无法读取");
  await page.screenshot({
    path: "docs/screenshots/onboarding-motion/startup-error.png",
  });
  await page.evaluate(() =>
    (
      window as unknown as { releaseStartup: (fail: boolean) => void }
    ).releaseStartup(false),
  );
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.locator(".startup-screen")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "全局导航" }),
  ).toBeVisible();
});

test("onboarding keeps the outgoing page hidden until its replacement commits", async ({
  page,
}) => {
  await setup(page);
  const dialog = wizard(page);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  await dialog.locator(".onboarding-content h2").focus();
  await expect(dialog.locator(".onboarding-content h2")).toHaveCSS(
    "outline-style",
    "none",
  );
  await page.evaluate(() => {
    const events: string[] = [];
    Object.assign(window, { cancelledOnboardingPages: events });
    const cancel = Animation.prototype.cancel;
    Animation.prototype.cancel = function () {
      const target = (this.effect as KeyframeEffect | null)?.target;
      if (
        target instanceof Element &&
        target.matches(".onboarding-content") &&
        this.playState === "finished"
      ) {
        events.push(target.querySelector("h2")?.textContent ?? "");
      }
      return cancel.call(this);
    };
  });
  await dialog.getByRole("button", { name: "开始设置" }).click();
  await expect(dialog).toHaveClass(/onboarding-step-1/);
  const title = await dialog.locator(".onboarding-content h2").textContent();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { cancelledOnboardingPages: string[] })
          .cancelledOnboardingPages,
    ),
  ).toEqual([title]);
  // Only the content enters; the white frame must never fade out over the page.
  expect(await dialog.evaluate((el) => el.getAnimations().length)).toBe(0);
});

test.describe("onboarding motion review", () => {
  test("record pointer transitions and check keyboard navigation", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://127.0.0.1:5173",
      viewport: { width: 1000, height: 700 },
      recordVideo: {
        dir: "test-results/onboarding-motion",
        size: { width: 1000, height: 700 },
      },
    });
    const page = await context.newPage();
    await setup(page, false, false, true);
    await page.waitForTimeout(3200); // Record one complete ambient breathing cycle.
    await page.evaluate(() =>
      (window as unknown as { releaseStartup: () => void }).releaseStartup(),
    );
    const dialog = wizard(page);
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    await page.waitForTimeout(600);
    await dialog.getByRole("button", { name: "开始设置" }).click();
    await expect(dialog).toHaveClass(/onboarding-step-1/);
    // The outgoing page finishes before the new page enters; no frame reflow.
    expect((await dialog.boundingBox())!.height).toBeCloseTo(box!.height, 0);
    await page.waitForTimeout(650);
    await dialog.getByRole("button", { name: "跳过这步" }).click();
    await expect(dialog.getByLabel("随心说说你的习惯")).toBeVisible();
    await page.waitForTimeout(650);
    await dialog.getByRole("button", { name: "手动填写" }).click();
    await expect(dialog.getByLabel("平常用餐人数")).toBeVisible();
    await page.waitForTimeout(650);
    await dialog.getByRole("button", { name: "上一步" }).click();
    await expect(dialog.getByLabel("随心说说你的习惯")).toBeVisible();
    await page.waitForTimeout(650);
    await dialog.getByRole("button", { name: "手动填写" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("平常用餐人数")).toBeVisible();
    expect(
      await dialog
        .locator(".onboarding-content > header")
        .evaluate((el) => el.getAnimations().length),
    ).toBe(0);
    for (let step = 2; step <= 5; step++) {
      await page.waitForTimeout(650);
      await dialog.getByRole("button", { name: "跳过这步" }).click();
      await expect(dialog).toHaveClass(
        new RegExp(`onboarding-step-${step + 1}`),
      );
    }
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: "docs/screenshots/onboarding-motion/finished.png",
      animations: "allow",
    });
    const video = page.video()!;
    await context.close();
    await video.saveAs("docs/screenshots/onboarding-motion/walkthrough.webm");
  });
});
