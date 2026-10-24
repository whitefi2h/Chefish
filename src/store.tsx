import type { ShoppingForecast } from "./domain/shopping";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { weekOf, type DemoState, type Recipe } from "./model";
import { demoClock, systemClock, type Clock } from "./domain/clock";
import { demoClient } from "./services/demoClient";
import { preferencesOf, type AppPreferences } from "./domain/preferences";
import {
  kitchenClient,
  nativeMode,
  emptyState,
  errorMessage,
  type KitchenCommand,
  type KitchenClient,
} from "./services/kitchenClient";
interface Store {
  preferences: AppPreferences;
  savePreferences: (preferences: AppPreferences) => Promise<boolean>;
  recipeHistory: (recipeId: string) => Promise<Recipe[]>;
  forecast?: ShoppingForecast;
  forecastError: string;
  forecastLoading: boolean;
  reloadForecast: () => void;
  state: DemoState;
  today: string;
  persistent: boolean;
  ready: boolean;
  busy: boolean;
  loadError: string;
  reload: () => Promise<boolean>;
  update: (fn: (s: DemoState) => DemoState, message?: string) => void;
  mutate: (
    command: KitchenCommand,
    fn: (s: DemoState) => DemoState,
    message: string,
  ) => Promise<boolean>;
  undo: () => void;
  canUndo: boolean;
  notice: string;
  notify: (text: string) => void;
  weekStart: string;
  setWeekStart: (day: string) => void;
}
const Context = createContext<Store | null>(null);
export function DemoProvider({
  children,
  client = nativeMode ? kitchenClient : undefined,
  clock = client ? systemClock : demoClock,
}: {
  children: ReactNode;
  client?: KitchenClient;
  clock?: Clock;
}) {
  const persistent = !!client;
  const [today, setToday] = useState(() => clock.today());
  const [weekStart, setWeekStart] = useState(() => weekOf(clock.today()));
  const [history, setHistory] = useState<DemoState[]>(() => [
    persistent ? emptyState() : demoClient.load(),
  ]);
  const [ready, setReady] = useState(!persistent);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notification, setNotification] = useState({ text: "", revision: 0 });
  const inFlight = useRef(false);
  const pending = useRef<{ key: string; id: string } | null>(null);
  const refreshRequired = useRef(false);
  const [forecastState, setForecastState] = useState<{
    key: string;
    value?: ShoppingForecast;
    error: string;
  }>({ key: "", error: "" });
  const [forecastRefresh, setForecastRefresh] = useState(0);
  const current = history[history.length - 1];
  const forecastKey = `${weekStart}|${today}|${current.dataRevision}|${forecastRefresh}`;
  useEffect(() => {
    if (!client?.shopping || !ready) return;
    let alive = true;
    client
      .shopping(weekStart)
      .then((value) => {
        if (
          !value ||
          value.weekStart !== weekStart ||
          !Array.isArray(value.items)
        )
          throw new Error("invalid forecast");
        if (alive) setForecastState({ key: forecastKey, value, error: "" });
      })
      .catch((error) => {
        if (alive)
          setForecastState({ key: forecastKey, error: errorMessage(error) });
      });
    return () => {
      alive = false;
    };
  }, [client, ready, weekStart, forecastKey]);
  const forecast =
    forecastState.key === forecastKey ? forecastState.value : undefined;
  const forecastError =
    forecastState.key === forecastKey ? forecastState.error : "";
  const forecastLoading = persistent && !forecast && !forecastError;

  const state = { ...current, today };
  const preferences = preferencesOf(state.preferences);
  function notify(text: string) {
    setNotification((n) => ({ text, revision: n.revision + 1 }));
  }
  async function reload() {
    if (!client) return true;
    try {
      const next = await client.load();
      setHistory([next]);
      setReady(true);
      setLoadError("");
      refreshRequired.current = false;
      return true;
    } catch (error) {
      setLoadError(errorMessage(error));
      return false;
    }
  }
  useEffect(() => {
    let alive = true;
    if (client)
      client
        .load()
        .then((next) => {
          if (alive) {
            setHistory([next]);
            setReady(true);
            setLoadError("");
          }
        })
        .catch((error) => {
          if (alive) setLoadError(errorMessage(error));
        });
    return () => {
      alive = false;
    };
  }, [client]);
  useEffect(() => {
    const check = () => setToday(clock.today());
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [clock]);
  useEffect(() => {
    if (!notification.text) return;
    const timer = setTimeout(
      () => setNotification((n) => ({ ...n, text: "" })),
      5000,
    );
    return () => clearTimeout(timer);
  }, [notification]);
  function update(
    fn: (s: DemoState) => DemoState,
    message = "演示数据已更新，可撤销",
  ) {
    if (persistent) {
      notify("此操作尚未接入本地数据库，本次未保存。");
      return;
    }
    setHistory((h) => {
      const next = demoClient.update(h[h.length - 1], fn);
      return next === h[h.length - 1] ? h : [...h.slice(-49), next];
    });
    if (message) notify(message);
  }
  async function mutate(
    command: KitchenCommand,
    fn: (s: DemoState) => DemoState,
    message: string,
  ) {
    const inventoryAction = [
      "complete_cooking",
      "undo_cooking",
      "change_lot",
      "undo_inventory",
      "reverse_inventory_event",
      "purchase_shopping",
      "receive_lot",
      "receive_shopping",
    ].includes(command.type);
    const successMessage = inventoryAction ? message : "";
    if (!client) {
      update(fn, successMessage);
      return true;
    }
    if (!ready || inFlight.current) {
      notify("正在加载或保存，请稍候。");
      return false;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      if (refreshRequired.current && !(await reload())) {
        notify("上次写入已提交，但读取失败；请先重试加载。");
        return false;
      }
      const key = JSON.stringify(command);
      const request =
        pending.current?.key === key
          ? pending.current
          : { key, id: crypto.randomUUID() };
      pending.current = request;
      await client.execute(command, request.id);
      pending.current = null;
      refreshRequired.current = true;
      if (!(await reload())) {
        notify("已写入本地数据库，但界面读取失败。请重试加载，不要重复提交。");
        // The transaction committed: close its form instead of offering a duplicate submit.
        return true;
      }
      if (successMessage) notify(successMessage);
      return true;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "STALE_REVISION"
      )
        await reload();
      notify(errorMessage(error));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  function undo() {
    if (persistent) return;
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
    notify("已撤销上一步演示变更");
  }
  async function savePreferences(next: AppPreferences) {
    if (!client) {
      update((s) => ({ ...s, preferences: next }), "设置已保存到当前演示会话");
      return true;
    }
    if (!ready || inFlight.current) return false;
    inFlight.current = true;
    setBusy(true);
    try {
      if (!client.savePreferences) throw new Error("当前客户端不支持保存设置");
      await client.savePreferences(next);
      if (!(await reload())) notify("设置已保存，但界面读取失败，请重试加载。");
      return true;
    } catch (error) {
      notify(errorMessage(error));
      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <Context.Provider
      value={{
        preferences,
        savePreferences,
        recipeHistory: async (recipeId) => {
          if (client) {
            if (!client.recipeHistory)
              throw new Error("无法读取菜谱版本，请重试。");
            return client.recipeHistory(recipeId);
          }
          const rows = [
            ...(state.recipeHistory ?? []),
            ...state.recipes,
            ...(state.archivedRecipes ?? []),
          ].filter((r) => r.id === recipeId);
          return [
            ...new Map(
              rows.map((r) => [r.revisionId ?? "initial", r]),
            ).values(),
          ].sort((a, b) => (b.revisionNumber ?? 1) - (a.revisionNumber ?? 1));
        },
        forecast,
        forecastError,
        forecastLoading,
        reloadForecast: () => setForecastRefresh((n) => n + 1),
        state,
        today,
        persistent,
        ready,
        busy,
        loadError,
        reload,
        update,
        mutate,
        undo,
        canUndo: !persistent && history.length > 1,
        notice: notification.text,
        notify,
        weekStart,
        setWeekStart,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw new Error("Kitchen provider required");
  return value;
}
