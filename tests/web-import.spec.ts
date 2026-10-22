import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

const url = "https://www.xiachufang.com/recipe/123456/";
const html = `<html><script>window.importExecuted=true</script><img src="https://example.invalid/leak"><script type="application/ld+json">${JSON.stringify(
  {
    "@graph": [
      {
        "@type": "Recipe",
        name: "本地导入测试菜",
        author: { name: "合成作者" },
        recipeIngredient: ["豆腐 0.5千克", "水 50ml", "盐 适量"],
        totalTime: "PT25M",
        recipeYield: "3人份",
        recipeInstructions: [
          { "@type": "HowToStep", name: "备料", text: "切成小块。" },
          {
            "@type": "HowToSection",
            itemListElement: [{ "@type": "HowToStep", text: "小火煮熟。" }],
          },
        ],
      },
    ],
  },
)}</script></html>`;

async function openImport(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.getByRole("button", { name: "导入菜谱", exact: true }).click();
  await page.getByRole("button", { name: "下厨房链接 / HTML" }).click();
  await page.getByLabel("下厨房菜谱链接").fill(url);
}
async function loadHtml(page: import("@playwright/test").Page, value = html) {
  await page.getByLabel("或选择本地 HTML").setInputFiles({
    name: "recipe.html",
    mimeType: "text/html",
    buffer: Buffer.from(value),
  });
}

test("HTML stays inert, editable import preserves author, quantities and step titles", async ({
  page,
}) => {
  let external = 0;
  page.on("request", (request) => {
    if (request.url().includes("example.invalid")) external++;
  });
  await openImport(page);
  await loadHtml(page);
  await expect(
    page.getByRole("heading", { name: "本地导入测试菜" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "编辑后导入" }).click();
  await expect(page.getByLabel("食材1用量")).toHaveValue("500 g");
  await expect(page.getByLabel("食材3名称")).toHaveValue("盐");
  await expect(page.getByLabel("食材3用量")).toHaveValue("适量");
  await expect(page.getByLabel("原作者")).toHaveValue("合成作者");
  await expect(page.getByLabel("步骤1标题")).toHaveValue("备料");
  await page.getByLabel("菜谱名称", { exact: true }).fill("确认后的名字");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .locator(".recipe-card")
    .filter({ hasText: "确认后的名字" })
    .locator(".recipe-title")
    .click();
  await expect(page.locator(".recipe-source")).toContainText("合成作者");
  expect(external).toBe(0);
  expect(await page.evaluate(() => "importExecuted" in window)).toBe(false);
});

test("same source with changed name requires explicit copy or revision", async ({
  page,
}) => {
  const state = initialState();
  state.recipes[0].source = { url, author: "作者", ingredientText: [] };
  await page.addInitScript((state) => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (name: string) => {
          if (name === "kitchen_bootstrap") return state;
          throw { message: "只读测试" };
        },
      },
    });
  }, state);
  await openImport(page);
  await loadHtml(page);
  await expect(page.getByRole("button", { name: "编辑后导入" })).toBeDisabled();
  await page.getByLabel("导入方式").selectOption("copy");
  await expect(page.getByRole("button", { name: "编辑后导入" })).toBeEnabled();
});

