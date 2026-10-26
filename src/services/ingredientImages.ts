import { invoke } from "@tauri-apps/api/core";
let running = false;
export function startIngredientImages() {
  let alive = true,
    timer: ReturnType<typeof setTimeout>;
  async function fill() {
    if (!alive || running) return;
    running = true;
    try {
      const result = await invoke<{ updated: number; remaining: number }>(
        "kitchen_ingredient_images",
        {},
      );
      if (result?.updated) {
        window.dispatchEvent(new Event("chefish:sync-data"));
        window.dispatchEvent(new Event("chefish:sync-wake"));
      }
      if (alive) {
        clearTimeout(timer);
        timer = setTimeout(
          () => void fill(),
          result?.remaining ? 2000 : 300000,
        );
      }
    } catch {
      if (alive) {
        clearTimeout(timer);
        timer = setTimeout(() => void fill(), 300000);
      }
    } finally {
      running = false;
    }
  }
  const wake = () => {
    if (!running) {
      clearTimeout(timer);
      timer = setTimeout(() => void fill(), 1500);
    }
  };
  timer = setTimeout(() => void fill(), 1500);
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
