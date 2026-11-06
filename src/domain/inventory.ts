import type { DemoState, InventoryLot } from "../model";
import { daysLeft } from "../model";
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
        lot.quantity > 0 && !!lot.expires && daysLeft(lot.expires, today) <= 3,
    )
    .sort((a, b) => (a.expires ?? "").localeCompare(b.expires ?? ""));
}
