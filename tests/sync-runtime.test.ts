import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { NativeSyncState } from "../src/services/syncNative";
const mocks = vi.hoisted(() => ({
  listener: null as ((user: unknown) => void) | null,
  state: vi.fn(),
  head: vi.fn(),
  operations: vi.fn(),
  outgoing: vi.fn(),
  prepare: vi.fn(),
  connect: vi.fn(),
  retry: vi.fn(),
  replacement: vi.fn(),
  replace: vi.fn(),
  bind: vi.fn(),
  upload: vi.fn(),
  get: vi.fn(),
  download: vi.fn(),
  resolve: vi.fn(),
}));
vi.mock("../src/services/cloudClient", () => ({
  cloudConfigured: true,
  cloudError: (e: Error) => e.message,
  watchAccount: (listener: (user: unknown) => void) => {
    mocks.listener = listener;
    return () => {};
  },
  syncRepository: () => ({
    head: mocks.head,
    operations: mocks.operations,
    replace: mocks.replace,
  }),
  repository: () => ({
    upload: mocks.upload,
    get: mocks.get,
    download: mocks.download,
  }),
  snapshotBridge: {},
}));
vi.mock("../src/services/syncNative", () => ({
  syncNative: {
    state: mocks.state,
    outgoing: mocks.outgoing,
    prepareBaseline: mocks.prepare,
    connect: mocks.connect,
    retry: mocks.retry,
    prepareReplacement: mocks.replacement,
    bindBaseline: mocks.bind,
    resolveCloud: mocks.resolve,
  },
  baselineBridge: vi.fn(),
}));
const local = (uid: string | null = "alice"): NativeSyncState => ({
  replicaId: "replica",
  queuedOperations: 0,
  queuedBytes: 0,
  binding: uid
    ? {
        uid,
        email: `${uid}@example.invalid`,
        spaceId: "space",
        cursor: 0,
        enabled: true,
        conflict: null,
      }
    : null,
});
let stop: (() => void) | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("window", new EventTarget());
  mocks.state.mockResolvedValue(local());
  mocks.head.mockResolvedValue({
    formatVersion: 1,
    spaceId: "space",
    baselineId: "baseline",
    sequence: 0,
    lastOperationId: "",
  });
  mocks.operations.mockResolvedValue([]);
  mocks.outgoing.mockResolvedValue(null);
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.unstubAllGlobals();
});
const login = (uid = "alice", emailVerified = true) =>
  mocks.listener?.({ uid, email: `${uid}@example.invalid`, emailVerified });
it("starts background sync only for a verified account with an explicit matching binding", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  stop = syncRuntime.start();
  login("alice", false);
  await syncRuntime.retry();
  expect(mocks.state).not.toHaveBeenCalled();
  mocks.state.mockResolvedValue(local(null));
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("setup"));
  expect(mocks.operations).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
  mocks.state.mockResolvedValue(local("bob"));
  await syncRuntime.retry();
  expect(syncRuntime.snapshot().phase).toBe("setup");
  expect(mocks.operations).not.toHaveBeenCalled();
  mocks.state.mockResolvedValue(local());
  await syncRuntime.retry();
  expect(mocks.operations).toHaveBeenCalledWith(0);
  expect(syncRuntime.snapshot().phase).toBe("synced");
});
it("local changes, online and window focus wake the connected background engine", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("synced"));
  for (const event of ["chefish:sync-wake", "online", "focus"]) {
    const count = mocks.operations.mock.calls.length;
    window.dispatchEvent(new Event(event));
    await vi.waitFor(() =>
      expect(mocks.operations.mock.calls.length).toBeGreaterThan(count),
    );
    await syncRuntime.retry();
  }
});
it("paused or conflicted kitchens keep their queue on background wake", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  const paused = local();
  paused.binding!.enabled = false;
  mocks.state.mockResolvedValue(paused);
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("paused"));
  const conflict = local();
  conflict.binding!.conflict = "同一条库存冲突";
  conflict.queuedOperations = 1;
  mocks.state.mockResolvedValue(conflict);
  await syncRuntime.inspect();
  window.dispatchEvent(new Event("focus"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(syncRuntime.snapshot().phase).toBe("conflict");
  expect(mocks.outgoing).not.toHaveBeenCalled();
  expect(mocks.retry).not.toHaveBeenCalled();
});
it("manual retry clears an old conflict marker and really runs the engine", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  const conflict = local();
  conflict.binding!.conflict = "旧版用餐偏好冲突";
  conflict.queuedOperations = 132;
  mocks.state.mockResolvedValue(conflict);
  mocks.retry.mockImplementation(async () => {
    mocks.state.mockResolvedValue(local());
  });
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("conflict"));
  await syncRuntime.retry();
  expect(mocks.retry).toHaveBeenCalledWith("alice");
  expect(mocks.operations).toHaveBeenCalledWith(0);
  expect(syncRuntime.snapshot().phase).toBe("synced");
});
it("a delayed old-account inspection cannot replace the new account status", async () => {
  let finish: (state: NativeSyncState) => void = () => {};
  mocks.state.mockReturnValueOnce(
    new Promise<NativeSyncState>((resolve) => {
      finish = resolve;
    }),
  );
  const { syncRuntime } = await import("../src/services/syncRuntime");
  stop = syncRuntime.start();
  login();
  mocks.listener?.(null);
  finish(local());
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(syncRuntime.snapshot().phase).toBe("signedOut");
  expect(syncRuntime.snapshot().account).toBeNull();
  expect(mocks.operations).not.toHaveBeenCalled();
});

