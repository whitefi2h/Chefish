import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  check: vi.fn(),
  saved: new Map<string, string>(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("../src/services/kitchenClient", () => ({ nativeMode: true }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.saved.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => mocks.saved.get(key) ?? null,
    setItem: (key: string, value: string) => mocks.saved.set(key, value),
  });
});
const release = { version: "2.4.0", notes: "更新说明", canInstall: true };
function update() {
  return {
    version: "2.4.0",
    close: vi.fn(),
    download: vi.fn(async (event) => {
      event({ event: "Started", data: { contentLength: 100 } });
      event({ event: "Progress", data: { chunkLength: 100 } });
    }),
    install: vi.fn(),
  };
}
it("manual checks work with automatic checks disabled and old unsigned releases offer the release page", async () => {
  mocks.invoke.mockResolvedValue({ ...release, canInstall: false });
  const { appUpdater } = await import("../src/services/appUpdater");
  appUpdater.setOptions({ autoCheck: false, autoUpdate: false });
  await appUpdater.check();
  expect(appUpdater.snapshot().phase).toBe("available");
  expect(mocks.check).not.toHaveBeenCalled();
  await appUpdater.openProject(true);
  expect(mocks.invoke).toHaveBeenLastCalledWith("app_open_project", {
    releases: true,
  });
});
it("automatic updates download but never install until explicitly requested", async () => {
  const handle = update();
  mocks.invoke.mockResolvedValue(release);
  mocks.check.mockResolvedValue(handle);
  const { appUpdater } = await import("../src/services/appUpdater");
  appUpdater.setOptions({ autoCheck: true, autoUpdate: true });
  await appUpdater.check();
  expect(appUpdater.snapshot()).toMatchObject({
    phase: "ready",
    progress: 100,
  });
  expect(handle.install).not.toHaveBeenCalled();
  await appUpdater.check();
  expect(mocks.check).toHaveBeenCalledTimes(1);
  await appUpdater.install();
  expect(handle.install).toHaveBeenCalledOnce();
});
it("deduplicates concurrent checks and retains ready bytes until installation", async () => {
  const handle = update();
  mocks.invoke.mockResolvedValue(release);
  mocks.check.mockResolvedValue(handle);
  const { appUpdater } = await import("../src/services/appUpdater");
  await Promise.all([appUpdater.check(), appUpdater.check()]);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(handle.download).not.toHaveBeenCalled();
  await Promise.all([appUpdater.download(), appUpdater.download()]);
  expect(handle.download).toHaveBeenCalledOnce();
  await appUpdater.check();
  expect(handle.close).not.toHaveBeenCalled();
});
it("keeps download failures retryable and never installs an unverified download", async () => {
  const handle = update();
  handle.download.mockRejectedValueOnce(new Error("signature mismatch"));
  mocks.invoke.mockResolvedValue(release);
  mocks.check.mockResolvedValue(handle);
  const { appUpdater } = await import("../src/services/appUpdater");
  await appUpdater.check();
  await appUpdater.download();
  await appUpdater.install();
  expect(appUpdater.snapshot()).toMatchObject({
    phase: "error",
    error: "signature mismatch",
  });
  expect(handle.install).not.toHaveBeenCalled();
  await appUpdater.download();
  expect(appUpdater.snapshot().phase).toBe("ready");
});
it("persists opt-out across app restarts and exposes connection errors without losing manual retry", async () => {
  const { appUpdater } = await import("../src/services/appUpdater");
  appUpdater.setOptions({ autoCheck: false, autoUpdate: false });
  vi.resetModules();
  const restarted = (await import("../src/services/appUpdater")).appUpdater;
  expect(restarted.snapshot().options).toEqual({
    autoCheck: false,
    autoUpdate: false,
  });
  mocks.invoke
    .mockRejectedValueOnce("暂时无法连接 GitHub")
    .mockResolvedValueOnce(null);
  await restarted.check();
  expect(restarted.snapshot().phase).toBe("error");
  await restarted.check();
  expect(restarted.snapshot().phase).toBe("current");
});
