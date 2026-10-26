import { lazy, Suspense, useEffect, useState } from "react";
import {
  Utensils,
  SlidersHorizontal,
  Sparkles,
  ArchiveRestore,
  Info,
  Minus,
  Plus,
  Check,
  Cloud,
} from "lucide-react";
import { Modal } from "./components";
import { useDemo } from "./store";
import AISettings from "./AISettings";
import Backup from "./Backup";
import { nativeMode } from "./services/kitchenClient";
import { type AppPreferences } from "./domain/preferences";
import { version } from "../package.json";
const CloudBackup = lazy(() => import("./CloudBackup"));

const sections = [
  {
    id: "preferences",
    label: "用餐与偏好",
    icon: Utensils,
    description: "让每一次配餐，更合你的日常。",
  },
  {
    id: "general",
    label: "通用",
    icon: SlidersHorizontal,
    description: "按习惯使用这间厨房。",
  },
  {
    id: "assistant",
    label: "AI 助手",
    icon: Sparkles,
    description: "选择模型服务，管理连接与密钥。",
  },
  {
    id: "data",
    label: "数据与备份",
    icon: ArchiveRestore,
    description: "为积累的菜谱和厨房记录，留一份备份。",
  },
  {
    id: "cloud",
    label: "账户与云端",
    icon: Cloud,
    description: "让同一间厨房，在不同电脑上接着用。",
  },
  {
    id: "about",
    label: "关于 Chefish",
    icon: Info,
    description: "一点计划，多一份从容。",
  },
] as const;
export type SettingsTab = (typeof sections)[number]["id"];

