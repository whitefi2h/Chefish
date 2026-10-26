import { useSyncExternalStore } from "react";
import { Cloud, CloudOff, RefreshCw } from "lucide-react";
import { syncRuntime } from "./services/syncRuntime";

export default function SyncIndicator({ onOpen }: { onOpen: () => void }) {
  const status = useSyncExternalStore(
    syncRuntime.subscribe,
    syncRuntime.snapshot,
  );
  if (!status.account?.verified || !status.local?.binding) return null;
  const label =
    status.local.binding.uid !== status.account.uid
      ? "厨房账户不同"
      : status.phase === "conflict"
        ? "同步需处理"
        : status.phase === "error"
          ? "同步待重试"
          : status.phase === "paused"
            ? "同步已暂停"
            : status.phase === "syncing"
              ? "同步中…"
              : "云端已同步";
  const Icon =
    status.phase === "error" || status.phase === "conflict"
      ? CloudOff
      : status.phase === "syncing"
        ? RefreshCw
        : Cloud;
  return (
    <button
      onClick={onOpen}
      title={status.error || "查看账户与同步状态"}
      aria-label={`查看同步状态：${label}`}
    >
      <Icon size={15} />
      {label}
    </button>
  );
}
