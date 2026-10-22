import { test, expect } from "@playwright/test";
test("drawer keeps input on outside click and Escape, X closes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "厨房助手", exact: true }).click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await page.mouse.click(20, 200);
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "关闭面板" }).click();
  await expect(panel).toHaveCount(0);
});
