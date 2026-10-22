import { shoppingPending } from "./domain/shopping";
import Seasonings from "./Seasonings";
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
export default function Dashboard({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const { state, today, persistent, forecast, forecastError } = useDemo();
  const next = state.plans
    .filter((p) => p.day >= today)
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        ["早餐", "午餐", "晚餐"].indexOf(a.meal) -
          ["早餐", "午餐", "晚餐"].indexOf(b.meal),
    )[0];
  const recipe = next ? recipeForPlan(state, next) : undefined;
  const alerts = state.lots.filter(
    (l) =>
      !isSeasoning(
        state.ingredients.find((i) => i.id === l.ingredientId)?.name ?? "",
      ) &&
      l.quantity > 0 &&
      (!l.expires || daysLeft(l.expires, today) <= 3),
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
        <section className="next-meal panel">
          {recipe ? (
            <>
              <Food image={recipe.image} name={recipe.name} />
              <div className="next-meal-content">
                <Badge tone="warm">下一餐 · {next.meal}</Badge>
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
              <span>
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
          <div className="mini-week">
            {weekDays(weekOf(today)).map((d, i) => {
              const plans = state.plans.filter((p) => p.day === d);
              return (
                <button
                  key={d}
                  className={i === 6 ? "current" : ""}
                  onClick={() => navigate("planner")}
                >
                  <small>周{"一二三四五六日"[i]}</small>
                  <strong>{d.slice(8)}</strong>
                  <span>
                    {plans.length ? `${plans.length} 道菜` : "留点空白"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="hint">
            共安排{" "}
            {
              new Set(
                state.plans
                  .filter((p) => weekOf(p.day) === weekOf(today))
                  .map((p) => `${p.day}|${p.meal}`),
              ).size
            }{" "}
            餐 · 安排不会消耗库存。
          </p>
        </section>
        <section className="panel">
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
          {persistent &&
            shoppingPending(forecast)
              .slice(0, 3)
              .map((i) => (
                <div
                  className="alert-line"
                  key={i.id ?? `${i.ingredientId}|${i.unit}`}
                >
                  <span>{i.name}</span>
                  <strong>
                    {i.remaining} {i.unit}
                  </strong>
                </div>
              ))}
          {pending.slice(0, 3).map((i) => (
            <div key={i.id} className="alert-line">
              <span>{i.name}</span>
              <strong>
                {i.quantity} {i.unit}
              </strong>
            </div>
          ))}
          <button className="text-button" onClick={() => navigate("shopping")}>
            去采购清单 <ArrowRight size={16} />
          </button>
        </section>
      </div>
      <Seasonings reminder onOpen={() => navigate("pantry")} />
      <section className="home-note">
        <Leaf size={20} />
        <p>厨房里的小事，值得认真对待。先用好手边的食材，再期待下一顿新鲜。</p>
        <span>CHEFISH · 日常的好滋味</span>
      </section>
    </>
  );
}
