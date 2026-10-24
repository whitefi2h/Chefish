import type { ShoppingForecast } from "../domain/shopping";
import type { AppPreferences } from "../domain/preferences";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DemoState, Recipe, PlannedMeal } from "../model";
export const nativeMode = isTauri();
export interface RecipeInput {
  ingredientKinds?: Record<string, boolean>;
  textIngredients?: { name: string; amountText: string }[];
  source?: { url: string; author: string; ingredientText: string[] };
  allowSourceDuplicate?: boolean;
  stepTitles?: string[];
  name: string;
  category: string;
  minutes: number;
  servings: number;
  subtitle: string;
  seasoning: string;
  ingredients: { name: string; quantity: string; unit: string }[];
  steps: string[];
}
export interface PlanInput {
  recipe_revision_id: string | null;
  custom_title: string | null;
  day: string;
  meal: string;
  servings: number;
}
export type KitchenCommand =
  | { type: "remove_seasoning"; name: string; expected_revision: string }
  | {
      type: "set_seasoning";
      name: string;
      missing: boolean;
      expected_revision: string;
    }
  | {
      type: "save_categories";
      kind: "recipe" | "ingredient";
      expected_revision: string;
      entries: { original: string | null; name: string }[];
    }
  | { type: "edit_note"; note_id: string; expected_note: string; note: string }
  | { type: "delete_note"; note_id: string; expected_note: string }
  | {
      type: "complete_cooking";
      draft: {
        plan_id: string;
        expected_version: number;
        expected_revision: string;
        servings: number;
        date: string;
        note: string;
        acknowledged: boolean;
        consumptions: {
          lot_id: string;
          expected_version: number;
          quantity: string;
        }[];
      };
    }
  | { type: "undo_cooking"; plan_id: string; expected_version: number }
  | {
      type: "save_shopping";
      line_id: string | null;
      expected_version: number | null;
      draft: { name: string; category: string; quantity: string; unit: string };
    }
  | {
      type: "purchase_shopping";
      line_id: string | null;
      expected_version: number;
      ingredient_id: string;
      unit: string;
      week_start: string | null;
      quantity: string;
      location: string;
      received: string;
      expires: string | null;
    }
  | {
      type: "receive_shopping";
      line_id: string;
      expected_version: number;
      quantity: string;
      location: string;
      received: string;
      expires: string | null;
    }
  | { type: "remove_shopping"; line_id: string; expected_version: number }
  | {
      type: "hide_shopping";
      week_start: string;
      ingredient_id: string;
      unit: string;
    }
  | { type: "refresh_shopping"; week_start: string }
  | { type: "save_shopping_memo"; memo: string; expected_revision: string }
  | {
      type: "save_plan";
      plan_id: string | null;
      expected_version: number | null;
      draft: PlanInput;
    }
  | { type: "remove_plan"; plan_id: string; expected_version: number }
  | {
      type: "move_category";
      kind: "recipe" | "ingredient";
      name: string;
      direction: number;
    }
  | { type: "undo_inventory"; lot_id: string; expected_version: number }
  | {
      type: "set_lot_expiry";
      lot_id: string;
      expected_version: number;
      expires: string | null;
      reason: string;
    }
  | {
      type: "receive_lot";
      draft: {
        name: string;
        category: string;
        quantity: string;
        unit: string;
        location: string;
        received: string;
        expires: string | null;
        precision: string;
      };
    }
  | {
      type: "change_lot";
      lot_id: string;
      expected_version: number;
      operation: "use" | "discard" | "correct" | "move";
      quantity: string;
      location: string | null;
      reason: string;
    }
  | { type: "reverse_inventory_event"; event_id: string; reason: string }
  | { type: "create_recipe"; draft: RecipeInput }
  | {
      type: "revise_recipe";
      recipe_id: string;
      expected_revision_id: string;
      draft: RecipeInput;
    }
  | { type: "archive_recipe"; recipe_id: string }
  | { type: "delete_recipe"; recipe_id: string }
  | { type: "restore_recipe"; recipe_id: string }
  | { type: "favorite" | "inspiration"; recipe_id: string; enabled: boolean }
  | { type: "create_note"; recipe_id: string; date: string; note: string }
  | { type: "add_category"; kind: "recipe" | "ingredient"; name: string }
  | {
      type: "rename_category";
      kind: "recipe" | "ingredient";
      old: string;
      name: string;
    }
  | { type: "remove_category"; kind: "recipe" | "ingredient"; name: string }
  | {
      type: "assign_category";
      kind: "recipe" | "ingredient";
      entity_id: string;
      name: string;
    };
export interface KitchenClient {
  savePreferences?(preferences: AppPreferences): Promise<void>;
  recipeHistory?(recipeId: string): Promise<Recipe[]>;
  load(): Promise<DemoState>;
  shopping?(weekStart: string): Promise<ShoppingForecast>;
  execute(command: KitchenCommand, requestId: string): Promise<void>;
}
type RecipeSnapshot = Omit<Recipe, "requirements"> & {
  requirements: { ingredientId: string; quantity: string; unit: string }[];
};
const decodeRecipe = (r: RecipeSnapshot): Recipe => ({
  ...r,
  requirements: r.requirements.map((i) => ({
    ...i,
    quantity: Number(i.quantity),
  })),
});
type Snapshot = Omit<
  DemoState,
  "recipes" | "lots" | "plans" | "archivedRecipes"
> & {
  archivedRecipes?: RecipeSnapshot[];
  plans: (Omit<PlannedMeal, "recipeSnapshot"> & {
    recipeSnapshot?: RecipeSnapshot;
  })[];
  lots: (Omit<DemoState["lots"][number], "quantity"> & { quantity: string })[];
  recipes: (Omit<Recipe, "requirements"> & {
    requirements: { ingredientId: string; quantity: string; unit: string }[];
  })[];
};
export const kitchenClient: KitchenClient = {
  savePreferences(preferences) {
    return invoke<void>("kitchen_preferences_save", { preferences });
  },
  async recipeHistory(recipeId) {
    const rows = await invoke<RecipeSnapshot[]>("kitchen_recipe_history", {
      recipeId,
    });
    return rows.map(decodeRecipe);
  },
  shopping(weekStart) {
    return invoke<ShoppingForecast>("kitchen_shopping", { weekStart });
  },
  async load() {
    const snapshot = await invoke<Snapshot>("kitchen_bootstrap");
    return {
      ...snapshot,
      lots: snapshot.lots.map((lot) => ({
        ...lot,
        quantityText: lot.quantity,
        quantity: Number(lot.quantity),
      })),
      recipes: snapshot.recipes.map(decodeRecipe),
      archivedRecipes: (snapshot.archivedRecipes ?? []).map(decodeRecipe),
      plans: snapshot.plans.map((p) => ({
        ...p,
        recipeSnapshot: p.recipeSnapshot
          ? decodeRecipe(p.recipeSnapshot)
          : undefined,
      })),
    };
  },
  execute(command, requestId) {
    return invoke<void>("kitchen_execute", { requestId, command });
  },
};
export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error)
    return String(error.message);
  return "本地操作失败，请保留草稿后重试。";
}
export function emptyState(): DemoState {
  return {
    recipes: [],
    recipeCategories: [],
    ingredientCategories: [],
    ingredients: [],
    lots: [],
    plans: [],
    shopping: [],
    favorites: [],
    inspiration: [],
    logs: [],
    memo: "",
    hiddenNeeds: [],
  };
}