test("unsupported HTML and site rejection leave the import dialog usable", async ({
  page,
}) => {
  await openImport(page);
  await loadHtml(page, "<h1>访问受限</h1>");
  await expect(page.getByRole("alert")).toContainText("未找到菜谱正文");
  await page.getByRole("button", { name: "读取链接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("桌面版");
  await loadHtml(
    page,
    '<h1 class="page-title">旧版页面菜谱</h1><div class="ings"><table><tr><td class="name">豆腐</td><td class="unit">100克</td></tr></table></div><div class="steps"><li><p class="text">煮熟。</p></li></div>',
  );
  await expect(
    page.getByRole("heading", { name: "旧版页面菜谱" }),
  ).toBeVisible();
});

test("native URL bridge previews HTML and save failure retains the edited import draft", async ({
  page,
}) => {
  await page.addInitScript(
    ({ state, html }) => {
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (name: string, args: unknown) => {
            if (name === "kitchen_bootstrap") return state;
            if (name === "kitchen_import_url") return html;
            if (name === "kitchen_execute") {
              Object.assign(window, { attemptedImport: args });
              throw {
                code: "DATABASE_LOCKED",
                message: "数据库暂时忙，请保留草稿重试",
              };
            }
            throw { message: "未实现测试命令" };
          },
        },
      });
    },
    { state: initialState(), html },
  );
  await openImport(page);
  await page.getByRole("button", { name: "读取链接", exact: true }).click();
  await page.getByRole("button", { name: "编辑后导入" }).click();
  await page.getByLabel("菜谱名称", { exact: true }).fill("失败时保留的菜名");
  await page.getByRole("button", { name: "确认导入", exact: true }).click();
  await expect(page.getByLabel("菜谱名称", { exact: true })).toHaveValue(
    "失败时保留的菜名",
  );
  await expect(page.getByLabel("原作者")).toHaveValue("合成作者");
  const captured = await page.evaluate(
    () =>
      (
        window as unknown as {
          attemptedImport: {
            command: {
              draft: {
                source: { url: string };
                ingredients: { quantity: string }[];
              };
            };
          };
        }
      ).attemptedImport,
  );
  expect(captured.command.draft.source.url).toBe(url);
  expect(captured.command.draft.ingredients[0].quantity).toBe("500");
});

for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`import preview layout ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openImport(page);
    await page.screenshot({
      path: `docs/screenshots/web-import/${width}-source.png`,
    });
    await loadHtml(page);
    await page.getByRole("button", { name: "编辑后导入" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/web-import/${width}-preview.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("visible source ingredients remain authoritative and unified amounts can change type", async ({page}) => {
  await openImport(page);
  const pairs = [["瘦肉","150克"],["青椒","3个"],["蒜末","3瓣"],["味达美生抽","2勺"],["味达美蚝油","1勺"],["料酒","1勺"],["生粉","2勺"],["盐","2克"],["糖","5克"]];
  const table = `<h1 class="page-title">青椒肉丝测试</h1><div class="ings"><table>${pairs.map(([name,amount]) => `<tr><td class="name">${name}</td><td class="unit">${amount}</td></tr>`).join("")}</table></div><div class="steps"><li><p class="text">加生抽一勺、盐少许、糖少许，炒熟。</p></li></div>`;
  const rows = await page.evaluate(async (html) => {
    const {recipeTextFromHtml} = await import(["/src/domain/recipeImport.ts"].join(""));
    return JSON.parse(recipeTextFromHtml(html)).ingredientRows;
  }, table);
  expect(rows).toEqual(pairs.map(([name,amountText]) => ({name,amountText})));
  await loadHtml(page,table);
  await page.getByRole("button",{name:"编辑后导入"}).click();
  const editor = page.getByRole("dialog");
  await expect(editor.locator(".text-ingredient-edit")).toHaveCount(9);
  await expect(editor.getByRole("heading",{name:"原文用量"})).toHaveCount(0);
  await expect(editor.getByLabel("食材5名称",{exact:true})).toHaveValue("蒜末");
  await expect(editor.getByLabel("食材5用量",{exact:true})).toHaveValue("3瓣");
  await editor.getByLabel("食材4用量",{exact:true}).fill("少许");
  await editor.getByLabel("食材5用量",{exact:true}).fill("5 g");
  await editor.getByRole("button",{name:"确认导入",exact:true}).click();
  await expect(editor).toHaveCount(0);
  await page.locator(".recipe-card").filter({hasText:"青椒肉丝测试"}).locator(".recipe-title").click();
  await expect(page.locator(".ingredient-line")).toHaveCount(9);
  await expect(page.locator(".ingredient-line").filter({hasText:"糖"})).toContainText("少许");
  await expect(page.locator(".ingredient-line").filter({hasText:"蒜末"})).toContainText("5 g");
});
