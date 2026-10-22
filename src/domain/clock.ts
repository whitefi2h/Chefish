export interface Clock {
  today(): string;
}
export function localToday(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const systemClock: Clock = { today: () => localToday() };
export const demoClock: Clock = { today: () => "2026-10-18" };
