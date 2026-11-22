import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import { answerAppDialog } from "./helpers/appDialog";
const html =
  '<h1 class="page-title">验证后测试菜</h1><div class="ings"><table><tr><td class="name">鸡蛋</td><td class="unit">2个</td></tr></table></div><div class="steps"><li><p class="text">炒熟。</p></li></div>';
async function setup(page: import("@playwright/test").Page) {
  await page.addInitScript(
    ({ state, html }) => {
      Object.assign(window, {
        isTauri: true,
        siteCalls: [],
        __TAURI_INTERNALS__: {
          invoke: async (name: string, args: unknown) => {
            (window as unknown as { siteCalls: unknown[] }).siteCalls.push({
              name,
              args,
            });
            if (name === "kitchen_bootstrap") return state;
            if (name === "kitchen_ai_settings")
              return { settings: { provider: "deepseek" }, configured: [] };
            if (name === "kitchen_import_url")
              throw { code: "SITE_VERIFICATION", message: "需要验证" };
            if (name === "kitchen_site_open") return null;
            if (name === "kitchen_site_read") return html;
            if (name === "kitchen_import_images") return { warnings: [] };
            throw { message: "测试未提供的命令" };
          },
        },
      });
    },
    { state: initialState(), html },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "导入菜谱", exact: true }).click();
  await page.getByRole("button", { name: "下厨房链接 / HTML" }).click();
  await page
    .getByLabel("下厨房菜谱链接")
    .fill("https://www.xiachufang.com/recipe/107076587/");
  await page.getByRole("button", { name: "读取链接", exact: true }).click();
}
test("verification returns to an editable preview without saving automatically", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "打开下厨房", exact: true }).click();
  await page.getByRole("button", { name: "继续读取", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "验证后测试菜" }),
  ).toBeVisible();
  const calls = await page.evaluate(
    () =>
      (window as unknown as { siteCalls: { name: string; args: unknown }[] })
        .siteCalls,
  );
  expect(calls.filter((c) => c.name === "kitchen_site_read")).toEqual([
    {
      name: "kitchen_site_read",
      args: {
        url: "https://www.xiachufang.com/recipe/107076587/",
        mode: "recipe",
      },
    },
  ]);
  expect(calls.some((c) => c.name === "kitchen_execute")).toBe(false);
  await page.screenshot({
    path: "docs/screenshots/site-verification/preview.png",
  });
});
test("cancelling verification never opens the site window or writes a recipe", async ({
  page,
}) => {
  await setup(page);
  await answerAppDialog(page, false);
  await expect(page.getByRole("alert")).toContainText("已取消读取");
  const calls = await page.evaluate(
    () => (window as unknown as { siteCalls: { name: string }[] }).siteCalls,
  );
  expect(
    calls.some((c) =>
      ["kitchen_site_open", "kitchen_site_read", "kitchen_execute"].includes(
        c.name,
      ),
    ),
  ).toBe(false);
});

test("search verification resumes with the requested site results", async ({
  page,
}) => {
  await page.addInitScript(
    ({ state }) => {
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (name: string) => {
            if (name === "kitchen_bootstrap") return state;
            if (name === "kitchen_ai_search")
              throw { code: "SITE_VERIFICATION", message: "需要验证" };
            if (name === "kitchen_site_open") return null;
            if (name === "kitchen_site_read")
              return [
                {
                  id: "verified",
                  title: "验证后的候选",
                  url: "https://www.xiachufang.com/recipe/107076587/",
                },
              ];
            throw { message: "测试未提供命令" };
          },
        },
      });
    },
    { state: initialState() },
  );
  await page.goto("/");
  const result = page.evaluate(async () => {
    const { searchRecipePages } = await import(
      ["/src/services/siteReader.ts"].join("")
    );
    return searchRecipePages("鸡蛋", 50);
  });
  await page.getByRole("button", { name: "打开下厨房", exact: true }).click();
  await page.getByRole("button", { name: "继续读取", exact: true }).click();
  expect(await result).toMatchObject([
    { id: "verified", title: "验证后的候选" },
  ]);
});
