import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { nativeMode, errorMessage } from "./services/kitchenClient";
export default function RecipeSourceLink({ url }: { url: string }) {
  const [error, setError] = useState("");
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => {
          if (nativeMode) {
            e.preventDefault();
            void invoke("kitchen_open_recipe", { url }).catch((err) =>
              setError(errorMessage(err)),
            );
          }
        }}
      >
        下厨房
      </a>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
