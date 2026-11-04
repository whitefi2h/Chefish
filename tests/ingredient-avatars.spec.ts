import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

test("app avatars use offline color assets, curated text and saved photos", async ({
  page,
}) => {
  const state = initialState();
  state.ingredients[0].name = "豆腐";
  delete state.ingredients[0].image;
  state.ingredients[1].name = "迷迭香";
  delete state.ingredients[1].image;
  state.ingredients[2].name = "番茄";
  const custom =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="purple"/></svg>',
    );
  state.ingredients[2].image = {
    data: custom,
    author: "用户",
    license: "个人图片",
    licenseUrl: "",
    sourceUrl: "",
    title: "我的番茄",
  };
  const legacy = {
    ...state.ingredients[2].image,
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Old-auto-photo.jpg",
    author: "Legacy automatic photo",
  };
  state.ingredients[0].image = legacy;
  state.ingredients[1].image = legacy;
  state.seasonings = [{ id: "醋", name: "醋", missing: false, image: legacy }];
  await page.addInitScript((snapshot) => {
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (name: string) =>
          name === "kitchen_bootstrap" ? snapshot : null,
      },
    });
  }, state);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  const row = (name: string) =>
    page.locator(".inventory-table tbody tr").filter({ hasText: name }).first();
  await expect(row("豆腐").locator(".ingredient-avatar img")).toHaveAttribute(
    "src",
    "/ingredient-icons/irasutoya-tofu.png",
  );
  await expect(row("迷迭香").locator(".ingredient-avatar")).toHaveText("迷");
  await expect(row("迷迭香").locator(".ingredient-avatar")).toHaveCSS(
    "font-size",
    "18px",
  );
  await expect(
    page.locator(".seasoning-avatar .ingredient-avatar img"),
  ).toHaveAttribute("src", /ingredient-icons\//);
  await expect(row("番茄").locator(".ingredient-avatar img")).toHaveAttribute(
    "src",
    custom,
  );
  await row("番茄")
    .locator(".ingredient-avatar img")
    .evaluate(
      (img: HTMLImageElement) => (img.src = "data:image/png;base64,broken"),
    );
  await expect(row("番茄").locator(".ingredient-avatar img")).toHaveAttribute(
    "src",
    /ingredient-icons\//,
  );
  await row("豆腐")
    .locator(".ingredient-avatar img")
    .evaluate(
      (img: HTMLImageElement) => (img.src = "data:image/png;base64,broken"),
    );
  await expect(row("豆腐").locator(".text-avatar")).toHaveText("豆");
  await page.screenshot({
    path: "docs/screenshots/ingredient-icon-app/inventory-1440.png",
  });
  await page.reload();
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  await expect(row("豆腐").locator(".ingredient-avatar img")).toHaveAttribute(
    "src",
    "/ingredient-icons/irasutoya-tofu.png",
  );
  await page.setViewportSize({ width: 1000, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/ingredient-icon-app/inventory-1000.png",
  });
  await page.getByRole("button", { name: "打开厨房设置" }).click();
  await page.getByRole("tab", { name: "关于 Chefish", exact: true }).click();
  await page.getByText("食材图标来源与许可", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "CC-BY-4.0", exact: true }),
  ).toBeVisible();
});
