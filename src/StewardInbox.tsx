import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  Lightbulb,
  Sparkles,
} from "lucide-react";
import { useDemo } from "./store";
import { errorMessage } from "./services/kitchenClient";
import {
  refreshSteward,
  steward,
  useSteward,
  type StewardDraft,
  type StewardItem,
} from "./services/steward";
import type { ShoppingForecast } from "./domain/shopping";

function summary(item: StewardItem) {
  if (item.kind === "maintenance" && item.payload.items)
    return item.payload.questions?.length
      ? `已完成自动整理，${item.payload.questions.length} 项食材需要补充。`
      : `已自动整理 ${item.payload.items.length} 项厨房信息。`;
  if (item.kind === "recommendations")
    return `为你找到 ${item.payload.candidates?.length ?? 0} 道新菜，看看有没有想试的。`;
  return item.body;
}
export function StewardTaskBanners({
  onSelect,
  history = false,
  onShowAll,
}: {
  onSelect: (item: StewardItem) => void;
  history?: boolean;
  onShowAll?: () => void;
}) {
  const state = useSteward();
  const items =
    state?.items.filter((i) => history || i.status === "open") ?? [];
  if (!items.length)
    return history ? (
      <p className="assistant-history-empty">最近 30 天没有任务会话</p>
    ) : null;
  return (
    <nav
      className={history ? "assistant-history-list" : "steward-banners"}
      aria-label={history ? "历史任务会话" : "厨房任务"}
    >
      {(history ? items : items.slice(0, 3)).map((item) => {
        const Icon =
          item.kind === "weekly"
            ? CalendarDays
            : item.kind === "recommendations"
              ? Lightbulb
              : Sparkles;
        const status =
          item.status !== "open"
            ? "已完成"
            : item.kind === "weekly"
              ? "等你回复"
              : item.kind === "maintenance" && !item.payload.questions?.length
                ? "已整理"
                : "待查看";
        return (
          <button
            key={item.id}
            type="button"
            className="task-banner"
            aria-label={`${item.title}，查看任务`}
            onClick={() => onSelect(item)}
          >
            <span className={`task-banner-icon ${item.kind}`}>
              <Icon size={18} strokeWidth={1.6} />
            </span>
            <span className="task-banner-copy">
              <strong>{item.title}</strong>
              <span>{summary(item)}</span>
            </span>
            <span className={`task-banner-status ${item.status}`}>
              {status}
            </span>
            <ChevronRight size={15} />
          </button>
        );
      })}
      {!history && items.length > 3 && (
        <button className="task-more" onClick={onShowAll}>
          查看其余 {items.length - 3} 项任务 <ChevronRight size={13} />
        </button>
      )}
    </nav>
  );
}
export default function StewardInbox({
  item,
  onImport,
  onDiscuss,
}: {
  item: StewardItem;
  onImport: (url: string) => void;
  onDiscuss: (text: string) => void;
}) {
  const { state: kitchen, reload, reloadForecast, preferences } = useDemo();
  const [draft, setDraft] = useState<StewardDraft | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forecast, setForecast] = useState<ShoppingForecast | null>(null);
  const [previewRevision, setPreviewRevision] = useState("");
  const [planChanges, setPlanChanges] = useState<
    { section: string; before: string; after: string }[]
  >([]);
  const [alias, setAlias] = useState("");
  const [canonical, setCanonical] = useState("");
  const [factor, setFactor] = useState("");
  const [fromUnit, setFromUnit] = useState("盒");
  const [toUnit, setToUnit] = useState("g");
  const scroll = useRef<HTMLDivElement>(null);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refreshSteward();
      await reload();
      await reloadForecast();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let alive = true;
    if (item.kind === "weekly") {
      setBusy(true);
      steward
        .draft(item.payload.draftId, item.payload.weekStart)
        .then((d) => {
          if (alive) setDraft(d);
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }
    const status =
      item.kind !== "weekly" && !item.payload.questions?.length
        ? "done"
        : "read";
    void steward
      .mark(item.id, status)
      .then(refreshSteward)
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [
    item.id,
    item.kind,
    item.payload.draftId,
    item.payload.weekStart,
    item.payload.questions?.length,
  ]);
  useEffect(() => {
    if (scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [draft?.messages.length, forecast, busy]);
  async function reply() {
    if (!draft || !input.trim() || busy) return;
    const message = input;
    setInput("");
    await act(async () => {
      try {
        setDraft(await steward.reply(draft, message));
        setForecast(null);
      } catch (e) {
        setDraft(await steward.draft(draft.id));
        setInput(message);
        throw e;
      }
    });
  }
  if (item.kind === "weekly")
    return (
      <section className="steward-weekly-chat" aria-label="每周菜单草稿">
        <div className="assistant-scroll" ref={scroll}>
          <div className="chat-message assistant">{item.body}</div>
          <div className="steward-messages">
            {draft?.messages.map((m, i) => (
              <div key={i} className={`assistant-turn ${m.role}`}>
                <div className={`chat-message ${m.role}`}>{m.content}</div>
              </div>
            ))}
          </div>
          {!!draft?.slots.length && (
            <section className="steward-menu-preview">
              <header>
                <h3>{draft.weekStart} 开始的一周</h3>
                <span className="proposal-state">
                  {draft.status === "confirmed" ? "已确认" : "草稿"}
                </span>
              </header>
              <table>
                <thead>
                  <tr>
                    <th>日期与餐次</th>
                    <th>菜式</th>
                    <th>人数</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.slots.map((s, i) => (
                    <tr key={i}>
                      <td>
                        {s.day}
                        <small>{s.meal}</small>
                      </td>
                      <td>
                        {s.customTitle ??
                          kitchen.recipes.find(
                            (r) => r.revisionId === s.recipeRevisionId,
                          )?.name ??
                          "原菜谱版本"}
                        {s.planId && <small>已有安排</small>}
                      </td>
                      <td>{s.servings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {forecast && (
            <section className="steward-menu-preview" aria-label="草稿采购预览">
              <h3>采购需求{draft?.status === "confirmed" ? "" : "预览"}</h3>
              {planChanges.map((c, i) => (
                <div key={i}>
                  <strong>{c.section}</strong>
                  <p className="hint">原先：{c.before || "无"}</p>
                  <p>{c.after || "无"}</p>
                </div>
              ))}
              {forecast.items
                .filter((i) => !i.hidden && Number(i.remaining) > 0)
                .map((i, n) => (
                  <div key={n}>
                    <p>
                      {i.name} · {i.remaining} {i.unit}
                      {i.estimated ? " · 含估算" : ""}
                      {i.review ? " · 待核对" : ""}
                    </p>
                    {i.estimates?.map((e, j) => (
                      <p className="hint" key={j}>
                        {e}
                      </p>
                    ))}
                  </div>
                ))}
              {forecast.reviewNotes.map((n, i) => (
                <p className="hint" key={i}>
                  {n}
                </p>
              ))}
            </section>
          )}
          {draft?.status === "confirmed" && (
            <p className="steward-confirmed">
              <Check size={15} /> 菜单已确认，采购需求已更新
            </p>
          )}
          {error && (
            <div className="assistant-error" role="alert">
              <p>{error}</p>
              {draft && (
                <button
                  onClick={() =>
                    void act(async () => {
                      setDraft(await steward.rebase(draft));
                      setForecast(null);
                    })
                  }
                >
                  按最新菜单重新核对
                </button>
              )}
            </div>
          )}
          {busy && (
            <p role="status" className="assistant-working">
              正在整理你的菜单…
            </p>
          )}
        </div>
        {draft?.status === "draft" && (
          <div className="weekly-compose-wrap">
            {!!draft.slots.length && (
              <div className="weekly-plan-actions">
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const preview = await steward.preview(draft.id);
                      setForecast(preview.after);
                      setPreviewRevision(preview.expectedRevision);
                      setPlanChanges(preview.changes ?? []);
                    })
                  }
                >
                  核对菜单与采购
                </button>
                <button
                  className="primary"
                  disabled={busy || !forecast}
                  onClick={() =>
                    void act(async () => {
                      setForecast(
                        await steward.confirm(draft, previewRevision),
                      );
                      setDraft(await steward.draft(draft.id));
                    })
                  }
                >
                  确认菜单并生成采购需求
                </button>
              </div>
            )}
            <form
              className="assistant-compose"
              onSubmit={(e) => {
                e.preventDefault();
                void reply();
              }}
            >
              <textarea
                aria-label="告诉管家这周怎么安排"
                rows={2}
                maxLength={8000}
                value={input}
                disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    (preferences.sendShortcut === "enter" ||
                      e.ctrlKey ||
                      e.metaKey) &&
                    !e.nativeEvent.isComposing &&
                    e.nativeEvent.keyCode !== 229
                  ) {
                    e.preventDefault();
                    void reply();
                  }
                }}
                placeholder="说说想吃什么，或继续调整这份菜单…"
              />
              <div className="assistant-compose-actions">
                <span>菜单确认后才会保存到本周安排</span>
                <button
                  type="submit"
                  aria-label="生成或调整草稿"
                  className="primary assistant-send"
                  disabled={busy || !input.trim()}
                >
                  <ArrowUp size={18} />
                </button>
              </div>
            </form>
          </div>
        )}
      </section>
    );
  return (
    <section className="steward-task-detail">
      <div className="chat-message assistant">
        <p>
          {item.kind === "maintenance" && item.payload.items
            ? summary(item)
            : item.body}
        </p>
        {!!item.payload.questions?.length && (
          <div>
            <ul>
              {item.payload.questions.map((q, i) => (
                <li key={i}>{q.question}</li>
              ))}
            </ul>
            <button
              disabled={busy}
              onClick={() =>
                onDiscuss(
                  `需要补充的食材：${item.payload.questions!.map((q) => q.question).join("；")}\n我的补充：`,
                )
              }
            >
              一次补充这些食材
            </button>
          </div>
        )}
        {!!item.payload.items?.length && (
          <details>
            <summary>
              查看自动整理明细（{item.payload.items.length} 项）
            </summary>
            {item.payload.items?.map((v, i) => (
              <div key={i}>
                <strong>{v.name}</strong>
                <button
                  disabled={busy}
                  onClick={() => {
                    const tags = window.prompt(
                      "修改标签，用逗号分隔；留空可清除",
                      v.metadata?.tags?.join("，") ?? "",
                    );
                    if (tags !== null)
                      void act(() =>
                        steward.tags(
                          v.entityKind,
                          v.entityId,
                          tags
                            .split(/[,，、]/)
                            .map((t) => t.trim())
                            .filter(Boolean),
                        ),
                      );
                  }}
                >
                  修改标签
                </button>
                <p className="hint">
                  {v.metadata?.tags?.join(" · ")}
                  {v.metadata?.reviewOn && ` · 预计复查 ${v.metadata.reviewOn}`}
                  {v.metadata?.suggestedLocation &&
                    ` · 推测库位 ${v.metadata.suggestedLocation}`}{" "}
                  {v.metadata?.basis}
                </p>
                {v.entityKind === "lot" && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      const date = window.prompt(
                        "预计复查日期（YYYY-MM-DD），留空清除；不会修改真实到期日",
                        v.metadata?.reviewOn ?? "",
                      );
                      if (date !== null)
                        void act(() =>
                          steward.reviewDate(v.entityId, date.trim() || null),
                        );
                    }}
                  >
                    修正预计复查日期
                  </button>
                )}
              </div>
            ))}
          </details>
        )}
        {item.payload.candidates?.map((c) => (
          <div key={c.url}>
            <strong>{c.title}</strong>
            {c.author && <small> · {c.author}</small>}
            <p>{c.reason}</p>
            <p className="hint">{c.verification}</p>
            <div className="steward-actions">
              <button disabled={busy} onClick={() => onImport(c.url)}>
                读取原文并整理
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const { invoke } = await import("@tauri-apps/api/core");
                    await invoke("kitchen_open_recipe", { url: c.url });
                  })
                }
              >
                查看来源
              </button>
            </div>
          </div>
        ))}
        {item.status === "open" &&
          item.payload.operations?.map((op, i) => (
            <button
              key={op}
              disabled={busy}
              onClick={() => {
                if (window.confirm("撤销这批自动整理？后续修改会阻止撤销。"))
                  void act(() => steward.undo(op));
              }}
            >
              撤销第 {i + 1} 批整理
            </button>
          ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <details className="steward-item">
        <summary>保存食材别名或确认的规格</summary>
        <p className="hint">
          仅在你确认是同一种食材时保存。包装换算仅适用于相应食材与规格，例如某种食材的每盒净重。不同规格应分开记录。
        </p>
        <label>
          原名称
          <input value={alias} onChange={(e) => setAlias(e.target.value)} />
        </label>
        <label>
          对应食材
          <select
            value={canonical}
            onChange={(e) => setCanonical(e.target.value)}
          >
            <option value="">选择已有食材</option>
            {kitchen.ingredients.map((i) => (
              <option key={i.id} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          换算（可选）
          <div>
            1{" "}
            <select
              value={fromUnit}
              onChange={(e) => setFromUnit(e.target.value)}
            >
              {["盒", "个", "片", "g", "ml"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>{" "}
            ={" "}
            <input
              type="number"
              min="0.000001"
              step="any"
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
            />
            <select value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
              {["g", "ml", "个", "片", "盒"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </div>
        </label>
        <button
          disabled={busy || !alias.trim() || !canonical}
          onClick={() =>
            void act(async () => {
              await steward.rule(
                alias.trim(),
                canonical,
                factor ? fromUnit : null,
                factor ? toUnit : null,
                factor || null,
              );
              setAlias("");
              setFactor("");
            })
          }
        >
          保存对应关系
        </button>
      </details>
    </section>
  );
}
