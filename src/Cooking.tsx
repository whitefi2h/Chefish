import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "./components";
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
      available: string;
      unit?: string;
      factor?: string;
      location: string;
      expires: string | null;
      review: boolean;
      suggested: string;
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
  const { state, today, mutate, busy } = useDemo();
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
  const [error, setError] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    invoke<CookingPreview>("kitchen_cooking", {
      planId: plan.id,
      servings,
      date,
    })
      .then((p) => {
        if (!alive) return;
        setPreview(p);
        setQuantities(
          Object.fromEntries(
            p.rows.flatMap((r) => r.lots.map((l) => [l.id, l.suggested])),
          ),
        );
        setError("");
      })
      .catch((e) => {
        if (alive) {
          setPreview(undefined);
          setError(errorMessage(e));
        }
      });
    return () => {
      alive = false;
    };
  }, [plan.id, servings, date, refresh]);
  const ready = preview && preview.planVersion === (plan.version ?? 1);
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
    setInterpreting(true);
    setError("");
    try {
      const result = await invoke<{
        preview: CookingPreview;
        quantities: Record<string, string>;
        summary: string;
        assumptions: string[];
      }>("kitchen_cooking_interpret", {
        planId: plan.id,
        servings,
        date,
        record,
      });
      setPreview(result.preview);
      setQuantities(result.quantities);
      setInterpreted(`${record}|${servings}|${date}`);
      setSummary(result.summary);
      setAssumptions(result.assumptions ?? []);
      return result;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setInterpreting(false);
    }
  }
  return (
    <Modal title="完成烹饪" onClose={onClose}>
      <form
        className="form-stack cooking-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          let p = preview,
            q = quantities;
          if (
            record.trim() &&
            interpreted !== `${record}|${servings}|${date}` &&
            !manual
          ) {
            const result = await interpretRecord();
            if (!result) return;
            p = result.preview;
            q = result.quantities;
          }
          const saved = await mutate(
            {
              type: "complete_cooking",
              draft: {
                plan_id: plan.id,
                expected_version: p.planVersion,
                expected_revision: p.revision,
                servings,
                date,
                note,
                record,
                acknowledged: true,
                consumptions: p.rows.flatMap((r) =>
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
            "烹饪已完成，记录与实际用量已保存",
          );
          if (saved) onClose();
        }}
      >
        <div>
          <h3>{recipeForPlan(state, plan).name}</h3>
          <p className="hint">
            直接写下用了什么，AI 会按库存单位整理实际用量；也可以手动调整。
          </p>
        </div>
        <div className="form-row">
          <label>
            实际人数
            <input
              aria-label="实际人数"
              disabled={interpreting}
              type="number"
              min="1"
              max="12"
              required
              value={servings}
              onChange={(e) => {
                setPreview(undefined);
                setManual(false);
                setServings(Number(e.target.value));
              }}
            />
          </label>
          <label>
            烹饪日期
            <input
              aria-label="烹饪日期"
              disabled={interpreting}
              type="date"
              min="1900-01-01"
              max={today}
              required
              value={date}
              onChange={(e) => {
                setPreview(undefined);
                setManual(false);
                setDate(e.target.value);
              }}
            />
          </label>
        </div>
        <label>
          烹饪记录
          <textarea
            aria-label="烹饪记录"
            maxLength={4000}
            rows={4}
            value={record}
            disabled={interpreting}
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="记录口味、火候，或下次想改进的地方。"
          />
        </label>
        <div className="cooking-record-actions">
          <button
            type="button"
            disabled={!record.trim() || !ready || interpreting || busy}
            onClick={() => void interpretRecord()}
          >
            {interpreting ? "AI 正在整理用量…" : "AI 整理实际用量"}
          </button>
          <span className="hint">也可直接确认完成，AI 会先整理文字记录。</span>
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
        <details className="cooking-manual">
          <summary>手动调整实际用量</summary>
          {preview?.rows.map((r) => (
            <section
              className="cooking-ingredient"
              key={`${r.ingredientId}|${r.unit}`}
            >
              <div className="section-heading">
                <h3>{r.name}</h3>
                <span className="hint">
                  配方用量 {r.required} {r.unit}
                </span>
              </div>
              {r.lots.map((l) => (
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
                    disabled={interpreting}
                    type="number"
                    min="0"
                    max={l.available}
                    step="0.000001"
                    required
                    value={quantities[l.id] ?? "0"}
                    onChange={(e) => {
                      setManual(true);
                      setQuantities((q) => ({ ...q, [l.id]: e.target.value }));
                    }}
                  />
                  <span>{l.unit ?? r.unit}</span>
                </label>
              ))}
              {!r.lots.length && (
                <p className="hint">
                  本次配方食材未记入库存，烹饪记录仍会保留。
                </p>
              )}
            </section>
          ))}
        </details>
        {preview && (!preview.rows.length || short) && (
          <p className="hint">只扣减库存中记录的用量，其余保留在烹饪记录中。</p>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setPreview(undefined);
              setRefresh((n) => n + 1);
            }}
          >
            刷新建议
          </button>
          <button
            className="primary"
            type="submit"
            disabled={busy || interpreting || !ready}
          >
            确认完成
          </button>
        </div>
      </form>
    </Modal>
  );
}
