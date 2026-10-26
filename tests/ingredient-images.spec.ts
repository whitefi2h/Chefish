import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

test("ingredient avatars fill automatically and replace across batches without editing inventory", async ({
  page,
}) => {
  const snapshot = initialState();
  snapshot.seasonings = [
    { id: "醋", name: "醋", missing: true },
    { id: "盐", name: "盐", missing: false },
  ];
  const first = snapshot.ingredients.find(
    (i) => i.id === snapshot.lots[0].ingredientId,
  )!;
  const originalQuantity = snapshot.lots[0].quantity;
  await page.addInitScript(
    ({ snapshot, id }) => {
      let replacements = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            name: string,
            args: { ingredientId?: string } = {},
          ) => {
            if (name === "kitchen_bootstrap") return structuredClone(snapshot);
            if (name === "kitchen_ingredient_images") {
              if (args.ingredientId) replacements++;
              const ingredient = snapshot.ingredients.find((i) => i.id === id)!;
              const image = {
                data:
                  "data:image/svg+xml," +
                  encodeURIComponent(
                    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="${replacements ? "orange" : "tomato"}"/></svg>`,
                  ),
                sourceUrl: `https://commons.wikimedia.org/wiki/File:Test${replacements}.jpg`,
                author: "Synthetic fixture",
                license: "CC0",
                licenseUrl: "",
                title: "Test photo",
              };
              if (!args.ingredientId || args.ingredientId === id)
                ingredient.image = image;
              snapshot.seasonings = (snapshot.seasonings ?? []).map((s) =>
                !args.ingredientId ||
                args.ingredientId === `seasoning:${s.name}`
                  ? {
                      ...s,
                      image: {
                        ...image,
                        sourceUrl: `https://commons.wikimedia.org/wiki/File:Seasoning${replacements}.jpg`,
                      },
                    }
                  : s,
              );
              return { updated: 1, remaining: 0 };
            }
            return null;
          },
        },
      });
    },
    { snapshot, id: first.id },
  );
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  const row = page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("button", {
        name: `查看${first.name}批次`,
        exact: true,
      }),
    })
    .first();
  const avatar = row.getByRole("img", { name: first.name, exact: true });
  await expect(avatar).toBeVisible();
  const before = await avatar.getAttribute("src");
  const seasonings = page.getByRole("region", { name: "调料区", exact: true });
  await expect(seasonings.getByRole("img").first()).toBeVisible();
  const foodFont = await row
    .locator("strong")
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(
    await seasonings
      .locator("strong")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe(foodFont);
  await expect(row.getByLabel(`${first.name}剩余数量`)).toHaveValue(
    String(originalQuantity),
  );
  const seasoningBefore = await seasonings
    .getByRole("img")
    .first()
    .getAttribute("src");
  await seasonings
    .getByRole("button", { name: /让 AI 更换.*图片/ })
    .first()
    .click();
  await expect(seasonings.getByRole("img").first()).not.toHaveAttribute(
    "src",
    seasoningBefore!,
  );
  await row
    .getByRole("button", { name: `查看${first.name}批次`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "让 AI 换张图片", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic fixture");
  await expect(
    page.getByRole("dialog").getByRole("img", { name: first.name }),
  ).not.toHaveAttribute("src", before!);
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(avatar).not.toHaveAttribute("src", before!);
  await expect(row.getByLabel(`${first.name}剩余数量`)).toHaveValue(
    String(originalQuantity),
  );
});
