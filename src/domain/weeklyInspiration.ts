import { weekOf, type DemoState } from "../model";
export function inspirationForWeek(state: DemoState, week: string) {
  return state.inspirationWeeks
    ? (state.inspirationWeeks[week] ?? [])
    : week === weekOf(state.today ?? "2026-10-18")
      ? state.inspiration
      : [];
}
export function toggleWeeklyInspiration(
  state: DemoState,
  week: string,
  id: string,
  enabled: boolean,
): DemoState {
  const existing = inspirationForWeek(state, week).filter((v) => v !== id);
  const ids = enabled ? [...existing, id] : existing;
  return {
    ...state,
    inspiration:
      week === weekOf(state.today ?? "2026-10-18") ? ids : state.inspiration,
    inspirationWeeks: {
      ...(state.inspirationWeeks ?? {
        [weekOf(state.today ?? "2026-10-18")]: state.inspiration,
      }),
      [week]: ids,
    },
  };
}
