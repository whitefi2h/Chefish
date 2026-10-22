import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge, Modal } from "./components";
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
      r.lots.reduce((n, l) => n + Number(quantities[l.id] ?? 0), 0) +
        0.0000001 <
      Number(r.required),
  );
  return (
    <Modal title="完成烹饪" onClose={onClose}>
      <form
        className="form-stack cooking-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!ready) return;
          const saved = await mutate(
            {
              type: "complete_cooking",
              draft: {
                plan_id: plan.id,
                expected_version: preview.planVersion,
                expected_revision: preview.revision,
                servings,
                date,
                note,
                acknowledged: true,
                consumptions: preview.rows.flatMap((r) =>
                  r.lots
                    .filter((l) => Number(quantities[l.id] ?? 0) > 0)
                    .map((l) => ({
                      lot_id: l.id,
                      expected_version: l.version,
                      quantity: quantities[l.id],
                    })),
                ),
              },
            },
            (s) => s,
            "烹饪已完成，已按确认用量更新库存",
          );
          if (saved) onClose();
        }}
      >
        <div>
          <h3>{recipeForPlan(state, plan).name}</h3>
          <p className="hint">建议按先到期批次分配；请核对这次实际用了多少。</p>
        </div>
        <div className="form-row">
          <label>
            实际人数
            <input
              aria-label="实际人数"
              type="number"
              min="1"
              max="12"
              required
              value={servings}
              onChange={(e) => {
                setPreview(undefined);
                setServings(Number(e.target.value));
              }}
            />
          </label>
          <label>
            烹饪日期
            <input
              aria-label="烹饪日期"
              type="date"
              min="1900-01-01"
              max={today}
              required
              value={date}
              onChange={(e) => {
                setPreview(undefined);
                setDate(e.target.value);
              }}
            />
          </label>
        </div>
        {error ? (
          <div role="alert">{error}</div>
        ) : (
          !preview && <p role="status">正在读取批次建议…</p>
        )}
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
                  {l.location} · {l.expires ?? "有效期待核对"}
                  <small>
                    剩余 {l.available} {r.unit}
                    {l.review ? " · 请核对日期和数量" : ""}
                  </small>
                </span>
                <input
                  aria-label={`${r.name} ${l.id} 实际用量`}
                  type="number"
                  min="0"
                  max={l.available}
                  step="0.000001"
                  required
                  value={quantities[l.id] ?? "0"}
                  onChange={(e) => {
                    setQuantities((q) => ({ ...q, [l.id]: e.target.value }));
                  }}
                />
                <span>{r.unit}</span>
              </label>
            ))}
            {!r.lots.length && (
              <p className="hint">
                没有可用的同单位批次；可先购买，或确认本次使用了未记入库存的食材。
              </p>
            )}
          </section>
        ))}
        {preview && (!preview.rows.length || short) && (
          <Badge tone="warm">部分用量未记入库存，仅扣减上方确认的数量</Badge>
        )}
        <label>
          烹饪心得（选填）
          <textarea
            aria-label="烹饪心得"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
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
          <button className="primary" type="submit" disabled={busy || !ready}>
            确认完成
          </button>
        </div>
      </form>
    </Modal>
  );
}
