import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { nativeMode } from "./kitchenClient";

export const projectUrl = "https://github.com/whitefi2h/Chefish";
const optionsKey = "chefish:update-options";
type Options = { autoCheck: boolean; autoUpdate: boolean };
type Release = { version: string; notes: string; canInstall: boolean };
type UpdateState = {
  options: Options;
  phase:
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  release: Release | null;
  progress: number | null;
  error: string;
  checkedAt: number | null;
};
function readOptions(): Options {
  try {
    const saved = JSON.parse(localStorage.getItem(optionsKey) ?? "null");
    return {
      autoCheck: saved?.autoCheck !== false,
      autoUpdate: saved?.autoCheck !== false && saved?.autoUpdate === true,
    };
  } catch {
    return { autoCheck: true, autoUpdate: false };
  }
}
let state: UpdateState = {
  options: readOptions(),
  phase: "idle",
  release: null,
  progress: null,
  error: "",
  checkedAt: null,
};
let update: Update | null = null;
let task: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
};
const message = (error: unknown) =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "更新暂未完成，请重试。";

async function download() {
  if (!update || state.phase === "ready" || state.phase === "installing")
    return;
  emit({ phase: "downloading", progress: null, error: "" });
  let received = 0,
    total = 0;
  try {
    await update.download((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress") received += event.data.chunkLength;
      if (total)
        emit({ progress: Math.min(100, Math.round((received / total) * 100)) });
    });
    emit({ phase: "ready", progress: 100 });
  } catch (error) {
    emit({ phase: "error", error: message(error) });
  }
}
async function inspect() {
  emit({ phase: "checking", release: null, error: "" });
  try {
    const release = await invoke<Release | null>("app_latest_release");
    await update?.close();
    update = null;
    if (release?.canInstall) {
      update = await check({ timeout: 20000 });
      if (!update || update.version !== release.version)
        throw new Error("版本信息已变化，请重新检查更新。");
    }
    emit({
      release,
      phase: release ? "available" : "current",
      checkedAt: Date.now(),
    });
    if (release?.canInstall && state.options.autoUpdate) await download();
  } catch (error) {
    emit({ phase: "error", error: message(error) });
  }
}
function run(work: () => Promise<void>) {
  if (!nativeMode) return Promise.resolve();
  if (task) return task;
  task = work().finally(() => {
    task = null;
  });
  return task;
}
export const appUpdater = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => state,
  setOptions(options: Options) {
    localStorage.setItem(optionsKey, JSON.stringify(options));
    emit({ options });
    if (options.autoUpdate && update && state.phase === "available")
      void run(download);
    else if (options.autoCheck && state.phase === "idle") void run(inspect);
  },
  check: () =>
    state.phase === "ready" || state.phase === "installing"
      ? Promise.resolve()
      : run(inspect),
  download: () => run(download),
  async install() {
    if (!update || state.phase !== "ready") return;
    emit({ phase: "installing", error: "" });
    try {
      await update.install();
    } catch (error) {
      emit({ phase: "ready", error: message(error) });
    }
  },
  start() {
    if (!nativeMode) return () => {};
    const checkLater = () => {
      if (
        state.options.autoCheck &&
        !["available", "ready", "installing", "downloading"].includes(
          state.phase,
        )
      )
        void run(inspect);
    };
    checkLater();
    const timer = setInterval(checkLater, 6 * 60 * 60 * 1000);
    window.addEventListener("online", checkLater);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", checkLater);
    };
  },
  async openProject(releases = false) {
    if (nativeMode) await invoke("app_open_project", { releases });
    else
      window.open(
        projectUrl + (releases ? "/releases" : ""),
        "_blank",
        "noopener,noreferrer",
      );
  },
};
