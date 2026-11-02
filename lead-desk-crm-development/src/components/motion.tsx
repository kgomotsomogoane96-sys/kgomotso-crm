"use client";

import Lenis from "lenis";
import {
  createContext, useContext, useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode,
} from "react";

type LenisRef = { current: Lenis | null };
const LenisContext = createContext<LenisRef>({ current: null });

export function useLenis(): LenisRef {
  return useContext(LenisContext);
}

function isScrollable(node: HTMLElement): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (node === document.body || node === document.documentElement) return false;
  const style = window.getComputedStyle(node);
  const vertical = (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 1;
  return vertical;
}

/** Inertial, buttery page scroll. Nested scroll areas (drawers, modals, lists) keep native scroll. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const ref = useRef<Lenis | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.3,
      prevent: (node) => isScrollable(node),
    });
    ref.current = lenis;
    let frame = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      ref.current = null;
    };
  }, []);
  return <LenisContext.Provider value={ref}>{children}</LenisContext.Provider>;
}

/** Adds `.is-in` to every [data-reveal] element once it scrolls into view. */
export function RevealObserver() {
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 });
    const scan = () => document.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
    scan();
    let queued = false;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; scan(); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return null;
}

export type SegItem = { id: string; label: ReactNode; count?: number; icon?: ReactNode; title?: string };

/** Segmented control with a spring-animated sliding indicator. */
export function Segmented({ items, value, onChange, variant = "light", className = "" }: {
  items: SegItem[];
  value: string;
  onChange: (id: string) => void;
  variant?: "nav" | "light" | "notch" | "dark";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ x: 0, w: 0, visible: false });
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const el = Array.from(track.querySelectorAll<HTMLElement>("[data-seg]")).find((node) => node.dataset.seg === value);
      if (el) setIndicator({ x: el.offsetLeft, w: el.offsetWidth, visible: true });
      else setIndicator((s) => ({ ...s, visible: false }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [value, items.length]);

  useEffect(() => {
    if (!indicator.visible || animate) return;
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [indicator.visible, animate]);

  return (
    <div ref={trackRef} role="tablist" className={`kc-seg kc-seg-${variant} ${animate ? "" : "kc-seg-noanim"} ${className}`}>
      <span aria-hidden className="kc-seg-ind" style={{ transform: `translateX(${indicator.x}px)`, width: indicator.w, opacity: indicator.visible ? 1 : 0 }} />
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          title={item.title}
          aria-selected={item.id === value}
          data-seg={item.id}
          data-active={item.id === value}
          onClick={() => onChange(item.id)}
          className="kc-seg-btn"
        >
          {item.icon}
          {item.label}
          {item.count !== undefined && <span className="kc-seg-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Eased count-up number. */
export function AnimatedNumber({ value, format, duration = 1100 }: { value: number; format?: (n: number) => string; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = origin + (value - origin) * eased;
      setDisplay(next);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); from.current = value; };
  }, [value, duration]);
  return <>{format ? format(display) : Math.round(display).toLocaleString("en-ZA")}</>;
}

/** iOS-style toggle with a stretchy spring knob. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`kc-switch ${checked ? "is-on" : ""}`}>
      <span className="kc-switch-knob" />
    </button>
  );
}

const AVATAR_GRADIENTS = [
  ["#f6b38a", "#e9775a"], ["#9bc3ff", "#5b8def"], ["#c9b6ff", "#8b6cf0"], ["#9fe3c1", "#3fb487"],
  ["#ffd38a", "#f0a63a"], ["#ffadc7", "#e4608c"], ["#a8d8e8", "#4fa3c4"], ["#d6e98a", "#9cbc2c"],
];

export function Avatar({ name, size = 32, style, className = "" }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [a, b] = AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length];
  const initials = name.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w[0] ?? "")).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return (
    <span className={`kc-avatar ${className}`} title={name} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.34), background: `linear-gradient(135deg, ${a}, ${b})`, ...style }}>
      {initials}
    </span>
  );
}
