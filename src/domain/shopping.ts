import { quantityText } from "./quantity";
export interface ShoppingLine {
  dishRequirements?: {
    dish: string;
    day: string;
    meal: string;
    quantity: string;
    unit: string;
  }[];
  manualAmount?: { quantity: string; unit: string } | null;
  roughStock?: boolean;
  roughCovered?: boolean;
  id: string | null;
  version: number;
  ingredientId: string;
  name: string;
  category: string;
  unit: string;
  source: "manual" | "plan";
  weekStart: string | null;
  required: string;
  covered: string;
  shortage: string;
  purchased: string;
  received: string;
  unreceived: string;
  remaining: string;
  review: boolean;
  estimated?: boolean;
  estimates?: string[];
  hidden: boolean;
  surplus: boolean;
  sources: string[];
  history: {
    id: string;
    kind: "purchase" | "receive" | "undo_receive" | "undo_purchase";
    quantity: string;
    at: string;
    lotId: string | null;
  }[];
}
export interface ShoppingForecast {
  weekStart: string;
  asOf: string;
  items: ShoppingLine[];
  reviewNotes: string[];
  pastPlanCount: number;
}
export const shoppingPending = (f?: ShoppingForecast) =>
  shoppingGroups(
    f?.items.filter((i) => !i.hidden && i.remaining !== "0") ?? [],
  );

export function shoppingGroups(items: ShoppingLine[]) {
  const groups: ShoppingLine[] = [];
  for (const item of items) {
    if (
      item.source === "manual" ||
      !groups.some((g) => g.source === "plan" && g.name === item.name)
    )
      groups.push(item);
  }
  return groups;
}

export function shoppingDescription(i: ShoppingLine) {
  if (i.source === "manual")
    return i.manualAmount
      ? i.manualAmount.quantity
        ? `${quantityText(i.manualAmount.quantity)}${i.manualAmount.unit}`
        : ""
      : `${quantityText(i.required)}${i.unit}`;
  return i.dishRequirements?.length
    ? i.dishRequirements
        .map((d) => `${d.dish}：${quantityText(d.quantity)}${d.unit}`)
        .join("；")
    : i.sources.join("；");
}
