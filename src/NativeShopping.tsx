import { supplies } from "./domain/seasonings";
import { useState } from "react";
import Seasonings from "./Seasonings";
import {
  Plus,
  RefreshCw,
  ShoppingBasket,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
} from "lucide-react";
import { weekLabel, weekOf, shiftDate, validDate } from "./model";
import { useDemo } from "./store";
import { Badge, Empty, Modal } from "./components";
import { shoppingPending, type ShoppingLine } from "./domain/shopping";
const format = (n: string, u: string) => `${n} ${u}`;
function PurchaseForm({
  line,
  receive,
  onClose,
}: {
  line: ShoppingLine;
  receive: boolean;
  onClose: () => void;
}) {
  const { mutate, busy, today } = useDemo();
  const [quantity, setQuantity] = useState(
    receive ? line.unreceived : line.remaining !== "0" ? line.remaining : "1",
  );
  const [location, setLocation] = useState("冷藏");
  const [received, setReceived] = useState(today);
  const [expires, setExpires] = useState("");
  return (
    <Modal title={receive ? "完善购买信息" : "购买食材"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await mutate(
            receive
              ? {
                  type: "receive_shopping",
                  line_id: line.id!,
                  expected_version: line.version,
                  quantity,
                  location,
                  received,
                  expires: expires || null,
                }
              : {
                  type: "purchase_shopping",
                  line_id: line.id,
                  expected_version: line.version,
                  ingredient_id: line.ingredientId,
                  unit: line.unit,
                  week_start: line.weekStart,
                  quantity,
                  location,
                  received,
                  expires: expires || null,
                },
            (s) => s,
            receive ? "购买信息已保存" : "购买已保存，库存已更新",
          );
          if (saved) onClose();
        }}
      >
        <h3>{line.name}</h3>
        <p className="hint">
          {receive
            ? `这笔已购买的 ${format(line.unreceived, line.unit)} 食材尚缺存放信息，请补充。`
            : `还需购买 ${format(line.remaining, line.unit)}，填写实际购买量与存放信息，确认后直接更新库存。`}
        </p>
        <label>
          本次购买数量
          <input
            aria-label="本次购买数量"
            type="number"
            min="0.000001"
            max={receive ? line.unreceived : "100000"}
            step="0.000001"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <small>单位：{line.unit}</small>
        </label>
        <>
          <label>
            储存位置
            <select
              aria-label="购买储存位置"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {["冷藏", "冷冻", "常温"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              购买日期
              <input
                aria-label="购买日期"
                type="date"
                min="1900-01-01"
                max={today}
                required
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </label>
            <label>
              到期日期（可留空）
              <input
                aria-label="购买到期日期"
                type="date"
                min={received}
                max="2100-12-31"
                value={expires}
                onChange={(e) => setExpires(e.target.value)}
              />
            </label>
          </div>
          <p className="hint">
            到期日留空会标记待核对，不自动计入可用库存。请核对实际食材和数量后确认。
          </p>
        </>
        <button className="primary" disabled={busy} type="submit">
          {receive ? "保存购买信息" : "确认购买"}
        </button>
      </form>
    </Modal>
  );
}
function ManualForm({
  line,
  onClose,
}: {
  line?: ShoppingLine;
  onClose: () => void;
}) {
  const { state, mutate, busy } = useDemo();
  const [name, setName] = useState(line?.name ?? "");
  const [category, setCategory] = useState(line?.category ?? "未分类");
  const [quantity, setQuantity] = useState(line?.required ?? "100");
  const [unit, setUnit] = useState(line?.unit ?? "g");
  return (
    <Modal title={line ? "编辑手动采购项目" : "添加采购项目"} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const saved = await mutate(
            {
              type: "save_shopping",
              line_id: line?.id ?? null,
              expected_version: line?.version ?? null,
              draft: { name: name.trim(), category, quantity, unit },
            },
            (s) => s,
            "手动采购项目已保存，跨周保留",
          );
          if (saved) onClose();
        }}
      >
        <label>
          食材名称
          <input
            aria-label="采购食材名称"
            maxLength={120}
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="form-row">
          <label>
            数量
            <input
              aria-label="采购数量"
              type="number"
              min="0.000001"
              max="100000"
              step="0.000001"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            单位
            <select
              aria-label="采购单位"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {["g", "ml", "个", "片", "盒"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          食材分类
          <select
            aria-label="采购食材分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {state.ingredientCategories.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <p className="hint">
          同名食材沿用原分类。手动添加代表额外采购意愿，不因计划重算或切周消失。
        </p>
        <button className="primary" disabled={busy} type="submit">
          保存采购项目
        </button>
      </form>
    </Modal>
  );
}
function ShoppingMemo() {
  const { state, mutate, busy } = useDemo();
  const [memo, setMemo] = useState(state.memo);
  return (
    <section className="panel">
      <h3>采购备忘</h3>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          await mutate(
            {
              type: "save_shopping_memo",
              memo,
              expected_revision: state.dataRevision ?? "",
            },
            (s) => s,
            "采购备忘已保存",
          );
        }}
      >
        <textarea
          aria-label="采购备忘"
          maxLength={4000}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <button disabled={busy} type="submit">
          保存备忘
        </button>
        <small>保存在本机，关闭重启仍保留。</small>
      </form>
    </section>
  );
}
export default function NativeShopping() {
  const {
    state,
    weekStart,
    setWeekStart,
    today,
    forecast,
    forecastError,
    forecastLoading,
    reloadForecast,
    mutate,
    busy,
    notify,
  } = useDemo();
  const [form, setForm] = useState<{
    kind: "manual" | "buy" | "receive" | "remove";
    line?: ShoppingLine;
  } | null>(null);
  const [detail, setDetail] = useState<ShoppingLine | null>(null);
  const items = forecast?.items ?? [];
  const pending = shoppingPending(forecast);
  const missingSeasonings = supplies(state).filter((s) => s.missing);
  const disabled = busy || forecastLoading || !forecast;
  const visible = items
    .filter((i) => !i.hidden)
    .sort((a, b) => Number(b.remaining !== "0") - Number(a.remaining !== "0"));
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM A GOOD PLAN TO YOUR KITCHEN</div>
          <h1>
            采购清单<span className="heading-dot">.</span>
          </h1>
          <p>{weekLabel(weekStart)} · 手动采购项跨周保留。</p>
        </div>
        <div className="actions">
          <button disabled={busy} onClick={() => setForm({ kind: "manual" })}>
            <Plus size={16} />
            手动添加
          </button>
          <button
            className="primary"
            disabled={disabled}
            onClick={() =>
              void mutate(
                { type: "refresh_shopping", week_start: weekStart },
                (s) => s,
                "已重新计算并恢复本周移除项；购买记录保留",
              )
            }
          >
            <RefreshCw size={16} />
            更新计划需求
          </button>
        </div>
      </div>
      <Seasonings reminder />
      <div className="week-toolbar">
        <div className="inline">
          <button
            className="round-button"
            aria-label="采购上一周"
            disabled={weekStart <= "1900-01-08"}
            onClick={() => setWeekStart(shiftDate(weekStart, -7))}
          >
            <ChevronLeft size={17} />
          </button>
          <strong>{weekLabel(weekStart)}</strong>
          <button
            className="round-button"
            aria-label="采购下一周"
            disabled={weekStart >= "2100-12-20"}
            onClick={() => setWeekStart(shiftDate(weekStart, 7))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
        <div className="inline week-controls">
          <button
            disabled={weekStart === weekOf(today)}
            onClick={() => setWeekStart(weekOf(today))}
          >
            返回本周
          </button>
          <input
            aria-label="采购清单周"
            type="date"
            min="1900-01-01"
            max="2100-12-24"
            value={weekStart}
            onChange={(e) => {
              if (validDate(e.target.value))
                setWeekStart(weekOf(e.target.value));
            }}
          />
        </div>
      </div>
      {forecastError && (
        <div className="panel load-error" role="alert">
          采购计算失败：{forecastError}
          <button onClick={reloadForecast}>重试采购计算</button>
        </div>
      )}
      {forecastLoading && (
        <p className="hint" role="status">
          正在按菜单日期与库存计算…
        </p>
      )}
      <div className="shopping-layout">
        <div>
          {visible.length > 0 && (
            <section className="panel shopping-list" aria-label="采购项目">
              <div className="section-heading">
                <h2>
                  购物清单 <Badge>{visible.length}</Badge>
                </h2>
                <span className="hint">{pending.length} 项待买</span>
              </div>
              {visible.map((i) => (
                <div
                  className={`shopping-row ${i.remaining === "0" && i.unreceived === "0" && i.received !== "0" ? "is-stocked" : ""}`}
                  key={i.id ?? `${i.weekStart}|${i.ingredientId}|${i.unit}`}
                  tabIndex={0}
                  role="group"
                  aria-label={`采购项目 · ${i.name}`}
                  title="右键查看详情"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setDetail(i);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget &&
                      (event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10"))
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                      setDetail(i);
                    }
                  }}
                >
                  <div className="shopping-name">
                    <div className="shopping-title">
                      <strong title={i.name}>{i.name}</strong>
                      {i.review && <Badge tone="warm">需核对</Badge>}
                      {i.hidden && <Badge>已忽略</Badge>}
                    </div>
                    <small>
                      {i.source === "plan"
                        ? `总需 ${format(i.required, i.unit)} · 库存 ${format(i.covered, i.unit)} · 仍缺 ${format(i.remaining, i.unit)}`
                        : `需求量 ${format(i.required, i.unit)} · 仍缺 ${format(i.remaining, i.unit)}`}
                    </small>
                  </div>
                  <div className="shopping-quantity">
                    <strong>
                      {i.remaining !== "0"
                        ? `待买 ${format(i.remaining, i.unit)}`
                        : i.purchased !== "0"
                          ? "已购买"
                          : "库存充足"}
                    </strong>
                  </div>
                  <div className="row-actions">
                    <button
                      disabled={disabled || i.remaining === "0"}
                      onClick={() => setForm({ kind: "buy", line: i })}
                    >
                      购买
                    </button>
                    <button
                      disabled={disabled}
                      aria-label={`删除${i.name}`}
                      onClick={() => setForm({ kind: "remove", line: i })}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}
          {forecast && visible.length === 0 && (
            <Empty>没有食材采购项目，可以安排菜单或手动添加。</Empty>
          )}
          {!!forecast?.reviewNotes.length && (
            <section className="panel shopping-review">
              <h2>用量待核对</h2>
              {forecast.reviewNotes.map((note, index) => (
                <p className="hint" key={index}>
                  {note}
                </p>
              ))}
            </section>
          )}
          {items.some((i) => i.hidden) && (
            <p className="hint">
              已移除 {items.filter((i) => i.hidden).length}{" "}
              项本周清单，点击「更新计划需求」可恢复。
            </p>
          )}
        </div>
        <aside className="shopping-summary">
          <section className="panel">
            <h3>本周概览</h3>
            <div className="shopping-stats">
              <div>
                <ShoppingBasket size={21} />
                <span>
                  待采购
                  <strong>
                    {forecast ? pending.length + missingSeasonings.length : "—"}
                    <small> 项</small>
                  </strong>
                </span>
              </div>
              <div>
                <Check size={21} />
                <span>
                  已购买
                  <strong>
                    {forecast
                      ? visible.filter((i) => i.purchased !== "0").length
                      : "—"}
                    <small> 项</small>
                  </strong>
                </span>
              </div>
              <div>
                <span className="muted">需求来源</span>
                <strong>
                  {
                    state.plans.filter((p) => weekOf(p.day) === weekStart)
                      .length
                  }
                  <small> 道菜计划</small>
                </strong>
              </div>
            </div>
            <button
              className="full"
              disabled={!forecast}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    [
                      ...visible.map(
                        (i) =>
                          `${i.name}：待买 ${format(i.remaining, i.unit)}，已购买 ${format(i.purchased, i.unit)}`,
                      ),
                      ...supplies(state)
                        .filter((s) => s.missing)
                        .map((s) => `调料：${s.name}（缺少，需补购）`),
                    ].join("\n"),
                  );
                  notify("已复制清单文本");
                } catch {
                  notify("剪贴板不可用，未复制");
                }
              }}
            >
              复制清单文本
            </button>
          </section>
          <ShoppingMemo />
        </aside>
      </div>
      {detail && (
        <Modal
          title={`采购详情 · ${detail.name}`}
          onClose={() => setDetail(null)}
        >
          <div className="shopping-detail">
            {(detail.unreceived !== "0" ||
              (detail.source === "manual" && detail.purchased === "0")) && (
              <div className="actions">
                {detail.unreceived !== "0" && (
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setDetail(null);
                      setForm({ kind: "receive", line: detail });
                    }}
                  >
                    完善信息
                  </button>
                )}
                {detail.source === "manual" && detail.purchased === "0" && (
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setDetail(null);
                      setForm({ kind: "manual", line: detail });
                    }}
                  >
                    编辑项目
                  </button>
                )}
              </div>
            )}
            <section>
              <h3>需求量</h3>
              <p>
                总需 {format(detail.required, detail.unit)} · 库存{" "}
                {format(detail.covered, detail.unit)} · 仍缺{" "}
                {format(detail.remaining, detail.unit)}
              </p>
              {detail.review && <Badge tone="warm">部分信息模糊，需核对</Badge>}
              {detail.hidden && <p className="hint">已忽略本周需求</p>}
            </section>
            <section>
              <h3>用于</h3>
              {detail.source === "manual" ? (
                <p className="hint">手动添加 · 通用清单，不关联特定餐次</p>
              ) : detail.sources.length ? (
                detail.sources.map((source, index) => (
                  <p key={index}>{source}</p>
                ))
              ) : (
                <p className="hint">原菜单需求已移除，保留购买记录</p>
              )}
            </section>
            <section>
              <h3>购买记录</h3>
              {detail.history.filter((h) => h.kind !== "receive").length ? (
                detail.history
                  .filter((h) => h.kind !== "receive")
                  .map((h) => (
                    <p className="shopping-history-entry" key={h.id}>
                      <span>
                        {h.kind === "undo_purchase"
                          ? "撤销购买"
                          : h.kind === "undo_receive"
                            ? "撤销购买信息"
                            : "购买"}{" "}
                        {format(h.quantity, detail.unit)}
                      </span>
                      <small>{new Date(h.at).toLocaleString()}</small>
                    </p>
                  ))
              ) : (
                <p className="hint">暂无购买记录</p>
              )}
            </section>
          </div>
        </Modal>
      )}
      {form?.kind === "manual" && (
        <ManualForm line={form.line} onClose={() => setForm(null)} />
      )}
      {form?.kind === "buy" && form.line && (
        <PurchaseForm
          line={form.line}
          receive={false}
          onClose={() => setForm(null)}
        />
      )}
      {form?.kind === "receive" && form.line && (
        <PurchaseForm line={form.line} receive onClose={() => setForm(null)} />
      )}
      {form?.kind === "remove" && form.line && (
        <Modal title="删除清单项目？" onClose={() => setForm(null)}>
          <p>
            从清单中移除这项食材，已购买的库存和记录会保留。
            {form.line.source === "plan" ? "更新计划需求可恢复显示。" : ""}
          </p>
          <div className="actions space-top">
            <button onClick={() => setForm(null)}>取消</button>
            <button
              className="danger"
              disabled={disabled}
              onClick={async () => {
                const i = form.line!;
                const saved = await mutate(
                  i.source === "plan"
                    ? {
                        type: "hide_shopping",
                        week_start: weekStart,
                        ingredient_id: i.ingredientId,
                        unit: i.unit,
                      }
                    : {
                        type: "remove_shopping",
                        line_id: i.id!,
                        expected_version: i.version,
                      },
                  (s) => s,
                  i.source === "plan"
                    ? "已从清单移除，购买记录保留"
                    : "手动采购项目已删除",
                );
                if (saved) setForm(null);
              }}
            >
              确认删除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
