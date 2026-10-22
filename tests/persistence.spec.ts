import { test, expect, type Page } from "@playwright/test";

test.use({ timezoneId: "Asia/Shanghai" });

// IPC contract tests only. Real SQLite durability is tested in Rust separately.
async function nativeStub(
  page: Page,
  failure: "load" | "save" | "refresh" | "none",
) {
  await page.addInitScript((mode) => {
    const target = window as unknown as {
      isTauri: boolean;
      commandCount: number;
      __TAURI_INTERNALS__: { invoke: (name: string) => Promise<unknown> };
    };
    target.isTauri = true;
    target.commandCount = 0;
    target.__TAURI_INTERNALS__ = {
      async invoke(name) {
        if (name === "kitchen_execute") {
          target.commandCount++;
          if (mode === "save") throw { message: "测试数据库拒绝写入" };
          return null;
        }
        if (mode === "load" || (mode === "refresh" && target.commandCount))
          throw { message: "测试数据库读取失败" };
        return {
          recipes: [],
          recipeCategories: ["未分类", "家常菜"],
          ingredientCategories: ["未分类"],
          ingredients: [],
          lots: [],
          plans: [],
          shopping: [],
          favorites: [],
          inspiration: [],
          logs: [],
          hiddenNeeds: [],
          memo: "",
          dataRevision: "0",
        };
      },
    };
  }, failure);
}

async function createDraft(page: Page) {
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "创建菜谱", exact: true }).click();
  await page.getByLabel("菜谱名称", { exact: true }).fill("失败时保留的草稿");
  await page.getByLabel("步骤1做法").fill("煮熟。\n装盘。");
}

test("native startup error offers retry without injecting demo recipes", async ({
  page,
}) => {
  await nativeStub(page, "load");
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText("测试数据库读取失败");
  await expect(page.getByRole("button", { name: "重试加载" })).toBeVisible();
  await expect(page.locator(".recipe-card")).toHaveCount(0);
});

test("failed native save retains draft and reports failure without success", async ({
  page,
}) => {
  await nativeStub(page, "save");
  await page.goto("/");
  await createDraft(page);
  await page.getByRole("button", { name: "保存菜谱", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("测试数据库拒绝写入");
  await expect(page.getByLabel("菜谱名称", { exact: true })).toHaveValue(
    "失败时保留的草稿",
  );
  await expect(page.locator(".recipe-card")).toHaveCount(0);
});

test("committed write with refresh error closes form and prevents duplicate submission", async ({
  page,
}) => {
  await nativeStub(page, "refresh");
  await page.goto("/");
  await createDraft(page);
  await page.getByRole("button", { name: "保存菜谱", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "已写入本地数据库，但界面读取失败",
  );
  await expect(page.getByRole("alert")).toContainText("测试数据库读取失败");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { commandCount: number }).commandCount,
      ),
    )
    .toBe(1);
});

test("native local calendar changes across midnight without reloading", async ({
  page,
}) => {
  await nativeStub(page, "none");
  await page.clock.install({ time: new Date("2026-12-31T15:59:50Z") });
  await page.goto("/");
  await expect(page.locator(".app-footer")).toContainText(
    "本机日期 2026-12-31",
  );
  await page.clock.fastForward(31000);
  await expect(page.locator(".app-footer")).toContainText(
    "本机日期 2027-01-01",
  );
});
