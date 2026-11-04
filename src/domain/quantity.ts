// Presentation only: keep source quantities unchanged for calculations and editing.
export function quantityText(value: number | string): string {
  const n = Number(value);
  const rounded = Number(n.toFixed(1));
  return n > 0 && rounded === 0 ? "<0.1" : String(rounded);
}
