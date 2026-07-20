import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "../theme.js";

/**
 * The spotlight tour — the signature guided walkthrough, in AGP brand tokens.
 * A dimmed, blurred overlay with an animated cut-out glides from one
 * highlighted area to the next; each step's card can carry a quote from
 * Cara's features doc so the walkthrough shows the ask next to what was
 * built. No tour library: React state + portals.
 *
 * Engine spec: 70%-navy overlay with 4px backdrop blur; cut-out via an
 * even-odd clip-path (animatable, so the spotlight glides, 350ms); a 2px
 * brand ring with a soft glow around the target; auto-flipping tooltip card
 * with progress dots; focus trapped in the card; ArrowRight/Enter next,
 * ArrowLeft back, Escape exits; prefers-reduced-motion disables the glide.
 */

export interface TourQuote {
  text: string;
  from: string;
}

export interface TourStep {
  key: string;
  /** Hash (without #) to be on before showing this step. */
  route?: string;
  /** CSS selector to spotlight; omit for a centered card. */
  target?: string;
  placement?: "top" | "bottom" | "left" | "right" | "auto";
  title: string;
  body: string;
  /** The ask this step answers — shown as a quote block above the body. */
  quote?: TourQuote;
}

const PAD = 8;
const CARD_W = 344;
const CARD_EST_H = 300;
const GLIDE_MS = 350;
const DIM = "rgba(7, 26, 47, 0.72)";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Even-odd polygon: full viewport with a rectangular hole — interpolates smoothly. */
function holeClipPath(hole: Box): string {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const { x, y, w, h } = hole;
  return `polygon(evenodd, 0px 0px, ${W}px 0px, ${W}px ${H}px, 0px ${H}px, 0px 0px, ${x}px ${y}px, ${x}px ${y + h}px, ${x + w}px ${y + h}px, ${x + w}px ${y}px, ${x}px ${y}px)`;
}

