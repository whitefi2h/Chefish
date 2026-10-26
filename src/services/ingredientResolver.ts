import { invoke } from "@tauri-apps/api/core";
export function startIngredientResolver() {
  let alive = true,
    running = false,
    timer: ReturnType<typeof setTimeout>;
  async function fill() {
    if (!alive || running) return;
    running = true;
    let delay = 300000;
    try {
      const result = await invoke<{ updated: number; remaining: number }>(
        "kitchen_resolve_ingredients",
      );
      if (result?.updated) {
        window.dispatchEvent(new Event("chefish:sync-data"));
        window.dispatchEvent(new Event("chefish:sync-wake"));
      }
      if (result?.remaining) delay = 2000;
    } catch {
      /* Retain original recipe and retry quietly. */
    } finally {
      running = false;
      if (alive) timer = setTimeout(() => void fill(), delay);
    }
  }
  const wake = () => {
    if (!running) {
      clearTimeout(timer);
      timer = setTimeout(() => void fill(), 2000);
    }
  };
  timer = setTimeout(() => void fill(), 2000);
  window.addEventListener("chefish:sync-wake", wake);
  window.addEventListener("online", wake);
  window.addEventListener("chefish:ingredient-images-wake", wake);
  return () => {
    alive = false;
    clearTimeout(timer);
    window.removeEventListener("chefish:sync-wake", wake);
    window.removeEventListener("online", wake);
    window.removeEventListener("chefish:ingredient-images-wake", wake);
  };
}
