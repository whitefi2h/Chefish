import { invoke } from "@tauri-apps/api/core";
import { confirmAction } from "./dialogs";
import { canonicalRecipeUrl } from "../domain/recipeImport";
import type { Candidate } from "./aiClient";
const hasCode = (error: unknown, code: string) =>
  !!error &&
  typeof error === "object" &&
  "code" in error &&
  error.code === code;

async function read<T>(
  request: () => Promise<T>,
  url: string,
  mode: "recipe" | "verify" | "search",
): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!hasCode(error, "SITE_VERIFICATION")) throw error;
    if (
      !(await confirmAction("链接暂未返回正文，可以通过下厨房窗口继续读取。", {
        title: "通过站内窗口读取",
        confirmLabel: "打开下厨房",
      }))
    )
      throw new Error("已取消读取，原内容仍保留");
    await invoke("kitchen_site_open", { url });
    const readPage = async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await invoke<T>("kitchen_site_read", { url, mode });
        } catch (error) {
          const navigating =
            hasCode(error, "SITE_LOADING") ||
            hasCode(error, "SITE_PAGE_MISMATCH");
          const mayBeRedirecting =
            attempt === 0 && hasCode(error, "SITE_VERIFICATION");
          if ((attempt >= 15 || !navigating) && !mayBeRedirecting) throw error;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    };
    for (;;) {
      try {
        return await readPage();
      } catch (error) {
        if (!hasCode(error, "SITE_VERIFICATION")) throw error;
        if (
          !(await confirmAction(
            "下厨房当前显示验证页。请在站内窗口手动完成验证，再继续读取。",
            { title: "下厨房验证", confirmLabel: "继续读取" },
          ))
        )
          throw new Error("已取消读取，可稍后重试");
      }
    }
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
