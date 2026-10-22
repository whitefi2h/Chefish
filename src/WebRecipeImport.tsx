import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { nativeMode } from "./services/kitchenClient";
import AISettings from "./AISettings";
import { useDemo } from "./store";
import {
  aiStatus,
  organizeRecipe,
  importRecipeImages,
} from "./services/aiClient";
import { errorMessage } from "./services/kitchenClient";
import { parseRecipeHtml, recipeTextFromHtml } from "./domain/recipeImport";
import type { RecipeDraft } from "./RecipeEditor";

export default function WebRecipeImport({
  onPreview,
  onReset,
}: {
  onPreview: (draft: RecipeDraft, warnings: string[]) => void;
  onReset: () => void;
}) {
  const { state } = useDemo();
  const [configured, setConfigured] = useState(false);
  const [useAI, setUseAI] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [lastHtml, setLastHtml] = useState("");
  useEffect(() => {
    let alive = true;
    if (nativeMode)
      aiStatus()
        .then((s) => {
          if (alive) setConfigured(s.configured.includes(s.settings.provider));
        })
        .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function read(html: string) {
    setLastHtml(html);
    const result =
      configured && useAI
        ? await organizeRecipe(
            recipeTextFromHtml(html),
            url,
            state.recipeCategories,
          )
        : parseRecipeHtml(html, url);
    if (!(configured && useAI) && nativeMode) {
      const images = await importRecipeImages(recipeTextFromHtml(html), url);
      if (images.media) result.draft.media = images.media;
      result.warnings.push(...images.warnings);
    }
    onPreview(result.draft, result.warnings);
    setError("");
  }
  return (
    <section className="form-stack">
      {nativeMode && (
        <>
          <div className="assistant-toolbar">
            <label className="inline">
              <input
                type="checkbox"
                checked={useAI && configured}
                disabled={!configured || loading}
                onChange={(e) => setUseAI(e.target.checked)}
              />
              用模型整理食材和步骤
            </label>
            <button
              disabled={loading}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              模型设置
            </button>
          </div>
          {settingsOpen && (
            <AISettings
              onSaved={(s) => {
                setConfigured(s.configured.includes(s.settings.provider));
                setUseAI(true);
              }}
            />
          )}
        </>
      )}
      <label>
        下厨房菜谱链接
        <input
          type="url"
          value={url}
          placeholder="https://www.xiachufang.com/recipe/…/"
          onChange={(e) => {
            setUrl(e.target.value);
            setLastHtml("");
            onReset();
          }}
          disabled={loading}
        />
      </label>
      <button
        disabled={loading || !url.trim()}
        onClick={async () => {
          onReset();
          setLoading(true);
          setError("");
          try {
            if (!nativeMode)
              throw new Error(
                "浏览器预览支持本地 HTML；链接读取请使用桌面版。",
              );
            await read(await invoke<string>("kitchen_import_url", { url }));
          } catch (e) {
            setError(
              e instanceof Error
                ? e.message
                : typeof e === "object" && e && "message" in e
                  ? String(e.message)
                  : "网页读取失败，可导入本地 HTML",
            );
          } finally {
            setLoading(false);
          }
        }}
      >
        {loading ? "正在读取…" : "读取链接"}
      </button>
      <label>
        或选择本地 HTML
        <input
          type="file"
          accept=".html,.htm,text/html"
          disabled={loading}
          onChange={async (e) => {
            onReset();
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              if (file.size > 2_000_000)
                throw new Error("HTML 文件需小于 2 MB");
              setLoading(true);
              await read(await file.text());
            } catch (err) {
              setError(err instanceof Error ? err.message : "无法读取文件");
            }
            setLoading(false);
            e.target.value = "";
          }}
        />
      </label>
      {nativeMode && (
        <details>
          <summary>或粘贴菜谱正文</summary>
          <textarea
            aria-label="粘贴菜谱正文"
            value={pasted}
            maxLength={60000}
            disabled={loading}
            onChange={(e) => setPasted(e.target.value)}
          />
          <button
            disabled={loading || !configured || !url.trim() || !pasted.trim()}
            onClick={async () => {
              onReset();
              setLoading(true);
              setError("");
              try {
                const result = await organizeRecipe(
                  pasted,
                  url,
                  state.recipeCategories,
                );
                onPreview(result.draft, result.warnings);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            整理粘贴正文
          </button>
        </details>
      )}
      <p className="hint">
        先填写原始链接。读取后可编辑内容，确认前不会保存。网站无法读取时，可使用自行保存的
        HTML 文件。
      </p>
      {lastHtml && nativeMode && (
        <div className="actions">
          <button
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await read(lastHtml);
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setLoading(false);
              }
            }}
          >
            重试整理已读取内容
          </button>
          <button
            disabled={loading}
            onClick={async () => {
              try {
                const result = parseRecipeHtml(lastHtml, url);
                if (nativeMode) {
                  const images = await importRecipeImages(
                    recipeTextFromHtml(lastHtml),
                    url,
                  );
                  if (images.media) result.draft.media = images.media;
                  result.warnings.push(...images.warnings);
                }
                onPreview(result.draft, result.warnings);
                setError("");
              } catch (e) {
                setError(errorMessage(e));
              }
            }}
          >
            按原文预览
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
