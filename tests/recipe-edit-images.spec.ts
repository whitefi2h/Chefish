import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH9sAAAAASUVORK5CYII=";
test("recipe cover and step photos edit, AI cover stays in draft, and step viewer zooms", async ({
  page,
}) => {
  const state = initialState();
  state.recipes[0].media = {
    cover: png,
    steps: [
      { sourceStep: 1, image: png },
      { sourceStep: 2, image: png },
    ],
  };
  state.recipes[0].image = png;
  state.recipes[0].revisionId = "before";
  await page.addInitScript(
    ({ state, png }) =>
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            name: string,
            args: {
              command?: {
                draft: { media: (typeof state.recipes)[number]["media"] };
              };
            } = {},
          ) => {
            if (name === "kitchen_bootstrap") return structuredClone(state);
            if (name === "kitchen_recipe_cover")
              return {
                image: png,
                credit: {
                  sourceUrl:
                    "https://commons.wikimedia.org/wiki/File:Test_dish.jpg",
                  author: "Synthetic photo",
                  license: "CC0",
                  licenseUrl: "",
                  title: "Test dish",
                },
              };
            if (name === "kitchen_execute") {
              state.recipes[0].media = args.command!.draft.media;
              state.recipes[0].image =
                state.recipes[0].media?.cover ?? "placeholder";
              state.recipes[0].revisionId = "after";
              return null;
            }
            return null;
          },
        },
      }),
    { state, png },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "我的菜谱" })
    .click();
  await page.locator(".recipe-title").first().click();
  await page
    .getByRole("button", { name: "放大步骤1图片", exact: true })
    .click();
  const viewer = page.getByRole("dialog", { name: "步骤 1", exact: true });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "放大图片", exact: true }).click();
  await expect(viewer).toContainText("150%");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await page.getByRole("button", { name: "编辑菜谱", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑菜谱", exact: true });
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const x = c.getContext("2d")!;
    x.fillStyle = "tomato";
    x.fillRect(0, 0, 160, 90);
    return c.toDataURL("image/png").split(",")[1];
  });
  const file = {
    name: "step.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64"),
  };
  const firstStep = editor.locator(".step-edit").first();
  await expect(
    firstStep.getByLabel("步骤1做法", { exact: true }),
  ).toBeVisible();
  await firstStep
    .getByLabel("上传步骤1图片", { exact: true })
    .setInputFiles(file);
  await expect(
    editor.getByRole("img", { name: "步骤1图片", exact: true }),
  ).toHaveAttribute("src", /^data:image\/jpeg/);
  await editor
    .getByRole("button", { name: "移除步骤2图片", exact: true })
    .click();
  await editor.getByLabel("上传封面图片", { exact: true }).setInputFiles(file);
  await expect(
    editor.getByRole("img", { name: "封面图片", exact: true }),
  ).toHaveAttribute("src", /^data:image\/jpeg/);
  await editor.getByRole("button", { name: "AI 找封面", exact: true }).click();
  await expect(editor).toContainText("保存菜谱后生效");
  await expect(editor).toContainText("Synthetic photo");
  await page.screenshot({
    path: "docs/screenshots/global-features/recipe-photo-editor.png",
  });
  await editor.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByAltText("原步骤 1")).toHaveAttribute(
    "src",
    /^data:image\/jpeg/,
  );
  await expect(page.getByAltText("原步骤 2")).toHaveCount(0);
  await expect(page.locator(".steps-panel")).toContainText("Synthetic photo");
});
