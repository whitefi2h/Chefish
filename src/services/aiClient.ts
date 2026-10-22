import { invoke } from "@tauri-apps/api/core";
import { parseRecipe, type RecipeDraft } from "../RecipeEditor";
import { canonicalRecipeUrl } from "../domain/recipeImport";
export type Provider = "deepseek" | "openai" | "gemini";
export interface AISettings {
  provider: Provider;
  model: string;
  timeout: number;
  maxTokens: number;
}
export interface AIStatus {
  settings: AISettings;
  configured: Provider[];
}
export interface Candidate {
  id: string;
  title: string;
  url: string;
  snippet: string;
  rating: number | null;
  madeCount: number | null;
  author: string | null;
  source?: "xiachufang" | "deepseek";
  siteRank?: number;
  fetchedAt?: number;
  verifiedAt?: number;
  ratingCount?: number | null;
  verification?: string;
  verificationError?: string;
}
export interface ChatMessage {
  candidates?: Candidate[];
  proposal?: AssistantProposal;
  proposalState?: "applied" | "rejected";
  role: "user" | "assistant";
  content: string;
}
export interface AssistantProposal {
  id: string;
  operations: string[];
  changes: { section: string; before: string; after: string }[];
  destructive: boolean;
  expectedRevision: string;
}
export interface Route {
  limit?: number;
  proposal?: AssistantProposal;
  copy?: { title: string; text: string };
  page?: string;
  message: string;
  action:
    "search" | "import" | "none" | "operate" | "navigate" | "copy_shopping";
  query?: string;
  candidateId?: string;
  url?: string;
}
export const aiStatus = () => invoke<AIStatus>("kitchen_ai_settings");
export async function organizeRecipe(
  content: string,
  url: string,
  categories: string[],
): Promise<{ draft: RecipeDraft; warnings: string[] }> {
  const result = await invoke<{
    draft: Omit<RecipeDraft, "ingredients"> & {
      ingredients: { name: string; quantity: string; unit: string }[];
    };
    warnings: string[];
  }>("kitchen_ai_organize", {
    content,
    url: canonicalRecipeUrl(url),
    categories,
  });
  const draft = parseRecipe(
    JSON.stringify({
      ...result.draft,
      ingredients: result.draft.ingredients.map((i) => ({
        ...i,
        quantity: Number(i.quantity),
      })),
    }),
  );
  const images = await importRecipeImages(content, url);
  if (images.media) draft.media = images.media;
  return { draft, warnings: [...result.warnings, ...images.warnings] };
}
export async function importRecipeImages(
  content: string,
  url?: string,
): Promise<{ media?: import("../model").RecipeMedia; warnings: string[] }> {
  try {
    const result = await invoke<{
      media?: import("../model").RecipeMedia;
      warnings: string[];
    }>("kitchen_import_images", { content, url });
    return result ?? { warnings: [] };
  } catch {
    return { warnings: ["图片暂未能下载，文字内容仍可导入。"] };
  }
}
export function selectedUrl(
  route: Route,
  candidates: Candidate[],
  userText = "",
): string {
  if (route.candidateId) {
    const candidate = candidates.find((c) => c.id === route.candidateId);
    if (!candidate) throw new Error("候选已经变化，请重新选择");
    return canonicalRecipeUrl(candidate.url);
  }
  const selected = canonicalRecipeUrl(route.url ?? "");
  const supplied = userText.match(/https:\/\/[^\s<>"，。；）)]+/g) ?? [];
  if (
    !supplied.some((value) => {
      try {
        return canonicalRecipeUrl(value) === selected;
      } catch {
        return false;
      }
    })
  )
    throw new Error("请指定候选，或直接提供想整理的下厨房链接");
  return selected;
}
