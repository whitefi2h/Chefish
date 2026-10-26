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
}));
vi.mock("../src/services/cloudClient", () => ({
  cloudConfigured: true,
  cloudError: (e: Error) => e.message,
  watchAccount: (listener: (user: unknown) => void) => {
    mocks.listener = listener;
    return () => {};
  },
  syncRepository: () => ({ head: mocks.head, operations: mocks.operations }),
  repository: () => ({}),
  snapshotBridge: {},
}));
vi.mock("../src/services/syncNative", () => ({
  syncNative: {
    state: mocks.state,
    outgoing: mocks.outgoing,
    prepareBaseline: mocks.prepare,
    connect: mocks.connect,
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
it("paused or conflicted kitchens keep their queue and never upload", async () => {
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
  await syncRuntime.retry();
  expect(syncRuntime.snapshot().phase).toBe("conflict");
  expect(mocks.outgoing).not.toHaveBeenCalled();
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
