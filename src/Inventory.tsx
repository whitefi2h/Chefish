import StockSlider from "./StockSlider";
import { hasStock, stockLevelText } from "./domain/stock";
import { confirmAction } from "./services/dialogs";
import { CarouselButtons, useHorizontalCarousel } from "./HorizontalCarousel";
import IngredientAvatar, { IngredientAvatarCredit } from "./IngredientAvatar";
import {
  foodInventoryLots,
  expiringInventoryLots,
  inventoryStatus,
} from "./domain/inventory";
import {
  rememberIngredientPhoto,
  usesIngredientPhoto,
} from "./services/ingredientAvatars";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./services/kitchenClient";
import CategoryManager from "./CategoryManager";
import Seasonings from "./Seasonings";
import { defaultIngredientUnit } from "./domain/ingredientStandards";
import { ingredientCategory } from "./domain/ingredientCategory";
import categoryRules from "./domain/ingredientCategories.json";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Minus,
  Search,
  ArrowUpRight,
  RotateCw,
  AlertTriangle,
  Trash2,
} from "lucide-react";
import {
  shiftDate,
  amount,
  daysLeft,
  type Category,
  type Location,
  type ShoppingItem,
  type DemoState,
  type InventoryLot,
} from "./model";
import { useDemo } from "./store";
import { Badge, Modal, Empty } from "./components";
function LevelReceive({ onClose }: { onClose: () => void }) {
  const { mutate, busy, state } = useDemo();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("自动分类");
  const [level, setLevel] = useState(1);
  return (
    <Modal title="新增食材购买" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await mutate(
              { type: "receive_level_lot", name, category, level },
              (s) => s,
              "食材已入库",
            )
          )
            onClose();
        }}
      >
        <label>
          食材名称
          <input
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          食材类别
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>自动分类</option>
            {state.ingredientCategories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <StockSlider
          name={name || "食材"}
          value={level}
          disabled={busy}
          onChange={(v) => {
            setLevel(v);
          }}
        />
        <button className="primary" disabled={busy || level < 0}>
          确认购买
        </button>
      </form>
    </Modal>
  );
}
export function ItemForm(props: {
  mode: "inventory" | "shopping";
  onClose: () => void;
  item?: ShoppingItem;
}) {
  const { preferences } = useDemo();
  return preferences.inventoryMode === "rough" && props.mode === "inventory" ? (
    <LevelReceive onClose={props.onClose} />
  ) : (
    <NumericItemForm {...props} />
  );
}
function NumericItemForm({
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
  const [quantityChosen, setQuantityChosen] = useState(!!item);
  const [unit, setUnit] = useState(item?.unit ?? "g");
  const [unitChosen, setUnitChosen] = useState(!!item);
  const [category, setCategory] = useState<Category>(
    item?.category ?? "自动分类",
  );
  const [location, setLocation] = useState<Location>("冷藏");
  const [expires, setExpires] = useState(persistent ? "" : shiftDate(today, 7));
  const [received, setReceived] = useState(today);
  const rough = true;
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
            const inferred =
              category === "自动分类" ? ingredientCategory(name) : category;
            const next = {
              ...s,
              ingredients: found
                ? s.ingredients
                : [
                    ...s.ingredients,
                    { id: ingredientId, name: name.trim(), category: inferred },
                  ],
            };
            return mode === "inventory"
              ? {
                  ...next,
                  ingredientCategories: [
                    ...new Set([...next.ingredientCategories, inferred]),
                  ],
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
                      category: found?.category ?? inferred,
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
            onChange={(e) => {
              setName(e.target.value);
              if (!unitChosen) {
                const suggested = defaultIngredientUnit(e.target.value) ?? "g";
                setUnit(suggested);
                if (!quantityChosen)
                  setQuantity(["个", "片", "盒"].includes(suggested) ? 1 : 100);
              }
            }}
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
              onChange={(e) => {
                setQuantity(Number(e.target.value));
                setQuantityChosen(true);
              }}
            />
          </label>
          <label>
            单位
            <select
              aria-label="单位"
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
                setUnitChosen(true);
              }}
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
            <option>自动分类</option>
            {[
              ...new Set([
                ...state.ingredientCategories,
                ...categoryRules.map((rule) => rule.category),
                "未分类",
              ]),
            ].map((c) => (
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
                  {["冷藏", "冷冻", "常温", "未指定"].map((l) => (
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
          </>
        )}
        <p className="hint">
          自动分类识别常见食材，可手动修改；同名食材沿用已有分类。
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
function DeleteLotButton({
  lot,
  onDeleted,
  compact = false,
}: {
  lot: InventoryLot;
  onDeleted: () => void;
  compact?: boolean;
}) {
  const { state, mutate, busy } = useDemo();
  const ingredient = state.ingredients.find((i) => i.id === lot.ingredientId)!;
  async function remove() {
    if (
      !(await confirmAction(
        `删除“${ingredient.name}”这批食材？删除后将从库存移除，历史购买和烹饪记录保留。`,
      ))
    )
      return;
    const saved = await mutate(
      {
        type: "delete_lot",
        lot_id: lot.id,
        expected_version: lot.version ?? 1,
      },
      (s) => ({ ...s, lots: s.lots.filter((l) => l.id !== lot.id) }),
      "食材批次已删除",
    );
    if (saved) onDeleted();
  }
  return (
    <button
      type="button"
      className="danger-button"
      disabled={busy}
      aria-label={`删除${ingredient.name}批次`}
      title={`删除${ingredient.name}批次`}
      onClick={() => void remove()}
    >
      <Trash2 size={15} />
      {!compact && "删除批次"}
    </button>
  );
}
function LotEditor({
  lot,
  onDeleted,
  onSaved,
}: {
  lot: InventoryLot;
  onDeleted: () => void;
  onSaved: () => void;
}) {
  const { state, mutate, busy, preferences } = useDemo();
  const ingredient = state.ingredients.find((i) => i.id === lot.ingredientId)!;
  const [baseline, setBaseline] = useState({
    lot,
    category: ingredient.category,
    coarse: preferences.inventoryMode === "rough",
  });
  const [level, setLevel] = useState<number | null>(
    lot.measurement === "level"
      ? (lot.level ?? null)
      : lot.quantity === 0
        ? -1
        : null,
  );
  const coarse = baseline.coarse;
  const [quantity, setQuantity] = useState(
    lot.measurement === "level" && !coarse
      ? ""
      : (lot.quantityText ?? String(lot.quantity)),
  );
  const [unit, setUnit] = useState(lot.unit);
  const [location, setLocation] = useState(lot.location);
  const [received, setReceived] = useState(lot.received);
  const [expires, setExpires] = useState(lot.expires ?? "");
  const rough = lot.precision === "rough";
  const [category, setCategory] = useState(ingredient.category);
  const stale =
    lot.version !== baseline.lot.version ||
    lot.stockRevision !== baseline.lot.stockRevision ||
    ingredient.category !== baseline.category ||
    (preferences.inventoryMode === "rough") !== coarse;
  function review(keep: boolean) {
    const old = baseline.lot;
    const nextCoarse = preferences.inventoryMode === "rough";
    const oldLevel =
      old.measurement === "level"
        ? (old.level ?? null)
        : old.quantity === 0
          ? -1
          : null;
    if (!keep || level === oldLevel)
      setLevel(
        lot.measurement === "level"
          ? (lot.level ?? null)
          : lot.quantity === 0
            ? -1
            : null,
      );
    const oldQuantity =
      old.measurement === "level" && !coarse
        ? ""
        : (old.quantityText ?? String(old.quantity));
    if (!keep || quantity === oldQuantity)
      setQuantity(
        lot.measurement === "level" && !nextCoarse
          ? ""
          : (lot.quantityText ?? String(lot.quantity)),
      );
    if (!keep || unit === old.unit) setUnit(lot.unit);
    if (!keep || location === old.location) setLocation(lot.location);
    if (!keep || received === old.received) setReceived(lot.received);
    if (!keep || expires === (old.expires ?? "")) setExpires(lot.expires ?? "");
    if (!keep || category === baseline.category)
      setCategory(ingredient.category);
    setBaseline({ lot, category: ingredient.category, coarse: nextCoarse });
  }
  const changed =
    level !==
      (baseline.lot.measurement === "level"
        ? (baseline.lot.level ?? null)
        : baseline.lot.quantity === 0
          ? -1
          : null) ||
    (baseline.lot.measurement === "level" && !coarse
      ? quantity !== ""
      : Number(quantity) !== baseline.lot.quantity) ||
    unit !== baseline.lot.unit ||
    location !== baseline.lot.location ||
    received !== baseline.lot.received ||
    (expires || null) !== baseline.lot.expires ||
    category !== baseline.category;
  return (
    <form
      className="form-stack lot-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (stale) return;
        const inferred =
          category === "自动分类"
            ? ingredientCategory(ingredient.name)
            : category;
        const saved = await mutate(
          {
            ...(coarse
              ? {
                  type: "edit_level_lot" as const,
                  level,
                  expected_stock_revision: baseline.lot.stockRevision,
                }
              : { type: "edit_lot" as const }),
            lot_id: lot.id,
            expected_version: baseline.lot.version ?? 1,
            draft: {
              quantity,
              unit,
              location,
              received,
              expires: expires || null,
              precision: rough ? "rough" : "exact",
              category,
            },
          },
          (s) => ({
            ...s,
            ingredientCategories: [
              ...new Set([...s.ingredientCategories, inferred]),
            ],
            ingredients: s.ingredients.map((i) =>
              i.id === ingredient.id ? { ...i, category: inferred } : i,
            ),
            shopping: s.shopping.map((i) =>
              i.ingredientId === ingredient.id
                ? { ...i, category: inferred }
                : i,
            ),
            lots: s.lots.map((l) =>
              l.id === lot.id
                ? {
                    ...l,
                    quantity: Number(quantity),
                    quantityText: quantity,
                    unit,
                    location,
                    received,
                    expires: expires || null,
                    precision: rough ? "rough" : "exact",
                    version: (l.version ?? 1) + 1,
                  }
                : l,
            ),
          }),
          "食材已更新",
        );
        if (saved) onSaved();
      }}
    >
      {stale && (
        <section className="cooking-ai-summary" role="alert">
          <p>这批食材已更新，你的修改仍保留。请核对后再保存。</p>
          <p className="hint">
            最新库存：
            {lot.measurement === "level" ||
            preferences.inventoryMode === "rough"
              ? stockLevelText(lot.level)
              : amount(lot.quantity, lot.unit)}{" "}
            · {lot.location}
          </p>
          <div className="actions">
            {coarse === (preferences.inventoryMode === "rough") && (
              <button
                type="button"
                disabled={busy}
                onClick={() => review(true)}
              >
                保留修改并合并最新信息
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => review(false)}>
              使用最新内容
            </button>
          </div>
        </section>
      )}
      <fieldset disabled={busy} className="lot-fields">
        {coarse ? (
          <StockSlider
            value={level}
            name={ingredient.name}
            disabled={busy}
            onChange={(v) => setLevel(v)}
          />
        ) : (
          <div className="form-row">
            <label>
              剩余数量（{unit}）
              <input
                type="number"
                min="0"
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
                aria-label="库存单位"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {["g", "ml", "个", "片", "盒"].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </label>
          </div>
        )}
        {unit !== lot.unit && (
          <p className="hint">
            单位修正会按填写的数量保存；请同时核对剩余数量，不会自动换算或改写历史记录。
          </p>
        )}
        <div className="form-row">
          <label>
            储存位置
            <select
              aria-label="储存位置"
              value={location}
              onChange={(e) => setLocation(e.target.value as Location)}
            >
              {["冷藏", "冷冻", "常温", "未指定"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-row">
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
          <label>
            到期日期
            <input
              type="date"
              min={received}
              max="2100-12-31"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </label>
        </div>
        <label>
          食材类别
          <select
            aria-label="食材所属分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option>自动分类</option>
            {[
              ...new Set([
                ...state.ingredientCategories,
                ...categoryRules.map((rule) => rule.category),
                "未分类",
              ]),
            ].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="hint">分类适用于同名食材的所有批次。</p>
        <div className="actions lot-editor-actions">
          <button
            className="primary"
            disabled={!changed || stale}
            type="submit"
          >
            保存修改
          </button>
          <DeleteLotButton lot={lot} onDeleted={onDeleted} />
        </div>
      </fieldset>
    </form>
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
  const [selected, setSelected] = useState(id);
  const [savedGeneration, setSavedGeneration] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const original = state.lots.find((l) => l.id === id);
  const lot = state.lots.find((l) => l.id === selected) ?? original;
  if (!lot)
    return (
      <Modal title="食材详情" onClose={onClose} drawer>
        <Empty>该批次已删除。</Empty>
      </Modal>
    );
  const ingredient = state.ingredients.find((i) => i.id === lot.ingredientId)!;
  return (
    <Modal title={`食材详情 · ${ingredient.name}`} onClose={onClose} drawer>
      <div className="ingredient-detail-image">
        <IngredientAvatar ingredient={ingredient} size="large" />
        <div>
          <strong>{ingredient.name}</strong>
          <p>{ingredient.category}</p>
          {persistent && (
            <button
              type="button"
              disabled={imageBusy}
              onClick={async () => {
                setImageBusy(true);
                setImageError("");
                try {
                  const result = await invoke<{ updated: number }>(
                    "kitchen_ingredient_images",
                    {
                      ingredientId: ingredient.id,
                      instruction:
                        "换一张不同的图片，食材本体清楚、背景干净，不要包装",
                    },
                  );
                  if (result.updated) rememberIngredientPhoto(ingredient.name);
                  window.dispatchEvent(new Event("chefish:sync-data"));
                  window.dispatchEvent(new Event("chefish:sync-wake"));
                } catch (error) {
                  setImageError(errorMessage(error));
                } finally {
                  setImageBusy(false);
                }
              }}
            >
              <RotateCw size={14} />
              {imageBusy ? "正在找图…" : "让 AI 换张图片"}
            </button>
          )}
        </div>
      </div>
      {imageError && (
        <p className="error" role="alert">
          {imageError}
        </p>
      )}
      <IngredientAvatarCredit ingredient={ingredient} />
      {ingredient.image && usesIngredientPhoto(ingredient) && (
        <p className="ingredient-image-credit">
          图片：{ingredient.image.author} · {ingredient.image.license} · 已缩放
          {persistent && (
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void invoke("kitchen_open_image_source", {
                  url: ingredient.image!.sourceUrl,
                })
              }
            >
              查看来源与许可
            </button>
          )}
        </p>
      )}
      <label className="form-stack">
        选择批次
        <select value={lot.id} onChange={(e) => setSelected(e.target.value)}>
          {state.lots
            .filter((l) => l.ingredientId === lot.ingredientId)
            .map((l, i) => (
              <option key={l.id} value={l.id}>
                批次 {i + 1} ·{" "}
                {l.measurement === "level" ||
                state.preferences?.inventoryMode === "rough"
                  ? stockLevelText(l.level)
                  : amount(l.quantity, l.unit)}{" "}
                · {l.expires ?? "—"}
              </option>
            ))}
        </select>
      </label>
      <LotEditor
        key={`${lot.id}:${savedGeneration}`}
        lot={lot}
        onDeleted={onClose}
        onSaved={() => setSavedGeneration((n) => n + 1)}
      />
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
                  {event.levelEvent
                    ? `${stockLevelText(event.beforeLevel)} → ${stockLevelText(event.afterLevel)}`
                    : event.kind === "move"
                      ? `${event.beforeLocation} → ${event.afterLocation}`
                      : event.kind === "use" || event.kind === "discard"
                        ? `${amount(Number(event.before) - Number(event.after), event.afterUnit ?? lot.unit)} · 剩余 ${event.after} ${event.afterUnit ?? lot.unit}`
                        : event.kind === "receive"
                          ? `${event.after} ${event.afterUnit ?? lot.unit} · ${event.afterLocation}`
                          : event.kind === "reverse"
                            ? `恢复为 ${event.after} ${event.afterUnit ?? lot.unit} · ${event.afterLocation}`
                            : `${event.before} ${event.beforeUnit ?? lot.unit} → ${event.after} ${event.afterUnit ?? lot.unit}`}
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
        {persistent ? "本机日期" : "演示基准日"} {today}。
        {persistent
          ? "历史操作会自动保留，方便回看。"
          : "所有操作仅保留在本次会话。"}
      </p>
    </Modal>
  );
}
function LotQuantity({ lot, name }: { lot: InventoryLot; name: string }) {
  const { preferences, mutate, busy } = useDemo();
  if (preferences.inventoryMode === "rough" || lot.measurement === "level")
    return (
      <StockSlider
        name={name}
        value={
          lot.measurement === "level"
            ? (lot.level ?? null)
            : lot.quantity === 0
              ? -1
              : null
        }
        disabled={busy}
        onChange={(level) =>
          mutate(
            {
              type: "set_stock_level",
              change: {
                lot_id: lot.id,
                expected_version: lot.version ?? 1,
                expected_stock_revision: lot.stockRevision,
                level,
              },
            },
            (s) => ({
              ...s,
              lots: s.lots.map((l) =>
                l.id === lot.id ? { ...l, measurement: "level", level } : l,
              ),
            }),
            "库存已更新",
          )
        }
      />
    );
  return <NumericLotQuantity lot={lot} name={name} />;
}
function NumericLotQuantity({
  lot,
  name,
}: {
  lot: InventoryLot;
  name: string;
}) {
  const { mutate, busy, notify } = useDemo();
  const [value, setValue] = useState(lot.quantityText ?? String(lot.quantity));
  const cancel = useRef(false);
  useEffect(() => {
    setValue(lot.quantityText ?? String(lot.quantity));
  }, [lot.quantity, lot.quantityText]);
  const step = lot.unit === "g" || lot.unit === "ml" ? 50 : 1;
  async function save(raw: string) {
    const next = Number(raw);
    if (!raw.trim() || !Number.isFinite(next) || next < 0 || next > 100000) {
      setValue(lot.quantityText ?? String(lot.quantity));
      notify("数量须为 0–100000");
      return;
    }
    if (next === lot.quantity) return;
    setValue(raw);
    const saved = await mutate(
      {
        type: "change_lot",
        lot_id: lot.id,
        expected_version: lot.version ?? 1,
        operation: "correct",
        quantity: raw,
        location: null,
        reason: "",
      },
      (s) => ({
        ...s,
        lots: s.lots.map((l) =>
          l.id === lot.id
            ? {
                ...l,
                quantity: next,
                quantityText: raw,
                version: (l.version ?? 1) + 1,
              }
            : l,
        ),
      }),
      "数量已更新",
    );
    if (!saved) setValue(lot.quantityText ?? String(lot.quantity));
  }
  return (
    <div className="lot-quantity">
      <button
        type="button"
        aria-label={`减少${name}数量`}
        title={`减少 ${step} ${lot.unit}`}
        disabled={busy || Number(value) <= 0}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          void save(
            String(Number(Math.max(0, Number(value) - step).toFixed(6))),
          )
        }
      >
        <Minus size={13} />
      </button>
      <label className="lot-quantity-value">
        <input
          aria-label={`${name}剩余数量`}
          style={{
            width: `calc(${Math.max(2, Math.min(value.length, 7))}ch + 8px)`,
          }}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={busy}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (cancel.current) {
              cancel.current = false;
              return;
            }
            void save(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              cancel.current = true;
              setValue(lot.quantityText ?? String(lot.quantity));
              e.currentTarget.blur();
            }
          }}
        />
        <span>{lot.unit}</span>
      </label>
      <button
        type="button"
        aria-label={`增加${name}数量`}
        title={`增加 ${step} ${lot.unit}`}
        disabled={busy || Number(value) >= 100000}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() =>
          void save(
            String(Number(Math.min(100000, Number(value) + step).toFixed(6))),
          )
        }
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
function LotLocation({ lot, name }: { lot: InventoryLot; name: string }) {
  const { mutate, busy } = useDemo();
  return (
    <select
      className="lot-location"
      aria-label={`${name}储存位置`}
      value={lot.location}
      disabled={busy}
      onChange={(e) => {
        const location = e.target.value as Location;
        void mutate(
          {
            type: "change_lot",
            lot_id: lot.id,
            expected_version: lot.version ?? 1,
            operation: "move",
            quantity: "0",
            location,
            reason: "",
          },
          (s) => ({
            ...s,
            lots: s.lots.map((l) =>
              l.id === lot.id
                ? { ...l, location, version: (l.version ?? 1) + 1 }
                : l,
            ),
          }),
          "库位已更新",
        );
      }}
    >
      {["冷藏", "冷冻", "常温", "未指定"].map((location) => (
        <option key={location}>{location}</option>
      ))}
    </select>
  );
}
function FilterTags({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  return (
    <div className="inventory-tag-row" role="group" aria-label={`${label}筛选`}>
      <span className="inventory-tag-label">{label}</span>
      <div className="inventory-tags">
        <button
          type="button"
          aria-pressed={!selected.length}
          onClick={() => onChange([])}
        >
          全部
        </button>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={selected.includes(option)}
            onClick={() =>
              onChange(
                selected.includes(option)
                  ? selected.filter((value) => value !== option)
                  : [...selected, option],
              )
            }
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
export default function Inventory({
  openLot,
}: {
  openLot: (id: string) => void;
}) {
  const { state, today, mutate, busy } = useDemo();
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [add, setAdd] = useState(false);
  const [categories, setCategories] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

  const foodLots = foodInventoryLots(state);
  const alerts = expiringInventoryLots(foodLots, today);
  const attention = useHorizontalCarousel(alerts.map((l) => l.id).join("|"));
  const filtered = [...foodLots]
    .sort((a, b) => Number(!hasStock(a)) - Number(!hasStock(b)))
    .filter(
      (l) =>
        (showEmpty || hasStock(l)) &&
        state.ingredients
          .find((i) => i.id === l.ingredientId)!
          .name.includes(query) &&
        (!locations.length || locations.includes(l.location)) &&
        (!selectedCategories.length ||
          selectedCategories.includes(
            state.ingredients.find((i) => i.id === l.ingredientId)!.category,
          )),
    );
  return (
    <>
      <div className="page-heading">
        <div>
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
          {alerts.length > 0 && (
            <section className="inventory-attention" aria-label="需要关注">
              <div className="attention-heading">
                <h2>
                  <AlertTriangle size={16} />
                  需要关注 <span>{alerts.length}</span>
                </h2>
                <div className="attention-counts">
                  {alerts.some(
                    (l) => !!l.expires && daysLeft(l.expires, today) < 0,
                  ) && (
                    <span className="expired">
                      过期{" "}
                      {
                        alerts.filter(
                          (l) => !!l.expires && daysLeft(l.expires, today) < 0,
                        ).length
                      }
                    </span>
                  )}
                  {alerts.some(
                    (l) => !!l.expires && daysLeft(l.expires, today) >= 0,
                  ) && (
                    <span>
                      临期{" "}
                      {
                        alerts.filter(
                          (l) => !!l.expires && daysLeft(l.expires, today) >= 0,
                        ).length
                      }
                    </span>
                  )}
                  {alerts.some((l) => !l.expires) && (
                    <span>复查 {alerts.filter((l) => !l.expires).length}</span>
                  )}
                </div>
                <CarouselButtons carousel={attention} label="临期食材" />
              </div>
              <div
                className="attention-items"
                ref={attention.ref}
                onScroll={attention.measure}
                aria-label="临期食材，可横向滚动"
              >
                {alerts.map((l) => {
                  const ingredient = state.ingredients.find(
                    (i) => i.id === l.ingredientId,
                  )!;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      className="attention-item"
                      onClick={() => openLot(l.id)}
                    >
                      <IngredientAvatar ingredient={ingredient} />
                      <span>
                        <strong>{ingredient.name}</strong>
                        <small>
                          {l.measurement === "level" ||
                          state.preferences?.inventoryMode === "rough"
                            ? stockLevelText(l.level)
                            : amount(l.quantity, l.unit)}{" "}
                          · {l.location}
                        </small>
                      </span>
                      <Badge tone={inventoryStatus(l, today).tone}>
                        {inventoryStatus(l, today).label}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section className="panel inventory-panel">
            <div className="section-heading">
              <h2>
                我的食材{" "}
                <Badge>
                  {
                    new Set(
                      foodLots.filter(hasStock).map((l) => l.ingredientId),
                    ).size
                  }{" "}
                  种
                </Badge>
              </h2>
              <div className="search inventory-search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索食材名称…"
                  aria-label="搜索库存"
                />
              </div>
              <div className="inventory-toolbar">
                <label className="check-label inventory-empty-filter">
                  <input
                    type="checkbox"
                    checked={showEmpty}
                    onChange={(e) => setShowEmpty(e.target.checked)}
                  />
                  显示已用完
                </label>
                <button
                  className="inventory-category-button"
                  onClick={() => setCategories(true)}
                >
                  <span>管理分类</span>
                </button>
                <button
                  className="inventory-category-button"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      {
                        type: "classify_inventory",
                        expected_revision: state.dataRevision ?? "0",
                      },
                      (s) => {
                        const ingredients = s.ingredients.map((i) =>
                          i.category === "未分类"
                            ? { ...i, category: ingredientCategory(i.name) }
                            : i,
                        );
                        return {
                          ...s,
                          ingredients,
                          ingredientCategories: [
                            ...new Set([
                              ...s.ingredientCategories,
                              ...ingredients.map((i) => i.category),
                            ]),
                          ],
                        };
                      },
                      "未分类食材已自动分类",
                    )
                  }
                >
                  <span>自动分类</span>
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setLocations([]);
                    setSelectedCategories([]);
                    setQuery("");
                    setShowEmpty(false);
                  }}
                >
                  清除筛选
                </button>
              </div>
            </div>
            <div className="inventory-filter-tags">
              <FilterTags
                label="位置"
                options={["冷藏", "冷冻", "常温", "未指定"]}
                selected={locations}
                onChange={setLocations}
              />
              <FilterTags
                label="类别"
                options={state.ingredientCategories}
                selected={selectedCategories}
                onChange={setSelectedCategories}
              />
            </div>
            <div className="table-scroll">
              <table className="inventory-table">
                <colgroup>
                  <col className="inventory-col-name" />
                  <col className="inventory-col-location" />
                  <col className="inventory-col-quantity" />
                  <col className="inventory-col-expiry" />
                  <col className="inventory-col-status" />
                  <col className="inventory-col-actions" />
                </colgroup>
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
                        <div className="inventory-ingredient">
                          <IngredientAvatar
                            ingredient={state.ingredients.find(
                              (i) => i.id === l.ingredientId,
                            )!}
                          />
                          <div>
                            <strong>
                              {
                                state.ingredients.find(
                                  (i) => i.id === l.ingredientId,
                                )!.name
                              }
                            </strong>
                            <small>购买于 {l.received}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <LotLocation
                          lot={l}
                          name={
                            state.ingredients.find(
                              (i) => i.id === l.ingredientId,
                            )!.name
                          }
                        />
                      </td>
                      <td>
                        <LotQuantity
                          lot={l}
                          name={
                            state.ingredients.find(
                              (i) => i.id === l.ingredientId,
                            )!.name
                          }
                        />
                      </td>
                      <td className="inventory-expiry" title={l.steward?.basis}>
                        <span>{l.expires ?? l.steward?.reviewOn ?? "—"}</span>
                        {!l.expires && l.steward?.reviewOn && (
                          <small>预计复查</small>
                        )}
                        {l.steward?.suggestedLocation === l.location && (
                          <small>库位为推测</small>
                        )}
                      </td>
                      <td>
                        {!hasStock(l) ? (
                          <Badge>已用完</Badge>
                        ) : l.expires || l.steward?.reviewOn ? (
                          <Badge tone={inventoryStatus(l, today).tone}>
                            {inventoryStatus(l, today).label}
                          </Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <div className="inventory-row-actions">
                          <button
                            onClick={() => openLot(l.id)}
                            aria-label={`查看${state.ingredients.find((i) => i.id === l.ingredientId)!.name}批次`}
                          >
                            查看 <ArrowUpRight size={14} />
                          </button>
                          <DeleteLotButton
                            lot={l}
                            compact
                            onDeleted={() => {}}
                          />
                        </div>
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
            setSelectedCategories([]);
          }}
        />
      )}
      {add && <ItemForm mode="inventory" onClose={() => setAdd(false)} />}
    </>
  );
}
