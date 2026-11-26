import StockSlider from "./StockSlider";
import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./components";
import { LotDetail } from "./Inventory";
import { stockLevelText } from "./domain/stock";
import { useDemo } from "./store";
import { errorMessage } from "./services/kitchenClient";
import { recipeForPlan, type PlannedMeal } from "./model";
export interface CookingPreview {
  planVersion: number;
  revision: string;
  rows: {
    ingredientId: string;
    name: string;
    unit: string;
    required: string;
    missing: string;
    lots: {
      id: string;
      version: number;
      stockRevision?: string;
      available: string;
      unit?: string;
      factor?: string;
      location: string;
      expires: string | null;
      review: boolean;
      suggested: string;
      measurement?: "exact" | "level";
      level?: number | null;
    }[];
  }[];
}
export function CookingForm({
  plan,
  onClose,
}: {
  plan: PlannedMeal;
  onClose: () => void;
}) {
  const { state, today, mutate, busy, preferences } = useDemo();
  const coarse = preferences.inventoryMode === "rough";
  const [levelChanges, setLevelChanges] = useState<
    Record<
      string,
      {
        level: number;
        expected_version: number;
        expected_stock_revision?: string;
      }
    >
  >({});
  const changesRef = useRef(levelChanges);
  useEffect(() => {
    changesRef.current = levelChanges;
  }, [levelChanges]);
  const interpretEpoch = useRef(0);
  const submitting = useRef(false);
  const [saving, setSaving] = useState(false);
  const touchedLevels = useRef(new Set<string>());
  const touchedQuantities = useRef(new Set<string>());
  const [servings, setServings] = useState(plan.servings);
  const [date, setDate] = useState(plan.day);
  const [note, setNote] = useState("");
  const [record, setRecord] = useState("");
  const [interpreting, setInterpreting] = useState(false);
  const [interpreted, setInterpreted] = useState("");
  const [summary, setSummary] = useState("");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const [preview, setPreview] = useState<CookingPreview>();
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [editingLot, setEditingLot] = useState<string>();
  const [error, setError] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  const stockRevision = state.dataRevision;
  useEffect(() => {
    let alive = true;
    interpretEpoch.current += 1;
    setInterpreting(false);
    setLoadingPreview(true);
    invoke<CookingPreview>("kitchen_cooking", {
      planId: plan.id,
      servings,
      date,
      lotIds: Object.keys(changesRef.current),
    })
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        if (coarse) {
          const ids = new Set(p.rows.flatMap((r) => r.lots.map((l) => l.id)));
          setLevelChanges((v) =>
            Object.fromEntries(Object.entries(v).filter(([id]) => ids.has(id))),
          );
          for (const id of touchedLevels.current)
            if (!ids.has(id)) touchedLevels.current.delete(id);
        }
        setQuantities((previous) =>
          Object.fromEntries(
            p.rows.flatMap((r) =>
              r.lots.map((lot) => [
                lot.id,
                touchedQuantities.current.has(lot.id) &&
                previous[lot.id] !== undefined
                  ? Number(previous[lot.id]) <= Number(lot.available)
                    ? previous[lot.id]
                    : "0"
                  : lot.suggested,
              ]),
            ),
          ),
        );
        setInterpreted("");
        setError("");
      })
      .catch((e) => {
        if (alive) {
          setPreview(undefined);
          setError(errorMessage(e));
        }
      })
      .finally(() => {
        if (alive) setLoadingPreview(false);
      });
    return () => {
      alive = false;
      interpretEpoch.current += 1;
    };
  }, [plan.id, servings, date, refresh, coarse, stockRevision]);
  const previewLots = preview?.rows.flatMap((r) => r.lots) ?? [];
  const conflicts = Object.entries(levelChanges).filter(([id, change]) => {
    const lot = previewLots.find((l) => l.id === id);
    return (
      !lot ||
      (change.expected_stock_revision && lot.stockRevision
        ? change.expected_stock_revision !== lot.stockRevision
        : change.expected_version !== lot.version)
    );
  });
  const ready = !!preview && !loadingPreview && !conflicts.length;
  const short = preview?.rows.some(
    (r) =>
      r.lots.reduce(
        (n, l) => n + Number(quantities[l.id] ?? 0) * Number(l.factor ?? 1),
        0,
      ) +
        0.0000001 <
      Number(r.required),
  );
  async function interpretRecord() {
    const epoch = ++interpretEpoch.current;
    setInterpreting(true);
    setError("");
    try {
      const result = await invoke<{
        preview: CookingPreview;
        quantities: Record<string, string>;
        summary: string;
        assumptions: string[];
        levels?: {
          lot_id: string;
          expected_version: number;
          expected_stock_revision?: string;
          level: number;
        }[];
      }>("kitchen_cooking_interpret", {
        planId: plan.id,
        servings,
        date,
        record,
      });
      if (epoch !== interpretEpoch.current || (coarse && submitting.current))
        return null;
      setPreview((previous) => {
        if (!coarse) return result.preview;
        const ids = new Set(
          result.preview.rows.flatMap((r) => r.lots.map((l) => l.id)),
        );
        const manualRows = (previous?.rows ?? [])
          .map((r) => ({
            ...r,
            lots: r.lots.filter(
              (l) => touchedLevels.current.has(l.id) && !ids.has(l.id),
            ),
          }))
          .filter((r) => r.lots.length);
        return {
          ...result.preview,
          rows: [...result.preview.rows, ...manualRows],
        };
      });
      if (coarse) {
        setLevelChanges((previous) => ({
          ...Object.fromEntries(
            Object.entries(previous).filter(([id]) =>
              touchedLevels.current.has(id),
            ),
          ),
          ...Object.fromEntries(
            (result.levels ?? [])
              .filter((c) => !touchedLevels.current.has(c.lot_id))
              .map((c) => [
                c.lot_id,
                {
                  level: c.level,
                  expected_version: c.expected_version,
                  expected_stock_revision: c.expected_stock_revision,
                },
              ]),
          ),
        }));
      } else setQuantities(result.quantities);
      setInterpreted(`${record}|${servings}|${date}`);
      setSummary(result.summary);
      setAssumptions(result.assumptions ?? []);
      return result;
    } catch (e) {
      if (epoch === interpretEpoch.current && !submitting.current)
        setError(errorMessage(e));
      return null;
    } finally {
      if (epoch === interpretEpoch.current) setInterpreting(false);
    }
  }
  return (
    <>
      <Modal title="完成烹饪" onClose={onClose}>
        <form
          className="form-stack cooking-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!preview || !ready || submitting.current) return;
            submitting.current = true;
            setSaving(true);
            setError("");
            try {
              let p = preview,
                q = quantities;
              if (
                !coarse &&
                record.trim() &&
                interpreted !== `${record}|${servings}|${date}` &&
                !manual
              ) {
                const result = await interpretRecord();
                if (result) {
                  p = result.preview;
                  q = result.quantities;
                } else {
                  // Preserve the record without applying recipe suggestions as actual usage.
                  q = {};
                }
              }
              const saved = await mutate(
                {
                  ...(coarse
                    ? {
                        type: "complete_level_cooking" as const,
                        changes: Object.entries(levelChanges).map(
                          ([lot_id, change]) => ({ lot_id, ...change }),
                        ),
                      }
                    : { type: "complete_cooking" as const }),
                  draft: {
                    plan_id: plan.id,
                    expected_version: p.planVersion,
                    expected_revision: p.revision,
                    servings,
                    date,
                    note,
                    record,
                    acknowledged: true,
                    consumptions: coarse
                      ? []
                      : p.rows.flatMap((r) =>
                          r.lots
                            .filter((l) => Number(q[l.id] ?? 0) > 0)
                            .map((l) => ({
                              lot_id: l.id,
                              expected_version: l.version,
                              quantity: q[l.id],
                            })),
                        ),
                  },
                },
                (s) => s,
                coarse
                  ? "烹饪已完成，记录与剩余状态已保存"
                  : record.trim() && !Object.keys(q).length
                    ? "烹饪已完成，文字记录已保存，库存未扣减"
                    : "烹饪已完成，记录与实际用量已保存",
              );
              if (saved) {
                interpretEpoch.current += 1;
                onClose();
              } else
                setError(
                  "本次未保存，文字和拉杆调整仍保留。请核对提示后重试；库存有变化时可刷新建议。",
                );
            } catch (error) {
              setError(errorMessage(error));
            } finally {
              submitting.current = false;
              setSaving(false);
            }
          }}
        >
          <div>
            <h3>{recipeForPlan(state, plan).name}</h3>
            {!coarse && (
              <p className="hint">
                直接写下用了什么，AI 会按库存单位整理实际用量；也可以手动调整。
              </p>
            )}
          </div>
          <div className="form-row">
            <label>
              实际人数
              <input
                aria-label="实际人数"
                disabled={interpreting || saving}
                type="number"
                min="1"
                max="12"
                required
                value={servings}
                onChange={(e) => {
                  setPreview(undefined);
                  setManual(false);
                  touchedQuantities.current.clear();
                  setServings(Number(e.target.value));
                }}
              />
            </label>
            <label>
              烹饪日期
              <input
                aria-label="烹饪日期"
                disabled={interpreting || saving}
                type="date"
                min="1900-01-01"
                max={today}
                required
                value={date}
                onChange={(e) => {
                  setPreview(undefined);
                  setManual(false);
                  touchedQuantities.current.clear();
                  setDate(e.target.value);
                }}
              />
            </label>
          </div>
          {coarse && (
            <section className="cooking-levels" aria-label="剩余库存">
              {preview?.rows.flatMap((r) =>
                r.lots.map((l) => (
                  <div className="cooking-level-row" key={l.id}>
                    <strong>
                      {r.name}
                      {r.lots.length > 1 ? ` · ${l.location}` : ""}
                    </strong>
                    <StockSlider
                      name={r.name}
                      value={levelChanges[l.id]?.level ?? l.level ?? 1}
                      disabled={busy || saving}
                      onTouch={() => touchedLevels.current.add(l.id)}
                      onChange={(level) => {
                        touchedLevels.current.add(l.id);
                        setLevelChanges((v) => ({
                          ...v,
                          [l.id]: {
                            level,
                            expected_version: l.version,
                            expected_stock_revision: l.stockRevision,
                          },
                        }));
                      }}
                    />
                  </div>
                )),
              )}
            </section>
          )}
          {coarse &&
            conflicts.map(([id]) => {
              const row = preview?.rows.find((r) =>
                r.lots.some((l) => l.id === id),
              );
              const lot = row?.lots.find((l) => l.id === id);
              return (
                <section key={id} role="alert" className="cooking-ai-summary">
                  <p>
                    {row?.name ?? "这批食材"}
                    的库存已变化，请核对。你的选择仍保留。
                  </p>
                  {lot && (
                    <p className="hint">
                      {lot.location} · 最新：{stockLevelText(lot.level ?? 1)}
                    </p>
                  )}
                  <div className="actions">
                    {lot && (
                      <button
                        type="button"
                        onClick={() =>
                          setLevelChanges((v) => ({
                            ...v,
                            [id]: {
                              ...v[id],
                              expected_version: lot.version,
                              expected_stock_revision: lot.stockRevision,
                            },
                          }))
                        }
                      >
                        保留我的选择
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        touchedLevels.current.delete(id);
                        setLevelChanges((v) => {
                          const next = { ...v };
                          delete next[id];
                          return next;
                        });
                      }}
                    >
                      {lot ? "使用最新档位" : "移除这项调整"}
                    </button>
                  </div>
                </section>
              );
            })}
          <label>
            烹饪记录
            <textarea
              aria-label="烹饪记录"
              maxLength={4000}
              rows={coarse ? 2 : 4}
              value={record}
              disabled={interpreting || saving}
              onChange={(e) => {
                setRecord(e.target.value);
                setManual(false);
                setSummary("");
                setAssumptions([]);
              }}
              placeholder="例如：肉酱用完了，大蒜和迷迭香各用了一点点，洋葱用了半个。"
            />
          </label>
          <label>
            烹饪手记（选填）
            <textarea
              aria-label="烹饪心得"
              maxLength={2000}
              disabled={saving}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="记录口味、火候，或下次想改进的地方。"
            />
          </label>
          <div className="cooking-record-actions">
            <button
              type="button"
              disabled={
                !record.trim() || !ready || interpreting || busy || saving
              }
              onClick={() => void interpretRecord()}
            >
              {interpreting
                ? "AI 正在整理…"
                : coarse
                  ? "AI 识别剩余情况"
                  : "AI 整理实际用量"}
            </button>
            {!coarse && (
              <span className="hint">
                也可直接确认完成，AI 会先整理文字记录。
              </span>
            )}
          </div>
          {summary && (
            <section className="cooking-ai-summary" role="status">
              <strong>{summary}</strong>
              {assumptions.map((a, i) => (
                <p className="hint" key={i}>
                  {a}
                </p>
              ))}
            </section>
          )}
          {error ? (
            <div role="alert">{error}</div>
          ) : (
            !preview && <p role="status">正在读取批次建议…</p>
          )}
          {!coarse && (
            <details className="cooking-manual">
              <summary>手动调整实际用量</summary>
              {preview?.rows
                .filter((r) => r.lots.length)
                .map((r) => (
                  <section
                    className="cooking-ingredient"
                    key={`${r.ingredientId}|${r.unit}`}
                  >
                    <div className="section-heading">
                      <h3>{r.name}</h3>
                      <span className="hint">
                        配方用量 {quantityText(r.required)} {r.unit}
                      </span>
                    </div>
                    {r.lots.map((l) =>
                      l.measurement === "level" ? (
                        <div className="cooking-lot" key={l.id}>
                          <span>
                            {l.location}
                            <small>
                              仍按档位记录 · {stockLevelText(l.level)}
                            </small>
                          </span>
                          <button
                            type="button"
                            disabled={saving || interpreting}
                            onClick={() => setEditingLot(l.id)}
                          >
                            补填当前数量
                          </button>
                        </div>
                      ) : (
                        <label className="cooking-lot" key={l.id}>
                          <span>
                            {l.location}
                            {l.expires ? ` · ${l.expires}` : ""}
                            <small>
                              剩余 {l.available} {l.unit ?? r.unit}
                              {l.review && l.expires ? " · 已过期" : ""}
                            </small>
                          </span>
                          <input
                            aria-label={`${r.name} ${l.id} 实际用量`}
                            disabled={interpreting || saving}
                            type="number"
                            min="0"
                            max={l.available}
                            step="0.000001"
                            value={quantities[l.id] ?? "0"}
                            onChange={(e) => {
                              setManual(true);
                              touchedQuantities.current.add(l.id);
                              setQuantities((q) => ({
                                ...q,
                                [l.id]: e.target.value,
                              }));
                            }}
                          />
                          <span>{l.unit ?? r.unit}</span>
                        </label>
                      ),
                    )}
                  </section>
                ))}
            </details>
          )}
          {!coarse && preview && (!preview.rows.length || short) && (
            <p className="hint">
              只扣减库存中记录的用量，其余保留在烹饪记录中。
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              disabled={busy || saving}
              onClick={() => {
                setRefresh((n) => n + 1);
              }}
            >
              刷新建议
            </button>
            <button
              className="primary"
              type="submit"
              disabled={busy || saving || (!coarse && interpreting) || !ready}
            >
              确认完成
            </button>
          </div>
        </form>
      </Modal>
      {editingLot && (
        <LotDetail
          id={editingLot}
          onClose={() => {
            setEditingLot(undefined);
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
import { quantityText } from "./domain/quantity";
