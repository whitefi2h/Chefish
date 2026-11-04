import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Cloud,
  Sparkles,
  Utensils,
  Leaf,
  CalendarDays,
} from "lucide-react";
import { Modal } from "./components";
import { useDemo } from "./store";
import { tagsOf } from "./domain/recipeTags";
import { nativeMode, errorMessage } from "./services/kitchenClient";
import type { AIStatus } from "./services/aiClient";
import AISettings from "./AISettings";
import OnboardingSteward from "./OnboardingSteward";
import { useSteward } from "./services/steward";
import {
  cloudConfigured,
  cloudError,
  login,
  watchAccount,
  verifyEmail,
  refreshAccount,
} from "./services/cloudClient";
import "./onboarding.css";

const progressKey = "chefish:onboarding:v1";
const steps = [
  "欢迎",
  "模型连接",
  "饮食偏好",
  "常吃菜系",
  "厨房管家",
  "云账户",
  "准备好了",
];
interface Progress {
  step: number;
  status: "active" | "finished" | "dismissed";
  done: number[];
}
export function onboardingProgress(): Progress | null {
  try {
    const p = JSON.parse(localStorage.getItem(progressKey) ?? "null");
    return p && Number.isInteger(p.step) && p.step >= 0 && p.step < steps.length
      ? p
      : null;
  } catch {
    return null;
  }
}
interface PreferenceDraft {
  defaultServings: number | null;
  taste: string;
  restrictions: string;
  equipment: string;
  cuisineIds: string[];
}

function CloudStep({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [account, setAccount] = useState<{
    email: string | null;
    verified: boolean;
  } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(nativeMode && cloudConfigured);
  useEffect(() => {
    if (!nativeMode || !cloudConfigured) return;
    return watchAccount(
      (user) => {
        setAccount(
          user ? { email: user.email, verified: user.emailVerified } : null,
        );
        setLoading(false);
      },
      (e) => {
        setError(cloudError(e));
        setLoading(false);
      },
    );
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(cloudError(e));
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  if (!nativeMode || !cloudConfigured)
    return (
      <div className="onboarding-cloud-empty">
        <Cloud size={36} />
        <h3>先从本机厨房开始</h3>
        <p>
          {nativeMode
            ? "此版本尚未连接云服务，可以之后在账户与云端中设置。"
            : "账户注册与登录请在桌面版中完成。"}
        </p>
        <p>菜谱和库存仍保存在本机。</p>
      </div>
    );
  return (
    <div className="onboarding-account" aria-busy={busy || loading}>
      {loading ? (
        <p role="status">正在读取账户…</p>
      ) : account ? (
        <>
          <div className="onboarding-account-status">
            <Check size={20} />
            <div>
              <strong>{account.email}</strong>
              <p>
                {account.verified ? "邮箱已验证" : "请查看邮箱中的验证链接"}
              </p>
            </div>
          </div>
          {!account.verified && (
            <div className="actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await verifyEmail();
                    setMessage("验证邮件已发送");
                  })
                }
              >
                重发验证邮件
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const user = await refreshAccount();
                    setAccount({
                      email: user.email,
                      verified: user.emailVerified,
                    });
                  })
                }
              >
                我已验证
              </button>
            </div>
          )}
        </>
      ) : (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await login(email, password, register);
              setPassword("");
              setMessage(register ? "账户已创建，请验证邮箱" : "已登录");
            });
          }}
        >
          <div className="onboarding-account-tabs">
            <button
              type="button"
              aria-pressed={register}
              onClick={() => setRegister(true)}
            >
              创建账户
            </button>
            <button
              type="button"
              aria-pressed={!register}
              onClick={() => setRegister(false)}
            >
              已有账户
            </button>
          </div>
          <label>
            邮箱
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              required
              minLength={6}
              autoComplete={register ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "正在连接…" : register ? "注册并发送验证邮件" : "登录"}
          </button>
        </form>
      )}
      <p className="onboarding-hint">
        登录后不会自动上传或替换数据。厨房同步与备份可之后在设置里开启。
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}

