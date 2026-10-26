import NativeShopping from "./NativeShopping";
import Seasonings from "./Seasonings";
import { useState } from "react";
import {
  Plus,
  Download,
  RefreshCw,
  ShoppingBasket,
  Check,
  Trash2,
} from "lucide-react";
import {
  weekOf,
  weekLabel,
  amount,
  needs,
  pendingItems,
  purchase,
  type Location,
  keyOf,
  csvText,
  type ShoppingItem,
} from "./model";
import { useDemo } from "./store";
import { Badge, Empty, Modal } from "./components";
import { ItemForm } from "./Inventory";
export default function Shopping() {
  const { persistent } = useDemo();
  return persistent ? <NativeShopping /> : <DemoShopping />;
}
function DemoShopping() {
  const { state, update, notify, weekStart } = useDemo();
  const [form, setForm] = useState<{ item?: ShoppingItem } | null>(null);
  const [receipt, setReceipt] = useState<ShoppingItem | null>(null);
  const [remove, setRemove] = useState<ShoppingItem | null>(null);
  const [detail, setDetail] = useState<ShoppingItem | null>(null);
  const items = pendingItems(state, weekStart).sort(
    (a, b) => Number(b.status === "pending") - Number(a.status === "pending"),
  );
  const demand = needs(state, weekStart);
  const pending = items.filter((i) => i.status === "pending");
  const bought = items.filter((i) => i.status === "bought");
  const stocked = items.filter((i) => i.status === "stocked");
  function exportList() {
    const blob = new Blob([csvText(items)], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Chefish-${weekStart}-shopping.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("已生成 CSV 文件；桌面端请使用浏览器预览下载或复制清单");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        items
          .map(
            (i) =>
              `${i.name} ${amount(i.quantity, i.unit)} · ${i.status === "pending" ? "待买" : i.status === "bought" ? "已买" : "已购买"}`,
          )
          .join("\n"),
      );
      notify("已复制清单文本");
    } catch {
      notify("剪贴板不可用，请使用 CSV 导出（浏览器预览）");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">FROM A GOOD PLAN TO YOUR KITCHEN</div>
          <h1>
            采购清单<span className="heading-dot">.</span>
          </h1>
          <p>{weekLabel(weekStart)} · 所选周需求，手动采购项跨周保留。</p>
        </div>
        <div className="actions">
          <button onClick={() => setForm({})}>
            <Plus size={16} />
            手动添加
          </button>
          <button
            className="primary"
            onClick={() =>
              update(
                (s) => ({ ...s, hiddenNeeds: [] }),
                "已按当前菜单与库存重算，已买及手动项目已保留",
              )
            }
          >
            <RefreshCw size={15} />
            更新计划需求
          </button>
        </div>
      </div>
      <Seasonings reminder />
      <div className="shopping-layout">
        <div>
          {items.length > 0 && (
            <section className="panel shopping-list" aria-label="采购项目">
              <div className="section-heading">
                <h2>
                  购物清单 <Badge>{items.length}</Badge>
                </h2>
                <span className="hint">{pending.length} 项待买</span>
              </div>
              {items.map((item) => {
                const n = demand.find((n) => keyOf(n) === keyOf(item));
                return (
                  <div
                    className={`shopping-row ${item.status === "stocked" ? "is-stocked" : ""}`}
                    key={item.id}
                    tabIndex={0}
                    role="group"
                    aria-label={`采购项目 · ${item.name}`}
                    title="右键查看详情"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setDetail(item);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        (event.key === "ContextMenu" ||
                          (event.shiftKey && event.key === "F10"))
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        setDetail(item);
                      }
                    }}
                  >
                    <div className="shopping-name">
                      <div className="shopping-title">
                        <strong title={item.name}>{item.name}</strong>
                      </div>
                      <small>
                        {n
                          ? `总需 ${amount(n.required, n.unit)} · 库存 ${amount(n.covered, n.unit)}`
                          : `需求量 ${amount(item.quantity, item.unit)}`}
                      </small>
                    </div>
                    <div className="shopping-quantity">
                      <strong>
                        {item.status === "pending"
                          ? `待买 ${amount(item.quantity, item.unit)}`
                          : "已购买"}
                      </strong>
                    </div>
                    <div className="row-actions">
                      <button
                        disabled={item.status !== "pending"}
                        onClick={() => setReceipt(item)}
                      >
                        购买
                      </button>
                      <button
                        aria-label={`删除${item.name}`}
                        onClick={() => setRemove(item)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
          <details className="panel covered">
            <summary>
              库存已覆盖，无需购买 ·{" "}
              {demand.filter((n) => n.covered >= n.required).length} 项
            </summary>
            {demand
              .filter((n) => n.covered >= n.required)
              .map((n) => (
                <p key={keyOf(n)}>
                  <Check size={15} />
                  {n.name}
                  <span>{amount(n.required, n.unit)} 已覆盖</span>
                </p>
              ))}
          </details>
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
                    {pending.length}
                    <small> 项</small>
                  </strong>
                </span>
              </div>
              <div>
                <Check size={21} />
                <span>
                  已购买
                  <strong>
                    {bought.length + stocked.length}
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
            <button className="full" onClick={copy}>
              复制清单文本
            </button>
            <button className="full" onClick={exportList}>
              <Download size={15} />
              导出 CSV（浏览器）
            </button>
          </section>
          <section className="panel">
            <h3>采购备忘</h3>
            <textarea
              aria-label="采购备忘"
              value={state.memo}
              onChange={(e) =>
                update(
                  (s) => ({ ...s, memo: e.target.value }),
                  "备忘已更新，仅保留本次演示会话",
                )
              }
            />
            <small>仅本次会话保留，刷新即重置。</small>
          </section>
        </aside>
      </div>
      {items.length === 0 && (
        <Empty>没有待买项目，可以安排菜单或手动添加。</Empty>
      )}
      {detail && (
        <Modal
          title={`采购详情 · ${detail.name}`}
          onClose={() => setDetail(null)}
        >
          <div className="shopping-detail">
            {detail.source === "manual" && detail.status === "pending" && (
              <div className="actions">
                <button
                  onClick={() => {
                    setDetail(null);
                    setForm({ item: detail });
                  }}
                >
                  编辑项目
                </button>
              </div>
            )}
            <section>
              <h3>用于</h3>
              {detail.source === "manual" ? (
                <p className="hint">手动添加 · 通用清单，不关联特定餐次</p>
              ) : detail.sources.length ? (
                detail.sources.map((source, index) => (
                  <p key={index}>{source}</p>
                ))
              ) : (
                <p className="hint">暂无关联餐次</p>
              )}
            </section>
            <section>
              <h3>购买记录</h3>
              <p>
                {detail.status === "pending"
                  ? "暂无购买记录"
                  : `已购买 ${amount(detail.quantity, detail.unit)}`}
              </p>
              <p className="hint">
                演示模式仅显示当前状态，不保存逐次购买历史。
              </p>
            </section>
          </div>
        </Modal>
      )}
      {form && (
        <ItemForm
          mode="shopping"
          item={form.item}
          onClose={() => setForm(null)}
        />
      )}
      {receipt && (
        <DemoPurchaseForm item={receipt} onClose={() => setReceipt(null)} />
      )}
      {remove && (
        <Modal title="移除采购项目？" onClose={() => setRemove(null)}>
          <p>
            {remove.source === "plan"
              ? "此需求将暂时从清单隐藏；更新计划需求会恢复，菜单本身不变。"
              : "从清单移除这个手动项目，已购买的库存保留，可撤销。"}
          </p>
          <div className="actions">
            <button onClick={() => setRemove(null)}>取消</button>
            <button
              className="danger"
              onClick={() => {
                update((s) =>
                  remove.source === "plan"
                    ? {
                        ...s,
                        hiddenNeeds: [
                          ...s.hiddenNeeds,
                          `${weekStart}|${keyOf(remove)}`,
                        ],
                      }
                    : {
                        ...s,
                        shopping: s.shopping.filter((i) => i.id !== remove.id),
                      },
                );
                setRemove(null);
              }}
            >
              确认移除
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function DemoPurchaseForm({
  item,
  onClose,
}: {
  item: ShoppingItem;
  onClose: () => void;
}) {
  const { update, today } = useDemo();
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [location, setLocation] = useState<Location>("冷藏");
  const [received, setReceived] = useState(today);
  const [expires, setExpires] = useState("");
  return (
    <Modal title="购买食材" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          update(
            (s) =>
              purchase(s, item, {
                quantity: Number(quantity),
                location,
                received,
                expires: expires || undefined,
              }),
            "购买已保存，食材已加入演示库存，可撤销",
          );
          onClose();
        }}
      >
        <h3>{item.name}</h3>
        <label>
          本次购买数量
          <input
            aria-label="本次购买数量"
            type="number"
            min="0.000001"
            max="100000"
            step="0.000001"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <small>单位：{item.unit}</small>
        </label>
        <label>
          储存位置
          <select
            aria-label="购买储存位置"
            value={location}
            onChange={(e) => setLocation(e.target.value as Location)}
          >
            {["冷藏", "冷冻", "常温"].map((v) => (
              <option key={v}>{v}</option>
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
        <p className="hint">确认后更新库存。本页为浏览器演示，刷新重置。</p>
        <button className="primary" type="submit">
          确认购买
        </button>
      </form>
    </Modal>
  );
}
