import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpCircle,
  Check,
  Download,
  ExternalLink,
  Github,
  RefreshCw,
} from "lucide-react";
import { appUpdater } from "./services/appUpdater";
import { nativeMode } from "./services/kitchenClient";
import { version } from "../package.json";

const useUpdates = () =>
  useSyncExternalStore(appUpdater.subscribe, appUpdater.snapshot);

export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  const state = useUpdates();
  useEffect(() => appUpdater.start(), []);
  if (!state.release || (!state.options.autoCheck && state.phase !== "ready"))
    return null;
  return (
    <button className="update-notice" onClick={onOpen}>
      <ArrowUpCircle size={15} />
      {state.phase === "ready"
        ? "更新已就绪"
        : `新版本 ${state.release.version}`}
    </button>
  );
}

export default function AppUpdates({
  installDisabled,
}: {
  installDisabled: boolean;
}) {
  const state = useUpdates();
  const [linkError, setLinkError] = useState("");
  const supported = nativeMode;
  const working = ["checking", "downloading", "installing"].includes(
    state.phase,
  );
  const open = async (releases = false) => {
    try {
      await appUpdater.openProject(releases);
      setLinkError("");
    } catch (error) {
      setLinkError(String(error));
    }
  };
  const status = {
    idle: "随时检查，保持厨房常新。",
    checking: "正在检查新版本…",
    current: "当前已是最新版本",
    available: `发现新版本 ${state.release?.version ?? ""}`,
    downloading:
      state.progress === null
        ? "正在下载更新…"
        : `正在下载更新 · ${state.progress}%`,
    ready: "更新已下载，准备安装",
    installing: "正在启动更新安装…",
    error: "暂时未能完成更新",
  }[state.phase];
  return (
    <section className="app-updates" aria-label="软件更新">
      <div className="settings-row update-status">
        <div>
          <strong>软件更新</strong>
          <p>当前版本 {version}</p>
        </div>
        <button
          disabled={!supported || working || state.phase === "ready"}
          onClick={() => void appUpdater.check()}
        >
          <RefreshCw
            size={15}
            className={
              state.phase === "checking" ? "update-spinning" : undefined
            }
          />
          {state.phase === "checking" ? "检查中…" : "检查更新"}
        </button>
      </div>
      <div
        className={`update-result${state.phase === "ready" ? " is-ready" : ""}`}
        role="status"
        aria-live="polite"
      >
        {state.phase === "current" || state.phase === "ready" ? (
          <Check size={17} />
        ) : (
          <ArrowUpCircle size={17} />
        )}
        <div>
          <strong>{supported ? status : "请在桌面版中检查和安装更新"}</strong>
          {state.phase === "ready" && (
            <p>安装会退出并重新打开 Chefish，请先保存正在编辑的内容。</p>
          )}
          {state.release && !state.release.canInstall && (
            <p>此版本提供手动安装，请前往版本发布页下载。</p>
          )}
          {state.checkedAt && (
            <small>
              上次检查{" "}
              {new Date(state.checkedAt).toLocaleString("zh-CN", {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
        </div>
      </div>
      {state.phase === "downloading" && (
        <progress
          aria-label="更新下载进度"
          max={100}
          value={state.progress ?? undefined}
        />
      )}
      {(state.error || linkError) && (
        <p className="error" role="alert">
          {state.error || linkError}
        </p>
      )}
      {state.release && (
        <>
          {state.release.notes && (
            <details className="update-notes">
              <summary>本次更新内容</summary>
              <p>{state.release.notes}</p>
            </details>
          )}
          <div className="actions">
            {state.release.canInstall &&
              !working &&
              state.phase !== "ready" && (
                <button
                  className="primary"
                  onClick={() => void appUpdater.download()}
                >
                  <Download size={15} />
                  下载更新
                </button>
              )}
            {state.phase === "ready" && (
              <button
                className="primary"
                disabled={installDisabled}
                onClick={() => {
                  if (
                    window.confirm(
                      "安装更新会退出并重新打开 Chefish。请确认正在编辑的内容已保存，现在安装？",
                    )
                  )
                    void appUpdater.install();
                }}
              >
                <ArrowUpCircle size={15} />
                重启并安装
              </button>
            )}
            <button onClick={() => void open(true)}>
              <ExternalLink size={15} />
              版本发布页
            </button>
          </div>
          {state.phase === "ready" && installDisabled && (
            <p className="settings-note">
              请先保存当前设置，或等待正在进行的操作完成。
            </p>
          )}
        </>
      )}
      <div className="settings-row">
        <div>
          <label htmlFor="updates-auto-check">新版本提示</label>
          <p>启动时及使用期间定期检查，在软件内提示可用版本。</p>
        </div>
        <label className="settings-switch">
          <input
            id="updates-auto-check"
            type="checkbox"
            role="switch"
            disabled={!supported}
            checked={state.options.autoCheck}
            onChange={(e) =>
              appUpdater.setOptions({
                autoCheck: e.target.checked,
                autoUpdate: e.target.checked && state.options.autoUpdate,
              })
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <div className="settings-row">
        <div>
          <label htmlFor="updates-auto-install">自动更新</label>
          <p>后台检查并下载更新，准备好后提示重启安装，不打断当前操作。</p>
        </div>
        <label className="settings-switch">
          <input
            id="updates-auto-install"
            type="checkbox"
            role="switch"
            disabled={!supported}
            checked={state.options.autoUpdate}
            onChange={(e) =>
              appUpdater.setOptions({
                autoCheck: e.target.checked || state.options.autoCheck,
                autoUpdate: e.target.checked,
              })
            }
          />
          <span aria-hidden="true" />
        </label>
      </div>
      <p className="settings-note">
        开关立即保存在这台电脑。关闭后仍可手动检查和更新。
      </p>
      <div className="settings-group-label">项目与反馈</div>
      <div className="actions update-links">
        <button onClick={() => void open()}>
          <Github size={16} />
          GitHub 项目主页
          <ExternalLink size={13} />
        </button>
        {!state.release && (
          <button onClick={() => void open(true)}>
            <ExternalLink size={15} />
            版本发布页
          </button>
        )}
      </div>
    </section>
  );
}
