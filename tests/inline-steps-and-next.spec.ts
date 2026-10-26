import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";
import { preferencesOf } from "../src/domain/preferences";
test.use({ timezoneId: "Asia/Shanghai" });
for (const width of [1280, 1920]) {
  test(`step photos follow text and next meal shows two dishes ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.clock.install({ time: new Date("2026-10-26T18:00:00+08:00") });
    const photos = await page.evaluate(() => {
      const create = (w: number, h: number) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const x = c.getContext("2d")!;
        x.fillStyle = "#e4dccb";
        x.fillRect(0, 0, w, h);
        x.fillStyle = "#a93c22";
        x.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
        return c.toDataURL("image/png");
      };
      return [create(600, 300), create(240, 400)];
    });
    const state = initialState();
    state.preferences = {
      ...preferencesOf(state.preferences),
      startPage: "home",
    };
    state.recipes[0].steps = [
      "先准备食材，洗净并切块。横向配图应跟在这段文字下方。",
      "将食材放入锅中，调味后翻炒至熟。竖向配图应与这段文字左右排列。",
    ];
    state.recipes[0].stepTitles = ["准备食材", "翻炒装盘"];
    state.recipes[0].media = {
      cover: photos[0],
      steps: photos.map((image, i) => ({ sourceStep: i + 1, image })),
    };
    state.recipes[0].image = photos[0];
    state.plans = state.recipes
      .slice(0, 4)
      .map((r, i) => ({
        id: `dish-${i}`,
        recipeId: r.id,
        meal: "晚餐",
        day: "2026-10-26",
        servings: 2,
        cooking:
          i === 3
            ? {
                id: "done",
                date: "2026-10-26",
                servings: 2,
                note: "",
                untracked: false,
              }
            : null,
      }));
    await page.addInitScript(
      (state) =>
        Object.assign(window, {
          isTauri: true,
          __TAURI_INTERNALS__: {
            invoke: async (name: string) =>
              name === "kitchen_bootstrap" ? structuredClone(state) : null,
          },
        }),
      state,
    );
    await page.goto("/");
    const upcoming = page.locator(".next-meal");
    await expect(upcoming.locator("h2")).toHaveText([
      state.recipes[0].name,
      state.recipes[1].name,
    ]);
    await expect(upcoming).toContainText("还有 1 道菜");
    await expect(upcoming).not.toContainText(state.recipes[3].name);
    expect((await upcoming.boundingBox())!.height).toBeLessThan(370);
    await page.screenshot({
      path: `docs/screenshots/inline-steps/${width}-next-two.png`,
    });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    await page.locator(".recipe-title").first().click();
    const landscape = page.getByRole("region", { name: "步骤 1", exact: true });
    const portrait = page.getByRole("region", { name: "步骤 2", exact: true });
    await landscape.getByRole("img").scrollIntoViewIfNeeded();
    await expect(landscape).toHaveClass(/landscape/);
    await portrait.getByRole("img").scrollIntoViewIfNeeded();
    await expect(portrait).toHaveClass(/portrait/);
    const text = await landscape.locator(".step-copy").boundingBox(),
      wide = await landscape.getByRole("img").boundingBox();
    expect(wide!.y).toBeGreaterThanOrEqual(text!.y + text!.height);
    const left = await portrait.locator(".step-copy").boundingBox(),
      tall = await portrait.getByRole("img").boundingBox();
    expect(tall!.x).toBeGreaterThanOrEqual(left!.x + left!.width);
    await landscape.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/inline-steps/${width}-recipe-steps.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "编辑菜谱", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑菜谱", exact: true });
    const rows = editor.locator(".step-edit");
    await expect(rows).toHaveCount(2);
    await expect(
      rows.nth(0).getByLabel("上传步骤1图片", { exact: true }),
    ).toBeAttached();
    await expect(
      rows.nth(1).getByLabel("上传步骤2图片", { exact: true }),
    ).toBeAttached();
    const order = await rows.nth(0).evaluate((row) => {
      const text = row.querySelector("textarea")!,
        photo = row.querySelector(".step-photo-editor")!;
      return !!(
        text.compareDocumentPosition(photo) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    });
    expect(order).toBe(true);
    await rows.nth(0).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/inline-steps/${width}-step-editor.png`,
    });
  });
}
