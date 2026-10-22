import { test, expect } from "@playwright/test";
test.use({
  launchOptions: {
    ignoreDefaultArgs: ["--hide-scrollbars"],
    args: ["--disable-features=OverlayScrollbar,FluentOverlayScrollbar"],
  },
});
for (const [width, height] of [
  [1280, 800],
  [1440, 900],
  [1920, 1080],
]) {
  test(`modal scroll lock preserves page and calendar geometry ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    // Classic Windows scrollbars take layout space; overlay scrollbars hide this bug.
    await page.addStyleTag({
      content: "::-webkit-scrollbar { width: 17px; height: 6px; }",
    });
    expect(
      await page.evaluate(
        () => innerWidth - document.documentElement.clientWidth,
      ),
    ).toBeGreaterThan(0);
    const metrics = () =>
      page.evaluate(() => {
        const bounds = (selector: string) => {
          const r = document.querySelector(selector)!.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width };
        };
        return {
          calendar: bounds(".calendar"),
          columns: Array.from(
            document.querySelectorAll(".day-head"),
            (e) => e.getBoundingClientRect().width,
          ),
          workspace: bounds(".workspace"),
          scrollY,
          scrollLeft: document.querySelector(".calendar-scroll")!.scrollLeft,
        };
      });
    await page.locator(".calendar").scrollIntoViewIfNeeded();
    const before = await metrics();
    await page.locator(".slot-add").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await metrics()).toEqual(before);
    await page.screenshot({
      path: `docs/screenshots/modal-stability/${width}-open.png`,
    });
    await page.mouse.move(15, 200);
    await page.mouse.wheel(0, 500);
    expect(await metrics()).toEqual(before);
    await page.getByRole("button", { name: "关闭面板" }).click();
    expect(await metrics()).toEqual(before);
    await page.screenshot({
      path: `docs/screenshots/modal-stability/${width}-closed.png`,
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const top = await metrics();
    await page.getByRole("button", { name: "厨房助手", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await metrics()).toEqual(top);
    await page.getByRole("button", { name: "关闭面板" }).click();
    expect(await metrics()).toEqual(top);
  });
}