export default function Onboarding({
  initialStep = 0,
  onClose,
}: {
  initialStep?: number;
  onClose: () => void;
}) {
  const {
    preferences,
    state,
    savePreferences,
    mutate,
    busy: storeBusy,
  } = useDemo();
  const [step, setStep] = useState(initialStep);
  const [done, setDone] = useState<number[]>(onboardingProgress()?.done ?? []);
  const [draft, setDraft] = useState(preferences);
  const tags = tagsOf(state).filter((t) => t.group === "cuisine" && !t.deleted);
  const [cuisineIds, setCuisineIds] = useState(
    tags.filter((t) => t.enabled).map((t) => t.id),
  );
  const [description, setDescription] = useState("");
  const [preferencePage, setPreferencePage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [childBusy, setChildBusy] = useState(false);
  const [childDirty, setChildDirty] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [saveTarget, setSaveTarget] = useState<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [changing, setChanging] = useState(false);
  const leaving = useRef<Animation | null>(null);
  const mounted = useRef(true);
  const locked = busy || childBusy || storeBusy;
  const kitchenSteward = useSteward();
  const [motion, setMotion] = useState(true);
  const direction = useRef(1);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      leaving.current?.cancel();
    };
  }, []);
  useLayoutEffect(() => {
    // Keep the outgoing page at opacity 0 until React has replaced it.
    // Cancelling before this commit can briefly reveal the old page again.
    leaving.current?.cancel();
    leaving.current = null;
    content.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
    if (!motion || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    // Reveal the heading, then the form. The frame and footer never move.
    const animations = Array.from(content.current?.children ?? []).map(
      (el, i) =>
        el.animate(
          [
            { opacity: 0, transform: `translateY(${direction.current * 3}px)` },
            { opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: 520,
            delay: Math.min(i * 45, 90),
            easing: "cubic-bezier(.22,.68,0,1)",
            fill: "backwards",
          },
        ),
    );
    return () => animations.forEach((animation) => animation.cancel());
  }, [step, preferencePage, motion]);
  async function changeView(
    apply: () => void,
    forward: boolean,
    animate: boolean,
  ) {
    if (leaving.current) return;
    const el = content.current;
    if (
      el &&
      animate &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setChanging(true);
      const animation = el.animate(
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: `translateY(${forward ? -2 : 2}px)` },
        ],
        { duration: 180, easing: "cubic-bezier(.4,0,.6,1)", fill: "forwards" },
      );
      leaving.current = animation;
      await animation.finished.catch(() => {});
      if (!mounted.current) return;
    }
    direction.current = forward ? 1 : -1;
    setMotion(animate);
    apply();
    setChanging(false);
  }
  const modelLoaded = useCallback(
    (s: AIStatus) => setModelReady(s.configured.includes(s.settings.provider)),
    [],
  );
  function move(next: number, completed = false, animate = true) {
    const finished = completed ? [...new Set([...done, step])] : done;
    try {
      localStorage.setItem(
        progressKey,
        JSON.stringify({ step: next, status: "active", done: finished }),
      );
    } catch {
      setError("流程进度未能保存，请重试。");
      return;
    }
    void changeView(
      () => {
        setDone(finished);
        setChildDirty(false);
        setError("");
        setStep(next);
      },
      next > step,
      animate,
    );
  }

  function close(status: Progress["status"] = "dismissed") {
    if (locked || changing) return;
    try {
      localStorage.setItem(progressKey, JSON.stringify({ step, status, done }));
      onClose();
    } catch {
      setError("流程进度未能保存，请重试。");
    }
  }
  async function next(animate: boolean) {
    if (locked || changing) return;
    if (step !== 2 && step !== 3) {
      move(step + 1, true, animate);
      return;
    }
    if (step === 2 && preferencePage === 0 && !description.trim()) {
      await changeView(() => setPreferencePage(1), true, animate);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (step === 2 && preferencePage === 0) {
        if (description.trim()) {
          const result = await invoke<PreferenceDraft>(
            "kitchen_onboarding_interpret",
            { description },
          );
          setDraft((d) => ({
            ...d,
            ...(result.defaultServings
              ? { defaultServings: result.defaultServings }
              : {}),
            ...(result.taste ? { taste: result.taste } : {}),
            ...(result.restrictions
              ? { restrictions: result.restrictions }
              : {}),
            ...(result.equipment ? { equipment: result.equipment } : {}),
          }));
          setCuisineIds((ids) => [...new Set([...ids, ...result.cuisineIds])]);
        }
        await changeView(() => setPreferencePage(1), true, animate);
        return;
      }
      if (step === 2 && !(await savePreferences(draft))) {
        setError("偏好未保存，请重试；填写内容仍在这里。");
        return;
      }
      if (step === 3) {
        const entries = tags
          .filter((t) => t.enabled !== cuisineIds.includes(t.id))
          .map((t) => ({ ...t, enabled: cuisineIds.includes(t.id) }));
        if (
          entries.length &&
          !(await mutate(
            {
              type: "save_recipe_tag_definitions",
              expected_revision: state.dataRevision ?? "",
              entries,
            },
            (s) => ({
              ...s,
              recipeTags: tagsOf(s).map(
                (t) => entries.find((e) => e.id === t.id) ?? t,
              ),
            }),
            "",
          ))
        ) {
          setError("菜系未保存，请重试。");
          return;
        }
      }
      move(step + 1, true, animate);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const titles = [
    "把厨房，设置成你习惯的样子。",
    "连接你习惯的模型",
    "你习惯怎么吃？",
    "把喜欢的风味留下来",
    "让管家照看一些小事",
    "让厨房随你同行",
    "你的厨房，准备好了。",
  ];
  const intros = [
    "每一步都可跳过，之后可以在设置里调整。",
    "",
    "告诉我们人数、口味和厨具，菜单会更合心意。",
    "",
    "",
    "登录云账户，之后可在不同电脑上接着用。",
    "从想吃的一道菜开始，安排今天的好滋味。",
  ];
  return (
    <Modal
      title="设置我的厨房"
      animateEntrance={false}
      onClose={() => close()}
      className={`onboarding-dialog onboarding-step-${step} ${motion ? "onboarding-motion" : ""}`}
      headerLeading={
        <img className="onboarding-brand" src="/brand.svg" alt="" />
      }
    >
      {step > 0 && step < 6 && (
        <div
          className="onboarding-progress"
          aria-label={`初始化进度，第 ${step} 步，共 5 步`}
        >
          <span>
            {String(step).padStart(2, "0")} <small>/ 05</small>
          </span>
          <div>
            {steps.slice(1, 6).map((name, i) => (
              <span
                key={name}
                className={i < step ? "active" : ""}
                title={name}
              />
            ))}
          </div>
          <small>{steps[step]}</small>
        </div>
      )}
      <div
        className="onboarding-content"
        ref={content}
        aria-busy={locked || changing}
        inert={changing}
      >
        {step === 6 && (
          <div className="onboarding-success" aria-hidden="true">
            <svg viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="29" />
              <path d="m19 32 9 9 18-19" pathLength="1" />
            </svg>
          </div>
        )}
        <header>
          <h2 ref={heading} tabIndex={-1}>
            {step === 2 && preferencePage === 1
              ? "核对一下你的饮食偏好"
              : titles[step]}
          </h2>
          {intros[step] && !(step === 2 && preferencePage === 1) && (
            <p>
              {step === 2
                ? "随心说说人数、口味和厨具，也可以直接手动填写。"
                : intros[step]}
            </p>
          )}
        </header>
        {step === 0 && (
          <div className="onboarding-welcome">
            {(
              [
                [Sparkles, "连接厨房助手", "用你熟悉的模型，开始对话。"],
                [Utensils, "留下饮食偏好", "人数、口味，还有常吃的风味。"],
                [
                  CalendarDays,
                  "选择需要的照料",
                  "菜单、库存和新菜灵感，按需开启。",
                ],
              ] as const
            ).map(([Icon, title, detail]) => (
              <div key={title}>
                <span>
                  <Icon size={20} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        {step === 1 &&
          (nativeMode ? (
            <AISettings
              compact
              saveTarget={saveTarget}
              onReady={modelLoaded}
              onDirtyChange={setChildDirty}
              onBusyChange={setChildBusy}
              onSaved={(status) => {
                modelLoaded(status);
                move(2, true);
              }}
            />
          ) : (
            <p className="onboarding-hint">
              模型配置请在桌面版中完成。演示中可以继续体验其余步骤。
            </p>
          ))}
        {step === 2 && (
          <>
            {preferencePage === 0 ? (
              <div className="onboarding-natural">
                <label htmlFor="onboarding-description">
                  <Sparkles size={16} /> 随心说说你的习惯
                </label>
                <textarea
                  id="onboarding-description"
                  rows={5}
                  maxLength={4000}
                  placeholder="比如：平常两个人吃饭，不吃香菜，喜欢川菜；只有电磁炉和空气炸锅。"
                  value={description}
                  disabled={locked}
                  onChange={(e) => setDescription(e.target.value)}
                />
                <small>
                  点击“识别并继续”后，这段描述将发送给已配置的模型；下一页可以核对和修改。
                </small>
              </div>
            ) : (
              <div className="onboarding-preferences form-stack">
                <label>
                  平常用餐人数
                  <input
                    type="number"
                    min={1}
                    max={12}
                    disabled={locked}
                    value={draft.defaultServings}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        defaultServings: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <div className="onboarding-meals">
                  <strong>周菜单显示的餐次</strong>
                  <div>
                    {(
                      [
                        ["showBreakfast", "早餐"],
                        ["showLunch", "午餐"],
                        ["showDinner", "晚餐"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={draft[key]}
                          onChange={(e) =>
                            setDraft({ ...draft, [key]: e.target.checked })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
                {(
                  [
                    ["taste", "口味偏好", "喜欢怎样的口味"],
                    ["restrictions", "忌口与饮食要求", "不喜欢、不能吃的食材"],
                    ["equipment", "厨房与厨具", "你有哪些厨具"],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <div
                    key={key}
                    className={`onboarding-field onboarding-field-${key}`}
                  >
                    <label htmlFor={`onboarding-${key}`}>{label}</label>
                    <textarea
                      id={`onboarding-${key}`}
                      disabled={locked}
                      rows={2}
                      maxLength={2000}
                      value={draft[key]}
                      placeholder={placeholder}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {step === 3 && (
          <div className="onboarding-cuisines">
            {tags
              .filter(
                (t) =>
                  !t.broaderIds.some((id) => tags.some((p) => p.id === id)),
              )
              .map((root) => {
                const children = tags.filter((t) =>
                  t.broaderIds.includes(root.id),
                );
                const chip = (t: typeof root) => (
                  <button
                    key={t.id}
                    disabled={locked}
                    data-tag-group="cuisine"
                    aria-pressed={cuisineIds.includes(t.id)}
                    onClick={() =>
                      setCuisineIds((ids) =>
                        ids.includes(t.id)
                          ? ids.filter((id) => id !== t.id)
                          : [...ids, t.id],
                      )
                    }
                  >
                    {cuisineIds.includes(t.id) && <Check size={14} />} {t.label}
                  </button>
                );
                return (
                  <section key={root.id}>
                    {chip(root)}
                    {children.length > 0 && (
                      <details>
                        <summary>
                          地方风味 <ChevronDown size={14} />
                        </summary>
                        <div>{children.map(chip)}</div>
                      </details>
                    )}
                  </section>
                );
              })}
            <p className="onboarding-hint">
              随时可以在“管理标签”里添加、关闭或删除标签。
            </p>
          </div>
        )}
        {step === 4 && (
          <OnboardingSteward
            onDirtyChange={setChildDirty}
            saveTarget={saveTarget}
            onBusyChange={setChildBusy}
            onSaved={() => move(5, true)}
          />
        )}
        {step === 5 && <CloudStep onBusyChange={setChildBusy} />}
        {step === 6 && (
          <div className="onboarding-finish">
            <div>
              <Utensils size={17} />
              <strong>用餐习惯</strong>
              <span>
                {preferences.defaultServings} 人用餐
                {preferences.taste ? ` · ${preferences.taste}` : ""}
              </span>
            </div>
            <div>
              <Leaf size={17} />
              <strong>常吃风味</strong>
              <span>
                {tags
                  .filter((t) => t.enabled)
                  .map((t) => t.label)
                  .join("、") || "留待之后选择"}
              </span>
            </div>
            <div>
              <Sparkles size={17} />
              <strong>厨房管家</strong>
              <span>
                {kitchenSteward?.settings.enabled ? "已开启" : "需要时再开启"}
              </span>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="error onboarding-error">
            {error}
          </p>
        )}
      </div>
      <footer className="onboarding-footer" inert={changing}>
        <div>
          {step > 0 && step < 6 && (
            <button
              disabled={locked}
              onClick={(e) => {
                if (step === 2 && preferencePage === 1) {
                  void changeView(
                    () => setPreferencePage(0),
                    false,
                    e.detail !== 0,
                  );
                } else move(step - 1, false, e.detail !== 0);
              }}
            >
              <ArrowLeft size={15} />
              上一步
            </button>
          )}
          <button
            className="text-button"
            disabled={locked}
            onClick={(e) =>
              step === 0 || step === 6
                ? close()
                : step === 2 && preferencePage === 0
                  ? void changeView(
                      () => setPreferencePage(1),
                      true,
                      e.detail !== 0,
                    )
                  : move(step + 1, false, e.detail !== 0)
            }
          >
            {step === 0
              ? "稍后设置"
              : step === 6
                ? "关闭"
                : step === 2 && preferencePage === 0
                  ? "跳过描述"
                  : "跳过这步"}
          </button>
        </div>
        <div>
          <div
            ref={setSaveTarget}
            hidden={(step !== 1 && step !== 4) || !childDirty}
          />
          {step === 6 ? (
            <button
              className="primary"
              disabled={locked}
              onClick={() => close("finished")}
            >
              进入我的厨房
              <ArrowRight size={15} />
            </button>
          ) : (step === 1 || step === 4) && childDirty ? null : (
            <button
              className="primary"
              disabled={
                locked ||
                ((step === 1 || step === 4) && childDirty) ||
                (step === 1 && nativeMode && !modelReady) ||
                (step === 2 &&
                  preferencePage === 1 &&
                  (!Number.isInteger(draft.defaultServings) ||
                    draft.defaultServings < 1 ||
                    draft.defaultServings > 12))
              }
              onClick={(e) => void next(e.detail !== 0)}
            >
              {step === 0
                ? "开始设置"
                : step === 2 && preferencePage === 0
                  ? busy
                    ? "正在识别…"
                    : description.trim()
                      ? "识别并继续"
                      : "手动填写"
                  : step === 2 || step === 3
                    ? "保存并继续"
                    : "继续"}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </footer>
    </Modal>
  );
}
