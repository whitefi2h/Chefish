import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings, Send, RotateCcw, ExternalLink } from "lucide-react";
import { Modal } from "./components";
import { useDemo } from "./store";
import RecipeEditor, { type RecipeDraft } from "./RecipeEditor";
import { recipeTextFromHtml } from "./domain/recipeImport";
import {
  aiStatus,
  organizeRecipe,
  selectedUrl,
  type Candidate,
  type AssistantProposal,
  type ChatMessage,
  type Route,
} from "./services/aiClient";
import { requestedSearchCount } from "./domain/assistantChat";
import { errorMessage } from "./services/kitchenClient";

export default function KitchenAssistant({
  onClose,
  onNavigate,
  onOpenSettings,
}: {
  onClose: () => void;
  onNavigate?: (page: string) => void;
  onOpenSettings: () => void;
}) {
  const { state, weekStart, reload, reloadForecast, preferences } = useDemo();
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [copy, setCopy] = useState<{ title: string; text: string } | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState(false);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [pendingUrl, setPendingUrl] = useState("");
  const [pasted, setPasted] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const saveQueue = useRef(Promise.resolve());
  const [lastQuery, setLastQuery] = useState("");
  const [lastLimit, setLastLimit] = useState(3);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    invoke<{
      messages: ChatMessage[];
      candidates: Candidate[];
      input: string;
      pendingUrl: string;
      pasted: string;
      lastQuery?: string;
      lastLimit?: number;
      proposal?: AssistantProposal | null;
    }>("kitchen_ai_history")
      .then((h) => {
        if (!alive) return;
        if (!Array.isArray(h.messages) || !Array.isArray(h.candidates))
          throw new Error("聊天记录格式无效");
        const restored = [...h.messages];
        if (
          h.candidates.length &&
          !restored.some((m) => m.candidates?.length)
        ) {
          const ix = restored
            .map(
              (m) =>
                m.role === "assistant" &&
                /找到\s*\d+\s*个候选|站内与网页搜索|网页搜索找到/.test(
                  m.content,
                ),
            )
            .lastIndexOf(true);
          if (ix >= 0)
            restored[ix] = { ...restored[ix], candidates: h.candidates };
        }
        if (
          h.proposal &&
          !restored.some((m) => m.proposal?.id === h.proposal?.id)
        ) {
          const ix = restored
            .map((m) => m.role === "assistant")
            .lastIndexOf(true);
          if (ix >= 0) restored[ix] = { ...restored[ix], proposal: h.proposal };
        }
        setMessages(restored);
        setCandidates(h.candidates);
        setInput(h.input ?? "");
        setPendingUrl(h.pendingUrl ?? "");
        setPasted(h.pasted ?? "");
        setLastQuery(h.lastQuery ?? "");
        setLastLimit(h.lastLimit ?? 3);
        setProposal(h.proposal ?? null);
        setHistoryReady(true);
        setHistoryError("");
      })
      .catch((e) => {
        if (alive) setHistoryError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [historyAttempt]);
  useEffect(() => {
    if (!historyReady) return;
    const history = {
      messages,
      candidates,
      input,
      pendingUrl,
      pasted,
      lastQuery,
      lastLimit,
      proposal,
    };
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(() => invoke<void>("kitchen_ai_save_history", { history }))
      .then(() => setHistoryError(""))
      .catch((e) => setHistoryError(errorMessage(e)));
  }, [
    historyReady,
    messages,
    candidates,
    input,
    pendingUrl,
    pasted,
    lastQuery,
    lastLimit,
    proposal,
  ]);
  async function clearHistory() {
    if (
      !window.confirm(
        "清除本机保存的聊天记录、候选和输入草稿？已保存的菜谱不受影响。",
      )
    )
      return;
    try {
      await saveQueue.current;
      await invoke("kitchen_ai_save_history", {
        history: {
          messages: [],
          candidates: [],
          input: "",
          pendingUrl: "",
          pasted: "",
          lastQuery: "",
        },
      });
      setProposal(null);
      setDeleteConfirm(false);
      setMessages([]);
      setCandidates([]);
      setInput("");
      setPendingUrl("");
      setPasted("");
      setLastQuery("");
      setHistoryReady(true);
      setHistoryError("");
      setError("");
    } catch (e) {
      setHistoryError(errorMessage(e));
    }
  }
  async function verifyCandidate(candidate: Candidate) {
    try {
      const result = await invoke<Partial<Candidate>>("kitchen_ai_verify", {
        url: candidate.url,
      });
      setCandidates((rows) =>
        rows.map((r) =>
          r.id === candidate.id
            ? {
                ...r,
                ...result,
                verification: "verified",
                verificationError: undefined,
              }
            : r,
        ),
      );
      setMessages((m) =>
        m.map((v) => ({
          ...v,
          candidates: v.candidates?.map((r) =>
            r.id === candidate.id
              ? {
                  ...r,
                  ...result,
                  verification: "verified",
                  verificationError: undefined,
                }
              : r,
          ),
        })),
      );
      return true;
    } catch (e) {
      setCandidates((rows) =>
        rows.map((r) =>
          r.id === candidate.id
            ? {
                ...r,
                verification: "unavailable",
                verificationError: errorMessage(e),
              }
            : r,
        ),
      );
      setMessages((m) =>
        m.map((v) => ({
          ...v,
          candidates: v.candidates?.map((r) =>
            r.id === candidate.id
              ? {
                  ...r,
                  verification: "unavailable",
                  verificationError: errorMessage(e),
                }
              : r,
          ),
        })),
      );
      return !(
        typeof e === "object" &&
        e !== null &&
        "code" in e &&
        e.code === "SITE_RATE_LIMIT"
      );
    }
  }
  async function runSearch(query: string, limit = 3) {
    setLastQuery(query);
    setLastLimit(limit);
    setStage("正在搜索下厨房，暂时失败时会自动重试…");
    const rows = (
      await invoke<Candidate[]>("kitchen_ai_search", { query, limit })
    )
      .slice(0, limit)
      .map((r) =>
        r.source === "xiachufang" ? { ...r, verification: "site" } : r,
      );
    setCandidates(rows);
    setPendingUrl("");
    setPasted("");
    setMessages((m) => [
      ...m,
      {
        role: "assistant",
        candidates: rows,
        content: rows.length
          ? rows[0]?.source === "xiachufang"
            ? `找到 ${rows.length} 个候选，来自下厨房站内搜索，按当前结果页的做过人数排序。已读取站内作者、评分和做过人数；整理时读取正文。可说“整理第二个”。`
            : `下厨房站内搜索暂未取得结果，已改用网页搜索找到 ${rows.length} 个候选。这批结果不是站内人气排名，正在自动核验。`
          : "站内与网页搜索均已重试，仍未取得可用菜谱链接。可重试搜索、换个菜名，或提供链接。",
      },
    ]);
    // Site cards already contain first-party metadata. Only external snippets need detail verification.
    if (rows[0]?.source !== "xiachufang") {
      setStage("正在逐项核验网页搜索结果，限流时会暂停…");
      for (const row of rows) {
        if (!(await verifyCandidate(row))) break;
      }
    }
  }
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, candidates, busy]);
  useEffect(() => {
    let alive = true;
    aiStatus()
      .then((s) => {
        if (alive) setConfigured(s.configured.includes(s.settings.provider));
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function importUrl(url: string) {
    setPendingUrl(url);
    setStage("读取菜谱正文…");
    const html = await invoke<string>("kitchen_import_url", { url });
    setStage("整理食材、步骤与图片…");
    const content = recipeTextFromHtml(html);
    setPasted(content);
    const result = await organizeRecipe(content, url, state.recipeCategories);
    setWarnings(result.warnings);
    setDraft(result.draft);
  }
  async function applyProposal() {
    if (!proposal || busy) return;
    setBusy(true);
    setError("");
    setStage("正在执行已确认的操作…");
    try {
      await invoke("kitchen_ai_apply", {
        proposalId: proposal.id,
        confirmDelete: deleteConfirm,
      });
      const operations = [...new Set(proposal.operations)].join("、");
      setMessages((m) =>
        m.map((v) =>
          v.proposal?.id === proposal.id
            ? { ...v, proposalState: "applied" }
            : v,
        ),
      );
      setProposal(null);
      setDeleteConfirm(false);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: `已完成：${operations}。` },
      ]);
      const loaded = await reload();
      reloadForecast();
      if (!loaded)
        setError("操作已完成，但页面刷新失败。请重试刷新，不必重复执行。");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  async function send() {
    if (!input.trim() || busy || !historyReady) return;
    const next = [
      ...messages,
      { role: "user" as const, content: input.trim() },
    ];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    setStage("正在理解你的需求…");
    try {
      const route = await invoke<Route>("kitchen_ai_route", {
        messages: next
          .slice(-16)
          .map(({ role, content }) => ({ role, content })),
        candidates,
        weekStart,
        proposalId: proposal?.id ?? null,
      });
      if (route.message || route.action === "operate")
        setMessages([
          ...next,
          {
            role: "assistant",
            content:
              route.action === "operate"
                ? "提案已整理好，可以同意、拒绝，或继续告诉我怎么改。"
                : route.message,
            ...(route.proposal ? { proposal: route.proposal } : {}),
          },
        ]);
      if (route.action === "search") {
        await runSearch(
          route.query ?? "",
          requestedSearchCount(next.at(-1)?.content ?? "", route.limit),
        );
      } else if (route.action === "operate") {
        if (!route.proposal)
          throw new Error("助手未提供可执行提案，请补充要求后重试");
        setProposal(route.proposal);
        setDeleteConfirm(false);
        setCandidates([]);
      } else if (route.action === "copy_shopping" && route.copy) {
        setCopy(route.copy);
      } else if (route.action === "navigate") {
        if (route.page === "settings") onOpenSettings();
        else if (
          route.page &&
          ["home", "recipes", "pantry", "planner", "shopping"].includes(
            route.page,
          )
        )
          onNavigate?.(route.page);
      } else if (route.action === "import") {
        await importUrl(
          selectedUrl(
            route,
            candidates,
            next
              .filter((m) => m.role === "user")
              .map((m) => m.content)
              .join("\n"),
          ),
        );
      }
    } catch (e) {
      setError(errorMessage(e));
      setInput(next.at(-1)?.content ?? "");
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  function renderCandidates(rows: Candidate[]) {
    return rows.length > 0 ? (
      <div className="recipe-candidates">
        {rows.map((c, i) => (
          <article key={c.id} className="recipe-candidate">
            <h3>
              <span>{i + 1}.</span> {c.title}
            </h3>
            <p className="hint">
              {c.author ??
                (c.verification === "verified"
                  ? "原页未提供作者"
                  : c.verification === "site"
                    ? "搜索页未提供作者"
                    : "作者未核验")}{" "}
              ·{" "}
              {c.rating === null
                ? c.verification === "verified"
                  ? "原页未提供评分"
                  : c.verification === "site"
                    ? "搜索页未提供评分"
                    : "评分未核验"
                : `${c.verification === "verified" ? "原页评分" : c.source === "xiachufang" ? "站内评分" : "摘要评分"} ${c.rating}`}{" "}
              ·{" "}
              {c.madeCount === null
                ? c.verification === "verified"
                  ? "原页未提供做过人数"
                  : c.verification === "site"
                    ? "搜索页未提供做过人数"
                    : "做过人数未核验"
                : `${c.madeCount} 人做过`}
            </p>
            {c.ratingCount != null && (
              <p className="hint">{c.ratingCount} 人评分</p>
            )}
            <p>{c.snippet}</p>
            {c.verification === "site" && (
              <p className="hint">已读取下厨房站内搜索页，详情在整理时读取。</p>
            )}
            {c.verification === "verified" && (
              <small className="hint">
                已读取原页核验 ·{" "}
                {new Date((c.verifiedAt ?? 0) * 1000).toLocaleString()}
              </small>
            )}
            {c.verificationError && (
              <p className="hint">原页暂未核验：{c.verificationError}</p>
            )}
            {c.fetchedAt && (
              <small className="hint" style={{ display: "block" }}>
                检索于 {new Date(c.fetchedAt * 1000).toLocaleString()}
              </small>
            )}
            <input
              className="candidate-url"
              aria-label={`菜谱${i + 1}原始链接`}
              value={c.url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <div className="actions">
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    await invoke("kitchen_open_recipe", { url: c.url });
                  } catch (e) {
                    setError(errorMessage(e));
                  }
                }}
              >
                原始链接 <ExternalLink size={13} />
              </button>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await importUrl(c.url);
                  } catch (e) {
                    setError(errorMessage(e));
                  } finally {
                    setBusy(false);
                    setStage("");
                  }
                }}
              >
                整理这道菜
              </button>
            </div>
          </article>
        ))}
      </div>
    ) : null;
  }
  function renderProposal(proposal: AssistantProposal) {
    return (
      <section className="assistant-proposal" aria-label="待确认操作">
        <div className="proposal-heading">
          <h3>
            {proposal.changes.some((c) => c.section === "菜单")
              ? "这份安排怎么样？"
              : "帮你这样处理"}
          </h3>
          <span className="proposal-state">待你确认</span>
        </div>
        <div className="proposal-content">
          {proposal.changes
            .filter((c) => c.section !== "食材分类")
            .map((change, i) => {
              const empty = (value: string) => !value || value === "无";
              const removing = empty(change.after);
              const content = removing ? change.before : change.after;
              const meal =
                change.section === "菜单"
                  ? content.match(
                      /^(\d{4}-\d{2}-\d{2})\s+(早餐|午餐|晚餐)\s*·\s*(.*?)\s*·\s*(\d+)人(.*)$/s,
                    )
                  : null;
              return (
                <section
                  className={`proposal-item ${meal ? "proposal-meal" : ""}`}
                  key={i}
                >
                  {meal ? (
                    <>
                      <div className="proposal-meal-meta">
                        <span>
                          {meal[1]} · {meal[2]}
                        </span>
                        <span>{meal[4]} 人份</span>
                      </div>
                      <h4>{meal[3]}</h4>
                      {meal[5] && <p>{meal[5]}</p>}
                      {removing && (
                        <span className="proposal-removal">将移除</span>
                      )}
                    </>
                  ) : (
                    <>
                      <h4>
                        {change.section === "采购预测"
                          ? "需要补购"
                          : change.section}
                      </h4>
                      <p>{removing ? `移除：${content}` : content}</p>
                    </>
                  )}
                  {!empty(change.before) && !removing && (
                    <details className="proposal-comparison">
                      <summary>查看修改前</summary>
                      <p>{change.before}</p>
                    </details>
                  )}
                </section>
              );
            })}
        </div>
        {proposal.destructive && (
          <label className="inline">
            <input
              type="checkbox"
              checked={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.checked)}
            />
            再次确认删除、移除或丢弃的内容
          </label>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={busy || (proposal.destructive && !deleteConfirm)}
            onClick={() => void applyProposal()}
          >
            同意并执行
          </button>
          <button
            disabled={busy}
            onClick={() => {
              setMessages((m) =>
                m.map((v) =>
                  v.proposal?.id === proposal.id
                    ? { ...v, proposalState: "rejected" }
                    : v,
                ),
              );
              setProposal(null);
              setDeleteConfirm(false);
            }}
          >
            拒绝提案
          </button>
        </div>
        <p className="hint">可以在对话中告诉我怎么改。</p>
      </section>
    );
  }
  if (draft)
    return (
      <RecipeEditor
        mode="import"
        initialDraft={draft}
        importWarnings={warnings}
        onClose={() => setDraft(null)}
      />
    );
  return (
    <Modal
      title="Chefish 厨房助手"
      drawer
      className="assistant-dialog"
      onClose={onClose}
    >
      <p className="hint">
        可查询菜谱和库存、安排菜单、管理采购与手记。修改会先展示提案，确认后执行。
      </p>
      <div className="assistant-toolbar">
        <span className="hint">
          {configured ? "已连接模型配置" : "请先配置模型"} ·
          聊天记录自动保存在本机
        </span>
        <button aria-label="模型设置" onClick={onOpenSettings} disabled={busy}>
          <Settings size={17} />
        </button>
      </div>
      <div className="assistant-scroll" ref={scrollRef}>
        {historyError && (
          <div>
            <p className="error" role="alert">
              聊天记录：{historyError}
            </p>
            <button onClick={() => setHistoryAttempt(historyAttempt + 1)}>
              重试读取记录
            </button>
            <button disabled={busy} onClick={() => void clearHistory()}>
              清除损坏记录
            </button>
          </div>
        )}
        {!historyReady && !historyError && (
          <p className="hint">正在读取聊天记录…</p>
        )}
        {lastQuery && (
          <div className="assistant-search-tools">
            <span className="hint">
              {candidates[0]?.source === "xiachufang"
                ? "下厨房站内搜索 · 当前页按做过人数排序"
                : "网页搜索回退 · 非站内人气排名"}
            </span>
            <button
              disabled={busy || !historyReady}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await runSearch(lastQuery, lastLimit);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                  setStage("");
                }
              }}
            >
              重试搜索
            </button>
          </div>
        )}
        <div className="assistant-conversation" aria-live="polite">
          {!messages.length && (
            <div className="assistant-intro">
              <h3>今天需要我帮什么？</h3>
              <p>例如：用现有食材安排今天的晚餐，优先用快到期的食材。</p>
              <p className="hint">
                也可以记下购买、修改菜谱和手记，或搜索下厨房新做法。本地菜谱与库存摘要会随问题交给你配置的模型处理。
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div className="assistant-turn" key={i}>
              <div className={`chat-message ${m.role}`}>{m.content}</div>
              {m.candidates?.length ? (
                m ===
                [...messages].reverse().find((v) => v.candidates?.length) ? (
                  renderCandidates(m.candidates)
                ) : (
                  <details className="past-search">
                    <summary>此前推荐 · {m.candidates.length} 道菜</summary>
                    {renderCandidates(m.candidates)}
                  </details>
                )
              ) : null}
              {m.proposal &&
                (proposal?.id === m.proposal.id &&
                !messages
                  .slice(i + 1)
                  .some((v) => v.proposal?.id === proposal.id) ? (
                  renderProposal(proposal)
                ) : (
                  <div className="past-proposal">
                    <strong>{m.proposal.operations[0]}</strong>
                    <span>
                      {m.proposalState === "applied"
                        ? "已执行"
                        : m.proposalState === "rejected"
                          ? "已拒绝"
                          : "已被后续提案替代"}
                    </span>
                  </div>
                ))}
            </div>
          ))}
        </div>
        {copy && (
          <section className="assistant-proposal">
            <h3>{copy.title}</h3>
            <p style={{ whiteSpace: "pre-wrap" }}>{copy.text}</p>
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(copy.text);
                  setMessages((m) => [
                    ...m,
                    { role: "assistant", content: "清单已复制。" },
                  ]);
                  setCopy(null);
                } catch {
                  setError("无法访问剪贴板，请选择上方文本复制。");
                }
              }}
            >
              复制清单文本
            </button>
          </section>
        )}
        {pendingUrl && (
          <details className="assistant-paste">
            <summary>
              {pasted
                ? "整理未完成？编辑已读取正文后重试"
                : "无法读取？粘贴所选菜谱正文继续"}
            </summary>
            <p className="hint">{pendingUrl}</p>
            <textarea
              aria-label="所选菜谱正文"
              maxLength={60000}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <button
              disabled={busy || !pasted.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                setStage("整理正文与图片…");
                try {
                  const result = await organizeRecipe(
                    pasted,
                    pendingUrl,
                    state.recipeCategories,
                  );
                  setWarnings(result.warnings);
                  setDraft(result.draft);
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                  setStage("");
                }
              }}
            >
              整理正文
            </button>
          </details>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className="hint">
            {stage}
          </p>
        )}
      </div>
      {
        <form
          className="assistant-compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            aria-label="对厨房助手说"
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
                if (!busy && configured && historyReady && input.trim())
                  void send();
              }
            }}
            maxLength={2000}
            placeholder="安排菜单、记录购买、修改菜谱，或发来链接…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
          />
          <div className="assistant-compose-actions">
            <button
              type="button"
              aria-label="清除聊天记录"
              disabled={busy}
              onClick={() => void clearHistory()}
            >
              <RotateCcw size={16} />
            </button>
            <button
              className="primary"
              disabled={busy || !historyReady || !configured || !input.trim()}
            >
              <Send size={16} />
              发送
            </button>
          </div>
        </form>
      }
    </Modal>
  );
}
