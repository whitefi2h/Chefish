import { confirmAction } from "./services/dialogs";
import { invoke } from "@tauri-apps/api/core";
import type { AssistantProposal } from "./services/aiClient";
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
  inbox = false,
  onShowAll,
}: {
  onSelect: (item: StewardItem) => void;
  history?: boolean;
  inbox?: boolean;
  onShowAll?: () => void;
}) {
  const state = useSteward();
  const items =
    state?.items.filter((i) => history || i.status === "open") ?? [];
  if (!items.length)
    return history || inbox ? (
      <p className="assistant-history-empty">
        {inbox ? "暂无待处理的主动消息" : "最近 30 天没有任务会话"}
      </p>
    ) : null;
  return (
    <nav
      className={
        history || inbox ? "assistant-history-list" : "steward-banners"
      }
      aria-label={history ? "历史任务会话" : "厨房任务"}
    >
      {(history || inbox ? items : items.slice(0, 3)).map((item) => {
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
              <strong>
                {inbox && item.unread && (
                  <span className="task-unread-dot" aria-label="未读" />
                )}
                {item.title}
              </strong>
              <span>{summary(item)}</span>
            </span>
            <span className={`task-banner-status ${item.status}`}>
              {status}
            </span>
            <ChevronRight size={15} />
          </button>
        );
      })}
      {!history && !inbox && items.length > 3 && (
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
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [forecast, setForecast] = useState<ShoppingForecast | null>(null);
  const [previewRevision, setPreviewRevision] = useState("");
  const [planChanges, setPlanChanges] = useState<
    { section: string; before: string; after: string }[]
  >([]);
  const meals = new Map<string, NonNullable<typeof draft>["slots"]>();
  for (const slot of draft?.slots ?? []) {
    const key = slot.day + "/" + slot.meal;
    const group = meals.get(key) ?? [];
    group.push(slot);
    meals.set(key, group);
  }
  const pendingItems =
    forecast?.items.filter(
      (item) => !item.hidden && Number(item.remaining) > 0,
    ) ?? [];
  const changeSummary = [
    ["新增", planChanges.filter((c) => !c.before && c.after).length],
    ["调整", planChanges.filter((c) => c.before && c.after).length],
    ["移除", planChanges.filter((c) => c.before && !c.after).length],
  ]
    .filter(([, count]) => Number(count) > 0)
    .map(([label, count]) => `${label} ${count} 项安排`)
    .join("、");
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
        const result = await steward.reply(draft, message);
        setDraft(result);
        setProposal(result.proposal ?? null);
        setConfirmDelete(false);
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
                {!!m.candidates?.length && (
                  <div className="weekly-search-results">
                    {m.candidates.map((c) => (
                      <article key={c.url}>
                        <strong>{c.title}</strong>
                        {c.author && <small>{c.author}</small>}
                        <button onClick={() => onImport(c.url)}>
                          读取原文并整理
                        </button>
                        <button
                          className="text-button"
                          onClick={() =>
                            void invoke("kitchen_open_recipe", {
                              url: c.url,
                            }).catch((e) => setError(errorMessage(e)))
                          }
                        >
                          查看来源
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {proposal && (
            <section className="assistant-proposal" aria-label="厨房操作提案">
              <h3>待确认的厨房操作</h3>
              {proposal.changes.map((change, i) => (
                <div key={i}>
                  <strong>{change.section}</strong>
                  <p>{change.after || `移除：${change.before}`}</p>
                </div>
              ))}
              {proposal.destructive && (
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={confirmDelete}
                    onChange={(e) => setConfirmDelete(e.target.checked)}
                  />
                  再次确认删除、移除或丢弃的内容
                </label>
              )}
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || (proposal.destructive && !confirmDelete)}
                  onClick={() =>
                    void act(async () => {
                      await invoke("kitchen_ai_apply", {
                        proposalId: proposal.id,
                        confirmDelete,
                      });
                      setProposal(null);
                    })
                  }
                >
                  同意并执行
                </button>
                <button disabled={busy} onClick={() => setProposal(null)}>
                  拒绝提案
                </button>
              </div>
            </section>
          )}
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
                  {[...meals.entries()]
                    .sort(
                      ([, a], [, b]) =>
                        a[0].day.localeCompare(b[0].day) ||
                        ["早餐", "午餐", "晚餐"].indexOf(a[0].meal) -
                          ["早餐", "午餐", "晚餐"].indexOf(b[0].meal),
                    )
                    .map(([key, slots]) => (
                      <tr key={key}>
                        <td>
                          {slots[0].day}
                          <small>{slots[0].meal}</small>
                        </td>
                        <td colSpan={2}>
                          <ul className="steward-meal-dishes">
                            {slots.map((slot, i) => (
                              <li key={i}>
                                <span>
                                  {slot.customTitle ??
                                    kitchen.recipes.find(
                                      (r) =>
                                        r.revisionId === slot.recipeRevisionId,
                                    )?.name ??
                                    "原菜谱版本"}
                                  {slot.planId && <small>已有安排</small>}
                                </span>
                                <span>{slot.servings} 人</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          )}
          {forecast && (
            <section className="steward-menu-preview" aria-label="草稿采购预览">
              <h3>采购需求{draft?.status === "confirmed" ? "" : "预览"}</h3>
              <p className="hint">
                {pendingItems.length
                  ? `还需采购 ${pendingItems.length} 种食材`
                  : "暂无待买食材"}
              </p>
              <ul className="steward-shopping-list">
                {pendingItems.map((item, n) => (
                  <li key={n}>
                    <span>{item.name}</span>
                    <strong>
                      {item.estimated ? "约 " : ""}
                      {quantityText(item.remaining)} {item.unit}
                    </strong>
                    {item.review && <small>请确认用量</small>}
                  </li>
                ))}
              </ul>
              {changeSummary && (
                <p className="hint">确认后将{changeSummary}。</p>
              )}
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
              正在处理…
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
                placeholder="发消息、搜索新菜，或调整这周菜单…"
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
                <p className="hint">
                  {v.metadata?.estimatedExpires &&
                    ` · 预计到期 ${v.metadata.estimatedExpires}`}
                  {v.metadata?.suggestedLocation &&
                    ` · 推测库位 ${v.metadata.suggestedLocation}`}{" "}
                  {v.metadata?.basis?.replaceAll("复查", "到期")}
                </p>
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
              onClick={async () => {
                if (
                  await confirmAction("撤销这批自动整理？后续修改会阻止撤销。")
                )
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
import { quantityText } from "./domain/quantity";
