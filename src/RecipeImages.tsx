import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ImagePlus } from "lucide-react";
import { useDemo } from "./store";
import { addRecipe, type RecipeDraft } from "./RecipeEditor";
import type { Recipe, RecipeMedia } from "./model";
import { recipeTextFromHtml } from "./domain/recipeImport";
import { importRecipeImages } from "./services/aiClient";
import { errorMessage } from "./services/kitchenClient";

export default function RecipeImages({ recipe }: { recipe: Recipe }) {
  const { state, mutate, persistent, busy } = useDemo();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [html, setHtml] = useState("");
  async function repair(content?: string) {
    setLoading(true);
    setStatus("");
    try {
      const result =
        content === undefined
          ? await invoke<{
              media: RecipeMedia | null;
              warnings: string[];
            }>("kitchen_recipe_images", { url: recipe.source!.url })
          : await importRecipeImages(
              recipeTextFromHtml(content),
              recipe.source!.url,
            );
      if (!result.media)
        throw new Error(
          result.warnings.join("；") || "原页暂未提供可保存的图片",
        );
      const steps = new Map(
        (recipe.media?.steps ?? []).map((s) => [s.sourceStep, s]),
      );
      result.media.steps.forEach((s) => steps.set(s.sourceStep, s));
      const media = {
        cover: result.media.cover ?? recipe.media?.cover ?? null,
        steps: [...steps.values()].sort((a, b) => a.sourceStep - b.sourceStep),
      };
      if (JSON.stringify(media) === JSON.stringify(recipe.media)) {
        setStatus("已有原图无需重复更新。");
        return;
      }
      const draft: RecipeDraft = {
        name: recipe.name,
        category: recipe.category,
        minutes: recipe.minutes,
        servings: recipe.servings,
        subtitle: recipe.subtitle,
        seasoning: recipe.seasoning,
        steps: recipe.steps,
        stepTitles: recipe.stepTitles,
        source: recipe.source,
        textIngredients: recipe.textIngredients,
        media,
        ingredients: recipe.requirements.map((r) => ({
          name: state.ingredients.find((i) => i.id === r.ingredientId)!.name,
          quantity: r.quantity,
          unit: r.unit,
        })),
      };
      const saved = await mutate(
        {
          type: "revise_recipe",
          recipe_id: recipe.id,
          expected_revision_id: recipe.revisionId!,
          draft: {
            ...draft,
            ingredients: draft.ingredients.map((i) => ({
              ...i,
              quantity: String(i.quantity),
            })),
          },
        },
        (s) => addRecipe(s, draft, recipe),
        "",
      );
      if (saved)
        setStatus(
          `已保存 ${media.steps.length} 张步骤原图${result.warnings.length ? `；${result.warnings.join("；")}` : "。"}`,
        );
    } catch (e) {
      setStatus(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  if (!persistent || !recipe.source) return null;
  return (
    <div className="recipe-image-repair">
      <button disabled={loading || busy} onClick={() => void repair()}>
        <ImagePlus size={15} />
        {loading ? "正在补充原图…" : "补充原图"}
      </button>
      <details className="space-top">
        <summary>原页能正常打开？粘贴 HTML 补图</summary>
        <div className="form-stack space-top">
          <textarea
            aria-label="原页 HTML 补图"
            maxLength={2000000}
            value={html}
            disabled={loading || busy}
            onChange={(e) => setHtml(e.target.value)}
            placeholder="粘贴正常原页的 HTML，仅提取原图，不改写菜谱。"
          />
          <button
            disabled={loading || busy || !html.trim()}
            onClick={() => void repair(html)}
          >
            从 HTML 补充原图
          </button>
        </div>
      </details>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
    </div>
  );
}
