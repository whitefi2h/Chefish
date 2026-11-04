import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, Leaf, Lightbulb } from "lucide-react";
import { errorMessage, nativeMode } from "./services/kitchenClient";
import {
  refreshSteward,
  steward,
  useSteward,
  type StewardSettings,
} from "./services/steward";

export default function OnboardingSteward({
  saveTarget,
  onDirtyChange,
  onBusyChange,
  onSaved,
}: {
  saveTarget: HTMLElement | null;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onSaved: () => void;
}) {
  const state = useSteward();
  const [draft, setDraft] = useState<StewardSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saved = JSON.stringify(state?.settings);
  useEffect(() => {
    if (saved) setDraft(JSON.parse(saved));
  }, [saved]);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  if (!nativeMode)
    return (
      <p className="onboarding-hint">厨房管家可在 Windows 桌面版中开启。</p>
    );
  if (!draft) return <p role="status">正在读取管家设置…</p>;
  const toggle = (
    key: "enabled" | "autostart",
    label: string,
    hint: string,
  ) => (
    <label
      className={`onboarding-toggle ${key === "enabled" ? "onboarding-toggle-main" : ""}`}
    >
      <span>
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={draft[key]}
        disabled={busy}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
      />
      <i aria-hidden="true" />
    </label>
  );
  return (
    <div className="onboarding-steward" aria-busy={busy}>
      {toggle(
        "enabled",
        "启用厨房管家",
        "帮你规划菜单、整理库存，寻找新菜灵感。",
      )}
      {draft.enabled && (
        <fieldset className="onboarding-tasks" disabled={busy}>
          <legend>希望管家帮你做什么？</legend>
          <div>
            {(
              [
                ["weekly", "每周菜单", CalendarDays],
                ["maintenance", "厨房整理", Leaf],
                ["recommendations", "新菜灵感", Lightbulb],
              ] as const
            ).map(([key, label, Icon]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.checked })
                  }
                />
                <Icon size={18} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {toggle(
        "autostart",
        "开机时在后台运行",
        "关闭窗口后留在托盘，方便按时照看厨房。",
      )}
      <p className="onboarding-hint">
        时间、通知和免打扰，可之后在管家设置中调整。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {saveTarget &&
        createPortal(
          <button
            className="primary"
            disabled={!dirty || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await steward.save(draft);
                await refreshSteward();
                onSaved();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在保存…" : "保存并继续"}
          </button>,
          saveTarget,
        )}
    </div>
  );
}
