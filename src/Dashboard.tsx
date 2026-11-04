import IngredientAvatar from "./IngredientAvatar";
import { quantityText } from "./domain/quantity";
import { shoppingPending } from "./domain/shopping";
import { isSeasoning, supplies } from "./domain/seasonings";
import {
  ArrowRight,
  Leaf,
  ShoppingBasket,
  CalendarDays,
  Clock,
} from "lucide-react";
import {
  recipeForPlan,
  weekDays,
  weekOf,
  daysLeft,
  expiryLabel,
  pendingItems,
} from "./model";
import { useDemo } from "./store";
import { Badge, Food } from "./components";
import { useState, useEffect } from "react";
import { nextMealDishes } from "./domain/nextMeal";
export default function Dashboard({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const { state, today, persistent, forecast, forecastError } = useDemo();
  const minuteNow = () => new Date().getHours() * 60 + new Date().getMinutes();
  const [minute, setMinute] = useState(minuteNow);
  useEffect(() => {
    const tick = () => setMinute(minuteNow());
    const timer = setInterval(tick, 30000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, []);
  const dishes = nextMealDishes(
    state.plans,
    today,
    persistent ? minute : 9 * 60,
  );
  const next = dishes[0];
  const recipe = next ? recipeForPlan(state, next) : undefined;
  const alerts = state.lots.filter(
    (l) =>
      !isSeasoning(
        state.ingredients.find((i) => i.id === l.ingredientId)?.name ?? "",
      ) &&
      l.quantity > 0 &&
      !!l.expires &&
      daysLeft(l.expires, today) <= 3,
  );
  const pending = (persistent ? [] : pendingItems(state)).filter(
    (i) => i.status === "pending",
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR KITCHEN, AT A GLANCE</div>
          <h1>
            今天，做点好吃的<span className="heading-dot">。</span>
          </h1>
          <p>好好吃饭，从一份从容的计划开始。</p>
        </div>
        <Badge tone="warm">
          {today} · {persistent ? "今天" : "演示今天"}
        </Badge>
      </div>
      <div className="dashboard-top">
        <section
          className={`next-meal panel ${dishes.length > 1 ? "multiple" : ""}`}
        >
          {dishes.length > 1 ? (
            <>
              <div className="next-meal-heading">
                <Badge tone="warm">
                  下一餐 · {next.day > today ? `${next.day} · ` : ""}
                  {next.meal}
                </Badge>
                <span>{dishes.length} 道菜</span>
              </div>
              <div className="next-meal-dishes">
                {dishes.slice(0, 2).map((plan) => {
                  const dish = recipeForPlan(state, plan);
                  return (
                    <article className="next-meal-dish" key={plan.id}>
                      <Food image={dish.image} name={dish.name} />
                      <div>
                        <h2>{dish.name}</h2>
                        <p>{dish.subtitle}</p>
                        <span className="inline muted">
                          <Clock size={13} />
                          {dish.minutes ? `${dish.minutes} 分钟 · ` : ""}
                          {plan.servings} 人份
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
              <div className="next-meal-footer">
                <span>
                  {dishes.length > 2
                    ? `还有 ${dishes.length - 2} 道菜`
                    : "这一餐，慢慢做好"}
                </span>
                <button className="primary" onClick={() => navigate("planner")}>
                  查看菜单安排 <ArrowRight size={15} />
                </button>
              </div>
            </>
          ) : recipe ? (
            <>
              <Food image={recipe.image} name={recipe.name} />
              <div className="next-meal-content">
                <Badge tone="warm">
                  下一餐 · {next.day > today ? `${next.day} · ` : ""}
                  {next.meal}
                </Badge>
                <h2>{recipe.name}</h2>
                <p>{recipe.subtitle}</p>
                <span className="inline muted">
                  <Clock size={16} />
                  {recipe.minutes ? `${recipe.minutes} 分钟 · ` : ""}
                  {next.servings} 人份
                </span>
                <button className="primary" onClick={() => navigate("planner")}>
                  查看菜单安排 <ArrowRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="next-meal-content">
              <h2>下一餐，吃点什么？</h2>
              <p>从喜欢的菜谱开始安排。</p>
              <button className="primary" onClick={() => navigate("planner")}>
                安排一餐
              </button>
            </div>
          )}
        </section>
        <section className="panel dashboard-alert">
          <div className="section-heading">
            <h2>
              <Leaf size={18} />
              冰箱里的新鲜
            </h2>
            <Badge tone="warm">{alerts.length} 个提醒</Badge>
          </div>
          {alerts.slice(0, 3).map((l) => (
            <div className="alert-line" key={l.id}>
              <span className="inventory-ingredient">
                <IngredientAvatar
                  ingredient={state.ingredients.find(
                    (i) => i.id === l.ingredientId,
                  )!}
                />
                {state.ingredients.find((i) => i.id === l.ingredientId)!.name}
              </span>
              <Badge tone={daysLeft(l.expires, today) < 0 ? "red" : "warm"}>
                {expiryLabel(l.expires, today)}
              </Badge>
            </div>
          ))}
          <button className="text-button" onClick={() => navigate("pantry")}>
            查看食材库存 <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <CalendarDays size={18} />
              这一周，慢慢安排
            </h2>
            <button className="text-button" onClick={() => navigate("planner")}>
              打开周菜单 →
            </button>
          </div>
          <div className="home-agenda">
            {weekDays(weekOf(today)).map((d, i) => {
              const plans = state.plans.filter((p) => p.day === d);
              return (
                <button
                  key={d}
                  className={d === today ? "current" : ""}
                  onClick={() => navigate("planner")}
                  aria-label={`查看${d}菜单`}
                >
                  <span className="agenda-date">
                    <small>周{"一二三四五六日"[i]}</small>
                    <strong>{d.slice(8)}</strong>
                  </span>
                  <span className="agenda-dishes">
                    <strong>
                      {plans.length
                        ? plans
                            .map((p) => recipeForPlan(state, p).name)
                            .join("、")
                        : "尚未安排"}
                    </strong>
                    <small>
                      {plans.length
                        ? [...new Set(plans.map((p) => p.meal))].join(" · ")
                        : "留一点空白"}
                      {plans.some((p) => p.cooking) ? " · 已做" : ""}
                    </small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        <section className="panel dashboard-shopping">
          <div className="section-heading">
            <h2>
              <ShoppingBasket size={18} />
              下次采购
            </h2>
            <Badge>
              {persistent
                ? forecast
                  ? `${shoppingPending(forecast).length + supplies(state).filter((s) => s.missing).length} 项`
                  : forecastError
                    ? "计算失败"
                    : "计算中"
                : `${pending.length + supplies(state).filter((s) => s.missing).length} 项`}
            </Badge>
          </div>
          <div className="dashboard-buy-list">
            {[
              ...(persistent
                ? shoppingPending(forecast).map((i) => ({
                    id: i.id ?? `${i.ingredientId}|${i.unit}`,
                    name: i.name,
                    amount: `${quantityText(i.remaining)} ${i.unit}`,
                    ingredient: state.ingredients.find(
                      (n) => n.id === i.ingredientId,
                    ),
                  }))
                : pending.map((i) => ({
                    id: i.id,
                    name: i.name,
                    amount: `${quantityText(i.quantity)} ${i.unit}`,
                    ingredient: state.ingredients.find(
                      (n) => n.id === i.ingredientId,
                    ),
                  }))),
              ...supplies(state)
                .filter((s) => s.missing)
                .map((s) => ({
                  id: `seasoning:${s.id}`,
                  name: s.name,
                  amount: "待补购",
                  ingredient: s,
                })),
            ]
              .slice(0, 5)
              .map((i) => (
                <button
                  className="dashboard-buy-item"
                  key={i.id}
                  onClick={() => navigate("shopping")}
                >
                  <IngredientAvatar
                    ingredient={i.ingredient ?? { name: i.name }}
                  />
                  <strong>{i.name}</strong>
                  <span>{i.amount}</span>
                </button>
              ))}
          </div>
          <button className="text-button" onClick={() => navigate("shopping")}>
            查看采购清单 <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <section className="home-note">
        <Leaf size={20} />
        <p>厨房里的小事，值得认真对待。先用好手边的食材，再期待下一顿新鲜。</p>
        <span>CHEFISH · 日常的好滋味</span>
      </section>
    </>
  );
}
