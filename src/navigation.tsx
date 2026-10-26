import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useCallback,
  type ReactNode,
} from "react";
type Route = { page: string; recipeId?: string; scrollY?: number };
interface Navigation {
  route: Route;
  canBack: boolean;
  back: () => void;
  navigate: (page: string, recipeId?: string) => void;
  reset: (page: string) => void;
}
const Context = createContext<Navigation | null>(null);
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<Route[]>([{ page: "planner" }]);
  const route = history[history.length - 1];
  const back = useCallback(
    () => setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h)),
    [],
  );
  const reset = useCallback(
    (page: string) => setHistory([{ page, scrollY: 0 }]),
    [],
  );
  const navigate = useCallback((page: string, recipeId?: string) => {
    const scrollY = window.scrollY;
    setHistory((h) => {
      const last = h[h.length - 1];
      return last.page === page && last.recipeId === recipeId
        ? h
        : [
            ...h.slice(-49, -1),
            { ...last, scrollY },
            { page, recipeId, scrollY: 0 },
          ];
    });
  }, []);
  useLayoutEffect(() => {
    const restore = () =>
      window.scrollTo({
        top: route.scrollY ?? 0,
        left: 0,
        behavior: "instant",
      });
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [route]);
  return (
    <Context.Provider
      value={{
        route,
        canBack: history.length > 1,
        back,
        reset,
        navigate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useNavigation() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing navigation provider");
  return value;
}
