import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function useHorizontalCarousel(signature: string) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef<number | null>(null);
  const [edges, setEdges] = useState({ left: true, right: true });
  function measure() {
    const el = ref.current;
    if (el)
      setEdges({
        left: el.scrollLeft <= 1,
        right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
  }
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    target.current = null;
    const manualScroll = () => {
      target.current = null;
    };
    el.addEventListener("wheel", manualScroll, { passive: true });
    el.addEventListener("pointerdown", manualScroll, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", manualScroll);
      el.removeEventListener("pointerdown", manualScroll);
    };
  }, [signature]);
  function scroll(direction: number, immediate = false) {
    const el = ref.current;
    if (!el) return;
    const width =
      el.firstElementChild?.getBoundingClientRect().width ?? el.clientWidth;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    target.current = Math.max(
      0,
      Math.min(
        el.scrollWidth - el.clientWidth,
        (target.current ?? el.scrollLeft) + direction * (width + gap),
      ),
    );
    el.scrollTo({
      left: target.current,
      behavior:
        immediate || matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
    });
  }
  return { ref, edges, measure, scroll };
}

export function CarouselButtons({
  carousel,
  label,
}: {
  carousel: ReturnType<typeof useHorizontalCarousel>;
  label: string;
}) {
  return (
    <div className="carousel-buttons">
      <button
        className="round-button"
        aria-label={`上一张${label}`}
        disabled={carousel.edges.left}
        onClick={(e) => carousel.scroll(-1, e.detail === 0)}
      >
        <ChevronLeft size={17} />
      </button>
      <button
        className="round-button"
        aria-label={`下一张${label}`}
        disabled={carousel.edges.right}
        onClick={(e) => carousel.scroll(1, e.detail === 0)}
      >
        <ChevronRight size={17} />
      </button>
    </div>
  );
}
