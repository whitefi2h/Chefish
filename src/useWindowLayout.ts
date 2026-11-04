import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

// Window state, rather than physical screen pixels, determines desktop card columns.
export function useWindowLayout() {
  const [layout, setLayout] = useState("browser");
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let stop: (() => void) | undefined;
    void (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const measure = async () => {
        const maximized = await win.isMaximized();
        if (!disposed) setLayout(maximized ? "maximized" : "windowed");
      };
      const unlisten = await win.onResized(() => void measure());
      if (disposed) unlisten();
      else stop = unlisten;
      await measure();
    })().catch(() => {
      /* Browser IPC fixtures do not expose native windows. */
    });
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return layout;
}
