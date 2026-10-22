import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=";
test("local cover and original step gallery render in recipe detail without remote requests", async ({
  page,
}) => {
  const state = initialState();
  state.recipes[0].media = {
    cover: png,
    steps: [{ image: png, sourceStep: 3 }],
  };
  state.recipes[0].image = png;
  await page.addInitScript(
    (state) =>
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (name: string) => {
            if (name === "kitchen_bootstrap") return state;
            return null;
          },
        },
      }),
    state,
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await expect(page.locator(".recipe-card img").first()).toHaveAttribute(
    "src",
    png,
  );
  await page.locator(".recipe-title").first().click();
  await expect(page.getByRole("heading", { name: "步骤原图" })).toBeVisible();
  await expect(page.getByAltText("原步骤 3")).toHaveAttribute("src", png);
});
test("HTML image extraction keeps source-step indices and ignores unrelated images", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { recipeTextFromHtml } = await import(
      ["/src/domain/recipeImport.ts"].join("")
    );
    return JSON.parse(
      recipeTextFromHtml(
        `<img src="https://evil.test/track"><script type="application/ld+json">{"@type":"Recipe","image":"https://i2.chuimg.com/cover.jpg"}</script><div class="steps"><li><p>一</p></li><li><img data-src="https://i2.chuimg.com/step.jpg" src="data:image/png;base64,AAAA"></li></div>`,
      ),
    ).imageSources;
  });
  expect(result).toEqual({
    cover: "https://i2.chuimg.com/cover.jpg",
    steps: [{ url: "https://i2.chuimg.com/step.jpg", sourceStep: 2 }],
  });
});

for (const mode of ["site", "html"]) {
  test(`repair original images from ${mode} keeps existing text and ingredients`, async ({
    page,
  }) => {
    const state = initialState();
    const original = state.recipes[0];
    original.source = {
      url: "https://www.xiachufang.com/recipe/104493058/",
      author: "作者",
      ingredientText: [],
    };
    await page.addInitScript(
      ({ state, png }) => {
        Object.assign(window, {
          isTauri: true,
          imageWrites: [],
          __TAURI_INTERNALS__: {
            invoke: async (name: string, args: unknown) => {
              if (name === "kitchen_bootstrap") return state;
              if (
                name === "kitchen_recipe_images" ||
                name === "kitchen_import_images"
              )
                return {
                  media: {
                    cover: png,
                    steps: [
                      { image: png, sourceStep: 1 },
                      { image: png, sourceStep: 14 },
                    ],
                  },
                  warnings: [],
                };
              if (name === "kitchen_execute") {
                (
                  window as unknown as { imageWrites: unknown[] }
                ).imageWrites.push(args);
                return null;
              }
              return null;
            },
          },
        });
      },
      { state, png },
    );
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    await page.locator(".recipe-title").first().click();
    if (mode === "site")
      await page.getByRole("button", { name: "补充原图", exact: true }).click();
    else {
      await page
        .getByText("原页能正常打开？粘贴 HTML 补图", { exact: true })
        .click();
      await page
        .getByLabel("原页 HTML 补图")
        .fill(
          '<div class="steps"><li><img src="https://i2.chuimg.com/step.jpg"></li></div>',
        );
      await page
        .getByRole("button", { name: "从 HTML 补充原图", exact: true })
        .click();
    }
    await expect(page.getByRole("status")).toContainText("已保存 2 张步骤原图");
    const writes = await page.evaluate(
      () =>
        (
          window as unknown as {
            imageWrites: {
              command: {
                type: string;
                draft: {
                  name: string;
                  steps: string[];
                  media: { steps: { sourceStep: number }[] };
                };
              };
            }[];
          }
        ).imageWrites,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0].command.type).toBe("revise_recipe");
    expect(writes[0].command.draft.name).toBe(original.name);
    expect(writes[0].command.draft.steps).toEqual(original.steps);
    expect(writes[0].command.draft.media.steps[1].sourceStep).toBe(14);
  });
}
