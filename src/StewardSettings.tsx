import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { errorMessage, nativeMode } from "./services/kitchenClient";
import {
  refreshSteward,
  steward,
  useSteward,
  type StewardSettings as Settings,
} from "./services/steward";

const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
export default function StewardSettings({
  onDirtyChange,
  saveTarget,
  onSaved,
  onBusyChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  saveTarget: HTMLElement | null;
  onSaved?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const state = useSteward();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const saved = JSON.stringify(state?.settings);
  useEffect(() => {
    if (saved) setDraft(JSON.parse(saved) as Settings);
  }, [saved]);
  const dirty = !!draft && JSON.stringify(draft) !== saved;
  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);
  if (!nativeMode) return <p>厨房管家在 Windows 桌面版中运行。</p>;
  if (!draft)
    return (
      <p role="status">
        正在读取管家设置…{" "}
        <button
          onClick={() =>
            void refreshSteward().catch((e) => setError(errorMessage(e)))
          }
        >
          重试
        </button>
        {error}
      </p>
    );
  function change<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((s) => s && { ...s, [key]: value });
    setMessage("");
  }
  const toggle = (key: keyof Settings, label: string, hint?: string) => (
    <div className="settings-row" key={key}>
      <div>
        <label htmlFor={`steward-${key}`}>{label}</label>
        {hint && <p>{hint}</p>}
      </div>
      <label className="settings-switch">
        <input
          id={`steward-${key}`}
          type="checkbox"
          role="switch"
          checked={!!draft[key]}
          onChange={(e) => change(key, e.target.checked as never)}
        />
        <span aria-hidden="true" />
      </label>
    </div>
  );
  return (
    <fieldset className="settings-fields steward-settings" disabled={busy}>
      <h3 className="settings-group-label">运行与通知</h3>
      <div className="settings-option-group">
        {toggle(
          "enabled",
          "在这台电脑启用厨房管家",
          "首次启用后按以下安排工作。换电脑前，请先停用旧设备的管家并完成同步。",
        )}
        {toggle(
          "doNotDisturb",
          "免打扰",
          "暂停全部主动任务及通知；手动对话、生成菜单和整理仍可使用。",
        )}
        {toggle(
          "autostart",
          "随 Windows 启动并留在托盘",
          "明确退出或关机后停止运行，下次启动只补检有效任务。",
        )}
      </div>
      <p className="settings-note">
        启用管家或开机自启动后，关闭窗口会留在托盘；双击托盘图标可重新打开，右键可切换自启动或退出。
      </p>
      <h3 className="settings-group-label">每周菜单</h3>
      <div className="settings-option-group">
        {toggle("weekly", "周末询问下周安排")}
        <div className="settings-row">
          <label htmlFor="weekly-time">询问时间</label>
          <div className="settings-schedule">
            <select
              aria-label="每周菜单询问日"
              value={draft.weeklyDay}
              onChange={(e) => change("weeklyDay", Number(e.target.value))}
            >
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <input
              id="weekly-time"
              type="time"
              value={draft.weeklyTime}
              onChange={(e) => change("weeklyTime", e.target.value)}
            />
          </div>
        </div>
        <div className="settings-row">
          <span className="settings-option-label">常做餐次</span>
          <div className="settings-meals" role="group" aria-label="常做餐次">
            {["早餐", "午餐", "晚餐"].map((meal) => (
              <label key={meal}>
                <input
                  type="checkbox"
                  checked={draft.meals.includes(meal)}
                  onChange={(e) =>
                    change(
                      "meals",
                      e.target.checked
                        ? [...draft.meals, meal]
                        : draft.meals.filter((m) => m !== meal),
                    )
                  }
                />
                {meal}
              </label>
            ))}
          </div>
        </div>
        {toggle("weeklyNotify", "通知我查看菜单询问")}
      </div>
      <p className="settings-note">
        无人回复时保留询问，不催促。草稿可跨天、跨重启继续，确认后才写入正式菜单。
      </p>
      <h3 className="settings-group-label">日常整理</h3>
      <div className="settings-option-group">
        {toggle("maintenance", "每天检查新增、修改和异常数据")}
        <div className="settings-row">
          <label htmlFor="maintenance-time">整理时间</label>
          <input
            id="maintenance-time"
            type="time"
            value={draft.maintenanceTime}
            onChange={(e) => change("maintenanceTime", e.target.value)}
          />
        </div>
        {toggle(
          "allowEstimates",
          "自动推测预计复查日期和缺失库位",
          "补充预计复查日期、缺失库位和标签；保留用户明确填写的值。估计不是包装有效期。",
        )}
        {toggle(
          "allowAutoEnableTags",
          "允许助手自动开启标签",
          "整理新入库菜谱时，可启用目录中匹配的未开启标签；不会新建标签或恢复已删除标签。",
        )}
        {toggle("maintenanceNotify", "通知我查看整理结果和待补充问题")}
      </div>
      <h3 className="settings-group-label">新菜谱与灵感</h3>
      <div className="settings-option-group">
        {toggle("recommendations", "定期从下厨房寻找新菜")}
        <div className="settings-row">
          <label htmlFor="recommendation-interval">推荐频率</label>
          <select
            id="recommendation-interval"
            value={draft.recommendationInterval}
            onChange={(e) =>
              change("recommendationInterval", Number(e.target.value))
            }
          >
            <option value={1}>每天</option>
            <option value={7}>每周</option>
            <option value={14}>每两周</option>
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="recommendation-time">推荐时间</label>
          <div className="settings-schedule">
            <select
              aria-label="菜谱推荐日"
              value={draft.recommendationsDay}
              onChange={(e) =>
                change("recommendationsDay", Number(e.target.value))
              }
            >
              {days.map((d, i) => (
                <option key={d} value={i}>
                  {d}
                </option>
              ))}
            </select>
            <input
              id="recommendation-time"
              type="time"
              value={draft.recommendationsTime}
              onChange={(e) => change("recommendationsTime", e.target.value)}
            />
          </div>
        </div>
        {toggle("recommendationsNotify", "通知我查看新菜谱")}
      </div>
      <p className="settings-note">
        关闭某项通知后，任务仍工作，结果留在助手的“管家消息”中。当前时间按本机时区计算。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
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
                setMessage("管家设置已保存");
                onSaved?.();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在保存…" : "保存设置"}
          </button>,
          saveTarget,
        )}
    </fieldset>
  );
}
