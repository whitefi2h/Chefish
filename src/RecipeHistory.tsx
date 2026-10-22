import { useEffect, useState } from "react";
import { Modal, Badge } from "./components";
import { useDemo } from "./store";
import { amount, type Recipe } from "./model";
import { errorMessage } from "./services/kitchenClient";

export default function RecipeHistory({
  recipe,
  onClose,
  onEdit,
}: {
  recipe: Recipe;
  onClose: () => void;
  onEdit?: (source: Recipe) => void;
}) {
  const { state, recipeHistory } = useDemo();
  const [rows, setRows] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  // Loading is tied to the requested recipe, not changes to the provider callback.
  const [load] = useState(() => recipeHistory);
  useEffect(() => {
    let alive = true;
    load(recipe.id)
      .then((next) => {
        if (alive) {
          setRows(next);
          setError("");
        }
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [load, recipe.id, attempt]);
  const version = rows[selected];
  return (
    <Modal title="菜谱历史版本" onClose={onClose}>
      {error ? (
        <div className="form-stack">
          <p role="alert" className="error">
            {error}
          </p>
          <button onClick={() => setAttempt((n) => n + 1)}>重试读取</button>
        </div>
      ) : !version ? (
        <p className="hint">正在读取版本…</p>
      ) : (
        <div className="form-stack recipe-history">
          <label>
            查看版本
            <select
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {rows.map((r, i) => (
                <option key={r.revisionId ?? i} value={i}>
                  第 {r.revisionNumber ?? 1} 版
                  {r.revisionId === recipe.revisionId ? " · 当前版本" : ""} ·{" "}
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div>
            <Badge tone="green">第 {version.revisionNumber ?? 1} 版</Badge>
            <h2>{version.name}</h2>
            <p className="hint">
              {version.minutes} 分钟 · {version.servings} 人份
            </p>
            <p>{version.subtitle}</p>
          </div>
          <section>
            <h3>食材用量</h3>
            {version.requirements.map((r, i) => (
              <div className="ingredient-line" key={i}>
                <span>
                  {state.ingredients.find((v) => v.id === r.ingredientId)
                    ?.name ?? "未命名食材"}
                </span>
                <strong>{amount(r.quantity, r.unit)}</strong>
              </div>
            ))}
            {version.textIngredients?.map((item, i) => (
              <div className="ingredient-line" key={`text-${i}`}>
                <span>{item.name}</span>
                <strong>{item.amountText}</strong>
              </div>
            ))}
            <p>{version.seasoning}</p>
          </section>
          <section>
            <h3>烹饪步骤</h3>
            <ol>
              {version.steps.map((step, i) => (
                <li key={i}>
                  {version.stepTitles?.[i] && (
                    <strong>
                      {version.stepTitles[i]}
                      <br />
                    </strong>
                  )}
                  {step}
                </li>
              ))}
            </ol>
          </section>
          {onEdit && (
            <div className="actions recipe-edit-actions">
              <button onClick={onClose}>关闭</button>
              <button className="primary" onClick={() => onEdit(version)}>
                用此版本编辑
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
