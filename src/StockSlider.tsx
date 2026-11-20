import { useEffect, useRef, useState } from "react";
import { Minus } from "lucide-react";
import { stockLevelText } from "./domain/stock";
import "./stock-slider.css";

export default function StockSlider({
  value,
  name,
  disabled,
  onTouch,
  onChange,
}: {
  value: number | null;
  name: string;
  disabled?: boolean;
  onTouch?: () => void;
  onChange: (value: number) => void | Promise<boolean>;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [keyboard, setKeyboard] = useState(false);
  const [position, setPosition] = useState(Math.max(0, value ?? 1) / 2);
  const [dragging, setDragging] = useState(false);
  const [empty, setEmpty] = useState(value === -1);
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; start: number; offset: number } | null>(
    null,
  );
  const fraction = useRef(position);
  const frame = useRef(0);
  useEffect(() => {
    if (!drag.current) {
      setLocalValue(value);
      setPosition(Math.max(0, value ?? 1) / 2);
      fraction.current = Math.max(0, value ?? 1) / 2;
      setEmpty(value === -1);
    }
  }, [value]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  async function commit(level: number) {
    setLocalValue(level);
    setEmpty(level === -1);
    if (level >= 0) {
      fraction.current = level / 2;
      setPosition(level / 2);
    }
    onTouch?.();
    if ((await onChange(level)) === false) {
      setLocalValue(value);
      setEmpty(value === -1);
      fraction.current = Math.max(0, value ?? 1) / 2;
      setPosition(fraction.current);
    }
  }
  function move(clientX: number) {
    const rect = rail.current!.getBoundingClientRect();
    fraction.current = Math.max(
      0,
      Math.min(
        1,
        (clientX - rect.left - (drag.current?.offset ?? 0)) / rect.width,
      ),
    );
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setPosition(fraction.current));
  }
  const preview = empty ? -1 : dragging ? Math.round(position * 2) : localValue;
  const tone = empty
    ? "#92998c"
    : position < 0.5
      ? "#b67b35"
      : position > 0.75
        ? "#3d817a"
        : "#6e8764";
  return (
    <div className={`stock-control${empty ? " is-empty" : ""}`}>
      <button
        type="button"
        className="stock-empty"
        disabled={disabled}
        aria-label={`${name}用完了`}
        aria-pressed={empty}
        title="用完了"
        onClick={() => void commit(empty ? Math.round(position * 2) : -1)}
      >
        <Minus size={12} />
      </button>
      <div
        className={`stock-track${dragging ? " dragging" : ""}${keyboard ? " keyboard" : ""}`}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`${name}存量`}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={Math.round(position * 2)}
        aria-valuetext={stockLevelText(preview)}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0) return;
          setKeyboard(false);
          const rect = rail.current!.getBoundingClientRect();
          const center = rect.left + fraction.current * rect.width;
          drag.current = {
            id: e.pointerId,
            start: fraction.current,
            offset: Math.abs(e.clientX - center) < 15 ? e.clientX - center : 0,
          };
          onTouch?.();
          setDragging(true);
          setEmpty(false);
          e.currentTarget.setPointerCapture(e.pointerId);
          move(e.clientX);
          e.preventDefault();
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) move(e.clientX);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          cancelAnimationFrame(frame.current);
          drag.current = null;
          setDragging(false);
          e.currentTarget.releasePointerCapture(e.pointerId);
          void commit(Math.round(fraction.current * 2));
        }}
        onPointerCancel={() => {
          if (!drag.current) return;
          cancelAnimationFrame(frame.current);
          fraction.current = drag.current.start;
          setPosition(fraction.current);
          drag.current = null;
          setDragging(false);
          setEmpty(value === -1);
        }}
        onKeyDown={(e) => {
          if (disabled) return;
          let next = Math.round(position * 2);
          if (["ArrowRight", "ArrowUp"].includes(e.key)) next++;
          else if (["ArrowLeft", "ArrowDown"].includes(e.key)) next--;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = 2;
          else return;
          e.preventDefault();
          setKeyboard(true);
          void commit(Math.max(0, Math.min(2, next)));
        }}
      >
        <div ref={rail} className="stock-rail">
          <span
            className="stock-knob"
            style={{ left: `${position * 100}%`, borderColor: tone }}
          />
        </div>
      </div>
      <span className="stock-label" style={{ color: tone }}>
        {stockLevelText(preview)}
      </span>
    </div>
  );
}
