import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, UtensilsCrossed } from "lucide-react";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "green" | "warm" | "red";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Food({
  image,
  name,
  className = "",
}: {
  image: string;
  name: string;
  className?: string;
}) {
  return (
    <img
      className={`food ${className}`}
      src={image.startsWith("data:image/") ? image : `/food/${image}.svg`}
      alt={image.startsWith("data:image/") ? name : `${name} · 本地插画占位`}
      onError={(e) => {
        if (!e.currentTarget.src.endsWith("/food/placeholder.svg")) {
          e.currentTarget.src = "/food/placeholder.svg";
        }
      }}
    />
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <UtensilsCrossed size={28} />
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  drawer = false,
  className = "",
  dismissOnEscape = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  drawer?: boolean;
  className?: string;
  dismissOnEscape?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    el.showModal();
    return () => {
      el.close();
      root.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`${drawer ? "dialog drawer" : "dialog"} ${className}`}
      onMouseDown={(e) => {
        if (!drawer || e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        )
          e.preventDefault();
      }}
      onDoubleClick={(e) => {
        if (!drawer || e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        ) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          onClose();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissOnEscape) onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" aria-label="关闭面板" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
