export interface ShoppingLine {
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
  f?.items.filter((i) => i.remaining !== "0") ?? [];
