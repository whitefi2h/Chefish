import { test, expect } from "@playwright/test";
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`recipe cards categories and three columns ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "我的菜谱" })
      .click();
    const first = page.locator(".recipe-card").first();
    const photo = await first.locator(".recipe-photo").boundingBox();
    const tag = await first.locator(".recipe-category-tag").boundingBox();
    expect(tag!.y).toBeGreaterThan(photo!.y + photo!.height / 2);
    expect(tag!.y + tag!.height).toBeLessThan(photo!.y + photo!.height);
    const titleBox = await first.locator(".recipe-title").boundingBox();
    const actionBox = await first.locator(".inspiration-button").boundingBox();
    expect(Math.abs(titleBox!.y - actionBox!.y)).toBeLessThan(3);
    await page.screenshot({
      path: `docs/screenshots/library-polish/${width}-cards.png`,
    });
    await page.getByRole("button", { name: "管理分类", exact: true }).click();
    const handles = page.locator(".category-grip");
    const from = await handles.nth(0).boundingBox();
    const to = await handles.nth(1).boundingBox();
    const original = await page
      .locator(".category-row input")
      .nth(1)
      .inputValue();
    await page.mouse.move(from!.x + 15, from!.y + 15);
    await page.mouse.down();
    await page.mouse.move(to!.x + 15, to!.y + 20, { steps: 15 });
    await expect(page.locator(".category-drag-preview")).toBeVisible();
    await expect(page.locator(".category-row.insert-before")).toHaveCount(1);
    await page.screenshot({
      path: `docs/screenshots/library-polish/${width}-dragging.png`,
    });
    await page.mouse.up();
    await expect(page.locator(".category-row input").first()).toHaveValue(
      original,
    );
    await page.getByLabel("新分类名称").fill("试做清单");
    await page.getByRole("button", { name: "添加分类", exact: true }).click();
    await page.screenshot({
      path: `docs/screenshots/library-polish/${width}-categories.png`,
    });
    await page.getByRole("button", { name: "保存分类", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".toast")).toHaveCount(0);
    await first.locator(".recipe-title").click();
    const ingredients = await page.locator(".ingredients-panel").boundingBox();
    const steps = await page.locator(".steps-panel").boundingBox();
    const notes = await page.locator(".cooking-log").boundingBox();
    if (width >= 1400) {
      expect(Math.abs(notes!.y - steps!.y)).toBeLessThan(2);
      expect(notes!.x).toBeGreaterThan(steps!.x);
    } else {
      expect(notes!.y).toBeGreaterThan(steps!.y);
      expect(notes!.x).toBe(ingredients!.x);
    }
    await page
      .getByLabel("烹饪笔记", { exact: true })
      .fill("火候稍小，静置五分钟；下次试一点迷迭香。");
    await page
      .getByRole("button", { name: "保存演示笔记", exact: true })
      .click();
    await expect(page.locator(".toast")).toHaveCount(0);
    const entry = page.locator(".log-entry").filter({ hasText: "火候稍小" });
    await page.getByLabel("烹饪笔记", { exact: true }).fill("新增草稿保留");
    await entry.getByRole("button", { name: /编辑笔记/ }).click();
    const editor = page.getByRole("dialog", { name: "编辑手记" });
    await editor.getByLabel("编辑手记内容").fill("取消的修改");
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByLabel("烹饪笔记", { exact: true })).toHaveValue(
      "新增草稿保留",
    );
    await expect(entry).toContainText("火候稍小");
    await entry.getByRole("button", { name: /编辑笔记/ }).click();
    await editor.getByLabel("编辑手记内容").fill("改用中火，静置五分钟。");
    await page.screenshot({
      path: `docs/screenshots/library-polish/${width}-note-editor.png`,
    });
    await editor.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByLabel("烹饪笔记", { exact: true })).toHaveValue(
      "新增草稿保留",
    );
    const edited = page.locator(".log-entry").filter({ hasText: "改用中火" });
    await expect(edited).toBeVisible();
    await page.locator(".recipe-detail-layout").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/screenshots/library-polish/${width}-detail.png`,
      fullPage: true,
    });
    await edited.getByRole("button", { name: /删除笔记/ }).click();
    await edited.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(edited).toHaveCount(0);
  });
}
for (const section of ["我的菜谱", "食材库存"])
  test(`category drag multi-row cancel and outside ${section}`, async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: section })
      .click();
    await page.getByRole("button", { name: "管理分类", exact: true }).click();
    const inputs = page.locator(".category-row input");
    const original = await inputs.evaluateAll((es) =>
      es.map((e) => (e as HTMLInputElement).value),
    );
    async function drag(from: number, to: number) {
      const a = await page.locator(".category-grip").nth(from).boundingBox();
      const b = await page.locator(".category-grip").nth(to).boundingBox();
      await page.mouse.move(a!.x + 15, a!.y + 15);
      await page.mouse.down();
      await page.mouse.move(b!.x + 15, b!.y + 20, { steps: 20 });
      await expect(page.locator(".category-drag-preview")).toBeVisible();
    }
    await drag(0, original.length - 1);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".category-drag-preview")).toHaveCount(0);
    expect(
      await inputs.evaluateAll((es) =>
        es.map((e) => (e as HTMLInputElement).value),
      ),
    ).toEqual(original);
    await drag(0, original.length - 1);
    await page.mouse.move(5, 5, { steps: 15 });
    await page.mouse.up();
    expect(
      await inputs.evaluateAll((es) =>
        es.map((e) => (e as HTMLInputElement).value),
      ),
    ).toEqual(original);
    await drag(0, original.length - 1);
    await page.mouse.up();
    await expect(inputs.last()).toHaveValue(original[0]);
    await drag(original.length - 1, 0);
    await page.mouse.up();
    await expect(inputs.first()).toHaveValue(original[0]);
    await page.getByRole("button", { name: "关闭面板" }).click();
    await page.getByRole("button", { name: "管理分类", exact: true }).click();
    expect(
      await inputs.evaluateAll((es) =>
        es.map((e) => (e as HTMLInputElement).value),
      ),
    ).toEqual(original);
  });
