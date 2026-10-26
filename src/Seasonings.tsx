import { CircleAlert, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { useDemo } from "./store";
import { Badge } from "./components";
import { supplies, setSupply } from "./domain/seasonings";
import IngredientAvatar from "./IngredientAvatar";
import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "./services/kitchenClient";

export default function Seasonings({
  reminder = false,
  onOpen,
}: {
  reminder?: boolean;
  onOpen?: () => void;
}) {
  const { state, mutate, busy, persistent, notify } = useDemo();
  const [name, setName] = useState("");
  const [replacing, setReplacing] = useState<string | null>(null);
  const all = supplies(state);
  const rows = reminder ? all.filter((s) => s.missing) : all;
  if (reminder && !rows.length) return null;
  async function mark(n: string, missing: boolean) {
    return mutate(
      {
        type: "set_seasoning",
        name: n,
        missing,
        expected_revision: state.dataRevision ?? "0",
      },
      (s) => setSupply(s, n, missing),
      missing ? "已标记缺少调料" : "调料已补齐",
    );
  }
  return (
    <section
      className={`panel seasoning-panel ${reminder ? "seasoning-reminder" : ""}`}
      aria-label={reminder ? "调料采购提醒" : "调料区"}
    >
      <div className="section-heading">
        <h2>{reminder ? "调料待补购" : "常备调料"}</h2>
        <Badge tone={all.some((s) => s.missing) ? "warm" : "green"}>
          {all.filter((s) => s.missing).length} 项缺少
        </Badge>
      </div>
      {!reminder && <p className="hint">点击感叹号标记缺货，再点一次取消。</p>}
      <div className="seasoning-list">
        {rows.map((s) => (
          <article
            className={`seasoning-row ${s.missing ? "missing" : ""}`}
            key={s.id}
          >
            <div className="seasoning-identity">
              {persistent ? (
                <button
                  className="seasoning-avatar"
                  aria-label={`让 AI 更换${s.name}图片`}
                  title={
                    s.image
                      ? `图片：${s.image.author} · ${s.image.license}。点击换图，右键查看来源与许可`
                      : "让 AI 换张图片"
                  }
                  onContextMenu={
                    s.image
                      ? (e) => {
                          e.preventDefault();
                          void invoke("kitchen_open_image_source", {
                            url: s.image!.sourceUrl,
                          }).catch((error) => notify(errorMessage(error)));
                        }
                      : undefined
                  }
                  disabled={replacing !== null}
                  onClick={async () => {
                    setReplacing(s.id);
                    try {
                      await invoke("kitchen_ingredient_images", {
                        ingredientId: `seasoning:${s.name}`,
                        instruction: "换张不同的调料图片，主体清楚、背景干净",
                      });
                      window.dispatchEvent(new Event("chefish:sync-data"));
                      window.dispatchEvent(new Event("chefish:sync-wake"));
                    } catch (error) {
                      notify(errorMessage(error));
                    } finally {
                      setReplacing(null);
                    }
                  }}
                >
                  <IngredientAvatar ingredient={s} />
                </button>
              ) : (
                <IngredientAvatar ingredient={s} />
              )}
              <span className="seasoning-name">
                <strong>{s.name}</strong>
                {s.missing && <span className="seasoning-status">缺货</span>}
              </span>
            </div>
            <div className="seasoning-actions">
              <button
                className={`seasoning-toggle ${s.missing ? "is-missing" : ""}`}
                aria-pressed={s.missing}
                title={s.missing ? "取消缺货标记" : "标记缺货"}
                disabled={busy}
                onClick={() => void mark(s.name, !s.missing)}
                aria-label={`${s.name}${s.missing ? "已补齐" : "标记缺少"}`}
              >
                <CircleAlert size={18} />
              </button>
              {!reminder && (
                <button
                  className="seasoning-delete"
                  aria-label={`删除调料${s.name}`}
                  title="移出常备调料"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      {
                        type: "remove_seasoning",
                        name: s.name,
                        expected_revision: state.dataRevision ?? "0",
                      },
                      (state) => ({
                        ...state,
                        seasonings: supplies(state).filter(
                          (v) => v.name !== s.name,
                        ),
                      }),
                      "已移出常备调料",
                    )
                  }
                >
                  <Trash2 size={15} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!reminder && (
        <form
          className="seasoning-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim() && (await mark(name.trim(), false))) setName("");
          }}
        >
          <input
            aria-label="新调料名称"
            placeholder="添加常备调料"
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <button disabled={busy || !name.trim()}>
            <Plus size={16} />
            添加
          </button>
        </form>
      )}
      {onOpen && (
        <button className="text-button" onClick={onOpen}>
          管理调料 →
        </button>
      )}
    </section>
  );
}
