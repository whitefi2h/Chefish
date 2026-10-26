import { localToday } from "./domain/clock";
import type { AppPreferences } from "./domain/preferences";
import { isSeasoning, type SeasoningSupply } from "./domain/seasonings";
import { DEMO_TODAY, DEMO_DAYS } from "./fixtures/demo";
export { initialState, recipes } from "./fixtures/demo";
export const TODAY = DEMO_TODAY;
export const DAYS = DEMO_DAYS;
export const MEALS = ["早餐", "午餐", "晚餐"] as const;
export function validDate(day: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    day >= "1900-01-01" &&
    day <= "2100-12-31" &&
    Number.isFinite(Date.parse(day + "T00:00:00Z")) &&
    new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day
  );
}
export function shiftDate(day: string, days: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function weekOf(day: string) {
  const weekday = new Date(day + "T00:00:00Z").getUTCDay();
  return shiftDate(day, -((weekday + 6) % 7));
}
export function weekDays(start: string) {
  return Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
}
export function weekLabel(start: string) {
  const end = shiftDate(start, 6);
  return `${start.replaceAll("-", " / ")} — ${end.replaceAll("-", " / ")}`;
}
export type MealTime = (typeof MEALS)[number];
export type Category = string;
export type Location = "冷藏" | "冷冻" | "常温";
export interface Ingredient {
  id: string;
  name: string;
  category: Category;
  image?: IngredientImage;
}
export interface IngredientImage {
  data: string;
  sourceUrl: string;
  author: string;
  license: string;
  licenseUrl: string;
  title: string;
}
export interface Requirement {
  ingredientId: string;
  quantity: number;
  unit: string;
}
export interface RecipeMedia {
  cover: string | null;
  coverCredit?: Omit<IngredientImage, "data">;
  steps: { image: string; sourceStep: number }[];
}
export interface Recipe {
  ingredientKinds?: Record<string, boolean>;
  media?: RecipeMedia;
  textIngredients?: { name: string; amountText: string }[];
  source?: { url: string; author: string; ingredientText: string[] };
  allowSourceDuplicate?: boolean;
  stepTitles?: string[];
  revisionId?: string;
  revisionNumber?: number;
  id: string;
  name: string;
  subtitle: string;
  category: string;
  minutes: number;
  servings: number;
  image: string;
  requirements: Requirement[];
  seasoning: string;
  steps: string[];
}
export interface InventoryLot extends Requirement {
  quantityText?: string;
  version?: number;
  id: string;
  location: Location;
  expires: string | null;
  received: string;
  precision: "exact" | "rough";
}
export interface InventoryEvent {
  id: string;
  lotId: string;
  kind: "receive" | "use" | "discard" | "correct" | "move" | "reverse";
  before: string;
  after: string;
  beforeLocation: Location;
  afterLocation: Location;
  afterVersion: number;
  reason: string;
  reversedEventId: string | null;
  occurredAt: string;
}
export interface CookingResult {
  record?:string;
  consumptions?: { name: string; quantity: string; unit: string }[];
  id: string;
  date: string;
  servings: number;
  note: string;
  untracked: boolean;
}
export interface PlannedMeal {
  cooking?: CookingResult | null;
  version?: number;
  recipeRevisionId?: string | null;
  recipeSnapshot?: Recipe;
  customTitle?: string | null;
  id: string;
  recipeId: string;
  day: string;
  meal: MealTime;
  servings: number;
}
export function recipeForPlan(s: DemoState, plan: PlannedMeal): Recipe {
  return (
    plan.recipeSnapshot ??
    s.recipes.find((r) => r.id === plan.recipeId) ?? {
      id: plan.id,
      name: plan.customTitle ?? "未找到菜谱",
      subtitle: "临时配餐 · 食材用量待补充",
      category: "未分类",
      minutes: 0,
      servings: plan.servings,
      image: "placeholder",
      requirements: [],
      seasoning: "",
      steps: [],
    }
  );
}
export interface ShoppingItem extends Requirement {
  id: string;
  name: string;
  category: Category;
  source: "manual" | "plan";
  status: "pending" | "bought" | "stocked";
  sources: string[];
  requiredAtPurchase?: number;
  weekStart?: string;
}
export interface CookingLog {
  id: string;
  recipeId: string;
  date: string;
  note: string;
}
export interface DemoState {
  undo?: { operationId: string; label: string } | null;
  preferences?: AppPreferences;
  seasonings?: SeasoningSupply[];
  archivedRecipes?: Recipe[];
  recipeHistory?: Recipe[];
  inventoryEvents?: InventoryEvent[];
  today?: string;
  dataRevision?: string;
  recipes: Recipe[];
  inspiration: string[];
  recipeCategories: string[];
  ingredientCategories: string[];
  ingredients: Ingredient[];
  lots: InventoryLot[];
  plans: PlannedMeal[];
  shopping: ShoppingItem[];
  favorites: string[];
  logs: CookingLog[];
  memo: string;
  hiddenNeeds: string[];
}
export const keyOf = (r: Requirement) => `${r.ingredientId}:${r.unit}`;
export function daysLeft(expires: string | null, today = localToday()) {
  if (!expires) return NaN;
  return Math.round(
    (Date.parse(expires + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) /
      86400000,
  );
}
export function expiryLabel(expires: string | null, today = localToday()) {
  const n = daysLeft(expires, today);
  if (!Number.isFinite(n)) return "—";
  return n < 0 ? `已过期 ${-n} 天` : n === 0 ? "今天到期" : `剩 ${n} 天`;
}
export function stock(s: DemoState, r: Requirement) {
  return s.lots
    .filter(
      (l) =>
        l.ingredientId === r.ingredientId &&
        l.unit === r.unit &&
        (!l.expires || daysLeft(l.expires, s.today ?? localToday()) >= 0),
    )
    .reduce((n, l) => n + l.quantity, 0);
}
export function amount(quantity: number, unit: string) {
  return `${Number(quantity.toFixed(6))} ${unit}`;
}
export interface Need extends Requirement {
  name: string;
  category: Category;
  required: number;
  covered: number;
  toBuy: number;
  sources: string[];
  review: boolean;
}
export function needs(
  s: DemoState,
  weekStart = weekOf(s.today ?? localToday()),
): Need[] {
  const map = new Map<string, Need>();
  for (const plan of s.plans) {
    if (plan.cooking || weekOf(plan.day) !== weekStart) continue;
    const recipe = recipeForPlan(s, plan);
    if (!recipe) continue;
    for (const req of recipe.requirements) {
      const key = keyOf(req);
      const ingredient = s.ingredients.find((i) => i.id === req.ingredientId)!;
      if (isSeasoning(ingredient.name, recipe.ingredientKinds)) continue;
      const row = map.get(key) ?? {
        ...req,
        name: ingredient.name,
        category: ingredient.category,
        quantity: 0,
        required: 0,
        covered: 0,
        toBuy: 0,
        sources: [],
        review: false,
      };
      row.required += (req.quantity * plan.servings) / recipe.servings;
      row.sources.push(`${plan.day.slice(5)} ${plan.meal} · ${recipe.name}`);
      map.set(key, row);
    }
  }
  return [...map.values()].map((row) => {
    const available = stock(s, row);
    const bought = s.shopping
      .filter(
        (i) =>
          i.source === "plan" &&
          (i.weekStart ?? DAYS[0]) === weekStart &&
          keyOf(i) === keyOf(row) &&
          i.status === "bought",
      )
      .reduce((n, i) => n + i.quantity, 0);
    return {
      ...row,
      quantity: Math.max(0, row.required - available - bought),
      covered: Math.min(row.required, available),
      toBuy: Math.max(0, row.required - available - bought),
      review: s.lots.some(
        (l) =>
          l.ingredientId === row.ingredientId &&
          l.quantity > 0 &&
          l.unit !== row.unit,
      ),
    };
  });
}
export function pendingItems(
  s: DemoState,
  weekStart = weekOf(s.today ?? localToday()),
): ShoppingItem[] {
  return [
    ...needs(s, weekStart)
      .filter(
        (n) =>
          n.toBuy > 0 && !s.hiddenNeeds.includes(`${weekStart}|${keyOf(n)}`),
      )
      .map((n) => ({
        ...n,
        id: `need:${weekStart}:${keyOf(n)}`,
        weekStart,
        source: "plan" as const,
        status: "pending" as const,
      })),
    ...s.shopping.filter(
      (i) =>
        (i.source === "manual" || (i.weekStart ?? DAYS[0]) === weekStart) &&
        (i.source !== "plan" ||
          !s.hiddenNeeds.includes(`${weekStart}|${keyOf(i)}`)),
    ),
  ];
}
export function putMeal(
  s: DemoState,
  recipeId: string,
  day: string,
  meal: MealTime,
  servings = 2,
  moveId?: string,
): DemoState {
  if (
    !s.recipes.some((r) => r.id === recipeId) ||
    !validDate(day) ||
    !MEALS.includes(meal) ||
    !Number.isFinite(servings) ||
    servings < 1 ||
    servings > 12
  )
    return s;
  return {
    ...s,
    hiddenNeeds: [],
    plans: [
      ...s.plans.filter((p) => p.id !== moveId),
      {
        id: moveId ?? crypto.randomUUID(),
        recipeId,
        day,
        meal,
        servings,
        recipeSnapshot:
          s.plans.find((p) => p.id === moveId)?.recipeSnapshot ??
          s.recipes.find((r) => r.id === recipeId),
      },
    ],
  };
}
export function buy(s: DemoState, item: ShoppingItem): DemoState {
  if (item.status !== "pending") return s;
  if (item.source === "plan" && item.id.startsWith("need:")) {
    const current = pendingItems(s, item.weekStart).find(
      (i) => i.id === item.id,
    );
    if (!current || current.quantity <= 0) return s;
    return {
      ...s,
      shopping: [
        ...s.shopping,
        {
          ...current,
          id: crypto.randomUUID(),
          status: "bought",
          requiredAtPurchase: needs(s, item.weekStart).find(
            (n) => keyOf(n) === keyOf(current),
          )?.required,
        },
      ],
    };
  }
  return {
    ...s,
    shopping: s.shopping.map((i) =>
      i.id === item.id ? { ...i, status: "bought" } : i,
    ),
  };
}
export function receive(
  s: DemoState,
  id: string,
  attributes?: { location: Location; received: string; expires?: string },
): DemoState {
  const item = s.shopping.find((i) => i.id === id);
  if (!item || item.status !== "bought") return s;
  return {
    ...s,
    shopping: s.shopping.map((i) =>
      i.id === id ? { ...i, status: "stocked" } : i,
    ),
    lots: [
      ...s.lots,
      {
        id: `receipt:${id}`,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
        unit: item.unit,
        location: attributes?.location ?? "冷藏",
        expires: attributes ? (attributes.expires ?? null) : "2026-10-25",
        received: attributes?.received ?? TODAY,
        precision: "exact",
      },
    ],
  };
}
export function purchase(
  s: DemoState,
  item: ShoppingItem,
  attributes: {
    quantity: number;
    location: Location;
    received: string;
    expires?: string;
  },
): DemoState {
  if (
    !Number.isFinite(attributes.quantity) ||
    attributes.quantity <= 0 ||
    attributes.quantity > 100000 ||
    !validDate(attributes.received) ||
    attributes.received > (s.today ?? localToday()) ||
    (attributes.expires &&
      (!validDate(attributes.expires) ||
        attributes.expires < attributes.received))
  )
    return s;
  const marked = buy(s, item);
  const stored =
    marked.shopping.find((i) => i.id === item.id) ??
    marked.shopping.find((i) => !s.shopping.some((old) => old.id === i.id));
  if (!stored) return s;
  const adjusted = {
    ...marked,
    shopping: marked.shopping.map((i) =>
      i.id === stored.id ? { ...i, quantity: attributes.quantity } : i,
    ),
  };
  const stocked = receive(adjusted, stored.id, attributes);
  if (item.source === "manual" && attributes.quantity < item.quantity)
    stocked.shopping.push({
      ...item,
      id: crypto.randomUUID(),
      quantity: item.quantity - attributes.quantity,
    });
  return stocked;
}
export function changeLot(
  s: DemoState,
  id: string,
  quantity: number,
  location?: Location,
): DemoState {
  if (!Number.isFinite(quantity) || quantity < 0) return s;
  return {
    ...s,
    lots: s.lots.map((l) =>
      l.id === id ? { ...l, quantity, location: location ?? l.location } : l,
    ),
  };
}
export function csvText(items: ShoppingItem[]) {
  const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
  return (
    "\uFEFF" +
    [
      "食材,数量,单位,状态,来源",
      ...items.map((i) =>
        [
          i.name,
          i.quantity,
          i.unit,
          i.status === "pending"
            ? "待买"
            : i.status === "bought"
              ? "已买"
              : "已购买",
          i.source === "manual" ? "手动" : i.sources.join("；"),
        ]
          .map((v) => quote(String(v).replace(/^[=+@-]/, "'$&")))
          .join(","),
      ),
    ].join("\r\n")
  );
}
