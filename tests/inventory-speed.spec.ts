import { test, expect } from "@playwright/test";
import { initialState } from "../src/fixtures/demo";

test("inline quantities update immediately and apply native inventory response without reloading recipes", async ({
  page,
}) => {
  const snapshot = initialState();
  snapshot.dataRevision = "10";
  snapshot.lots[0].version = 1;
  await page.addInitScript((snapshot) => {
    let loads = 0;
    Object.assign(window, {
      isTauri: true,
      inventoryLoads: () => loads,
      __TAURI_INTERNALS__: {
        invoke: async (
          name: string,
          args: {
            command?: {
              type: string;
              lot_id: string;
              quantity: string;
              expected_version: number;
              location: string | null;
            };
          } = {},
        ) => {
          if (name === "kitchen_bootstrap") {
            loads++;
            return structuredClone(snapshot);
          }
          if (name === "kitchen_execute") {
            const c = args.command!;
            await new Promise((r) => setTimeout(r, 250));
            const lot = snapshot.lots.find((l) => l.id === c.lot_id)!;
            lot.quantity = Number(c.quantity);
            lot.version = c.expected_version + 1;
            const before = snapshot.dataRevision!;
            snapshot.dataRevision = String(Number(before) + 1);
            return {
              baseRevision: before,
              dataRevision: snapshot.dataRevision,
              lots: snapshot.lots.map((l) => ({
                ...l,
                quantity: String(l.quantity),
              })),
              inventoryEvents: [],
            };
          }
          return null;
        },
      },
    });
  }, snapshot);
  await page.goto("/");
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "食材库存" })
    .click();
  const row = page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("button", { name: "查看牛肉批次", exact: true }),
    })
    .first();
  const quantity = row.getByLabel("牛肉剩余数量");
  await expect(quantity).toHaveValue("400");
  const initialLoads = await page.evaluate(() =>
    (window as unknown as { inventoryLoads: () => number }).inventoryLoads(),
  );
  await row.getByRole("button", { name: "增加牛肉数量", exact: true }).click();
  await expect(quantity).toHaveValue("450");
  await expect(quantity).toBeEnabled();
  await row.getByRole("button", { name: "减少牛肉数量", exact: true }).click();
  await expect(quantity).toHaveValue("400");
  await expect(quantity).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { inventoryLoads: () => number }).inventoryLoads(),
    ),
  ).toBe(initialLoads);
  await expect(page.locator(".toast")).toHaveCount(0);
});
