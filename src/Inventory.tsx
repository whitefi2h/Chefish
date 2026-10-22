import CategoryManager from "./CategoryManager";
import Seasonings from "./Seasonings";
import { supplies, isSeasoning } from "./domain/seasonings";
import { useState } from "react";
import {
  Plus,
  Search,
  ArrowUpRight,
  Package,
  Leaf,
  AlertTriangle,
} from "lucide-react";
import {
  shiftDate,
  amount,
  daysLeft,
  expiryLabel,
  changeLot,
  type Category,
  type Location,
  type ShoppingItem,
  type DemoState,
} from "./model";
import { useDemo } from "./store";
import { Badge, Modal, Empty } from "./components";
export function ItemForm({
  mode,
  onClose,
  item,
}: {
  mode: "inventory" | "shopping";
  onClose: () => void;
  item?: ShoppingItem;
}) {
  const { state, update, mutate, persistent, busy, today } = useDemo();
  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState(item?.quantity ?? 100);
  const [unit, setUnit] = useState(item?.unit ?? "g");
  const [category, setCategory] = useState<Category>(
    item?.category ?? (persistent ? "未分类" : "蔬菜菌菇"),
  );
  const [location, setLocation] = useState<Location>("冷藏");
  const [expires, setExpires] = useState(persistent ? "" : shiftDate(today, 7));
  const [received, setReceived] = useState(today);
  const [rough, setRough] = useState(false);
  return (
    <Modal
      title={
        item
          ? "编辑手动采购项目"
          : mode === "inventory"
            ? "新增食材购买"
            : "添加采购项目"
      }
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !Number.isFinite(quantity) || quantity <= 0)
            return;
          const demoChange = (s: DemoState): DemoState => {
            const found = s.ingredients.find((i) => i.name === name.trim());
            const ingredientId = found?.id ?? crypto.randomUUID();
            const next = {
              ...s,
              ingredients: found
                ? s.ingredients
                : [
                    ...s.ingredients,
                    { id: ingredientId, name: name.trim(), category },
                  ],
            };
            return mode === "inventory"
              ? {
                  ...next,
                  lots: [
                    ...s.lots,
                    {
                      id: crypto.randomUUID(),
                      ingredientId,
                      quantity,
                      unit,
                      location,
                      expires: expires || null,
                      received,
                      precision: rough ? "rough" : "exact",
                    },
                  ],
                }
              : {
                  ...next,
                  shopping: [
                    ...s.shopping.filter((i) => i.id !== item?.id),
                    {
                      id: item?.id ?? crypto.randomUUID(),
                      ingredientId,
                      name: name.trim(),
                      category: found?.category ?? category,
                      quantity,
                      unit,
                      status: "pending",
                      source: "manual",
                      sources: [],
                    },
                  ],
                };
          };
          if (persistent && mode === "inventory") {
            const saved = await mutate(
              {
                type: "receive_lot",
                draft: {
                  name: name.trim(),
                  category,
                  quantity: String(quantity),
                  unit,
                  location,
                  received,
                  expires: expires || null,
                  precision: rough ? "rough" : "exact",
                },
              },
              demoChange,
              "购买已保存，库存已更新",
            );
            if (saved) onClose();
          } else {
            update(demoChange);
            onClose();
          }
        }}
      >
        <label>
          食材名称
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：新鲜罗勒叶"
          />
        </label>
        <div className="form-row">
          <label>
            数量
            <input
              type="number"
              required
              min="0.000001"
              max="100000"
              step="0.000001"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </label>
          <label>
            单位
            <select
              aria-label="单位"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {["g", "ml", "个", "片", "盒"].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          食材类别
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as Category)}
          >
            {state.ingredientCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {mode === "inventory" && (
          <>
            <label>
              购买日期
              <input
                type="date"
                required
                min="1900-01-01"
                max="2100-12-31"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </label>
            <div className="form-row">
              <label>
                储存位置
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value as Location)}
                >
                  {["冷藏", "冷冻", "常温"].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label>
                到期日期
                <input
                  type="date"
                  min={received}
                  max="2100-12-31"
                  required={!persistent}
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </label>
            </div>
            {persistent && (
              <p className="hint">
                到期日未知可留空，将提示核对，不自动计入安全可用库存。
              </p>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={rough}
                onChange={(e) => setRough(e.target.checked)}
              />
              粗略记录（不自动抵扣精确需求）
            </label>
          </>
        )}
        <p className="hint">
          同名食材复用已有分类。单位不一致或粗略记录时不会自动换算。
        </p>
        <button type="submit" className="primary" disabled={busy}>
          {item
            ? "更新演示项目"
            : mode === "inventory"
              ? persistent
                ? "确认购买"
                : "确认演示购买"
              : "添加项目"}
        </button>
      </form>
    </Modal>
  );
}
export function LotDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const { state, mutate, persistent, busy, today } = useDemo();
  const original = state.lots.find((l) => l.id === id)!;
  const [selected, setSelected] = useState(id);
  const lot = state.lots.find((l) => l.id === selected) ?? original;
  const [value, setValue] = useState(String(lot.quantityText ?? lot.quantity));
  const [reason, setReason] = useState("");
  const ingredient = state.ingredients.find((i) => i.id === lot.ingredientId)!;
  const [operation, setOperation] = useState("校正");
  return (
    <Modal title={`食材详情 · ${ingredient.name}`} onClose={onClose} drawer>
      <div className="detail-symbol">
        <Package size={38} />
        <Badge
          tone={
            !lot.expires
              ? "warm"
              : daysLeft(lot.expires, today) < 0
                ? "red"
                : "green"
          }
        >
          {expiryLabel(lot.expires, today)}
        </Badge>
      </div>
      <label className="form-stack">
        食材类别
        <select
          aria-label="食材所属分类"
          value={ingredient.category}
          onChange={(e) =>
            mutate(
              {
                type: "assign_category",
                kind: "ingredient",
                entity_id: ingredient.id,
                name: e.target.value,
              },
              (s) => ({
                ...s,
                ingredients: s.ingredients.map((i) =>
                  i.id === ingredient.id
                    ? { ...i, category: e.target.value }
                    : i,
                ),
                shopping: s.shopping.map((i) =>
                  i.ingredientId === ingredient.id
                    ? { ...i, category: e.target.value }
                    : i,
                ),
              }),
              persistent ? "食材分类已保存" : "食材分类已更新，可撤销",
            )
          }
        >
          {state.ingredientCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <h3 className="space-top">批次管理</h3>
      <label className="form-stack">
        选择批次
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            const chosen = state.lots.find((l) => l.id === e.target.value)!;
            setValue(String(chosen.quantityText ?? chosen.quantity));
          }}
        >
          {state.lots
            .filter((l) => l.ingredientId === lot.ingredientId)
            .map((l, i) => (
              <option key={l.id} value={l.id}>
                批次 {i + 1} · {amount(l.quantity, l.unit)} ·{" "}
                {l.expires ?? "未记录有效期"}
              </option>
            ))}
        </select>
      </label>
      <dl className="detail-list">
        <dt>剩余数量</dt>
        <dd>
          {amount(lot.quantity, lot.unit)}{" "}
          {lot.precision === "rough" ? "（粗略）" : ""}
        </dd>
        <dt>购买日期</dt>
        <dd>{lot.received}</dd>
        <dt>到期日期</dt>
        <dd>{lot.expires ?? "未记录有效期"}</dd>
        <dt>当前库位</dt>
        <dd>{lot.location}</dd>
      </dl>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const next =
            operation === "校正" ? Number(value) : lot.quantity - Number(value);
          if (!Number.isFinite(next) || next < 0) return;
          const saved = await mutate(
            {
              type: "change_lot",
              lot_id: lot.id,
              expected_version: lot.version ?? 1,
              operation:
                operation === "校正"
                  ? "correct"
                  : operation === "使用"
                    ? "use"
                    : "discard",
              quantity: value,
              location: null,
              reason,
            },
            (s) => changeLot(s, lot.id, next),
            persistent ? `已记录${operation}` : `已记录${operation}，可撤销`,
          );
          if (saved) {
            if (operation !== "校正") setValue("0");
            setReason("");
          }
        }}
      >
        <h3>数量操作</h3>
        <div className="segmented">
          {["校正", "使用", "丢弃"].map((o) => (
            <button
              key={o}
              type="button"
              className={operation === o ? "selected" : ""}
              onClick={() => {
                setOperation(o);
                setValue(
                  o === "校正" ? String(lot.quantityText ?? lot.quantity) : "0",
                );
              }}
            >
              {o}
            </button>
          ))}
        </div>
        <label>
          {operation === "校正" ? "校正后剩余量" : `${operation}数量`}（
          {lot.unit}）
          <input
            required
            type="number"
            min={operation === "校正" ? "0" : "0.000001"}
            max={operation === "校正" ? 100000 : lot.quantity}
            step="0.000001"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {persistent && (
          <label>
            操作说明（选填）
            <input
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="有需要时再补充说明"
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          确认{operation}
        </button>
      </form>
      <label className="form-stack space-top">
        转移库位
        <select
          value={lot.location}
          onChange={(e) =>
            mutate(
              {
                type: "change_lot",
                lot_id: lot.id,
                expected_version: lot.version ?? 1,
                operation: "move",
                quantity: "0",
                location: e.target.value,
                reason: "手动转移库位",
              },
              (s) =>
                changeLot(s, lot.id, lot.quantity, e.target.value as Location),
              persistent ? "已更改存放位置" : "已转移演示库位，可撤销",
            )
          }
        >
          {["冷藏", "冷冻", "常温"].map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
      </label>
      {persistent && (
        <section className="inventory-history space-top">
          <div className="section-heading">
            <h3>历史操作</h3>
            <button
              disabled={
                busy ||
                !(state.inventoryEvents ?? []).some(
                  (event) =>
                    event.lotId === lot.id &&
                    event.afterVersion === lot.version &&
                    event.kind !== "reverse",
                )
              }
              onClick={() =>
                void mutate(
                  {
                    type: "undo_inventory",
                    lot_id: lot.id,
                    expected_version: lot.version ?? 1,
                  },
                  (s) => s,
                  "已撤销上次操作",
                )
              }
            >
              撤销上次操作
            </button>
          </div>
          {(state.inventoryEvents ?? [])
            .filter((event) => event.lotId === lot.id)
            .map((event) => (
              <article className="inventory-event" key={event.id}>
                <div>
                  <strong>
                    {
                      {
                        receive: "购买",
                        use: "使用",
                        discard: "丢弃",
                        correct: "校正",
                        move: "转移",
                        reverse: "撤销操作",
                      }[event.kind]
                    }
                  </strong>
                  <small>
                    {new Date(event.occurredAt).toLocaleString("zh-CN", {
                      hour12: false,
                    })}
                  </small>
                </div>
                <p>
                  {event.kind === "move"
                    ? `${event.beforeLocation} → ${event.afterLocation}`
                    : event.kind === "use" || event.kind === "discard"
                      ? `${amount(Number(event.before) - Number(event.after), lot.unit)} · 剩余 ${event.after} ${lot.unit}`
                      : event.kind === "receive"
                        ? `${event.after} ${lot.unit} · ${event.afterLocation}`
                        : event.kind === "reverse"
                          ? `恢复为 ${event.after} ${lot.unit} · ${event.afterLocation}`
                          : `${event.before} → ${event.after} ${lot.unit}`}
                </p>
                {event.reason &&
                  !["撤销上次操作", "手动购买"].includes(event.reason) && (
                    <p className="hint">
                      {event.reason.replaceAll("入库", "购买")}
                    </p>
                  )}
              </article>
            ))}
        </section>
      )}
      <p className="hint space-top">
        {persistent ? "本机日期" : "演示基准日"} {today}
        。过期、未知到期日及粗略批次不自动用于精确抵扣。
        {persistent
          ? "历史操作会自动保留，方便回看。"
          : "所有操作仅保留在本次会话。"}
      </p>
    </Modal>
  );
}
export default function Inventory({
  openLot,
}: {
  openLot: (id: string) => void;
}) {
  const { state, today, persistent } = useDemo();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("全部位置");
  const [category, setCategory] = useState("全部类别");
  const [add, setAdd] = useState(false);
  const [categories, setCategories] = useState(false);
  const foodLots = state.lots.filter((l) => {
    const name =
      state.ingredients.find((i) => i.id === l.ingredientId)?.name ?? "";
    return !isSeasoning(name) && !supplies(state).some((s) => s.name === name);
  });
  const alerts = foodLots.filter(
    (l) => l.quantity > 0 && (!l.expires || daysLeft(l.expires, today) <= 3),
  );
  const filtered = [...foodLots]
    .sort((a, b) => Number(a.quantity === 0) - Number(b.quantity === 0))
    .filter(
      (l) =>
        state.ingredients
          .find((i) => i.id === l.ingredientId)!
          .name.includes(query) &&
        (location === "全部位置" || l.location === location) &&
        (category === "全部类别" ||
          state.ingredients.find((i) => i.id === l.ingredientId)!.category ===
            category),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">LESS WASTE, MORE GOOD FOOD</div>
          <h1>
            食材库存<span className="heading-dot">.</span>
          </h1>
          <p>记住冰箱里的新鲜，也珍惜每一份食材。</p>
        </div>
        <button className="primary" onClick={() => setAdd(true)}>
          <Plus size={16} />
          食材购买
        </button>
      </div>
      <div className="pantry-layout">
        <div className="pantry-food">
          <div className="section-heading">
            <h2>
              <AlertTriangle size={17} />
              需要关注
            </h2>
            <span className="hint">
              {persistent ? "本机日期" : "演示日期"} {today} · {alerts.length}{" "}
              个需关注批次
            </span>
          </div>
          <div className="expiry-grid">
            {alerts.map((l) => (
              <button
                className="expiry-card"
                key={l.id}
                onClick={() => openLot(l.id)}
              >
                <div className="ingredient-icon">
                  <Leaf size={27} />
                </div>
                <div>
                  <Badge tone={daysLeft(l.expires, today) < 0 ? "red" : "warm"}>
                    {expiryLabel(l.expires, today)}
                  </Badge>
                  <h3>
                    {
                      state.ingredients.find((i) => i.id === l.ingredientId)!
                        .name
                    }
                  </h3>
                  <small>
                    {amount(l.quantity, l.unit)} · {l.location} ·{" "}
                    {l.expires ?? "到期日待核对"}
                  </small>
                </div>
                <ArrowUpRight size={17} />
              </button>
            ))}
            {alerts.length === 0 && <Empty>暂时没有临期批次</Empty>}
          </div>
          <section className="panel inventory-panel">
            <div className="section-heading">
              <h2>
                我的食材{" "}
                <Badge>
                  {
                    new Set(
                      foodLots
                        .filter((l) => l.quantity > 0)
                        .map((l) => l.ingredientId),
                    ).size
                  }{" "}
                  种
                </Badge>
              </h2>
              <span className="hint">按批次记录 · 点击查看详情</span>
            </div>
            <div className="filters">
              <div className="search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索食材名称…"
                  aria-label="搜索库存"
                />
              </div>
              <select
                aria-label="筛选储存位置"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                {["全部位置", "冷藏", "冷冻", "常温"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
              <select
                aria-label="筛选食材类别"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {["全部类别", ...state.ingredientCategories].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <button onClick={() => setCategories(true)}>管理分类</button>
              <button
                className="text-button"
                onClick={() => {
                  setLocation("全部位置");
                  setCategory("全部类别");
                  setQuery("");
                }}
              >
                清除筛选
              </button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>食材 / 批次</th>
                    <th>储存位置</th>
                    <th>剩余量</th>
                    <th>到期时间</th>
                    <th>状态</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <strong>
                          {
                            state.ingredients.find(
                              (i) => i.id === l.ingredientId,
                            )!.name
                          }
                        </strong>
                        <small>购买于 {l.received}</small>
                      </td>
                      <td>
                        <Badge>{l.location}</Badge>
                      </td>
                      <td>
                        {amount(l.quantity, l.unit)}
                        {l.precision === "rough" && <small>粗略，需确认</small>}
                      </td>
                      <td>{l.expires ?? "未记录有效期"}</td>
                      <td>
                        <Badge
                          tone={
                            !l.expires
                              ? "warm"
                              : daysLeft(l.expires, today) < 0
                                ? "red"
                                : daysLeft(l.expires, today) <= 3
                                  ? "warm"
                                  : "green"
                          }
                        >
                          {l.quantity === 0
                            ? "已用完"
                            : expiryLabel(l.expires, today)}
                        </Badge>
                      </td>
                      <td>
                        <button
                          onClick={() => openLot(l.id)}
                          aria-label={`查看${state.ingredients.find((i) => i.id === l.ingredientId)!.name}批次`}
                        >
                          查看 <ArrowUpRight size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && (
              <Empty>没有匹配食材，清除筛选或添加一批食材。</Empty>
            )}
          </section>
        </div>
        <aside>
          <Seasonings />
        </aside>
      </div>
      {categories && (
        <CategoryManager
          kind="ingredient"
          onClose={() => {
            setCategories(false);
            setCategory("全部类别");
          }}
        />
      )}
      {add && <ItemForm mode="inventory" onClose={() => setAdd(false)} />}
    </>
  );
}
