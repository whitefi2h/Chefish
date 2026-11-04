import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { prepareIngredientAvatars } from "./tools/ingredient-icons/prepare-app.mjs";
export default defineConfig(async () => {
  await prepareIngredientAvatars();
  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: 5173,
      strictPort: true,
      watch: { ignored: ["**/src-tauri/**", "**/reference/**", "**/docs/fixtures/**"] },
    },
  };
});