it("force-local publishes a complete baseline before binding and bypasses the conflicted queue", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  const conflict = local();
  conflict.binding!.conflict = "旧回退冲突";
  conflict.queuedOperations = 135;
  mocks.state.mockResolvedValue(conflict);
  const replaced = {
    formatVersion: 1,
    spaceId: "new-space",
    baselineId: "new-baseline",
    baselineSequence: 8,
    sequence: 8,
    lastOperationId: "",
  };
  mocks.replacement.mockResolvedValue({ manifest: { id: "new-baseline" } });
  mocks.replace.mockResolvedValue(replaced);
  mocks.bind.mockImplementation(async () => {
    const current = local();
    current.binding!.spaceId = "new-space";
    current.binding!.cursor = 8;
    mocks.state.mockResolvedValue(current);
    mocks.head.mockResolvedValue(replaced);
  });
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("conflict"));
  await syncRuntime.forceLocal();
  expect(mocks.replacement).toHaveBeenCalledWith(
    "alice",
    "alice@example.invalid",
  );
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.replace.mock.invocationCallOrder[0],
  );
  expect(mocks.replace.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.bind.mock.invocationCallOrder[0],
  );
  expect(mocks.bind).toHaveBeenCalledWith(
    "alice",
    "new-baseline",
    "new-space",
    8,
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
  expect(syncRuntime.snapshot().phase).toBe("synced");
});
it("force-cloud download failures leave local data alone; success restores without queue rollback", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  const conflict = local();
  conflict.binding!.conflict = "旧回退冲突";
  conflict.queuedOperations = 135;
  mocks.state.mockResolvedValue(conflict);
  mocks.get.mockResolvedValue({ id: "baseline" });
  mocks.download
    .mockRejectedValueOnce(new Error("下载失败"))
    .mockResolvedValueOnce({ token: "restore-token" });
  mocks.connect.mockImplementation(async () =>
    mocks.state.mockResolvedValue(local()),
  );
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("conflict"));
  await expect(syncRuntime.forceCloud()).rejects.toThrow("下载失败");
  expect(mocks.connect).not.toHaveBeenCalled();
  expect(syncRuntime.snapshot().local?.queuedOperations).toBe(135);
  await syncRuntime.forceCloud();
  expect(mocks.connect).toHaveBeenCalledWith(
    "alice",
    "alice@example.invalid",
    "space",
    "restore-token",
    0,
  );
  expect(mocks.resolve).not.toHaveBeenCalled();
});
it("force replacement refuses a kitchen bound to a different account", async () => {
  const { syncRuntime } = await import("../src/services/syncRuntime");
  mocks.state.mockResolvedValue(local("bob"));
  stop = syncRuntime.start();
  login();
  await vi.waitFor(() => expect(syncRuntime.snapshot().phase).toBe("setup"));
  await expect(syncRuntime.forceLocal()).rejects.toThrow("账户不一致");
  await expect(syncRuntime.forceCloud()).rejects.toThrow("账户不一致");
  expect(mocks.replacement).not.toHaveBeenCalled();
  expect(mocks.connect).not.toHaveBeenCalled();
});