export default function Settings({
  initialTab = "preferences",
  onClose,
}: {
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const { preferences, savePreferences, busy, persistent, reload } = useDemo();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<AppPreferences>(preferences);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const saved = JSON.stringify(preferences);
  useEffect(() => {
    setDraft(JSON.parse(saved) as AppPreferences);
  }, [saved]);
  const dirty = JSON.stringify(draft) !== saved;
  const current = sections.find((s) => s.id === tab)!;
  function change<K extends keyof AppPreferences>(
    key: K,
    value: AppPreferences[K],
  ) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setMessage("");
    setError("");
  }
  function close() {
    if (busy || backupBusy) return;
    if (dirty && !window.confirm("设置还未保存，放弃这些修改并关闭？")) return;
    onClose();
  }
  async function save() {
    setMessage("");
    setError("");
    if (await savePreferences(draft)) setMessage("设置已保存");
    else setError("设置未保存，请重试。");
  }
  return (
    <Modal
      title="厨房设置"
      onClose={close}
      className="settings-dialog"
      dismissOnEscape
    >
      <div className="settings-layout">
        <aside className="settings-sidebar">
          <div className="settings-kitchen">
            <span>
              <img
                className="app-logo"
                src="/brand.svg"
                alt=""
                aria-hidden="true"
              />
            </span>
            <div>
              <strong>我的厨房</strong>
              <small>{persistent ? "在这台电脑上" : "当前演示会话"}</small>
            </div>
          </div>
          <nav
            aria-label="设置分类"
            role="tablist"
            aria-orientation="vertical"
            onKeyDown={(e) => {
              if (
                backupBusy ||
                !["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)
              )
                return;
              e.preventDefault();
              const index = sections.findIndex((s) => s.id === tab);
              const next =
                e.key === "Home"
                  ? 0
                  : e.key === "End"
                    ? sections.length - 1
                    : (index +
                        (e.key === "ArrowDown" ? 1 : -1) +
                        sections.length) %
                      sections.length;
              setTab(sections[next].id);
              document
                .getElementById(`settings-tab-${sections[next].id}`)
                ?.focus();
            }}
          >
            {sections.map((section) => (
              <button
                key={section.id}
                id={`settings-tab-${section.id}`}
                role="tab"
                disabled={backupBusy}
                tabIndex={tab === section.id ? 0 : -1}
                aria-selected={tab === section.id}
                aria-controls="settings-content"
                className={tab === section.id ? "selected" : ""}
                onClick={() => {
                  setTab(section.id);
                  setMessage("");
                }}
              >
                <section.icon size={17} strokeWidth={1.7} />
                {section.label}
              </button>
            ))}
          </nav>
          <div className="settings-sidebar-foot">
            Chefish <span>v{version}</span>
          </div>
        </aside>
        <div className="settings-main">
          <div
            className="settings-content"
            id="settings-content"
            role="tabpanel"
            aria-labelledby={`settings-tab-${tab}`}
          >
            <header className="settings-section-heading">
              <h2>{current.label}</h2>
              <p>{current.description}</p>
            </header>
            {tab === "preferences" && (
              <fieldset disabled={busy} className="settings-fields">
                <div className="settings-serving-row">
                  <div>
                    <label htmlFor="default-servings">平常几个人吃饭？</label>
                    <p>菜谱用量展示和新配餐会先按这个人数填写。</p>
                  </div>
                  <div className="settings-stepper">
                    <button
                      aria-label="减少默认人数"
                      disabled={draft.defaultServings <= 1 || busy}
                      onClick={() =>
                        change("defaultServings", draft.defaultServings - 1)
                      }
                    >
                      <Minus size={16} />
                    </button>
                    <label className="settings-serving-value">
                      <input
                        id="default-servings"
                        aria-label="默认用餐人数"
                        type="number"
                        min={1}
                        max={12}
                        value={draft.defaultServings}
                        onChange={(e) => {
                          const number = Number(e.target.value);
                          if (
                            Number.isInteger(number) &&
                            number >= 1 &&
                            number <= 12
                          )
                            change("defaultServings", number);
                        }}
                      />
                      <span>人</span>
                    </label>
                    <button
                      aria-label="增加默认人数"
                      disabled={draft.defaultServings >= 12 || busy}
                      onClick={() =>
                        change("defaultServings", draft.defaultServings + 1)
                      }
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <p className="settings-note">
                  每次都可以另选人数。菜谱的标准份数、已有菜单和烹饪记录会保留。
                </p>
                <div className="settings-group-label">
                  告诉助手，你习惯怎么吃
                </div>
                {(
                  [
                    [
                      "taste",
                      "口味偏好",
                      "例如：清淡一点，喜欢酸口，工作日晚餐尽量半小时内做好",
                    ],
                    [
                      "restrictions",
                      "忌口与饮食要求",
                      "例如：不吃香菜，对花生过敏，家里有人不吃牛肉",
                    ],
                    [
                      "equipment",
                      "厨房与厨具",
                      "例如：有电磁炉、空气炸锅，没有烤箱；锅比较小",
                    ],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <div className="settings-text-field" key={key}>
                    <div>
                      <label htmlFor={`preference-${key}`}>{label}</label>
                      {draft[key] && (
                        <button
                          className="text-button"
                          aria-label={`清空${label}`}
                          onClick={() => change(key, "")}
                        >
                          清空
                        </button>
                      )}
                    </div>
                    <textarea
                      id={`preference-${key}`}
                      rows={2}
                      maxLength={2000}
                      value={draft[key]}
                      placeholder={placeholder}
                      onChange={(e) => change(key, e.target.value)}
                    />
                  </div>
                ))}
                <p className="settings-note">
                  助手回答和配餐时会参考这些描述。本次聊天的明确要求优先，临时要求不会自动保存到这里。
                </p>
              </fieldset>
            )}
            {tab === "general" && (
              <fieldset disabled={busy} className="settings-fields">
                <div className="settings-row">
                  <div>
                    <label htmlFor="startup-page">启动页面</label>
                    <p>下次打开 Chefish 时，先看到这一页。</p>
                  </div>
                  <select
                    id="startup-page"
                    value={draft.startPage}
                    onChange={(e) =>
                      change(
                        "startPage",
                        e.target.value as AppPreferences["startPage"],
                      )
                    }
                  >
                    <option value="planner">每周菜单</option>
                    <option value="home">首页</option>
                    <option value="recipes">我的菜谱</option>
                    <option value="pantry">食材库存</option>
                    <option value="shopping">采购清单</option>
                  </select>
                </div>
                <div className="settings-group-label">助手对话</div>
                <div className="settings-field-heading">
                  <strong>发送消息的按键</strong>
                  <p>使用中文输入法选词时，不会触发发送。</p>
                </div>
                <div
                  className="settings-choices"
                  role="radiogroup"
                  aria-label="发送消息的按键"
                >
                  {(
                    [
                      ["enter", "Enter 发送", "Shift + Enter 换行"],
                      ["ctrlEnter", "Ctrl + Enter 发送", "Enter 换行"],
                    ] as const
                  ).map(([value, label, hint]) => (
                    <label
                      key={value}
                      className={draft.sendShortcut === value ? "chosen" : ""}
                    >
                      <input
                        type="radio"
                        name="send-shortcut"
                        checked={draft.sendShortcut === value}
                        onChange={() => change("sendShortcut", value)}
                      />
                      <span>
                        <strong>{label}</strong>
                        <small>{hint}</small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {tab === "assistant" &&
              (nativeMode ? (
                <AISettings />
              ) : (
                <p className="settings-note">
                  模型连接和密钥管理请在桌面版中设置。
                </p>
              ))}
            {tab === "data" && (
              <>
                <fieldset
                  disabled={busy || backupBusy}
                  className="settings-fields"
                >
                  <div className="settings-row">
                    <div>
                      <label htmlFor="automatic-backup">每日自动备份</label>
                      <p>
                        当天首次打开应用时保存一份，包含菜谱图片和全部厨房记录。
                      </p>
                    </div>
                    <label className="settings-switch">
                      <input
                        id="automatic-backup"
                        type="checkbox"
                        role="switch"
                        checked={draft.automaticBackup}
                        onChange={(e) =>
                          change("automaticBackup", e.target.checked)
                        }
                      />
                      <span aria-hidden="true" />
                    </label>
                  </div>
                </fieldset>
                <Backup
                  onRestored={async () => {
                    setDraft(preferences);
                    setMessage("");
                    return reload();
                  }}
                  onBusyChange={setBackupBusy}
                />
              </>
            )}
            {tab === "cloud" && (
              <Suspense fallback={<p role="status">正在加载云服务…</p>}>
                <CloudBackup
                  onBusyChange={setBackupBusy}
                  onRestored={async () => {
                    setMessage("");
                    return reload();
                  }}
                />
              </Suspense>
            )}
            {tab === "about" && (
              <div className="settings-about">
                <div className="settings-about-mark">
                  <img
                    className="app-logo"
                    src="/brand.svg"
                    alt=""
                    aria-hidden="true"
                  />
                </div>
                <h3>Chefish</h3>
                <p>日常的好滋味</p>
                <span className="settings-version">版本 {version}</span>
                <dl>
                  <div>
                    <dt>数据保存</dt>
                    <dd>菜谱、库存、菜单和对话保存在本机，可随备份恢复。</dd>
                  </div>
                  <div>
                    <dt>模型服务</dt>
                    <dd>
                      使用 AI
                      时，会将当前对话及相关厨房信息发送至你配置的模型服务。
                    </dd>
                  </div>
                  <div>
                    <dt>密钥</dt>
                    <dd>由 Windows 凭据管理器保存，普通备份不包含密钥。</dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
          <footer className="settings-footer">
            <div aria-live="polite">
              {error ? (
                <span role="alert" className="error">
                  {error}
                </span>
              ) : message ? (
                <span className="settings-saved" role="status">
                  <Check size={14} />
                  {message}
                </span>
              ) : (
                <span>
                  {dirty
                    ? "有未保存的修改"
                    : persistent
                      ? "设置保存在本机"
                      : "演示设置仅在本次会话中有效"}
                </span>
              )}
            </div>
            <button
              className="primary"
              disabled={!dirty || busy || backupBusy}
              onClick={() => void save()}
            >
              {busy ? "正在保存…" : "保存设置"}
            </button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
