import {
  cloudConfigured,
  watchAccount,
  syncRepository,
  repository,
  snapshotBridge,
  cloudError,
} from "./cloudClient";
import {
  syncNative,
  baselineBridge,
  type NativeSyncState,
  type RestorePreview,
} from "./syncNative";
import { SyncEngine } from "./syncEngine";
import type { SyncHead } from "./syncRepository";
type Account = { uid: string; email: string | null; verified: boolean };
export interface SyncView {
  account: Account | null;
  local: NativeSyncState | null;
  head: SyncHead | null;
  phase:
    | "loading"
    | "signedOut"
    | "setup"
    | "paused"
    | "syncing"
    | "synced"
    | "conflict"
    | "error";
  error: string;
  lastSynced: number | null;
  progress: string;
}
let view: SyncView = {
  account: null,
  local: null,
  head: null,
  phase: "signedOut",
  error: "",
  lastSynced: null,
  progress: "",
};
const listeners = new Set<() => void>();
let account: Account | null = null,
  running: Promise<void> | null = null,
  exclusive = false,
  started = false;
const emit = (patch: Partial<SyncView>) => {
  view = { ...view, ...patch };
  listeners.forEach((listener) => listener());
};
const assert = (uid: string) => {
  if (account?.uid !== uid || !account.verified)
    throw new Error("账户已变化，同步已停止。");
};
const changed = async () => {
  window.dispatchEvent(new Event("chefish:sync-data"));
};
function phase(local: NativeSyncState): SyncView["phase"] {
  if (!local.binding || local.binding.uid !== account?.uid) return "setup";
  if (!local.binding.enabled) return "paused";
  if (local.binding.conflict) return "conflict";
  return local.queuedOperations ? "syncing" : "synced";
}
async function inspect(fetchHead = false) {
  if (!account?.verified) return;
  const uid = account.uid;
  const local = await syncNative.state();
  assert(uid);
  const head = fetchHead ? await syncRepository(uid).head() : view.head;
  assert(uid);
  emit({
    local,
    head,
    phase: phase(local),
    error: local.binding?.conflict ?? "",
  });
}
async function tick() {
  if (!account?.verified || exclusive) return;
  if (running) return running;
  const uid = account.uid;
  running = (async () => {
    try {
      await inspect();
      assert(uid);
      const local = view.local;
      if (
        !local?.binding ||
        local.binding.uid !== uid ||
        !local.binding.enabled ||
        local.binding.conflict
      )
        return;
      emit({ phase: "syncing", error: "" });
      const state = await new SyncEngine(
        uid,
        syncRepository(uid),
        syncNative,
        () => assert(uid),
        changed,
      ).pass();
      assert(uid);
      const head = await syncRepository(uid).head();
      assert(uid);
      emit({
        local: state,
        head,
        phase:
          state.binding && head && state.binding.cursor < head.sequence
            ? "syncing"
            : phase(state),
        lastSynced: Date.now(),
        error: state.binding?.conflict ?? "",
      });
    } catch (error) {
      if (account?.uid === uid) {
        let local = view.local;
        try {
          local = await syncNative.state();
        } catch {
          /* Keep last known local status. */
        }
        if (account?.uid !== uid) return;
        emit({
          local,
          phase: local?.binding?.conflict ? "conflict" : "error",
          error: cloudError(error),
        });
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
async function lock<T>(
  work: (uid: string, email: string) => Promise<T>,
): Promise<T> {
  const current = account;
  if (!current?.verified) throw new Error("请先登录并验证邮箱。");
  if (exclusive) throw new Error("已有同步操作正在进行。");
  exclusive = true;
  try {
    await running;
    assert(current.uid);
    return await work(current.uid, current.email ?? "");
  } finally {
    exclusive = false;
    emit({ progress: "" });
  }
}
export const syncRuntime = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  snapshot: () => view,
  start() {
    if (started || !cloudConfigured) return () => {};
    started = true;
    const stop = watchAccount(
      (user) => {
        const previous = account?.uid;
        account = user
          ? { uid: user.uid, email: user.email, verified: user.emailVerified }
          : null;
        emit({
          account,
          ...(previous !== account?.uid
            ? { local: null, head: null, lastSynced: null }
            : {}),
          error: "",
          phase: account?.verified ? "loading" : "signedOut",
        });
        const uid = account?.uid;
        if (account?.verified)
          void inspect(true)
            .then(() => tick())
            .catch((error) => {
              if (account?.uid === uid)
                emit({ phase: "error", error: cloudError(error) });
            });
      },
      (error) => emit({ phase: "error", error: cloudError(error) }),
    );
    const wake = () => {
      void tick();
    };
    const timer = setInterval(wake, 15000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("chefish:sync-wake", wake);
    return () => {
      stop();
      clearInterval(timer);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("chefish:sync-wake", wake);
      account = null;
      started = false;
    };
  },
  async inspect() {
    await inspect(true);
  },
  async retry() {
    await tick();
  },
  async pause(enabled: boolean) {
    await lock(async (uid) => {
      await syncNative.pause(uid, enabled);
      await inspect();
    });
    if (enabled) await tick();
  },
  async create(transferOwner = false) {
    return lock(async (uid, email) => {
      emit({ progress: "正在准备并上传厨房…" });
      const baseline = await syncNative.prepareBaseline(
        uid,
        email,
        transferOwner,
      );
      assert(uid);
      await repository().upload(
        baselineBridge(syncNative, baseline, snapshotBridge),
        (progress) => emit({ progress }),
      );
      assert(uid);
      const head = await syncRepository(uid).create(baseline.manifest.id);
      assert(uid);
      await syncNative.bindBaseline(uid, baseline.manifest.id, head.spaceId);
      emit({ head });
      await inspect();
    }).then(() => tick());
  },
  async prepareJoin(): Promise<{ preview: RestorePreview; head: SyncHead }> {
    return lock(async (uid) => {
      const head = await syncRepository(uid).head();
      if (!head) throw new Error("这个账户尚无云端厨房。");
      const snapshots = await repository().list();
      let manifest = snapshots.find((item) => item.id === head.baselineId);
      // The baseline may be older than the recent-backups list.
      if (!manifest) manifest = await repository().get(head.baselineId);
      const preview = await repository().download(
        manifest,
        snapshotBridge,
        (progress) => emit({ progress }),
      );
      assert(uid);
      return { preview, head };
    });
  },
  async connect(preview: RestorePreview, head: SyncHead) {
    return lock(async (uid, email) => {
      await syncNative.connect(uid, email, head.spaceId, preview.token);
      assert(uid);
      await changed();
      emit({ head });
      await inspect();
    }).then(() => tick());
  },
  async resolveCloud() {
    return lock(async (uid) => {
      await syncNative.resolveCloud(uid);
      await changed();
      await inspect();
    }).then(() => tick());
  },
};
