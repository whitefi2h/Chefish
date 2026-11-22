import { invoke } from "@tauri-apps/api/core";
import { confirmAction } from "./dialogs";
import { canonicalRecipeUrl } from "../domain/recipeImport";
import type { Candidate } from "./aiClient";
async function read<T>(
  request: () => Promise<T>,
  url: string,
  mode: "recipe" | "verify" | "search",
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== "SITE_VERIFICATION"
    )
      throw error;
    if (
      !(await confirmAction(
        "下厨房需要验证。请在站内窗口手动完成验证，再返回 Chefish 继续读取。",
        { title: "下厨房验证", confirmLabel: "打开下厨房" },
      ))
    )
      throw new Error("已取消读取，原内容仍保留");
    await invoke("kitchen_site_open", { url });
    if (
      !(await confirmAction(
        "完成验证并看到原来的菜谱或搜索结果后，点击继续读取。",
        { title: "等待下厨房验证", confirmLabel: "继续读取" },
      ))
    )
      throw new Error("已取消读取，可稍后重试");
    return invoke<T>("kitchen_site_read", { url, mode });
  }
}
export const readRecipePage = (url: string) =>
  read(
    () => invoke<string>("kitchen_import_url", { url }),
    canonicalRecipeUrl(url),
    "recipe",
  );
export function searchRecipePages(query: string, limit: number) {
  const url = `https://www.xiachufang.com/search/?keyword=${encodeURIComponent(query)}&cat=1001`;
  return read(
    () => invoke<Candidate[]>("kitchen_ai_search", { query, limit }),
    url,
    "search",
  );
}
