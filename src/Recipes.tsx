import { isSeasoning } from "./domain/seasonings";
import RecipeSourceLink from "./RecipeSourceLink";
import RecipeImages from "./RecipeImages";
import { useRef, useState } from "react";
import {
  Search,
  Heart,
  Clock,
  ArrowLeft,
  Plus,
  NotebookPen,
  Users,
  Check,
  Upload,
  Pencil,
  Trash2,
  History,
} from "lucide-react";
import { amount, type Recipe } from "./model";
import { useDemo } from "./store";
import { Badge, Food, Empty, Modal } from "./components";
import { PlanForm } from "./Planner";
import RecipeEditor from "./RecipeEditor";
import CategoryManager from "./CategoryManager";
import RecipeHistory from "./RecipeHistory";
function InspirationButton({ recipe }: { recipe: Recipe }) {
  const { state, mutate } = useDemo();
  const active = state.inspiration.includes(recipe.id);
  return (
    <button
      className="inspiration-button"
      aria-label={`${active ? "移出" : "加入"}周灵感${recipe.name}`}
      onClick={() =>
        mutate(
          { type: "inspiration", recipe_id: recipe.id, enabled: !active },
          (s) => ({
            ...s,
            inspiration: active
              ? s.inspiration.filter((id) => id !== recipe.id)
              : [...s.inspiration, recipe.id],
          }),
          active
            ? "已移出本周灵感，已排菜单保留"
            : "已加入本周灵感，可前往每周菜单配餐",
        )
      }
    >
      {active ? <Check size={16} /> : <Plus size={16} />}
      {active ? "已加入周灵感" : "加入周灵感"}
    </button>
  );
}
export function RecipeCard({
  recipe,
  onOpen,
}: {
  recipe: Recipe;
  onOpen: () => void;
}) {
  const { state, mutate, persistent } = useDemo();
  const favorite = state.favorites.includes(recipe.id);
  return (
    <article className="recipe-card">
      <div className="recipe-photo">
        <button
          className="photo-link"
          onClick={onOpen}
          aria-label={`查看${recipe.name}`}
        >
          <Food image={recipe.image} name={recipe.name} />
        </button>
        <Badge>
          <Clock size={12} />
          {recipe.minutes} 分钟
        </Badge>
        <span className="recipe-category-tag">
          <Badge tone="green">{recipe.category}</Badge>
        </span>
        <button
          className={`favorite ${favorite ? "active" : ""}`}
          aria-label={`${favorite ? "取消收藏" : "收藏"}${recipe.name}`}
          onClick={() =>
            mutate(
              { type: "favorite", recipe_id: recipe.id, enabled: !favorite },
              (s) => ({
                ...s,
                favorites: favorite
                  ? s.favorites.filter((id) => id !== recipe.id)
                  : [...s.favorites, recipe.id],
              }),
              persistent ? "收藏已保存到本地" : "收藏已更新，仅保留本次会话",
            )
          }
        >
          <Heart size={17} fill={favorite ? "currentColor" : "none"} />
        </button>
      </div>
      <div className="recipe-body">
        <div className="recipe-card-heading">
          <div>
            <button className="recipe-title" onClick={onOpen}>
              {recipe.name}
            </button>
            <p>{recipe.subtitle}</p>
          </div>
          <InspirationButton recipe={recipe} />
        </div>
        <footer>
          <span>{recipe.servings} 人份 · 本地插画占位</span>
          <button className="text-button" onClick={onOpen}>
            查看菜谱 →
          </button>
        </footer>
      </div>
    </article>
  );
}
function NoteEditor({
  entry,
  onClose,
}: {
  entry: { id: string; note: string; date: string };
  onClose: () => void;
}) {
  const { mutate, busy } = useDemo();
  const [draft, setDraft] = useState(entry.note);
  return (
    <Modal title="编辑手记" onClose={onClose}>
      <form
        className="form-stack note-edit-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutate(
              {
                type: "edit_note",
                note_id: entry.id,
                expected_note: entry.note,
                note: draft.trim(),
              },
              (s) => ({
                ...s,
                logs: s.logs.map((l) =>
                  l.id === entry.id ? { ...l, note: draft.trim() } : l,
                ),
              }),
              "",
            )
          )
            onClose();
        }}
      >
        <p className="hint">{entry.date}</p>
        <label>
          手记内容
          <textarea
            aria-label="编辑手记内容"
            required
            maxLength={2000}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </label>
        <div className="actions note-edit-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || !draft.trim()}>
            保存修改
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RecipeDetail({
  recipe,
  onBack,
}: {
  recipe: Recipe;
  onBack: () => void;
}) {
  const { state, mutate, persistent, today, busy, preferences } = useDemo();
  const [servings, setServings] = useState(preferences.defaultServings);
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<{
    id: string;
    date: string;
    note: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [plan, setPlan] = useState(false);
  const [recipeEditor, setRecipeEditor] = useState<Recipe | null>(null);
  const [versions, setVersions] = useState(false);
  const [archive, setArchive] = useState(false);
  const logs = state.logs.filter((l) => l.recipeId === recipe.id);
  return (
    <>
      <div className="recipe-detail-toolbar">
        <button className="text-button back" onClick={onBack}>
          <ArrowLeft size={17} />
          返回菜谱库
        </button>
        <div className="recipe-management actions">
          <button onClick={() => setRecipeEditor(recipe)}>
            <Pencil size={15} />
            编辑菜谱
          </button>
          <button onClick={() => setVersions(true)}>
            <History size={15} />
            历史版本
          </button>
          <button onClick={() => setArchive(true)}>
            <Trash2 size={15} />
            删除
          </button>
        </div>
      </div>
      <section className="detail-hero panel">
        <Food image={recipe.image} name={recipe.name} />
        <div>
          <div className="eyebrow">FROM YOUR RECIPE COLLECTION</div>
          <h1>{recipe.name}</h1>
          <p>{recipe.subtitle}</p>
          {recipe.source && (
            <p className="hint recipe-source">
              来源：
              <RecipeSourceLink url={recipe.source.url} />
              {recipe.source.author ? ` · ${recipe.source.author}` : ""}
            </p>
          )}
          <label className="recipe-category-label">
            菜谱分类
            <select
              aria-label="菜谱所属分类"
              value={recipe.category}
              onChange={(e) =>
                mutate(
                  {
                    type: "assign_category",
                    kind: "recipe",
                    entity_id: recipe.id,
                    name: e.target.value,
                  },
                  (s) => ({
                    ...s,
                    recipes: s.recipes.map((r) =>
                      r.id === recipe.id
                        ? { ...r, category: e.target.value }
                        : r,
                    ),
                  }),
                  persistent ? "菜谱分类已保存" : "菜谱分类已更新，可撤销",
                )
              }
            >
              {state.recipeCategories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="actions">
            <Badge tone="green">{recipe.category}</Badge>
            <Badge>
              <Clock size={13} />
              {recipe.minutes} 分钟
            </Badge>
            <Badge>
              <Users size={13} />
              {recipe.servings} 标准份
            </Badge>
          </div>
          <div className="actions detail-actions space-top">
            <InspirationButton recipe={recipe} />
            <button className="primary" onClick={() => setPlan(true)}>
              <Plus size={15} />
              加入周菜单
            </button>
          </div>
        </div>
      </section>
      <div className="recipe-detail-layout">
        <section className="panel ingredients-panel">
          <h2>准备食材</h2>
          <label className="servings">
            用餐人数
            <input
              aria-label="菜谱用餐人数"
              type="number"
              min="1"
              max="12"
              required
              value={servings}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (value >= 1 && value <= 12) setServings(value);
              }}
            />
          </label>
          {[false, true].map((seasoningGroup) => (
            <div
              className="recipe-ingredient-group"
              key={String(seasoningGroup)}
            >
              <h3>{seasoningGroup ? "调料" : "食材"}</h3>
              {recipe.requirements
                .filter(
                  (req) =>
                    isSeasoning(
                      state.ingredients.find((i) => i.id === req.ingredientId)
                        ?.name ?? "",
                      recipe.ingredientKinds,
                    ) === seasoningGroup,
                )
                .map((req) => (
                  <div className="ingredient-line" key={req.ingredientId}>
                    <span>
                      {
                        state.ingredients.find(
                          (i) => i.id === req.ingredientId,
                        )!.name
                      }
                    </span>
                    <strong>
                      {amount(
                        (req.quantity * servings) / recipe.servings,
                        req.unit,
                      )}
                    </strong>
                  </div>
                ))}
              {recipe.textIngredients
                ?.filter(
                  (item) =>
                    isSeasoning(item.name, recipe.ingredientKinds) ===
                    seasoningGroup,
                )
                .map((item, i) => (
                  <div className="ingredient-line" key={`text-${i}`}>
                    <span>{item.name}</span>
                    <strong>{item.amountText}</strong>
                  </div>
                ))}
            </div>
          ))}
          <h3>调味备注</h3>
          <p>{recipe.seasoning}</p>
          <small>「适量 / 少许」保留原文，不作精确换算。</small>
        </section>
        <section className="panel steps-panel">
          <h2>享受下厨的过程</h2>
          <p className="hint">不必匆忙，一步一步就好。</p>
          <p className="hint">
            已保存 {recipe.media?.steps.length ?? 0} 张步骤原图
            {recipe.media?.steps.length ? "，见文字步骤下方。" : "。"}
          </p>
          <RecipeImages recipe={recipe} />
          {recipe.steps.map((step, i) => (
            <div className="step" key={step}>
              <span>{i + 1}</span>
              <div>
                {recipe.stepTitles?.[i] && <h3>{recipe.stepTitles[i]}</h3>}
                <p>{step}</p>
              </div>
            </div>
          ))}
          {!!recipe.media?.steps.length && (
            <section className="source-step-images">
              <h3>步骤原图</h3>
              <p className="hint">按原菜谱顺序保留，供对照做法。</p>
              <div className="step-image-grid">
                {recipe.media.steps.map((item, index) => (
                  <figure key={index}>
                    <img
                      src={item.image}
                      alt={`原步骤 ${item.sourceStep}`}
                      loading="lazy"
                    />
                    <figcaption>原步骤 {item.sourceStep}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
        </section>
        <section className="panel cooking-log">
          <h2>
            <NotebookPen size={19} />
            我的厨房手记
          </h2>
          <p className="hint">记下这次火候、口味和下次想试的变化。</p>
          <Badge tone="green">{logs.length} 篇手记</Badge>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.trim()) return;
              const saved = await mutate(
                {
                  type: "create_note",
                  recipe_id: recipe.id,
                  date: today,
                  note: note.trim(),
                },
                (s) => ({
                  ...s,
                  logs: [
                    {
                      id: crypto.randomUUID(),
                      recipeId: recipe.id,
                      date: today,
                      note: note.trim(),
                    },
                    ...s.logs,
                  ],
                }),
                persistent
                  ? "烹饪笔记已保存，库存未扣减"
                  : "笔记已加入演示记录，本次会话有效",
              );
              if (saved) {
                setNote("");
              }
            }}
          >
            <textarea
              maxLength={2000}
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label="烹饪笔记"
              placeholder="这次下厨，有什么想记住的？"
            />
            <button className="primary" disabled={busy || !note.trim()}>
              {persistent ? "保存笔记" : "保存演示笔记"}
            </button>
          </form>
          {logs.map((l) => (
            <article className="log-entry" key={l.id}>
              <header>
                <span className="note-date">{l.date}</span>
                <div className="actions">
                  <button
                    className="note-icon"
                    aria-label={`编辑笔记${l.date}`}
                    title="编辑笔记"
                    onClick={() => {
                      setEditing({ id: l.id, date: l.date, note: l.note });
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    className="note-icon"
                    aria-label={`删除笔记${l.date}`}
                    title="删除笔记"
                    onClick={() => setDeleting(l.id)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </header>
              <p>{l.note}</p>
              {deleting === l.id && (
                <div className="note-delete">
                  <span>删除这篇手记？</span>
                  <div className="actions">
                    <button onClick={() => setDeleting(null)}>取消</button>
                    <button
                      className="danger"
                      onClick={async () => {
                        if (
                          await mutate(
                            {
                              type: "delete_note",
                              note_id: l.id,
                              expected_note: l.note,
                            },
                            (s) => ({
                              ...s,
                              logs: s.logs.filter((n) => n.id !== l.id),
                            }),
                            "",
                          )
                        ) {
                          setDeleting(null);
                          if (editing?.id === l.id) setEditing(null);
                        }
                      }}
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))}
        </section>
      </div>
      {editing && (
        <NoteEditor entry={editing} onClose={() => setEditing(null)} />
      )}
      {plan && (
        <PlanForm
          recipeId={recipe.id}
          servings={servings}
          onClose={() => setPlan(false)}
        />
      )}
      {recipeEditor && (
        <RecipeEditor
          mode="edit"
          recipe={recipe}
          source={recipeEditor}
          onClose={() => setRecipeEditor(null)}
        />
      )}
      {versions && (
        <RecipeHistory
          recipe={recipe}
          onClose={() => setVersions(false)}
          onEdit={(source) => {
            setVersions(false);
            setRecipeEditor(source);
          }}
        />
      )}
      {archive && (
        <Modal title="删除菜谱" onClose={() => setArchive(false)}>
          <div className="form-stack">
            <p>
              将「{recipe.name}
              」从菜谱库删除？已有菜单和烹饪记录会保留。
            </p>
            <div className="actions recipe-edit-actions">
              <button onClick={() => setArchive(false)}>取消</button>
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  if (
                    await mutate(
                      { type: "delete_recipe", recipe_id: recipe.id },
                      (s) => ({
                        ...s,
                        recipes: s.recipes.filter((r) => r.id !== recipe.id),
                        archivedRecipes: [recipe, ...(s.archivedRecipes ?? [])],
                        plans: s.plans.map((p) =>
                          p.recipeId === recipe.id && !p.recipeSnapshot
                            ? { ...p, recipeSnapshot: recipe }
                            : p,
                        ),
                      }),
                      "",
                    )
                  )
                    onBack();
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
export default function Recipes() {
  const { state } = useDemo();
  const [editor, setEditor] = useState<"create" | "import" | null>(null);
  const [categories, setCategories] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部菜谱");
  const [sort, setSort] = useState("默认顺序");
  const [selected, setSelected] = useState<string | null>(null);
  const libraryScroll = useRef(0);
  const filtered = state.recipes
    .filter(
      (r) =>
        r.name.includes(query) &&
        (category === "全部菜谱" ||
          (category === "我的收藏" && state.favorites.includes(r.id)) ||
          r.category === category),
    )
    .sort((a, b) =>
      sort === "用时最短"
        ? a.minutes - b.minutes
        : sort === "名称排序"
          ? a.name.localeCompare(b.name, "zh-CN")
          : 0,
    );
  return (
    <>
      <div hidden={selected !== null}>
        <div className="page-heading">
          <div>
            <div className="eyebrow">COLLECT THE THINGS YOU LOVE TO COOK</div>
            <div className="page-title-row">
              <h1>
                我的菜谱<span className="heading-dot">.</span>
              </h1>
              <span className="page-count">{state.recipes.length} 道菜谱</span>
            </div>
            <p>熟悉的味道，和下一次尝试的灵感。</p>
          </div>
          <div className="actions">
            <button onClick={() => setEditor("import")}>
              <Upload size={16} />
              导入菜谱
            </button>
            <button className="primary" onClick={() => setEditor("create")}>
              <Plus size={16} />
              创建菜谱
            </button>
          </div>
        </div>
        <div className="filters recipe-filters">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="搜索我的菜谱"
              placeholder="搜索一道想吃的菜…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="菜谱排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            {["默认顺序", "用时最短", "名称排序"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="category-tabs">
          {["全部菜谱", ...state.recipeCategories, "我的收藏"].map((c) => (
            <button
              key={c}
              className={category === c ? "selected" : ""}
              onClick={() => setCategory(c)}
            >
              {c}
              {c === "全部菜谱" && <span>{state.recipes.length}</span>}
            </button>
          ))}
          <button className="text-button" onClick={() => setCategories(true)}>
            管理分类
          </button>
        </div>
        <div className="recipe-grid">
          {filtered.map((r) => (
            <RecipeCard
              key={r.id}
              recipe={r}
              onOpen={() => {
                libraryScroll.current = window.scrollY;
                setSelected(r.id);
                window.scrollTo(0, 0);
              }}
            />
          ))}
        </div>
        {filtered.length === 0 && (
          <Empty>
            {state.recipes.length
              ? "没有匹配菜谱，试试其他关键词或类别。"
              : "菜谱库为空，点击创建菜谱或导入 JSON 开始。"}
          </Empty>
        )}
      </div>
      {editor && (
        <RecipeEditor
          mode={editor}
          onClose={() => setEditor(null)}
          onExisting={(id) => {
            setSelected(id);
            window.scrollTo(0, 0);
          }}
        />
      )}
      {categories && (
        <CategoryManager
          kind="recipe"
          onClose={() => {
            setCategories(false);
            setCategory("全部菜谱");
          }}
        />
      )}
      {selected && state.recipes.some((r) => r.id === selected) && (
        <RecipeDetail
          key={selected}
          recipe={state.recipes.find((r) => r.id === selected)!}
          onBack={() => {
            setSelected(null);
            requestAnimationFrame(() =>
              window.scrollTo(0, libraryScroll.current),
            );
          }}
        />
      )}
    </>
  );
}
