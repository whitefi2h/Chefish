import { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check, Plus, X, Search, Pencil } from "lucide-react";
import { Modal } from "./components";
import { useDemo } from "./store";
import type { Recipe } from "./model";
import {
  ancestors,
  displayRecipeTags,
  legacyTags,
  recipeTagIds,
  searchTag,
  tagGroups,
  tagsOf,
  type RecipeTag,
  type TagGroup,
} from "./domain/recipeTags";

export function RecipeTagBadges({
  recipe,
  full = false,
}: {
  recipe: Recipe;
  full?: boolean;
}) {
  const { state } = useDemo(),
    tags = tagsOf(state);
  const visible = full
    ? recipeTagIds(recipe, tags)
        .map((id) => tags.find((t) => t.id === id && !t.deleted))
        .filter((t): t is RecipeTag => !!t)
    : displayRecipeTags(recipe, tags);
  const shown = full ? visible : visible.slice(0, 3);
  return (
    <div className="recipe-tag-badges">
      {shown.map((t) => (
        <span
          className={`recipe-tag ${t.group}`}
          data-tag-group={t.group}
          key={t.id}
        >
          {t.label}
          {full && !t.enabled && <small>未显示</small>}
        </span>
      ))}
      {!full && visible.length > 3 && (
        <span
          className="recipe-tag"
          title={visible
            .slice(3)
            .map((t) => t.label)
            .join("、")}
        >
          +{visible.length - 3}
        </span>
      )}
    </div>
  );
}

