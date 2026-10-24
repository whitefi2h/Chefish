import { supplies } from "./domain/seasonings";
import KitchenAssistant from "./KitchenAssistant";
import { shoppingPending } from "./domain/shopping";
import { useEffect, useRef, useState } from "react";
import {
  ChefHat,
  LayoutDashboard,
  BookOpen,
  Refrigerator,
  CalendarDays,
  ShoppingBasket,
  Sparkles,
  Undo2,
  ArrowRight,
  X,
  PanelRightClose,
  Settings2,
} from "lucide-react";
import { DemoProvider, useDemo } from "./store";
import { putMeal, shiftDate, weekLabel, pendingItems } from "./model";
import { Badge, Modal, Food } from "./components";
import Planner from "./Planner";
import Inventory, { LotDetail } from "./Inventory";
import Shopping from "./Shopping";
import Recipes from "./Recipes";
import Dashboard from "./Dashboard";
import Settings, { type SettingsTab } from "./Settings";
const pages = [
  { id: "home", name: "首页", icon: LayoutDashboard },
  { id: "recipes", name: "我的菜谱", icon: BookOpen },
  { id: "pantry", name: "食材库存", icon: Refrigerator },
  { id: "planner", name: "每周菜单", icon: CalendarDays },
  { id: "shopping", name: "采购清单", icon: ShoppingBasket },
];
function Assistant({
  page,
  onClose,
  onNavigate,
  onOpenSettings,
}: {
  page: string;
  onClose: () => void;
  onNavigate: (page: string) => void;
  onOpenSettings: () => void;
}) {
  const { state, update, weekStart, persistent, preferences } = useDemo();
  const [proposal, setProposal] = useState(false);
  if (persistent)
    return (
      <KitchenAssistant
        onClose={onClose}
        onNavigate={onNavigate}
        onOpenSettings={onOpenSettings}
      />
    );
  const recipe = state.recipes.find((r) => r.id === "soup")!;
  return (
    <Modal title="Chefish 厨房助手" onClose={onClose} drawer>
      <Badge tone="warm">固定演示建议 · 未连接 AI</Badge>
      <h3 className="space-top">一起想想，这周吃什么。</h3>
      <p>
        当前页面：{pages.find((p) => p.id === page)?.name}。演示上下文有{" "}
        {weekLabel(weekStart)}；{state.plans.length} 道菜安排（含其他周）、
        {state.lots.length} 个库存批次。
      </p>
      <div className="assistant-message">
        可以试试番茄菌菇暖汤。以下是固定演示提案，不会自动执行，也不代表实时库存匹配。
      </div>
      {!proposal ? (
        <button className="primary" onClick={() => setProposal(true)}>
          <Sparkles size={16} />
          预览一份菜单建议
        </button>
      ) : (
        <section className="proposal panel">
          <Food image={recipe.image} name={recipe.name} />
          <Badge tone="warm">待确认的草稿</Badge>
          <h3>{recipe.name}</h3>
          <p>
            {shiftDate(weekStart, 6)} 周日晚餐 · {preferences.defaultServings}{" "}
            人份
          </p>
          <p className="hint">
            确认后加入该餐，与已有菜品一同安排，并更新采购需求；不会扣减库存。
          </p>
          <button
            className="primary full"
            onClick={() => {
              update(
                (s) =>
                  putMeal(
                    s,
                    recipe.id,
                    shiftDate(weekStart, 6),
                    "晚餐",
                    preferences.defaultServings,
                  ),
                "已应用演示提案，采购需求已重算",
              );
              setProposal(false);
              onClose();
            }}
          >
            确认加入菜单 <ArrowRight size={16} />
          </button>
          <button className="full" onClick={() => setProposal(false)}>
            拒绝提案
          </button>
        </section>
      )}
      <p className="hint space-top">
        SQLite、实时模型与网页导入尚未接入。这里只演示「预览 → 确认」的交互。
      </p>
    </Modal>
  );
}
function Shell() {
  const {
    state,
    undo,
    canUndo,
    notice,
    notify,
    weekStart,
    today,
    persistent,
    ready,
    busy,
    loadError,
    reload,
    forecast,
    preferences,
  } = useDemo();
  const [page, setPage] = useState("planner");
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const startupApplied = useRef(false);
  useEffect(() => {
    if (ready && !startupApplied.current) {
      setPage(preferences.startPage);
      startupApplied.current = true;
    }
  }, [ready, preferences.startPage]);
  const [panel, setPanel] = useState<
    { kind: "ai" } | { kind: "lot"; id: string } | null
  >(null);
  const count = persistent
    ? shoppingPending(forecast).length +
      supplies(state).filter((s) => s.missing).length
    : pendingItems(state, weekStart).filter((i) => i.status === "pending")
        .length;
  if (persistent && !ready)
    return (
      <main className="page">
        <section className="panel">
          <h1>正在打开我的厨房</h1>
          <p role="alert">{loadError || "正在读取本机数据库…"}</p>
          {loadError && (
            <button className="primary" onClick={() => void reload()}>
              重试加载
            </button>
          )}
        </section>
      </main>
    );
  return (
    <div className="app" aria-busy={busy}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("home");
          }}
        >
          <span className="brand-mark">
            <ChefHat size={26} />
          </span>
          <div>
            <strong>
              Chefish<span>®</span>
            </strong>
            <small>日常的好滋味</small>
          </div>
        </a>
        <div className="nav-caption">我的厨房</div>
        <nav aria-label="全局导航">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-current={page === p.id ? "page" : undefined}
              className={page === p.id ? "active" : ""}
              onClick={() => {
                setPage(p.id);
                setPanel(null);
              }}
            >
              <p.icon size={19} />
              <span>{p.name}</span>
              {p.id === "recipes" && <small>{state.recipes.length}</small>}
              {p.id === "shopping" && <small>{count}</small>}
              {p.id === "planner" && <small>本周</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <LeafMark />
          <p>
            好好吃饭，
            <br />
            慢慢生活。
          </p>
          <small>一点计划，多一份从容。</small>
        </div>
        <button
          className="sidebar-footer settings-trigger"
          aria-label="打开厨房设置"
          onClick={() => {
            setPanel(null);
            setSettingsTab("preferences");
          }}
        >
          <span className="avatar">
            <ChefHat size={18} />
          </span>
          <div>
            <strong>{persistent ? "我的厨房" : "我的演示厨房"}</strong>
            <small>设置与偏好</small>
          </div>
          <Settings2 size={16} className="settings-trigger-icon" />
        </button>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            我的厨房 <span>/</span>{" "}
            <strong>{pages.find((p) => p.id === page)?.name}</strong>
          </div>
          <div className="actions">
            <span className="demo-indicator">
              {persistent
                ? busy
                  ? "正在保存…"
                  : "本地数据库"
                : "演示数据 · 刷新后重置"}
            </span>
            <button onClick={undo} disabled={!canUndo} aria-label="撤销上一步">
              <Undo2 size={15} />
              撤销
            </button>
            <button
              className="assistant-toggle"
              onClick={() =>
                setPanel(panel?.kind === "ai" ? null : { kind: "ai" })
              }
            >
              <Sparkles size={16} />
              厨房助手
            </button>
          </div>
        </header>
        <main>
          {loadError && (
            <div className="panel load-error" role="alert">
              {loadError}
              <button onClick={() => void reload()}>重试加载</button>
            </div>
          )}
          {pages.map((p) => (
            <fieldset
              key={p.id}
              hidden={page !== p.id}
              className="page module-frame"
            >
              {p.id === "home" ? (
                <Dashboard navigate={setPage} />
              ) : p.id === "recipes" ? (
                <Recipes />
              ) : p.id === "pantry" ? (
                <Inventory openLot={(id) => setPanel({ kind: "lot", id })} />
              ) : p.id === "shopping" ? (
                <Shopping />
              ) : (
                <Planner goShopping={() => setPage("shopping")} />
              )}
            </fieldset>
          ))}
        </main>
        <footer className="app-footer">
          <span>CHEFISH / 我的厨房手记</span>
          <span>
            {persistent
              ? `本机日期 ${today} · 数据保存在本机`
              : `演示基准日 ${today} · 所有变更仅本次会话有效`}
          </span>
        </footer>
      </div>
      {panel?.kind === "ai" && (
        <Assistant
          page={page}
          onNavigate={setPage}
          onClose={() => setPanel(null)}
          onOpenSettings={() => {
            setPanel(null);
            setSettingsTab("assistant");
          }}
        />
      )}
      {settingsTab && (
        <Settings
          initialTab={settingsTab}
          onClose={() => setSettingsTab(null)}
        />
      )}
      {panel?.kind === "lot" && (
        <LotDetail
          key={panel.id}
          id={panel.id}
          onClose={() => setPanel(null)}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          {canUndo && <button onClick={undo}>撤销</button>}
          <button aria-label="关闭提示" onClick={() => notify("")}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function LeafMark() {
  return (
    <PanelRightClose className="sidebar-line-art" size={30} strokeWidth={1} />
  );
}
export default function App() {
  return (
    <DemoProvider>
      <Shell />
    </DemoProvider>
  );
}
