import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Pause, Play, Cloud, ShieldCheck } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { syncRuntime } from "./services/syncRuntime";
import { cloudError } from "./services/cloudClient";
import type { RestorePreview } from "./services/syncNative";
import type { SyncHead } from "./services/syncRepository";
export default function SyncPanel({
  disabled,
  onBusyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const status = useSyncExternalStore(
    syncRuntime.subscribe,
    syncRuntime.snapshot,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState<{
    preview: RestorePreview;
    head: SyncHead;
  } | null>(null);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  useEffect(() => {
    busyCallback.current(busy || !!pending);
  }, [busy, pending]);
  useEffect(
    () => () => {
      busyCallback.current(false);
    },
    [],
  );
  useEffect(() => {
    void syncRuntime.inspect().catch((e) => setError(cloudError(e)));
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(cloudError(e));
    } finally {
      setBusy(false);
    }
  }
  const binding = status.local?.binding,
    other = !!binding && binding.uid !== status.account?.uid,
    connected = !!binding && !other;
  const locked = disabled || busy;
  const labels = {
    loading: "正在检查连接…",
    signedOut: "登录并验证邮箱后可同步",
    setup: "尚未连接这间厨房",
    paused: "自动同步已暂停",
    syncing: "正在同步厨房…",
    synced: "厨房已同步",
    conflict: "需要处理同步冲突",
    error: "同步暂未完成",
  };
  return (
    <section className="sync-panel" aria-label="多设备同步" aria-busy={busy}>
      <div className="settings-group-label">多设备自动同步</div>
      <div className="sync-status">
        <Cloud size={21} />
        <div>
          <strong>{labels[status.phase]}</strong>
          <p>
            {connected
              ? `${status.local?.queuedOperations ?? 0} 项本机操作待同步`
              : other
                ? `本机厨房关联的是 ${binding?.email}。登录不会自动转移厨房数据。`
                : "首次连接后，菜谱、图片、库存和菜单会在同一账户的设备间同步。"}
          </p>
        </div>
      </div>
      {connected ? (
        <>
          {binding?.conflict || status.phase === "conflict" ? (
            <div className="sync-conflict" role="alert">
              <strong>同步未能完成</strong>
              <p>{binding?.conflict || status.error}</p>
              <p>
                本机内容和待同步操作均已保留。可以重试自动合并，或在下方直接选择一个完整版本强制替换。
              </p>
            </div>
          ) : (
            <p className="settings-note">
              {status.phase === "synced"
                ? "本机操作已同步。同一字段保留最后同步的修改；断网时可继续编辑，恢复网络后自动重试。"
                : "聊天、模型密钥和通用设置留在各自电脑。"}
            </p>
          )}
          <div className="actions">
            <button
              disabled={locked || status.phase === "syncing"}
              onClick={() => void run(() => syncRuntime.retry())}
            >
              <RefreshCw size={15} />
              立即同步
            </button>
            <button
              disabled={locked}
              onClick={() =>
                void run(() => syncRuntime.pause(!binding.enabled))
              }
            >
              {binding.enabled ? <Pause size={15} /> : <Play size={15} />}{" "}
              {binding.enabled ? "暂停自动同步" : "继续自动同步"}
            </button>
          </div>
          <details
            className="sync-replace"
            open={!!binding.conflict || status.phase === "error"}
          >
            <summary>强制替换同步版本</summary>
            <p className="settings-note">
              不再合并冲突队列，直接采用你选定的完整厨房。替换前自动保存备份；聊天、模型密钥和通用设置保留在各自电脑。
            </p>
            <div className="settings-row">
              <div>
                <strong>以这台电脑为准</strong>
                <p>把当前本机完整内容设为云端版本，包含尚未同步的修改。</p>
              </div>
              <button
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    if (
                      !window.confirm(
                        `将先备份本机，再用这台电脑的完整厨房替换云端同步版本，包含当前 ${status.local?.queuedOperations ?? 0} 项待同步操作的结果。云端原版本会保留恢复记录；其他设备需要重新选择版本。确定以本机为准？`,
                      )
                    )
                      return;
                    await syncRuntime.forceLocal();
                  })
                }
              >
                以本机版本替换云端
              </button>
            </div>
            <div className="settings-row">
              <div>
                <strong>以云端为准</strong>
                <p>备份后直接重新载入云端厨房，放弃本机尚未同步的修改。</p>
              </div>
              <button
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    if (
                      !window.confirm(
                        `将先下载云端厨房，再备份并替换本机。当前 ${status.local?.queuedOperations ?? 0} 项本机待同步操作将不再上传；恢复不依赖旧队列回退。确定以云端为准？`,
                      )
                    )
                      return;
                    await syncRuntime.forceCloud();
                  })
                }
              >
                以云端版本替换本机
              </button>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="actions">
            <button
              className="primary"
              disabled={locked || !!pending}
              onClick={() =>
                void run(async () => {
                  if (status.head) {
                    setPending(await syncRuntime.prepareJoin());
                    return;
                  }
                  if (
                    !window.confirm(
                      other
                        ? "将先备份本机，再把当前厨房复制到当前登录账户。原账户的云端内容保持保留。继续？"
                        : "将当前厨房（含菜谱图片、库存、菜单与用餐偏好）上传到当前账户，并开启自动同步？聊天和密钥保留本机。",
                    )
                  )
                    return;
                  await syncRuntime.create(other);
                })
              }
            >
              {status.head
                ? "连接云端厨房"
                : other
                  ? "复制本机厨房到当前账户"
                  : "用本机厨房开启同步"}
            </button>
            <button
              disabled={locked || !!pending}
              onClick={() => void run(() => syncRuntime.inspect())}
            >
              检查云端厨房
            </button>
          </div>
          {pending && (
            <section
              className="settings-restore-preview"
              aria-label="连接云端厨房预览"
            >
              <ShieldCheck size={19} />
              <strong>初始备份已通过校验</strong>
              <p>
                {pending.preview.recipes} 道菜谱 ·{" "}
                {pending.preview.inventoryLots} 个库存批次 ·{" "}
                {pending.preview.plannedMeals} 项菜单安排
              </p>
              <p>
                连接会先备份本机，再载入云端厨房并同步此后的更新。本机聊天、通用设置和模型密钥会保留。
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={locked}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !window.confirm(
                          "连接将替换本机厨房数据。会先保存安全备份，并保留本机聊天、通用设置和密钥。继续？",
                        )
                      )
                        return;
                      await syncRuntime.connect(pending.preview, pending.head);
                      setPending(null);
                    })
                  }
                >
                  确认连接并恢复
                </button>
                <button
                  disabled={locked}
                  onClick={() =>
                    void run(async () => {
                      await invoke("kitchen_backup_cancel");
                      setPending(null);
                    })
                  }
                >
                  取消连接
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {(status.progress || busy) && (
        <p role="status">{status.progress || "正在处理同步…"}</p>
      )}
      {(error || (status.phase === "error" && status.error)) && (
        <p role="alert" className="error">
          {error || status.error}
        </p>
      )}
    </section>
  );
}
