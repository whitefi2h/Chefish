import { useEffect, useRef, useState } from "react";
import {
  ArchiveRestore,
  Download,
  FolderOpen,
  ShieldCheck,
  FileCheck2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage, nativeMode } from "./services/kitchenClient";

interface Preview {
  token: string;
  schemaVersion: number;
  recipes: number;
  inventoryLots: number;
  plannedMeals: number;
  cookingSessions: number;
  fileName: string;
}
interface BackupStatus {
  directory: string;
  latest: number | null;
  count: number;
}

export default function Backup({
  onRestored,
  onBusyChange,
}: {
  onRestored: () => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [refresh, setRefresh] = useState(0);
  const previewRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (preview) previewRef.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);
  useEffect(() => {
    if (!nativeMode) return;
    let alive = true;
    invoke<BackupStatus>("kitchen_backup_status")
      .then((value) => {
        if (alive) setStatus(value);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(
    () => () => {
      if (nativeMode) void invoke("kitchen_backup_cancel").catch(() => {});
    },
    [],
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  if (!nativeMode)
    return (
      <div className="settings-backup-demo">
        <ShieldCheck size={20} />
        <p>桌面版可备份和恢复全部厨房数据。浏览器演示使用独立数据。</p>
      </div>
    );

  return (
    <div className="settings-backup" aria-busy={busy}>
      <div className="settings-backup-location">
        <ShieldCheck size={20} strokeWidth={1.5} />
        <div>
          <strong>本机安全备份</strong>
          <p>
            {status
              ? status.count
                ? `${status.count} 份备份 · 最近保存于 ${status.latest ? new Date(status.latest * 1000).toLocaleString("zh-CN") : "未知时间"}`
                : "尚无自动备份，建议先手动保存一份。"
              : "正在读取备份信息…"}
          </p>
          {status && <small title={status.directory}>{status.directory}</small>}
        </div>
        <button
          aria-label="打开备份目录"
          title="打开备份目录"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await invoke("kitchen_backup_open_folder");
            })
          }
        >
          <FolderOpen size={17} />
        </button>
      </div>
      <div className="settings-group-label">手动备份与恢复</div>
      <div className="settings-row">
        <div className="settings-action-title">
          <Download size={19} strokeWidth={1.6} />
          <div>
            <strong>保存一份备份</strong>
            <p>选择保存位置，包含菜谱、图片、库存、菜单、偏好与对话。</p>
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const name = await invoke<string | null>("kitchen_backup_create");
              if (name) setMessage(`备份已保存：${name}`);
            })
          }
        >
          立即备份
        </button>
      </div>
      <div className="settings-row">
        <div className="settings-action-title">
          <ArchiveRestore size={19} strokeWidth={1.6} />
          <div>
            <strong>从备份恢复</strong>
            <p>先检查文件与数据概况，确认后再替换当前数据。</p>
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const next = await invoke<Preview | null>(
                "kitchen_backup_preview",
              );
              if (next) setPreview(next);
            })
          }
        >
          选择备份
        </button>
      </div>
      {preview && (
        <section
          ref={previewRef}
          className="settings-restore-preview"
          aria-label="恢复预览"
        >
          <div className="settings-preview-title">
            <FileCheck2 size={19} />
            <div>
              <strong>备份已通过检查</strong>
              <span>{preview.fileName}</span>
            </div>
          </div>
          <dl>
            {(
              [
                [preview.recipes, "菜谱"],
                [preview.inventoryLots, "库存批次"],
                [preview.plannedMeals, "菜单安排"],
                [preview.cookingSessions, "烹饪记录"],
              ] as const
            ).map(([count, label]) => (
              <div key={label}>
                <dd>{count}</dd>
                <dt>{label}</dt>
              </div>
            ))}
          </dl>
          <p>
            恢复将替换当前厨房数据与偏好。确认后会先保存一份恢复前备份，模型密钥仍保存在本机。
          </p>
          <div className="actions">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !window.confirm(
                      "恢复将替换当前厨房数据与偏好。应用会先备份现有数据，继续恢复？",
                    )
                  )
                    return;
                  await invoke("kitchen_backup_restore", {
                    token: preview.token,
                  });
                  setPreview(null);
                  const loaded = await onRestored();
                  setRefresh((n) => n + 1);
                  setMessage(
                    loaded
                      ? "数据已恢复，恢复前的内容也已留存备份。"
                      : "数据已恢复，界面读取失败，请关闭设置后重试加载。",
                  );
                })
              }
            >
              确认恢复
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await invoke("kitchen_backup_cancel");
                  setPreview(null);
                })
              }
            >
              取消
            </button>
          </div>
        </section>
      )}
      <p className="settings-note">
        备份文件包含个人厨房记录，请自行妥善保存。API 密钥由 Windows
        凭据管理器保存，不随普通备份导出。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="settings-saved">
          {message}
        </p>
      )}
    </div>
  );
}