export function Tour({
  steps,
  step,
  onStep,
  onClose,
}: {
  steps: TourStep[];
  step: number;
  onStep: (i: number) => void;
  onClose: () => void;
}) {
  const s = steps[step];
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const reduced =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Navigate if the step lives on another route, then find + track its target.
  useEffect(() => {
    if (!s) return;
    if (s.route !== undefined && window.location.hash.replace(/^#/, "") !== s.route) {
      window.location.hash = s.route;
    }
    if (!s.target) {
      setBox(null);
      return;
    }
    let tries = 0;
    let timer = 0;
    const measure = (el: Element) => {
      const r = el.getBoundingClientRect();
      setBox({ x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 });
    };
    const find = () => {
      const el = document.querySelector(s.target!);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        // Smooth scroll settles within ~350ms; measure then and once more after.
        timer = window.setTimeout(() => {
          measure(el);
          timer = window.setTimeout(() => measure(el), 250);
        }, reduced ? 30 : 380);
      } else if (tries++ < 40) {
        timer = window.setTimeout(find, 50);
      } else {
        setBox(null); // degrade to a centered card, never a broken tour
      }
    };
    find();
    const refresh = () => {
      const el = s.target ? document.querySelector(s.target) : null;
      if (el) measure(el);
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [step, s, reduced]);

  // Keyboard driving + focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if ((e.key === "ArrowRight" || e.key === "Enter") && step < steps.length - 1) {
        e.preventDefault();
        onStep(step + 1);
      } else if (e.key === "Enter" && step === steps.length - 1) {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft" && step > 0) {
        onStep(step - 1);
      } else if (e.key === "Tab" && cardRef.current) {
        const focusables = cardRef.current.querySelectorAll<HTMLElement>("button, [href], input");
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length, onStep, onClose]);

  // Focus lands in the card on every step.
  useEffect(() => {
    const btn = cardRef.current?.querySelector<HTMLElement>("[data-tour-next]");
    btn?.focus();
  }, [step]);

  if (!s) return null;
  const last = step === steps.length - 1;
  const glide = reduced ? "none" : `clip-path ${GLIDE_MS}ms ease-in-out`;
  const ringGlide = reduced ? "none" : `all ${GLIDE_MS}ms ease-in-out`;

  // Card placement: auto flips bottom → top → right → left, clamped to viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardStyle: React.CSSProperties;
  if (!box) {
    cardStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  } else {
    const want = s.placement && s.placement !== "auto" ? s.placement : undefined;
    const fitsBottom = box.y + box.h + CARD_EST_H + 16 < vh;
    const fitsTop = box.y - CARD_EST_H - 16 > 0;
    const fitsRight = box.x + box.w + CARD_W + 16 < vw;
    const place =
      want ?? (fitsBottom ? "bottom" : fitsTop ? "top" : fitsRight ? "right" : "left");
    const clampX = (x: number) => Math.min(Math.max(12, x), Math.max(12, vw - CARD_W - 16));
    const clampY = (y: number) => Math.min(Math.max(12, y), Math.max(12, vh - CARD_EST_H - 12));
    if (place === "bottom") cardStyle = { top: box.y + box.h + 14, left: clampX(box.x) };
    else if (place === "top") cardStyle = { top: Math.max(12, box.y - CARD_EST_H - 14), left: clampX(box.x) };
    else if (place === "right") cardStyle = { top: clampY(box.y), left: box.x + box.w + 14 };
    else cardStyle = { top: clampY(box.y), left: Math.max(12, box.x - CARD_W - 14) };
  }

  // Centered-card steps use a zero-size hole so the polygon keeps its shape
  // and the next transition still glides.
  const hole: Box = box ?? { x: vw / 2, y: vh / 2, w: 0, h: 0 };

  return createPortal(
    <>
      {/* Dim + blur everything except the spotlit cut-out. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: DIM,
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          clipPath: holeClipPath(hole),
          transition: glide,
        }}
      />
      {/* Brand ring + soft glow around the target. */}
      {box && (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: hole.y,
            left: hole.x,
            width: hole.w,
            height: hole.h,
            borderRadius: 12,
            border: `2px solid ${T.roi.navy}`,
            boxShadow: `0 0 24px rgba(11, 60, 110, 0.4)`,
            pointerEvents: "none",
            zIndex: 9999,
            transition: ringGlide,
          }}
        />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        style={{
          position: "fixed",
          ...cardStyle,
          width: CARD_W,
          maxWidth: "calc(100vw - 24px)",
          background: "#fff",
          border: `1px solid ${T.grid}`,
          borderRadius: 12,
          boxShadow: "0 18px 50px rgba(7, 26, 47, 0.35)",
          padding: "16px 18px",
          zIndex: 10000,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.4, color: T.roi.navy, textTransform: "uppercase" }}>
          Step {step + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 800, color: T.ink, marginTop: 5, letterSpacing: -0.2 }}>{s.title}</div>

        {s.quote && (
          <div
            style={{
              borderLeft: `3px solid ${T.roi.navy}`,
              background: "#f4f7fb",
              borderRadius: "0 8px 8px 0",
              padding: "8px 11px",
              margin: "9px 0 2px",
            }}
          >
            <div style={{ fontSize: 12.5, fontStyle: "italic", color: T.ink, lineHeight: 1.5 }}>“{s.quote.text}”</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: T.inkMuted, marginTop: 5 }}>
              — {s.quote.from}
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-start", gap: 7, marginTop: 8 }}>
          {s.quote && (
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: 0.6,
                color: "#116a43",
                background: "#e3f4ec",
                borderRadius: 999,
                padding: "2px 8px",
                textTransform: "uppercase",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              Built ✓
            </span>
          )}
          <div style={{ fontSize: 13, color: T.ink, opacity: 0.78, lineHeight: 1.6 }}>{s.body}</div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" data-tour-next className="btn btn-primary btn-sm" onClick={() => (last ? onClose() : onStep(step + 1))}>
            {last ? "Finish ✓" : "Next →"}
          </button>
          {step > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStep(step - 1)}>
              ← Back
            </button>
          )}
          {/* Progress dots — one per step. */}
          <span style={{ display: "flex", gap: 5, marginLeft: 4 }} aria-hidden>
            {steps.map((st, i) => (
              <span
                key={st.key}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: i === step ? T.roi.navy : T.grid,
                  transition: reduced ? "none" : "background 200ms ease",
                }}
              />
            ))}
          </span>
          <button type="button" className="btn-link" style={{ marginLeft: "auto", fontSize: 11, color: T.inkMuted }} onClick={onClose}>
            Skip tour
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
