import { splitIngredientRows } from "./domain/ingredientRows";
import { isSeasoning, supplies } from "./domain/seasonings";
import WebRecipeImport from "./WebRecipeImport";
import RecipeMediaEditor from "./RecipeMediaEditor";
import { canonicalRecipeUrl } from "./domain/recipeImport";
import { useState } from "react";
import { Modal, Badge } from "./components";
import { useDemo } from "./store";
import type { DemoState, Recipe, RecipeMedia } from "./model";
export interface RecipeDraft {
  ingredientKinds?: Record<string, boolean>;
  media?: RecipeMedia;
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
  steps: string[];
  ingredients: { name: string; quantity: number; unit: string }[];
}
export const example: RecipeDraft = {
  name: "清炒西兰花",
  category: "家常菜",
  minutes: 15,
  servings: 2,
  subtitle: "一道简单的家常菜",
  seasoning: "盐少许",
  steps: ["西兰花洗净切小朵。", "热锅翻炒至熟，调味装盘。"],
  ingredients: [{ name: "西兰花", quantity: 300, unit: "g" }],
};
export function parseRecipe(text: string): RecipeDraft {
  const d = JSON.parse(text);
  const validText = (v: unknown, max = 2000): v is string =>
    typeof v === "string" && v.trim().length > 0 && v.length <= max;
  if (
    !d ||
    !validText(d.name, 120) ||
    !validText(d.category, 24) ||
    ["全部菜谱", "我的收藏", "已归档"].includes(d.category.trim()) ||
    !Number.isInteger(d.minutes) ||
    d.minutes < 1 ||
    d.minutes > 1440 ||
    !Number.isInteger(d.servings) ||
    d.servings < 1 ||
    d.servings > 12 ||
    !Array.isArray(d.steps) ||
    !d.steps.length ||
    d.steps.length > 50 ||
    !d.steps.every((v: unknown) => validText(v)) ||
    (d.stepTitles !== undefined &&
      (!Array.isArray(d.stepTitles) ||
        d.stepTitles.length !== d.steps.length ||
        !d.stepTitles.every(
          (v: unknown) => typeof v === "string" && v.length <= 120,
        ))) ||
    !Array.isArray(d.ingredients) ||
    d.ingredients.length > 100 ||
    !d.ingredients.every(
      (i: { name: unknown; quantity: number; unit: unknown }) =>
        i &&
        validText(i.name, 120) &&
        Number.isFinite(i.quantity) &&
        i.quantity > 0 &&
        i.quantity <= 100000 &&
        ["g", "ml", "个", "片", "盒"].includes(String(i.unit)),
    )
  )
    throw new Error(
      "请检查名称、分类、人数（1–12）、用时（1–1440）、步骤和食材数量 / 单位。",
    );
  for (const key of ["subtitle", "seasoning"])
    if (
      d[key] !== undefined &&
      (typeof d[key] !== "string" || d[key].length > 2000)
    )
      throw new Error("描述或调味文字格式不正确。");
  if (
    d.ingredientKinds !== undefined &&
    (!d.ingredientKinds ||
      Array.isArray(d.ingredientKinds) ||
      typeof d.ingredientKinds !== "object" ||
      Object.keys(d.ingredientKinds).length > 100 ||
      !Object.entries(d.ingredientKinds).every(
        ([k, v]) => k.trim() && k.length <= 120 && typeof v === "boolean",
      ))
  )
    throw new Error("配料类型格式不正确。");
  if (
    d.textIngredients !== undefined &&
    (!Array.isArray(d.textIngredients) ||
      d.textIngredients.length + d.ingredients.length > 100 ||
      !d.textIngredients.every(
        (i: { name: unknown; amountText: unknown }) =>
          i && validText(i.name, 120) && validText(i.amountText, 200),
      ))
  )
    throw new Error("请检查原文用量食材的名称和用量");
  if (d.media) {
    const validImage = (v: unknown) =>
      typeof v === "string" &&
      v.length <= 1000100 &&
      /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(v);
    if (
      (d.media.cover != null && !validImage(d.media.cover)) ||
      !Array.isArray(d.media.steps) ||
      d.media.steps.length > 50 ||
      !d.media.steps.every(
        (v: { image: unknown; sourceStep: number }) =>
          v &&
          validImage(v.image) &&
          Number.isInteger(v.sourceStep) &&
          v.sourceStep >= 1 &&
          v.sourceStep <= 50,
      )
    )
      throw new Error("菜谱图片格式不正确");
  }
  if (d.source) {
    d.source.url = canonicalRecipeUrl(d.source.url);
    if (
      typeof d.source.author !== "string" ||
      d.source.author.length > 120 ||
      !Array.isArray(d.source.ingredientText) ||
      d.source.ingredientText.length > 100 ||
      !d.source.ingredientText.every(
        (v: unknown) => typeof v === "string" && v.length <= 200,
      )
    )
      throw new Error("来源作者或原始用量格式不正确");
  }
  return {
    ...d,
    name: d.name.trim(),
    category: d.category.trim(),
    subtitle: d.subtitle ?? "",
    seasoning: d.seasoning ?? "",
  };
}
export function addRecipe(
  s: DemoState,
  d: RecipeDraft,
  previous?: Recipe,
): DemoState {
  const ingredients = [...s.ingredients];
  const requirements = d.ingredients.map((i) => {
    let item = ingredients.find((v) => v.name === i.name.trim());
    if (!item) {
      item = {
        id: crypto.randomUUID(),
        name: i.name.trim(),
        category: "未分类",
      };
      ingredients.push(item);
    }
    return { ingredientId: item.id, quantity: i.quantity, unit: i.unit };
  });
  const r: Recipe = {
    ingredientKinds: d.ingredientKinds,
    id: previous?.id ?? crypto.randomUUID(),
    revisionId: crypto.randomUUID(),
    revisionNumber: (previous?.revisionNumber ?? (previous ? 1 : 0)) + 1,
    name: d.name,
    category: d.category,
    minutes: d.minutes,
    servings: d.servings,
    subtitle: d.subtitle,
    seasoning: d.seasoning,
    steps: d.steps,
    stepTitles: d.stepTitles,
    source: d.source ?? previous?.source,
    textIngredients: d.textIngredients ?? [],
    media: d.media ?? previous?.media,
    image: d.media
      ? (d.media.cover ?? "placeholder")
      : (previous?.image ?? "placeholder"),
    requirements,
  };
  return {
    ...s,
    ingredients,
    seasonings: [
      ...supplies(s),
      ...[...d.ingredients, ...(d.textIngredients ?? [])]
        .filter(
          (i) =>
            isSeasoning(i.name, d.ingredientKinds) &&
            !supplies(s).some((v) => v.name === i.name.trim()),
        )
        .map((i) => ({
          id: i.name.trim(),
          name: i.name.trim(),
          missing: false,
        })),
    ],
    ingredientCategories: ingredients.some((i) => i.category === "未分类")
      ? [...new Set([...s.ingredientCategories, "未分类"])]
      : s.ingredientCategories,
    recipes: previous
      ? s.recipes.map((old) => (old.id === previous.id ? r : old))
      : [...s.recipes, r],
    recipeHistory: previous
      ? [...(s.recipeHistory ?? []), previous]
      : s.recipeHistory,
    plans: previous
      ? s.plans.map((p) =>
          p.recipeId === previous.id && !p.recipeSnapshot
            ? { ...p, recipeSnapshot: previous }
            : p,
        )
      : s.plans,
    recipeCategories: [...new Set([...s.recipeCategories, d.category])],
  };
}
export default function RecipeEditor({
  mode,
  onClose,
  recipe,
  source = recipe,
  onExisting,
  initialDraft,
  importWarnings = [],
}: {
  mode: "create" | "import" | "edit" | "review";
  initialDraft?: RecipeDraft;
  importWarnings?: string[];
  recipe?: Recipe;
  source?: Recipe;
  onExisting?: (id: string) => void;
  onClose: () => void;
}) {
  const { state, mutate, persistent, busy } = useDemo();
  const [name, setName] = useState(initialDraft?.name ?? source?.name ?? "");
  const [media, setMedia] = useState<RecipeMedia | undefined>(
    initialDraft?.media ?? source?.media,
  );
  const [mediaBusy, setMediaBusy] = useState(false);
  const [category, setCategory] = useState(
    initialDraft?.category ??
      recipe?.category ??
      state.recipeCategories[0] ??
      "未分类",
  );
  const [minutes, setMinutes] = useState(
    initialDraft?.minutes ?? source?.minutes ?? 20,
  );
  const [servings, setServings] = useState(
    initialDraft?.servings ?? source?.servings ?? 2,
  );
  const [steps, setSteps] = useState(
    initialDraft
      ? initialDraft.steps.map((body, i) => ({
          body,
          title: initialDraft.stepTitles?.[i] ?? "",
        }))
      : source
        ? source.steps.map((body, i) => ({
            body,
            title: source.stepTitles?.[i] ?? "",
          }))
        : [{ title: "", body: "" }],
  );
  const [seasoning, setSeasoning] = useState(
    initialDraft?.seasoning ?? source?.seasoning ?? "",
  );
  const [subtitle, setSubtitle] = useState(
    initialDraft?.subtitle ?? source?.subtitle ?? "我的厨房手记",
  );
  const [ingredientRows, setIngredientRows] = useState(() => {
    if (!initialDraft && !source) return [{ name: "", amountText: "100 g" }];
    const exact =
      initialDraft?.ingredients ??
      source?.requirements.map((i) => ({
        name:
          state.ingredients.find((v) => v.id === i.ingredientId)?.name ?? "",
        quantity: i.quantity,
        unit: i.unit,
      })) ??
      [];
    return [
      ...exact.map((i) => ({
        name: i.name,
        amountText: `${i.quantity} ${i.unit}`,
      })),
      ...(initialDraft?.textIngredients ?? source?.textIngredients ?? []),
    ];
  });
  const [ingredientKinds, setIngredientKinds] = useState<
    Record<string, boolean>
  >(initialDraft?.ingredientKinds ?? source?.ingredientKinds ?? {});
  const [origin] = useState(initialDraft?.source ?? source?.source);
  const [author, setAuthor] = useState(origin?.author ?? "");
  const [method, setMethod] = useState(initialDraft ? "web" : "json");
  const [review, setReview] = useState(false);
  const [warnings, setWarnings] = useState<string[]>(importWarnings);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<RecipeDraft | null>(
    mode === "import" ? (initialDraft ?? null) : null,
  );
  const [error, setError] = useState("");
  const [importChoice, setImportChoice] = useState("");
  const duplicates = draft
    ? state.recipes.filter(
        (r) =>
          r.name.trim() === draft.name.trim() ||
          (draft.source && r.source?.url === draft.source.url),
      )
    : [];
  const importTarget = duplicates.find((r) => r.id === importChoice);
  function preview(value: string) {
    setImportChoice("");
    try {
      setDraft(parseRecipe(value));
      setError("");
    } catch (e) {
      setDraft(null);
      setError(e instanceof Error ? e.message : "无法读取菜谱");
    }
  }
  if (review && draft)
    return (
      <RecipeEditor
        mode="review"
        initialDraft={{
          ...draft,
          allowSourceDuplicate: importChoice === "copy",
        }}
        recipe={importTarget}
        onClose={onClose}
      />
    );
  return (
    <Modal
      title={
        mode === "review"
          ? "编辑导入草稿"
          : mode === "edit"
            ? "编辑菜谱"
            : mode === "create"
              ? "创建菜谱"
              : "导入菜谱"
      }
      onClose={onClose}
    >
      {mode !== "import" ? (
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              const d = parseRecipe(
                JSON.stringify({
                  name,
                  category,
                  minutes,
                  servings,
                  steps: steps.map((v) => v.body.trim()),
                  stepTitles: steps.map((v) => v.title.trim()),
                  seasoning,
                  ingredientKinds: Object.fromEntries(
                    ingredientRows
                      .filter((row) => row.name.trim())
                      .map((row) => [
                        row.name.trim(),
                        isSeasoning(row.name, ingredientKinds),
                      ]),
                  ),
                  ...splitIngredientRows(
                    ingredientRows.filter((row) => row.name.trim()),
                  ),
                  subtitle,
                  source: origin ? { ...origin, author } : undefined,
                  media,
                  allowSourceDuplicate: initialDraft?.allowSourceDuplicate,
                }),
              );
              const saved = await mutate(
                {
                  ...(recipe
                    ? {
                        type: "revise_recipe" as const,
                        recipe_id: recipe.id,
                        expected_revision_id: recipe.revisionId!,
                      }
                    : { type: "create_recipe" as const }),
                  draft: {
                    ...d,
                    ingredients: d.ingredients.map((i) => ({
                      ...i,
                      quantity: String(i.quantity),
                    })),
                  },
                },
                (s) => addRecipe(s, d, recipe),
                persistent ? "菜谱已保存到本地数据库" : "菜谱已加入演示菜谱库",
              );
              if (saved) onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "请核对输入");
            }
          }}
        >
          {recipe && (
            <p className="hint">保存为新版本，已安排的菜单继续使用原配方。</p>
          )}
          {origin && (
            <section className="form-stack import-source">
              <p className="hint">来源：{origin.url}</p>
              <label>
                原作者
                <input
                  maxLength={120}
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </label>
            </section>
          )}
          <label>
            菜谱名称
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            菜谱简介
            <input
              maxLength={2000}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />
          </label>
          <div className="form-row">
            <label>
              菜谱分类
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {[...new Set([...state.recipeCategories, category])].map(
                  (c) => (
                    <option key={c}>{c}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              用时（分钟）
              <input
                type="number"
                min={1}
                max={1440}
                required
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
          </div>
          <label>
            标准人数
            <input
              type="number"
              min={1}
              max={12}
              required
              value={servings}
              onChange={(e) => setServings(Number(e.target.value))}
            />
          </label>
          <p className="hint">
            用量可填写 150 g、3 个、2
            勺或适量。调料不按每餐消耗采购，缺少时在库存的调料区标记。
          </p>
          {[false, true].map((seasoningGroup) => (
            <section
              className="recipe-ingredient-group"
              key={String(seasoningGroup)}
            >
              <h3>{seasoningGroup ? "调料用量" : "食材用量"}</h3>
              {ingredientRows.map(
                (item, index) =>
                  isSeasoning(item.name, ingredientKinds) ===
                    seasoningGroup && (
                    <div className="text-ingredient-edit" key={index}>
                      <input
                        aria-label={`食材${index + 1}名称`}
                        placeholder="食材名称"
                        value={item.name}
                        maxLength={120}
                        onChange={(e) => {
                          if (Object.hasOwn(ingredientKinds, item.name.trim()))
                            setIngredientKinds({
                              ...ingredientKinds,
                              [e.target.value.trim()]:
                                ingredientKinds[item.name.trim()],
                            });
                          setIngredientRows(
                            ingredientRows.map((v, n) =>
                              n === index ? { ...v, name: e.target.value } : v,
                            ),
                          );
                        }}
                      />
                      <input
                        aria-label={`食材${index + 1}用量`}
                        placeholder="例如：150 g / 适量"
                        value={item.amountText}
                        maxLength={200}
                        onChange={(e) =>
                          setIngredientRows(
                            ingredientRows.map((v, n) =>
                              n === index
                                ? { ...v, amountText: e.target.value }
                                : v,
                            ),
                          )
                        }
                      />
                      <select
                        aria-label={`食材${index + 1}类型`}
                        value={seasoningGroup ? "seasoning" : "food"}
                        onChange={(e) =>
                          setIngredientKinds({
                            ...ingredientKinds,
                            [item.name.trim()]: e.target.value === "seasoning",
                          })
                        }
                      >
                        <option value="food">食材</option>
                        <option value="seasoning">调料</option>
                      </select>
                      <button
                        type="button"
                        aria-label={`移除食材${index + 1}`}
                        onClick={() =>
                          setIngredientRows(
                            ingredientRows.filter((_, n) => n !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  ),
              )}
              <button
                type="button"
                onClick={() => {
                  if (seasoningGroup)
                    setIngredientKinds({ ...ingredientKinds, 新调料: true });
                  setIngredientRows([
                    ...ingredientRows,
                    { name: seasoningGroup ? "新调料" : "", amountText: "" },
                  ]);
                }}
              >
                {seasoningGroup ? "添加调料" : "添加食材"}
              </button>
            </section>
          ))}
          <label>
            调味（可选）
            <input
              value={seasoning}
              maxLength={2000}
              onChange={(e) => setSeasoning(e.target.value)}
            />
          </label>
          <RecipeMediaEditor
            value={media ?? { cover: null, steps: [] }}
            onChange={setMedia}
            name={name}
            disabled={mediaBusy}
            onBusyChange={setMediaBusy}
          />
          <div className="step-editor">
            <h3>烹饪步骤</h3>
            {steps.map((step, index) => (
              <section className="step-edit" key={index}>
                <header>
                  <strong>步骤 {index + 1}</strong>
                  <button
                    type="button"
                    aria-label={`移除步骤${index + 1}`}
                    disabled={steps.length === 1 || mediaBusy}
                    onClick={() => {
                      setSteps(steps.filter((_, i) => i !== index));
                      setMedia((v) =>
                        v
                          ? {
                              ...v,
                              steps: v.steps
                                .filter((s) => s.sourceStep !== index + 1)
                                .map((s) =>
                                  s.sourceStep > index + 1
                                    ? { ...s, sourceStep: s.sourceStep - 1 }
                                    : s,
                                ),
                            }
                          : v,
                      );
                    }}
                  >
                    ×
                  </button>
                </header>
                <label>
                  标题（可选）
                  <input
                    aria-label={`步骤${index + 1}标题`}
                    maxLength={120}
                    value={step.title}
                    placeholder="例如：煎至两面金黄"
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, i) =>
                          i === index ? { ...s, title: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  做法
                  <textarea
                    aria-label={`步骤${index + 1}做法`}
                    required
                    maxLength={2000}
                    value={step.body}
                    onChange={(e) =>
                      setSteps(
                        steps.map((s, i) =>
                          i === index ? { ...s, body: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
                <RecipeMediaEditor
                  value={media ?? { cover: null, steps: [] }}
                  onChange={setMedia}
                  name={name}
                  step={index + 1}
                  disabled={mediaBusy}
                  onBusyChange={setMediaBusy}
                />
              </section>
            ))}
            <button
              type="button"
              disabled={steps.length >= 50 || mediaBusy}
              onClick={() => setSteps([...steps, { title: "", body: "" }])}
            >
              添加步骤
            </button>
          </div>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy || mediaBusy}>
            {mode === "review"
              ? "确认导入"
              : recipe
                ? "保存修改"
                : persistent
                  ? "保存菜谱"
                  : "创建演示菜谱"}
          </button>
        </form>
      ) : (
        <div className="form-stack">
          <div className="actions" role="group" aria-label="导入来源">
            <button
              className={method === "web" ? "primary" : ""}
              onClick={() => {
                setMethod("web");
                setDraft(null);
                setError("");
              }}
            >
              下厨房链接 / HTML
            </button>
            <button
              className={method === "json" ? "primary" : ""}
              onClick={() => {
                setMethod("json");
                setDraft(null);
                setError("");
              }}
            >
              JSON
            </button>
          </div>
          {method === "web" ? (
            initialDraft ? (
              <p className="hint">
                整理完成，编辑后确认保存。来源：{initialDraft.source?.url}
              </p>
            ) : (
              <WebRecipeImport
                onReset={() => {
                  setDraft(null);
                  setError("");
                  setImportChoice("");
                }}
                onPreview={(value, notices) => {
                  try {
                    setDraft(parseRecipe(JSON.stringify(value)));
                    setWarnings(notices);
                    setImportChoice("");
                    setError("");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "无法读取菜谱");
                  }
                }}
              />
            )
          ) : (
            <>
              <label>
                选择 JSON 文件
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 64000000) {
                      setError("文件需小于 64 MB");
                      return;
                    }
                    try {
                      const value = await file.text();
                      setText(value);
                      preview(value);
                    } catch {
                      setError("无法读取文件");
                    }
                  }}
                />
              </label>
              <label>
                菜谱 JSON
                <textarea
                  aria-label="菜谱 JSON"
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setDraft(null);
                    setError("");
                  }}
                  maxLength={64000000}
                />
              </label>
              <div className="actions">
                <button
                  onClick={() => {
                    setText(JSON.stringify(example, null, 2));
                    setDraft(null);
                  }}
                >
                  填入格式示例
                </button>
                <button onClick={() => preview(text)}>预览导入</button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {draft && (
            <section className="panel">
              <Badge tone="warm">待确认</Badge>
              <h3>{draft.name}</h3>
              {draft.media?.cover && (
                <img
                  className="import-cover-preview"
                  src={draft.media.cover}
                  alt={`${draft.name}封面预览`}
                />
              )}
              {draft.media && (
                <p className="hint">
                  {draft.media.cover ? "含封面 · " : ""}
                  {draft.media.steps.length} 张步骤原图，确认后保存在本机。
                </p>
              )}
              {method === "web" &&
                warnings.map((w) => (
                  <p className="hint" key={w}>
                    {w}
                  </p>
                ))}
              <p>
                {draft.category} · {draft.minutes} 分钟 · {draft.servings} 人份
              </p>
              <p>
                {draft.ingredients.length} 项食材 · {draft.steps.length} 个步骤
              </p>
              {duplicates.length > 0 && (
                <div className="form-stack import-duplicate">
                  <p>已有同名或同来源菜谱，请选择如何处理。</p>
                  <label>
                    导入方式
                    <select
                      value={importChoice}
                      onChange={(e) => setImportChoice(e.target.value)}
                    >
                      <option value="">请选择</option>
                      {duplicates.map((r) => (
                        <option key={r.id} value={r.id}>
                          更新「{r.name}」为新版本（第 {r.revisionNumber ?? 1}{" "}
                          版之后）
                        </option>
                      ))}
                      <option value="copy">另存副本</option>
                    </select>
                  </label>
                  {onExisting && (
                    <div className="actions">
                      {duplicates.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            onClose();
                            onExisting(r.id);
                          }}
                        >
                          查看已有菜谱
                          {duplicates.length > 1 ? ` · ${r.category}` : ""}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                className="primary full"
                disabled={busy || (duplicates.length > 0 && !importChoice)}
                onClick={async () => {
                  if (method === "web") {
                    setReview(true);
                    return;
                  }
                  const saved = await mutate(
                    {
                      ...(importTarget
                        ? {
                            type: "revise_recipe" as const,
                            recipe_id: importTarget.id,
                            expected_revision_id: importTarget.revisionId!,
                          }
                        : { type: "create_recipe" as const }),
                      draft: {
                        ...draft,
                        allowSourceDuplicate: importChoice === "copy",
                        ingredients: draft.ingredients.map((i) => ({
                          ...i,
                          quantity: String(i.quantity),
                        })),
                      },
                    },
                    (s) => addRecipe(s, draft, importTarget),
                    persistent ? "已导入本地菜谱库" : "已确认导入演示菜谱",
                  );
                  if (saved) onClose();
                }}
              >
                {method === "web" ? "编辑后导入" : "确认导入"}
              </button>
            </section>
          )}
        </div>
      )}
      <p className="hint space-top">
        {persistent ? "确认后保存到本机数据库。" : "仅在本次会话保留。"}
        没有填写用量的食材不会自动生成采购需求。
      </p>
    </Modal>
  );
}
