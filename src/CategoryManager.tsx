import { useState, useRef } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  DragOverlay,
} from "@dnd-kit/core";
import { Modal } from "./components";
import { useDemo } from "./store";
import type { DemoState } from "./model";
export function changeCategory(
  s: DemoState,
  kind: "recipe" | "ingredient",
  old: string,
  next: string,
): DemoState {
  const key = kind === "recipe" ? "recipeCategories" : "ingredientCategories";
  const target = next.trim() || "未分类";
  if (next.trim() && s[key].includes(target) && target !== old) return s;
  const categories = [...new Set(s[key].map((c) => (c === old ? target : c)))];
  return kind === "recipe"
    ? {
        ...s,
        recipeCategories: categories,
        recipes: s.recipes.map((r) =>
          r.category === old ? { ...r, category: target } : r,
        ),
      }
    : {
        ...s,
        ingredientCategories: categories,
        ingredients: s.ingredients.map((i) =>
          i.category === old ? { ...i, category: target } : i,
        ),
        shopping: s.shopping.map((i) =>
          i.category === old ? { ...i, category: target } : i,
        ),
      };
}

interface CategoryDraft {
  id: string;
  original: string | null;
  name: string;
}
function CategoryRow({
  row,
  disabled,
  onName,
  onRemove,
  onMove,
  shift,
  marker,
  step,
}: {
  row: CategoryDraft;
  disabled: boolean;
  onName: (value: string) => void;
  onRemove: () => void;
  onMove: (direction: number) => void;
  shift: number;
  marker: "before" | "after" | null;
  step: number;
}) {
  const {
    setNodeRef: dragRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: row.id, disabled });
  const { setNodeRef: dropRef } = useDroppable({ id: row.id });
  return (
    <div
      ref={(node) => {
        dragRef(node);
        dropRef(node);
      }}
      style={{ transform: `translateY(${shift * step}px)` }}
      className={`category-row ${isDragging ? "dragging" : ""} ${marker ? `insert-${marker}` : ""}`}
    >
      <button
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        className="category-grip"
        disabled={disabled}
        aria-label={`拖动分类${row.name}`}
        title="拖动排序；Alt + 上下方向键调整"
        onKeyDown={(e) => {
          if (e.altKey && ["ArrowUp", "ArrowDown"].includes(e.key)) {
            e.preventDefault();
            onMove(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <GripVertical size={17} />
      </button>
      <input
        aria-label={`分类名称${row.original ?? row.name}`}
        disabled={disabled || row.original === "未分类"}
        maxLength={24}
        value={row.name}
        onChange={(e) => onName(e.target.value)}
      />
      <button
        aria-label={`移除分类${row.name}`}
        disabled={disabled || row.original === "未分类"}
        onClick={onRemove}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
export default function CategoryManager({
  kind,
  onClose,
}: {
  kind: "recipe" | "ingredient";
  onClose: () => void;
}) {
  const { state, mutate, busy } = useDemo();
  const key = kind === "recipe" ? "recipeCategories" : "ingredientCategories";
  const [revision] = useState(state.dataRevision ?? "0");
  const [rows, setRows] = useState<CategoryDraft[]>(() =>
    [...new Set([...state[key], "未分类"])].map((c) => ({
      id: crypto.randomUUID(),
      original: c,
      name: c,
    })),
  );
  const dragRects = useRef<
    Parameters<typeof pointerWithin>[0]["droppableRects"] | null
  >(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [step, setStep] = useState(50);
  const activeIndex = rows.findIndex((r) => r.id === activeId);
  const overIndex = rows.findIndex((r) => r.id === overId);
  const activeRow = rows[activeIndex];
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );
  function move(from: string, to: string) {
    setRows((list) => {
      const next = [...list];
      const i = next.findIndex((r) => r.id === from),
        j = next.findIndex((r) => r.id === to);
      if (i < 0 || j < 0) return list;
      const [row] = next.splice(i, 1);
      next.splice(j, 0, row);
      return next;
    });
  }
  function valid(list: CategoryDraft[]) {
    const names = list.map((r) => r.name.trim());
    return (
      names.every(
        (n) =>
          n &&
          !["全部菜谱", "我的收藏", "已归档", "全部类别", "全部位置"].includes(
            n,
          ),
      ) && new Set(names).size === names.length
    );
  }
  return (
    <Modal
      title={kind === "recipe" ? "管理菜谱分类" : "管理食材分类"}
      onClose={onClose}
    >
      <p className="hint">
        拖动左侧手柄调整顺序，修改后统一保存。移除分类后，内容归入「未分类」。
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={(args) => {
          if (!dragRects.current && args.droppableRects.size)
            dragRects.current = new Map(args.droppableRects);
          return pointerWithin({
            ...args,
            droppableRects: dragRects.current ?? args.droppableRects,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== args.active.id,
            ),
          });
        }}
        onDragStart={({ active }) => {
          dragRects.current = null;
          setActiveId(String(active.id));
          setOverId(String(active.id));
          setStep((active.rect.current.initial?.height ?? 40) + 10);
        }}
        onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
        }}
        onDragEnd={({ active, over }) => {
          setActiveId(null);
          setOverId(null);
          if (over && active.id !== over.id)
            move(String(active.id), String(over.id));
        }}
      >
        <div
          className={`category-editor ${activeId ? "category-sorting" : ""}`}
        >
          {rows.map((row, index) => (
            <CategoryRow
              key={row.id}
              row={row}
              disabled={busy}
              step={step}
              shift={
                activeIndex >= 0 && overIndex >= 0
                  ? index === activeIndex
                    ? overIndex - activeIndex
                    : activeIndex < overIndex &&
                        index > activeIndex &&
                        index <= overIndex
                      ? -1
                      : activeIndex > overIndex &&
                          index >= overIndex &&
                          index < activeIndex
                        ? 1
                        : 0
                  : 0
              }
              marker={
                activeIndex >= 0 && overIndex >= 0 && index === activeIndex
                  ? "before"
                  : null
              }
              onName={(value) =>
                setRows((list) =>
                  list.map((r) =>
                    r.id === row.id ? { ...r, name: value } : r,
                  ),
                )
              }
              onRemove={() =>
                setRows((list) => list.filter((r) => r.id !== row.id))
              }
              onMove={(direction) => {
                const other = rows[index + direction];
                if (other) move(row.id, other.id);
              }}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeRow && (
            <div className="category-drag-preview">
              <GripVertical size={18} />
              <span>{activeRow.name}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <form
        className="category-add"
        onSubmit={(e) => {
          e.preventDefault();
          const next = [
            ...rows,
            { id: crypto.randomUUID(), original: null, name: name.trim() },
          ];
          if (!valid(next)) {
            setError("分类名称不能为空、重复或使用筛选项名称");
            return;
          }
          setRows(next);
          setName("");
          setError("");
        }}
      >
        <input
          aria-label="新分类名称"
          placeholder="输入新分类"
          maxLength={24}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={busy || !name.trim()}>
          <Plus size={15} />
          添加分类
        </button>
      </form>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions category-save">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            if (!valid(rows)) {
              setError("分类名称不能为空、重复或使用筛选项名称");
              return;
            }
            const entries = rows.map((r) => ({
              original: r.original,
              name: r.name.trim(),
            }));
            const saved = await mutate(
              {
                type: "save_categories",
                kind,
                expected_revision: revision,
                entries,
              },
              (s) => {
                const remap = (old: string) =>
                  entries.find((e) => e.original === old)?.name ?? "未分类";
                return {
                  ...s,
                  [key]: entries.map((e) => e.name),
                  ...(kind === "recipe"
                    ? {
                        recipes: s.recipes.map((r) => ({
                          ...r,
                          category: remap(r.category),
                        })),
                      }
                    : {
                        ingredients: s.ingredients.map((i) => ({
                          ...i,
                          category: remap(i.category),
                        })),
                        shopping: s.shopping.map((i) => ({
                          ...i,
                          category: remap(i.category),
                        })),
                      }),
                };
              },
              "",
            );
            if (saved) onClose();
          }}
        >
          保存分类
        </button>
      </div>
    </Modal>
  );
}
