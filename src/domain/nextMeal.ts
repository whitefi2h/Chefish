import type { PlannedMeal } from "../model";
const ends = { 早餐: 10 * 60, 午餐: 14 * 60, 晚餐: 21 * 60 };
const order = ["早餐", "午餐", "晚餐"];
export function nextMeal(plans: PlannedMeal[], today: string, minute: number) {
  return plans
    .filter(
      (p) =>
        !p.cooking &&
        (p.day > today || (p.day === today && minute < ends[p.meal])),
    )
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        order.indexOf(a.meal) - order.indexOf(b.meal),
    )[0];
}
export function nextMealDishes(
  plans: PlannedMeal[],
  today: string,
  minute: number,
) {
  const next = nextMeal(plans, today, minute);
  return next
    ? plans.filter(
        (p) => !p.cooking && p.day === next.day && p.meal === next.meal,
      )
    : [];
}
