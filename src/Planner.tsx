import { CookingForm } from "./Cooking";
import { shoppingPending } from "./domain/shopping";
import { useState, useRef, useEffect } from "react";
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Plus,
  Check,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ShoppingBasket,
  X,
  ArrowRight,
  Search,
} from "lucide-react";
import {
  weekDays,
  weekOf,
  shiftDate,
  weekLabel,
  validDate,
  MEALS,
  putMeal,
  recipeForPlan,
  needs,
  amount,
  type PlannedMeal,
  type MealTime,
} from "./model";
import { useDemo } from "./store";
import { Badge, Food, Modal, Empty } from "./components";
function DragRecipe({
  id,
  children,
  disabled = false,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { busy } = useDemo();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    disabled: busy || disabled,
    id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`draggable ${isDragging ? "dragging" : ""}`}
    >
      {children}
    </div>
  );
}
function Slot({
  id,
  children,
  onAdd,
  label,
}: {
  id: string;
  children: React.ReactNode;
  onAdd: () => void;
  label: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`meal-slot ${isOver ? "over" : ""}`}
      data-slot={id}
    >
      {children ?? (
        <button
          className="slot-add"
          onClick={onAdd}
          aria-label={`安排${label}`}
        >
          <Plus size={17} />
          <span>安排{label.slice(-2)}</span>
        </button>
      )}
    </div>
  );
}
export function PlanForm({
  onClose,
  initial,
  recipeId,
  day,
  meal,
}: {
  onClose: () => void;
  initial?: PlannedMeal;
  recipeId?: string;
  day?: string;
  meal?: MealTime;
}) {
  const { state, mutate, persistent, busy, weekStart, today } = useDemo();
  const [customName, setCustomName] = useState(initial?.customTitle ?? "");
  const [recipe, setRecipe] = useState(
    (initial?.customTitle ? "__custom" : initial?.recipeId) ??
      recipeId ??
      state.recipes[0]?.id ??
      "__custom",
  );
  const [date, setDate] = useState(
    initial?.day ?? day ?? (weekStart === weekOf(today) ? today : weekStart),
  );
  const days = weekDays(weekOf(date));
  const [time, setTime] = useState<MealTime>(initial?.meal ?? meal ?? "晚餐");
  const [servings, setServings] = useState(initial?.servings ?? 2);
  if (initial?.cooking)
    return (
      <Modal title="烹饪记录" onClose={onClose}>
        <div className="form-stack">
          <h3>{recipeForPlan(state, initial).name}</h3>
          <p>
            {initial.cooking.date} · {initial.cooking.servings} 人份
          </p>
          <p>{initial.cooking.note || "未填写心得"}</p>
          <section>
            <h3>实际消耗</h3>
            {initial.cooking.consumptions?.length ? (
              initial.cooking.consumptions.map((c, i) => (
                <p key={i}>
                  {c.name} · {c.quantity} {c.unit}
                </p>
              ))
            ) : (
              <p className="hint">未记录库存扣减</p>
            )}
          </section>
          {initial.cooking.untracked && (
            <Badge tone="warm">部分用量未记入库存</Badge>
          )}
          <p className="hint">
            撤销会恢复本次扣减的所有批次。批次后续有其他操作时，请先核对并撤销后续操作。
          </p>
          <button
            disabled={busy}
            onClick={async () => {
              if (
                await mutate(
                  {
                    type: "undo_cooking",
                    plan_id: initial.id,
                    expected_version: initial.version ?? 1,
                  },
                  (s) => s,
                  "已撤销烹饪，库存已恢复",
                )
              )
                onClose();
            }}
          >
            撤销本次烹饪
          </button>
        </div>
      </Modal>
    );
  return (
    <Modal title={initial ? "编辑这餐" : "安排一餐"} onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await mutate(
            {
              type: "save_plan",
              plan_id: initial?.id ?? null,
              expected_version: initial?.version ?? null,
              draft: {
                recipe_revision_id:
                  recipe === "__custom"
                    ? null
                    : ((recipe === initial?.recipeId
                        ? initial.recipeRevisionId
                        : undefined) ??
                      state.recipes.find((r) => r.id === recipe)?.revisionId ??
                      null),
                custom_title: recipe === "__custom" ? customName.trim() : null,
                day: date,
                meal: time,
                servings,
              },
            },
            (s) => {
              if (recipe !== "__custom")
                return putMeal(s, recipe, date, time, servings, initial?.id);
              const id = crypto.randomUUID();
              if (!customName.trim()) return s;
              const next = {
                ...s,
                recipes: [
                  ...s.recipes,
                  {
                    id,
                    name: customName.trim(),
                    subtitle: "临时配餐 · 食材用量待补充",
                    category: "未分类",
                    minutes: 20,
                    servings,
                    image: "placeholder",
                    requirements: [],
                    seasoning: "",
                    steps: ["尚未记录烹饪步骤。"],
                  },
                ],
                recipeCategories: [
                  ...new Set([...s.recipeCategories, "未分类"]),
                ],
              };
              return putMeal(next, id, date, time, servings, initial?.id);
            },
            "菜单已更新；库存未扣减",
          );
          if (saved) onClose();
        }}
        className="form-stack"
      >
        <label>
          选择菜谱
          <select
            aria-label="选择菜谱"
            value={recipe}
            onChange={(e) => setRecipe(e.target.value)}
          >
            <option value="__custom">临时添加一道菜…</option>
            {initial?.recipeSnapshot &&
              !state.recipes.some((r) => r.id === initial.recipeId) && (
                <option value={initial.recipeId}>
                  {initial.recipeSnapshot.name}（已安排版本）
                </option>
              )}
            {state.recipes.map((r) => (
              <option value={r.id} key={r.id}>
                {initial?.recipeId === r.id && initial.recipeSnapshot
                  ? `${initial.recipeSnapshot.name}（已安排版本）`
                  : r.name}
              </option>
            ))}
          </select>
        </label>
        {recipe === "__custom" && (
          <label>
            菜名
            <input
              aria-label="菜名"
              required
              maxLength={120}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <small>
              {persistent
                ? "仅加入菜单，不创建菜谱；暂不生成精确食材需求。"
                : "将加入菜谱库；未录入用量，暂不生成采购需求。"}
            </small>
          </label>
        )}
        <label>
          跳转配餐周
          <input
            aria-label="跳转配餐周"
            type="date"
            min="1900-01-01"
            max="2100-12-24"
            value={date}
            onChange={(e) => {
              if (validDate(e.target.value)) setDate(e.target.value);
            }}
          />
        </label>
        <div className="form-row">
          <label>
            日期
            <select
              aria-label="日期"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            >
              {days.map((d, i) => (
                <option key={d} value={d}>
                  {d.slice(5)} 周{"一二三四五六日"[i]}
                </option>
              ))}
            </select>
          </label>
          <label>
            餐次
            <select
              aria-label="餐次"
              value={time}
              onChange={(e) => setTime(e.target.value as MealTime)}
            >
              {MEALS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          用餐人数
          <input
            type="number"
            min="1"
            max="12"
            required
            value={servings}
            onChange={(e) => setServings(Number(e.target.value))}
          />
        </label>
        <p className="hint">
          同一餐可安排多道菜，新增和移动均保留其他菜。可从完整菜谱库选择，或临时输入菜名；安排不会消耗库存。
        </p>
        <button className="primary" type="submit" disabled={busy}>
          确认安排
        </button>
        {initial && (
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              const saved = await mutate(
                {
                  type: "remove_plan",
                  plan_id: initial.id,
                  expected_version: initial.version ?? 1,
                },
                (s) => ({
                  ...s,
                  plans: s.plans.filter((p) => p.id !== initial.id),
                }),
                "已移除这道菜；库存未扣减",
              );
              if (saved) onClose();
            }}
          >
            移除这道菜
          </button>
        )}
      </form>
    </Modal>
  );
}
export default function Planner({ goShopping }: { goShopping: () => void }) {
  const {
    state,
    mutate,
    busy,
    weekStart,
    setWeekStart,
    today,
    persistent,
    forecast,
    forecastLoading,
    forecastError,
  } = useDemo();
  const [query, setQuery] = useState("");
  const [cookingPlan, setCookingPlan] = useState<PlannedMeal | null>(null);
  const [form, setForm] = useState<{
    initial?: PlannedMeal;
    recipeId?: string;
    day?: string;
    meal?: MealTime;
  } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  const pointerDrop = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // A fast pointer release can precede dnd-kit's rendered collision state.
    // Resolve the actual release position; keyboard drops keep its collision result.
    const released = (event: PointerEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      pointerDrop.current =
        element?.closest<HTMLElement>("[data-slot]")?.dataset.slot ?? null;
    };
    window.addEventListener("pointerup", released, true);
    return () => window.removeEventListener("pointerup", released, true);
  }, []);
  const [edges, setEdges] = useState({ left: true, right: true });
  const poolRecipes = state.recipes.filter(
    (r) => state.inspiration.includes(r.id) && r.name.includes(query),
  );
  const poolSignature = poolRecipes.map((r) => r.id).join("|");
  function measurePool() {
    const el = poolRef.current;
    if (el)
      setEdges({
        left: el.scrollLeft <= 1,
        right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
  }
  useEffect(() => {
    const el = poolRef.current;
    if (!el) return;
    const observer = new ResizeObserver(measurePool);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    measurePool();
    return () => observer.disconnect();
  }, [poolSignature]);
  function scrollPool(direction: number) {
    const el = poolRef.current;
    if (!el) return;
    const width =
      el.querySelector(".pool-card")?.getBoundingClientRect().width ?? 226;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
    el.scrollBy({
      left: direction * (width + gap),
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const days = weekDays(weekStart);
  const shopping = needs(state, weekStart).filter((n) => n.toBuy > 0);
  const planned = new Set(
    state.plans
      .filter((p) => weekOf(p.day) === weekStart)
      .map((p) => `${p.day}|${p.meal}`),
  ).size;
  async function commit(
    recipe: string,
    day: string,
    meal: MealTime,
    move?: PlannedMeal,
  ) {
    await mutate(
      {
        type: "save_plan",
        plan_id: move?.id ?? null,
        expected_version: move?.version ?? null,
        draft: {
          recipe_revision_id:
            move?.recipeRevisionId ??
            state.recipes.find((r) => r.id === recipe)?.revisionId ??
            null,
          custom_title: move?.customTitle ?? null,
          day,
          meal,
          servings: move?.servings ?? 2,
        },
      },
      (s) => putMeal(s, recipe, day, meal, move?.servings ?? 2, move?.id),
      "配餐已更新；库存未扣减",
    );
  }
  function dropped(e: DragEndEvent) {
    setActive(null);
    const target =
      pointerDrop.current === undefined ? e.over?.id : pointerDrop.current;
    pointerDrop.current = undefined;
    if (!target || busy) return;
    const [day, time] = String(target).split("|");
    const move = state.plans.find((p) => `plan:${p.id}` === e.active.id);
    const recipe = move?.recipeId ?? String(e.active.id).replace("recipe:", "");
    if (move?.day === day && move.meal === time) return;
    void commit(recipe, day, time as MealTime, move);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE PLANNING, A BETTER WEEK</div>
          <h1>
            每周菜单<span className="heading-dot">.</span>
          </h1>
          <p>把喜欢的菜，安排进这一周。</p>
        </div>
        <button className="primary" disabled={busy} onClick={() => setForm({})}>
          <Plus size={16} />
          安排一餐
        </button>
      </div>
      <div className="week-toolbar">
        <div className="inline">
          <button
            className="round-button"
            aria-label="上一周"
            disabled={weekStart <= "1900-01-08"}
            onClick={() => setWeekStart(shiftDate(weekStart, -7))}
          >
            <ChevronLeft size={17} />
          </button>
          <CalendarDays size={19} />
          <strong>{weekLabel(weekStart)}</strong>
          <Badge tone="warm">
            {weekStart === weekOf(today)
              ? "本周"
              : weekStart < weekOf(today)
                ? "回看"
                : "提前规划"}
          </Badge>
        </div>
        <div className="inline week-controls">
          <button
            className="round-button"
            aria-label="下一周"
            disabled={weekStart >= "2100-12-20"}
            onClick={() => setWeekStart(shiftDate(weekStart, 7))}
          >
            <ChevronRight size={17} />
          </button>
          <button
            onClick={() => setWeekStart(weekOf(today))}
            disabled={weekStart === weekOf(today)}
          >
            返回本周
          </button>
          <label className="sr-only" htmlFor="week-jump">
            查看指定周
          </label>
          <input
            id="week-jump"
            aria-label="查看指定周"
            type="date"
            min="1900-01-01"
            max="2100-12-24"
            value={weekStart}
            onChange={(e) => {
              if (validDate(e.target.value))
                setWeekStart(weekOf(e.target.value));
            }}
          />
          <span className="muted">已安排 {planned} / 21 餐</span>
          <button onClick={goShopping}>
            <ShoppingBasket size={16} />
            采购预览{" "}
            <b>
              {persistent
                ? forecastLoading
                  ? "计算中"
                  : forecast
                    ? shoppingPending(forecast).length
                    : "计算失败"
                : shopping.length}
            </b>
            <ArrowRight size={15} />
          </button>
        </div>
      </div>
      <DndContext
        collisionDetection={(args) =>
          args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)
        }
        sensors={sensors}
        onDragStart={(e) => {
          pointerDrop.current = undefined;
          setActive(String(e.active.id));
        }}
        onDragCancel={() => setActive(null)}
        onDragEnd={dropped}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              "按空格开始拖动，方向键移动，空格放置，Escape 取消。也可使用安排按钮选择日期。",
          },
        }}
      >
        <section className="recipe-pool panel">
          <div className="section-heading">
            <div>
              <h2>本周的灵感菜谱</h2>
              <span className="hint">拖入下方餐次 · 右键已安排的菜可编辑</span>
            </div>
            <div className="pool-tools">
              <div className="search compact">
                <Search size={16} />
                <input
                  aria-label="搜索候选菜谱"
                  placeholder="找一道菜…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                className="round-button"
                aria-label="上一张灵感菜谱"
                disabled={edges.left}
                onClick={() => scrollPool(-1)}
              >
                <ChevronLeft size={17} />
              </button>
              <button
                className="round-button"
                aria-label="下一张灵感菜谱"
                disabled={edges.right}
                onClick={() => scrollPool(1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          <div className="pool-row" ref={poolRef} onScroll={measurePool}>
            {poolRecipes.map((r) => (
              <article className="pool-card" key={r.id}>
                <DragRecipe id={`recipe:${r.id}`}>
                  <Food image={r.image} name={r.name} />
                  <div>
                    <strong>{r.name}</strong>
                    <small>
                      {r.minutes} 分钟 · {r.servings} 人份
                    </small>
                  </div>
                  <GripVertical size={15} />
                </DragRecipe>
              </article>
            ))}
            {poolRecipes.length === 0 && (
              <p className="hint">
                暂无匹配的周灵感，可从「我的菜谱」加入，或直接安排一餐。
              </p>
            )}
          </div>
        </section>
        <div
          className="calendar-scroll"
          tabIndex={0}
          aria-label="七日菜单，可横向滚动"
        >
          <div className="calendar">
            <div className="calendar-corner">餐次 / 日期</div>
            {days.map((d, i) => (
              <div className={`day-head ${d === today ? "today" : ""}`} key={d}>
                <span>星期{"一二三四五六日"[i]}</span>
                <strong>
                  {d.slice(8)}
                  <small>{Number(d.slice(5, 7))} 月</small>
                </strong>
                {d === today && (
                  <span className="today-dot">
                    {persistent ? "今天" : "演示今天"}
                  </span>
                )}
              </div>
            ))}
            {MEALS.map((m, row) => (
              <div className="calendar-row" key={m}>
                <div className="meal-label">
                  <span>{["☀", "◒", "☾"][row]}</span>
                  <strong>{m}</strong>
                  <small>
                    {["开启新一天", "认真吃午饭", "今晚吃点好"][row]}
                  </small>
                </div>
                {days.map((d) => {
                  const plans = state.plans.filter(
                    (p) => p.day === d && p.meal === m,
                  );
                  return (
                    <Slot
                      key={d}
                      id={`${d}|${m}`}
                      label={`${d.slice(5)}${m}`}
                      onAdd={() => setForm({ day: d, meal: m })}
                    >
                      {plans.length ? (
                        <>
                          {plans.map((plan) => {
                            const recipe = recipeForPlan(state, plan);
                            return (
                              <article
                                className="planned-card"
                                key={plan.id}
                                aria-label={`${d}${m} · ${recipe.name}`}
                                title="右键编辑 · 拖动移动"
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  if (!busy) setForm({ initial: plan });
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "ContextMenu" ||
                                    (event.shiftKey && event.key === "F10")
                                  ) {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (!busy) setForm({ initial: plan });
                                  }
                                }}
                              >
                                <DragRecipe
                                  id={`plan:${plan.id}`}
                                  disabled={!!plan.cooking}
                                >
                                  <Food
                                    image={recipe.image}
                                    name={recipe.name}
                                  />
                                  <strong>
                                    {recipe.name}
                                    {plan.cooking && (
                                      <Badge tone="green">已完成</Badge>
                                    )}
                                  </strong>
                                  <small>
                                    {recipe.minutes
                                      ? `${recipe.minutes} 分钟 · `
                                      : ""}
                                    {plan.servings} 人份
                                  </small>
                                </DragRecipe>
                                {persistent &&
                                  (plan.cooking || plan.day <= today) && (
                                    <button
                                      className={`plan-complete${plan.cooking ? " completed" : ""}`}
                                      title={
                                        plan.cooking
                                          ? "查看烹饪记录"
                                          : "完成烹饪"
                                      }
                                      aria-label={
                                        plan.cooking
                                          ? "查看烹饪记录"
                                          : "完成烹饪"
                                      }
                                      disabled={busy}
                                      onClick={() =>
                                        plan.cooking
                                          ? setForm({ initial: plan })
                                          : setCookingPlan(plan)
                                      }
                                    >
                                      <Check size={15} />
                                    </button>
                                  )}
                                <button
                                  className="plan-remove"
                                  title="移除这道菜"
                                  aria-label={`移除${d}${m}`}
                                  onClick={() =>
                                    void mutate(
                                      {
                                        type: "remove_plan",
                                        plan_id: plan.id,
                                        expected_version: plan.version ?? 1,
                                      },
                                      (s) => ({
                                        ...s,
                                        plans: s.plans.filter(
                                          (p) => p.id !== plan.id,
                                        ),
                                      }),
                                      "已移除这道菜；库存未扣减",
                                    )
                                  }
                                  disabled={busy || !!plan.cooking}
                                >
                                  <X size={13} />
                                </button>
                              </article>
                            );
                          })}
                          <button
                            className="add-dish"
                            aria-label={`为${d}${m}加一道菜`}
                            onClick={() => setForm({ day: d, meal: m })}
                          >
                            <Plus size={13} />
                            加一道菜
                          </button>
                        </>
                      ) : null}
                    </Slot>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null} style={{ pointerEvents: "none" }}>
          {active && (
            <div className="drag-preview">
              <GripVertical size={18} />{" "}
              {(() => {
                const plan = state.plans.find((p) => `plan:${p.id}` === active);
                return plan
                  ? recipeForPlan(state, plan).name
                  : state.recipes.find(
                      (r) => r.id === active.replace("recipe:", ""),
                    )?.name;
              })()}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <div className="planner-bottom panel">
        <div>
          <Badge tone="green">
            {persistent ? "菜单已保存在本机" : "采购需求随菜单更新"}
          </Badge>
          <p>
            {persistent
              ? "安排不会扣减库存。采购需求按未来餐次顺序计算，确认购买时更新库存。"
              : "安排仅生成需求，不代表实际下厨或使用食材。"}
          </p>
        </div>
        <div className="preview-items">
          {persistent && forecastError && (
            <span className="hint">采购计算失败，请到清单重试</span>
          )}
          {persistent &&
            forecast &&
            shoppingPending(forecast)
              .slice(0, 3)
              .map((i) => (
                <span key={i.id ?? `${i.ingredientId}|${i.unit}`}>
                  {i.name}{" "}
                  <b>
                    {i.remaining} {i.unit}
                  </b>
                </span>
              ))}
          {persistent && forecast && shoppingPending(forecast).length === 0 && (
            <span className="hint">
              暂无待买项目{forecast.reviewNotes.length ? "，有用量待核对" : ""}
            </span>
          )}
          {!persistent &&
            shopping.slice(0, 3).map((n) => (
              <span key={n.ingredientId}>
                {n.name} <b>{amount(n.toBuy, n.unit)}</b>
              </span>
            ))}
          {!persistent && shopping.length === 0 && (
            <Empty>本周需求已覆盖</Empty>
          )}
        </div>
        <button className="text-button" onClick={goShopping}>
          查看完整清单 <ArrowRight size={16} />
        </button>
      </div>
      {cookingPlan && (
        <CookingForm plan={cookingPlan} onClose={() => setCookingPlan(null)} />
      )}
      {form && <PlanForm {...form} onClose={() => setForm(null)} />}
      <div className="calendar-caption">
        <ChevronLeft size={13} />
        周历可局部左右滚动，日期与餐次始终对应
        <ChevronRight size={13} />
      </div>
    </>
  );
}