export function RecipeTagPicker({
  value,
  onChange,
  collapsed = false,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  collapsed?: boolean;
}) {
  const { state, busy } = useDemo(),
    tags = tagsOf(state),
    [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState(!collapsed),
    [manage, setManage] = useState(false);
  return (
    <div className="tag-picker">
      {collapsed && (
        <div className="tag-picker-summary">
          <div className="recipe-tag-badges">
            {value
              .map((id) => tags.find((t) => t.id === id && !t.deleted))
              .filter((t): t is RecipeTag => !!t)
              .map((t) => (
                <span
                  key={t.id}
                  className="recipe-tag"
                  data-tag-group={t.group}
                >
                  {t.label}
                </span>
              ))}
            {!value.length && <span className="hint">未选择标签</span>}
          </div>
          <button
            type="button"
            className="text-button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "收起标签" : "修改标签"}
            <ChevronDown size={14} />
          </button>
        </div>
      )}
      {expanded && (
        <>
          <div className="tag-picker-tools">
            <div className="search">
              <Search size={15} />
              <input
                aria-label="搜索可用菜谱标签"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标签…"
              />
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => setManage(true)}
            >
              管理标签
            </button>
          </div>
          {tagGroups.map((g) => (
            <div className="tag-picker-group" key={g.id}>
              <span>{g.label}</span>
              <div>
                {tags
                  .filter(
                    (t) =>
                      t.group === g.id &&
                      !t.deleted &&
                      (t.enabled || value.includes(t.id)) &&
                      searchTag(t, query, tags),
                  )
                  .map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      disabled={busy}
                      className={`tag-choice ${value.includes(t.id) ? "selected" : ""}`}
                      data-tag-group={t.group}
                      aria-pressed={value.includes(t.id)}
                      onClick={() =>
                        onChange(
                          value.includes(t.id)
                            ? value.filter((id) => id !== t.id)
                            : [...value, t.id],
                        )
                      }
                    >
                      {value.includes(t.id) && <Check size={12} />}
                      {t.label}
                      {!t.enabled && <small>未显示</small>}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </>
      )}
      {manage && <RecipeTagManager onClose={() => setManage(false)} />}
    </div>
  );
}

export function RecipeTagFilters({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { state } = useDemo(),
    tags = tagsOf(state),
    [open, setOpen] = useState<TagGroup | null>(null),
    [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const active = selected.filter((id) =>
    tags.some((t) => t.id === id && t.enabled && !t.deleted),
  );
  return (
    <div className="tag-filter-area" ref={ref}>
      <div className="tag-filter-controls">
        {tagGroups.map((g) => {
          const n = active.filter(
            (id) => tags.find((t) => t.id === id)?.group === g.id,
          ).length;
          return (
            <div className="tag-filter" key={g.id}>
              <button
                className={n ? "selected" : ""}
                aria-expanded={open === g.id}
                onClick={() => {
                  setOpen(open === g.id ? null : g.id);
                  setQuery("");
                }}
              >
                {g.label}
                {n ? ` · ${n}` : ""}
                <ChevronDown size={13} />
              </button>
              {open === g.id && (
                <div
                  className="tag-filter-popover"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setOpen(null);
                    }
                  }}
                >
                  <input
                    autoFocus
                    aria-label={`搜索${g.label}筛选`}
                    placeholder="搜索已开启标签…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <div>
                    {tags
                      .filter(
                        (t) =>
                          t.group === g.id &&
                          t.enabled &&
                          !t.deleted &&
                          searchTag(t, query, tags),
                      )
                      .map((t) => (
                        <button
                          key={t.id}
                          className={`tag-choice ${active.includes(t.id) ? "selected" : ""}`}
                          data-tag-group={t.group}
                          aria-pressed={active.includes(t.id)}
                          onClick={() =>
                            onChange(
                              active.includes(t.id)
                                ? active.filter((id) => id !== t.id)
                                : [...active, t.id],
                            )
                          }
                        >
                          {t.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!!active.length && (
        <div className="recipe-tag-badges">
          {active.map((id) => (
            <button
              className="recipe-tag selected"
              data-tag-group={tags.find((t) => t.id === id)!.group}
              key={id}
              onClick={() => onChange(active.filter((v) => v !== id))}
            >
              {tags.find((t) => t.id === id)!.label}
              <X size={11} />
            </button>
          ))}
          <button className="text-button" onClick={() => onChange([])}>
            清除标签筛选
          </button>
        </div>
      )}
    </div>
  );
}

export function RecipeTagsEditor({
  recipe,
  onClose,
}: {
  recipe: Recipe;
  onClose: () => void;
}) {
  const { state, mutate, busy } = useDemo(),
    [ids, setIds] = useState(() => recipeTagIds(recipe, tagsOf(state)));
  return (
    <Modal
      title="编辑菜谱标签"
      onClose={onClose}
      headerActions={
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            const ok = await mutate(
              {
                type: "set_recipe_tags",
                recipe_id: recipe.id,
                tag_ids: ids,
                expected_revision: state.dataRevision ?? "",
              },
              (s) => ({
                ...s,
                recipes: s.recipes.map((r) =>
                  r.id === recipe.id
                    ? { ...r, tagIds: ids, tagOrigin: "user" }
                    : r,
                ),
              }),
              "",
            );
            if (ok) onClose();
          }}
        >
          保存
        </button>
      }
    >
      <p className="hint">{recipe.name}</p>
      <RecipeTagPicker value={ids} onChange={setIds} />
    </Modal>
  );
}

function TagDefinitionEditor({
  tag,
  onClose,
  onSave,
  initialGroup,
}: {
  tag?: RecipeTag;
  initialGroup: TagGroup;
  onClose: () => void;
  onSave: (t: RecipeTag) => Promise<boolean>;
}) {
  const { state, busy } = useDemo(),
    tags = tagsOf(state),
    [group, setGroup] = useState(tag?.group ?? initialGroup),
    [name, setName] = useState(tag?.label ?? ""),
    [aliases, setAliases] = useState(tag?.aliases.join("，") ?? ""),
    [parentQuery, setParentQuery] = useState(""),
    [parents, setParents] = useState(tag?.broaderIds ?? []),
    [error, setError] = useState("");
  const formId = useId();
  return (
    <Modal
      title={tag ? "编辑标签" : "添加标签"}
      onClose={onClose}
      headerActions={
        <button type="submit" form={formId} className="primary" disabled={busy}>
          保存标签
        </button>
      }
    >
      <form
        id={formId}
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          const label = name.trim();
          if (
            tags.some(
              (t) =>
                t.id !== tag?.id &&
                !t.deleted &&
                t.group === group &&
                (t.label === label || t.aliases.includes(label)),
            )
          ) {
            setError("同类型中已有这个名称或别名，请编辑原标签。");
            return;
          }
          const next: RecipeTag = {
            id: tag?.id ?? `user.${crypto.randomUUID()}`,
            group,
            label,
            aliases: aliases
              .split(/[,，]/)
              .map((s) => s.trim())
              .filter(Boolean),
            broaderIds: parents,
            description: tag?.description ?? "",
            enabled: tag?.enabled ?? true,
            deleted: tag?.deleted ?? false,
            builtin: tag?.builtin ?? false,
            defaultEnabled: tag?.defaultEnabled ?? false,
            section: tag?.section ?? "自定义",
            position: tag?.position ?? tags.length,
          };
          if (await onSave(next)) onClose();
        }}
      >
        <label>
          标签名称
          <input
            required
            maxLength={24}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          类型
          <select
            aria-label="标签类型"
            value={group}
            disabled={!!tag}
            onChange={(e) => {
              setGroup(e.target.value as TagGroup);
              setParents([]);
            }}
          >
            {tagGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          搜索别名
          <input
            maxLength={500}
            placeholder="多个别名用逗号分隔"
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </label>
        <fieldset className="tag-parent-picker">
          <legend>所属标签</legend>
          <div className="recipe-tag-badges">
            {parents.map((id) => (
              <button
                type="button"
                className="recipe-tag"
                data-tag-group={tags.find((t) => t.id === id)?.group}
                key={id}
                onClick={() => setParents(parents.filter((p) => p !== id))}
              >
                {tags.find((t) => t.id === id)?.label}
                <X size={12} />
              </button>
            ))}
          </div>
          <input
            aria-label="搜索所属标签"
            placeholder="搜索并勾选，可留空"
            value={parentQuery}
            onChange={(e) => setParentQuery(e.target.value)}
          />
          <div className="tag-parent-options">
            {tags
              .filter(
                (t) =>
                  t.group === group &&
                  !t.deleted &&
                  t.id !== tag?.id &&
                  (!tag || !ancestors(t.id, tags).has(tag.id)) &&
                  searchTag(t, parentQuery, tags),
              )
              .map((t) => (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={parents.includes(t.id)}
                    onChange={(e) =>
                      setParents(
                        e.target.checked
                          ? [...parents, t.id]
                          : parents.filter((id) => id !== t.id),
                      )
                    }
                  />
                  {t.label}
                </label>
              ))}
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

function TagTree({
  tags,
  visible,
  selected,
  onSelect,
  expanded,
  onExpand,
  forceOpen,
  busy,
  onSave,
  onEdit,
}: {
  tags: RecipeTag[];
  visible: RecipeTag[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  expanded: string[];
  onExpand: (ids: string[]) => void;
  forceOpen: boolean;
  busy: boolean;
  onSave: (tags: RecipeTag[]) => Promise<boolean>;
  onEdit: (tag: RecipeTag) => void;
}) {
  const allowed = new Set(visible.map((t) => t.id));
  const parent = (t: RecipeTag) => t.broaderIds.find((id) => allowed.has(id));
  function row(t: RecipeTag, depth: number): React.ReactNode {
    const children = visible.filter((v) => parent(v) === t.id);
    const open = forceOpen || expanded.includes(t.id);
    const branch = visible
      .filter((v) => ancestors(v.id, tags).has(t.id))
      .map((v) => v.id);
    return (
      <div key={t.id}>
        <div
          className="tag-catalog-row"
          data-tag-group={t.group}
          style={{ paddingLeft: depth * 22 }}
        >
          <input
            type="checkbox"
            aria-label={`选择标签${t.label}`}
            checked={selected.includes(t.id)}
            onChange={(e) =>
              onSelect(
                e.target.checked
                  ? [...selected, t.id]
                  : selected.filter((id) => id !== t.id),
              )
            }
          />
          <div className="tag-tree-name">
            {children.length > 0 && (
              <button
                className="tag-tree-toggle"
                aria-label={`展开${t.label}`}
                aria-expanded={open}
                onClick={() =>
                  onExpand(
                    open
                      ? expanded.filter((id) => id !== t.id)
                      : [...expanded, t.id],
                  )
                }
              >
                <ChevronDown size={14} />
              </button>
            )}
            <strong>{t.label}</strong>
            {children.length > 0 && (
              <>
                <small>{children.length}</small>
                <button
                  className="tag-tree-select"
                  onClick={() =>
                    onSelect([...new Set([...selected, ...branch])])
                  }
                  aria-label={`全选${t.label}及下级`}
                >
                  全选
                </button>
                <button
                  className="tag-tree-select"
                  onClick={() =>
                    onSelect([
                      ...selected.filter((id) => !branch.includes(id)),
                      ...branch.filter((id) => !selected.includes(id)),
                    ])
                  }
                  aria-label={`反选${t.label}及下级`}
                >
                  反选
                </button>
              </>
            )}
          </div>
          <button
            disabled={busy}
            className={
              t.enabled && !t.deleted ? "tag-switch enabled" : "tag-switch"
            }
            aria-label={`${t.deleted ? "恢复" : t.enabled ? "关闭" : "开启"}标签${t.label}`}
            aria-pressed={t.enabled && !t.deleted}
            onClick={() =>
              void onSave([
                {
                  ...t,
                  deleted: false,
                  enabled: t.deleted ? false : !t.enabled,
                },
              ])
            }
          >
            {t.deleted ? "恢复" : t.enabled ? "已开启" : "未开启"}
          </button>
          <button
            className="tag-edit"
            aria-label={`编辑标签${t.label}`}
            onClick={() => onEdit(t)}
          >
            <Pencil size={14} />
          </button>
        </div>
        {open && children.map((c) => row(c, depth + 1))}
      </div>
    );
  }
  return visible.filter((t) => !parent(t)).map((t) => row(t, 0));
}

export default function RecipeTagManager({ onClose }: { onClose: () => void }) {
  const { state, mutate, busy } = useDemo(),
    tags = tagsOf(state),
    [group, setGroup] = useState<TagGroup | "legacy">("cuisine"),
    [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<RecipeTag | null | undefined>(),
    [deleting, setDeleting] = useState(false),
    [merging, setMerging] = useState(false),
    [target, setTarget] = useState(""),
    [expanded, setExpanded] = useState<string[]>([]),
    [resolving, setResolving] = useState<string | null>(null);
  const recipes = [...state.recipes, ...(state.archivedRecipes ?? [])];
  const legacy = [...new Set(recipes.flatMap((r) => legacyTags(r, tags)))];
  const visible = tags.filter(
    (t) =>
      t.group === group &&
      (status === "deleted" ? t.deleted : !t.deleted) &&
      (status === "on" ? t.enabled : status === "off" ? !t.enabled : true) &&
      searchTag(t, query, tags),
  );
  const selection = tags.filter((t) => selected.includes(t.id));
  const affected = recipes.filter((r) =>
    recipeTagIds(r, tags).some((id) => selected.includes(id)),
  ).length;
  async function save(entries: RecipeTag[]) {
    return mutate(
      {
        type: "save_recipe_tag_definitions",
        expected_revision: state.dataRevision ?? "",
        entries,
      },
      (s) => ({
        ...s,
        recipeTags: [
          ...tagsOf(s).filter((t) => !entries.some((e) => e.id === t.id)),
          ...entries,
        ].sort((a, b) => a.position - b.position),
      }),
      "",
    );
  }
  function switchGroup(g: TagGroup | "legacy") {
    setGroup(g);
    setSelected([]);
    setQuery("");
  }
  async function resolve(name: string, id: string | null) {
    const ok = await mutate(
      {
        type: "resolve_legacy_recipe_tag",
        expected_revision: state.dataRevision ?? "",
        name,
        target_id: id,
      },
      (s) => ({
        ...s,
        recipes: s.recipes.map((r) => {
          const old = legacyTags(r, tagsOf(s));
          return old.includes(name)
            ? {
                ...r,
                legacyTags: old.filter((v) => v !== name),
                tagIds: [
                  ...new Set([
                    ...recipeTagIds(r, tagsOf(s)),
                    ...(id ? [id] : []),
                  ]),
                ],
              }
            : r;
        }),
      }),
      "",
    );
    if (ok) setResolving(null);
  }
  return (
    <>
      <Modal
        title="管理菜谱标签"
        className="recipe-tags-dialog"
        onClose={onClose}
        headerActions={
          group !== "legacy" && (
            <button
              className="tag-action soft"
              disabled={busy}
              onClick={() => setEditing(null)}
            >
              <Plus size={14} />
              添加标签
            </button>
          )
        }
      >
        <div className="tag-manager-tabs">
          {tagGroups.map((g) => (
            <button
              key={g.id}
              data-tag-group={g.id}
              className={group === g.id ? "selected" : ""}
              onClick={() => switchGroup(g.id)}
            >
              {g.label}
              <small>
                {tags.filter((t) => t.group === g.id && !t.deleted).length}
              </small>
            </button>
          ))}
          {!!legacy.length && (
            <button
              className={group === "legacy" ? "selected" : ""}
              onClick={() => switchGroup("legacy")}
            >
              待整理 {legacy.length}
            </button>
          )}
        </div>
        <div className="tag-manager-search">
          <div className="search">
            <Search size={16} />
            <input
              aria-label="搜索标签目录"
              placeholder="搜索名称、别名或上级…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected([]);
              }}
            />
          </div>
          {group !== "legacy" && (
            <select
              aria-label="标签显示状态"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSelected([]);
              }}
            >
              <option value="all">全部标签</option>
              <option value="on">已开启</option>
              <option value="off">未开启</option>
              <option value="deleted">已删除</option>
            </select>
          )}
        </div>
        {group === "legacy" ? (
          <>
            <p className="hint">未匹配的原分类可在这里整理。</p>
            <div className="tag-catalog-list">
              {legacy
                .filter((n) => n.includes(query))
                .map((name) => (
                  <div className="tag-legacy-row" key={name}>
                    <span>
                      {name}
                      <small>
                        {
                          recipes.filter((r) =>
                            legacyTags(r, tags).includes(name),
                          ).length
                        }{" "}
                        道菜谱
                      </small>
                    </span>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setResolving(name);
                        setTarget("");
                      }}
                    >
                      归入标签
                    </button>
                  </div>
                ))}
            </div>
          </>
        ) : (
          <>
            <div className="tag-batch">
              <label>
                <input
                  type="checkbox"
                  aria-label="选择当前结果"
                  checked={
                    !!visible.length &&
                    visible.every((t) => selected.includes(t.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? visible.map((t) => t.id) : [],
                    )
                  }
                />
                全选
              </label>
              <button
                onClick={() =>
                  setSelected(
                    visible
                      .filter((t) => !selected.includes(t.id))
                      .map((t) => t.id),
                  )
                }
              >
                反选
              </button>
              <button
                disabled={!selected.length}
                onClick={() => setSelected([])}
              >
                清空
              </button>
              <button
                disabled={busy || !selected.length || status === "deleted"}
                onClick={() =>
                  void save(selection.map((t) => ({ ...t, enabled: true })))
                }
              >
                开启
              </button>
              <button
                disabled={busy || !selected.length || status === "deleted"}
                onClick={() =>
                  void save(selection.map((t) => ({ ...t, enabled: false })))
                }
              >
                关闭
              </button>
              {status === "deleted" ? (
                <button
                  disabled={busy || !selected.length}
                  onClick={() =>
                    void save(
                      selection.map((t) => ({
                        ...t,
                        enabled: false,
                        deleted: false,
                      })),
                    )
                  }
                >
                  恢复
                </button>
              ) : (
                <>
                  <button
                    className="danger"
                    disabled={busy || !selected.length}
                    onClick={() => setDeleting(true)}
                  >
                    删除
                  </button>
                  <button
                    disabled={busy || selected.length !== 1}
                    onClick={() => {
                      setTarget("");
                      setMerging(true);
                    }}
                  >
                    合并
                  </button>
                </>
              )}
              <span>
                {visible.length} 项 · 已选 {selected.length} 项
              </span>
            </div>
            <div className="tag-catalog-list">
              <TagTree
                tags={tags}
                visible={visible}
                selected={selected}
                onSelect={setSelected}
                expanded={expanded}
                onExpand={setExpanded}
                forceOpen={!!query || status !== "all"}
                busy={busy}
                onSave={save}
                onEdit={setEditing}
              />
            </div>
          </>
        )}
        <div className="tag-manager-foot">
          <span>
            已开启 {tags.filter((t) => t.enabled && !t.deleted).length} 项
          </span>
          <button
            disabled={busy}
            onClick={() =>
              void mutate(
                {
                  type: "reset_recipe_tag_visibility",
                  expected_revision: state.dataRevision ?? "",
                },
                (s) => ({
                  ...s,
                  recipeTags: tagsOf(s).map((t) =>
                    t.builtin && !t.deleted
                      ? { ...t, enabled: t.defaultEnabled }
                      : t,
                  ),
                }),
                "",
              )
            }
          >
            恢复默认开关
          </button>
        </div>
      </Modal>
      {editing !== undefined && (
        <TagDefinitionEditor
          tag={editing ?? undefined}
          initialGroup={group === "legacy" ? "trait" : group}
          onClose={() => setEditing(undefined)}
          onSave={(t) => save([t])}
        />
      )}{" "}
      {deleting && (
        <Modal title="删除所选标签？" onClose={() => setDeleting(false)}>
          <p>
            将删除 {selected.length} 个标签，影响 {affected}{" "}
            道菜谱的当前标签显示。菜谱和历史记录保留；如果只是想隐藏，请使用关闭。
          </p>
          <button
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                await save(
                  selection.map((t) => ({
                    ...t,
                    deleted: true,
                    enabled: false,
                  })),
                )
              ) {
                setDeleting(false);
                setSelected([]);
              }
            }}
          >
            确认删除
          </button>
        </Modal>
      )}
      {merging && selection[0] && (
        <Modal title="合并标签" onClose={() => setMerging(false)}>
          <p>
            {selection[0].label}的关联将移到目标标签，影响 {affected}{" "}
            道菜谱；原标签停用。
          </p>
          <select
            aria-label="合并到标签"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择同类型标签</option>
            {tags
              .filter(
                (t) =>
                  !t.deleted &&
                  t.group === selection[0].group &&
                  !ancestors(t.id, tags).has(selection[0].id),
              )
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.label}
                </option>
              ))}
          </select>
          <button
            className="primary"
            disabled={busy || !target}
            onClick={async () => {
              const source = selection[0].id;
              const ok = await mutate(
                {
                  type: "merge_recipe_tags",
                  expected_revision: state.dataRevision ?? "",
                  source_id: source,
                  target_id: target,
                },
                (s) => ({
                  ...s,
                  recipeTags: tagsOf(s).map((t) =>
                    t.id === source
                      ? { ...t, deleted: true, enabled: false }
                      : t,
                  ),
                  recipes: s.recipes.map((r) => ({
                    ...r,
                    tagIds: [
                      ...new Set(
                        recipeTagIds(r, tagsOf(s)).map((id) =>
                          id === source ? target : id,
                        ),
                      ),
                    ],
                  })),
                }),
                "",
              );
              if (ok) {
                setMerging(false);
                setSelected([]);
              }
            }}
          >
            确认合并
          </button>
        </Modal>
      )}
      {resolving !== null && (
        <Modal title={`整理“${resolving}”`} onClose={() => setResolving(null)}>
          <select
            aria-label="归入标签"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">选择已有标签</option>
            {tags
              .filter((t) => !t.deleted)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {tagGroups.find((g) => g.id === t.group)?.label} / {t.label}
                </option>
              ))}
          </select>
          <div className="actions space-top">
            <button
              className="primary"
              disabled={busy || !target}
              onClick={() => void resolve(resolving, target)}
            >
              归入所选标签
            </button>
            <button
              disabled={busy}
              onClick={() => void resolve(resolving, null)}
            >
              忽略此旧分类
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
