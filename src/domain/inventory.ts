import { hasStock } from "./stock";
import type { DemoState, InventoryLot } from "../model";
import { daysLeft, expiryLabel } from "../model";
import { isSeasoning, supplies } from "./seasonings";

// Dashboard reminders and the inventory page use the same food scope.
export function foodInventoryLots(state: DemoState): InventoryLot[] {
  const names = new Map(state.ingredients.map((i) => [i.id, i.name]));
  const supplyNames = new Set(supplies(state).map((s) => s.name));
  return state.lots.filter((lot) => {
    const name = names.get(lot.ingredientId) ?? "";
    return !isSeasoning(name) && !supplyNames.has(name);
  });
}

export function expiringInventoryLots(
  lots: InventoryLot[],
  today: string,
): InventoryLot[] {
  return lots
    .filter(
      (lot) =>
        hasStock(lot) &&
        !!attentionDate(lot) &&
        daysLeft(attentionDate(lot), today) <= 3,
    )
    .sort((a, b) =>
      (attentionDate(a) ?? "").localeCompare(attentionDate(b) ?? ""),
    );
}
export function attentionDate(lot: InventoryLot) {
  return lot.expires ?? lot.steward?.reviewOn ?? null;
}
export function inventoryStatus(
  lot: InventoryLot,
  today: string,
): { label: string; tone: "red" | "warm" | "green" } {
  const left = daysLeft(attentionDate(lot), today);
  if (lot.expires)
    return {
      label: expiryLabel(lot.expires, today),
      tone: left < 0 ? "red" : left <= 3 ? "warm" : "green",
    };
  return {
    label:
      left < 0 ? "待复查" : left === 0 ? "今天复查" : `预计${left}天后复查`,
    tone: left <= 3 ? "warm" : "green",
  };
}
