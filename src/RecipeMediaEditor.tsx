import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sparkles, Upload, Trash2 } from "lucide-react";
import type { RecipeMedia } from "./model";
import { useDemo } from "./store";
import { errorMessage } from "./services/kitchenClient";
import ImageViewer from "./ImageViewer";

async function readPhoto(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error("请选择 20 MB 以内的图片");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.65, 0.5]) {
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= 1000000) return data;
    }
    throw new Error("图片压缩后仍较大，请换一张较小的图片");
  } finally {
    bitmap.close();
  }
}
export default function RecipeMediaEditor({
  value,
  onChange,
  name,
  step,
  disabled = false,
  onBusyChange,
}: {
  value: RecipeMedia;
  onChange: (media: RecipeMedia) => void;
  name: string;
  step?: number;
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { persistent } = useDemo();
  const [loading, setLoading] = useState(false),
    [status, setStatus] = useState(""),
    [preference, setPreference] = useState("");
  const [view, setView] = useState<{ image: string; title: string } | null>(
    null,
  );
  async function upload(file: File, step?: number) {
    setLoading(true);
    onBusyChange(true);
    setStatus("");
    try {
      const data = await readPhoto(file);
      onChange(
        step
          ? {
              ...value,
              steps: [
                ...value.steps.filter((v) => v.sourceStep !== step),
                { image: data, sourceStep: step },
              ].sort((a, b) => a.sourceStep - b.sourceStep),
            }
          : { ...value, cover: data, coverCredit: undefined },
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "无法读取图片，请使用 JPG、PNG 或 WebP",
      );
    } finally {
      setLoading(false);
      onBusyChange(false);
    }
  }
  function controls(image: string | undefined, label: string, step?: number) {
    return (
      <div className="media-edit-row">
        {image && (
          <button
            type="button"
            className="media-edit-preview"
            aria-label={`放大${label}`}
            onClick={() => setView({ image, title: label })}
          >
            <img src={image} alt={label} />
          </button>
        )}
        <div className="media-edit-actions">
          <strong>{label}</strong>
          <label className="image-upload">
            <Upload size={14} />
            {image ? "替换图片" : "上传图片"}
            <input
              aria-label={`上传${label}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={loading || disabled}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file, step);
                e.currentTarget.value = "";
              }}
            />
          </label>
          {image && (
            <button
              type="button"
              className="text-button"
              aria-label={`移除${label}`}
              disabled={loading || disabled}
              onClick={() =>
                onChange(
                  step
                    ? {
                        ...value,
                        steps: value.steps.filter((v) => v.sourceStep !== step),
                      }
                    : { ...value, cover: null, coverCredit: undefined },
                )
              }
            >
              <Trash2 size={13} />
              移除
            </button>
          )}
        </div>
      </div>
    );
  }
  if (step !== undefined)
    return (
      <div className="recipe-media-editor step-photo-editor">
        {controls(
          value.steps.find((s) => s.sourceStep === step)?.image,
          `步骤${step}图片`,
          step,
        )}
        {status && (
          <p className="hint" role="status">
            {status}
          </p>
        )}
        {view && <ImageViewer {...view} onClose={() => setView(null)} />}
      </div>
    );
  return (
    <section className="recipe-media-editor">
      <h3>菜谱封面</h3>
      {controls(value.cover ?? undefined, "封面图片")}
      {persistent && (
        <div className="cover-ai">
          <input
            aria-label="封面图片偏好"
            value={preference}
            maxLength={500}
            onChange={(e) => setPreference(e.target.value)}
            placeholder="图片偏好，例如：完整餐盘、背景简洁"
          />
          <button
            type="button"
            disabled={loading || disabled || !name.trim()}
            onClick={async () => {
              setLoading(true);
              onBusyChange(true);
              setStatus("");
              try {
                const result = await invoke<{
                  image: string;
                  credit: NonNullable<RecipeMedia["coverCredit"]>;
                }>("kitchen_recipe_cover", {
                  name,
                  preference,
                  previous: value.coverCredit?.sourceUrl ?? null,
                });
                onChange({
                  ...value,
                  cover: result.image,
                  coverCredit: result.credit,
                });
                setStatus("已填入参考封面，保存菜谱后生效。");
              } catch (error) {
                setStatus(errorMessage(error));
              } finally {
                setLoading(false);
                onBusyChange(false);
              }
            }}
          >
            <Sparkles size={14} />
            {loading ? "正在找封面…" : "AI 找封面"}
          </button>
        </div>
      )}
      {value.coverCredit && (
        <p className="hint">
          图片：{value.coverCredit.author} · {value.coverCredit.license}
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void invoke("kitchen_open_image_source", {
                url: value.coverCredit!.sourceUrl,
              })
            }
          >
            查看来源与许可
          </button>
        </p>
      )}
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
      {view && <ImageViewer {...view} onClose={() => setView(null)} />}
    </section>
  );
}
