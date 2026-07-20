import { useEffect, useState } from "react";
import { T } from "../theme.js";

/**
 * Spotlight tour: dims the app and walks through it one highlighted area at a
 * time — built for demoing the workspace (auto-starts on first visit, restarts
 * from the nav "Tour" button). Steps can navigate by hash; the target is found
 * by [data-tour] selector after the route renders. A missing target degrades
 * to a centered card, never a broken tour.
 */

export interface TourStep {
  key: string;
  /** Hash (without #) to be on before showing this step. */
  route?: string;
  /** CSS selector to spotlight; omit for a centered card. */
  target?: string;
  title: string;
  body: string;
}

const PAD = 8;
const CARD_W = 330;
const DIM = "rgba(9, 24, 44, 0.62)";

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
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Navigate if the step lives on another route, then find its target.
  useEffect(() => {
    if (!s) return;
    if (s.route !== undefined && window.location.hash.replace(/^#/, "") !== s.route) {
      window.location.hash = s.route;
    }
    setRect(null);
    if (!s.target) return;
    let tries = 0;
    let timer = 0;
    let raf = 0;
    const find = () => {
      const el = document.querySelector(s.target!);
      if (el) {
        el.scrollIntoView({ block: "center" });
        raf = requestAnimationFrame(() => setRect(el.getBoundingClientRect()));
      } else if (tries++ < 40) {
        timer = window.setTimeout(find, 50);
      }
      // Not found after 2s → stay centered; the copy still explains the area.
    };
    find();
    const refresh = () => {
      const el = s.target ? document.querySelector(s.target) : null;
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [step, s]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && step < steps.length - 1) onStep(step + 1);
      if (e.key === "ArrowLeft" && step > 0) onStep(step - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, steps.length, onStep, onClose]);

  if (!s) return null;
  const last = step === steps.length - 1;

  // Card placement: under the spotlight when it fits, above otherwise, centered when no target.
  const cardStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        top: rect.bottom + PAD + 210 < window.innerHeight ? rect.bottom + PAD + 10 : Math.max(12, rect.top - PAD - 218),
        left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - CARD_W - 16)),
      }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <>
      {/* Click shield — the tour owns the screen while it runs. */}
      <div style={{ position: "fixed", inset: 0, zIndex: 997 }} onClick={() => !last && onStep(step + 1)} />
      {rect ? (
        <div
          aria-hidden
          style={{
            position: "fixed",
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: `0 0 0 9999px ${DIM}`,
            border: "2px solid rgba(255,255,255,0.85)",
            pointerEvents: "none",
            zIndex: 998,
            transition: "all 0.25s ease",
          }}
        />
      ) : (
        <div aria-hidden style={{ position: "fixed", inset: 0, background: DIM, zIndex: 998 }} />
      )}

      <div
        role="dialog"
        aria-label={s.title}
        style={{
          ...cardStyle,
          width: CARD_W,
          maxWidth: "calc(100vw - 24px)",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 18px 50px rgba(9, 24, 44, 0.35)",
          padding: "16px 18px",
          zIndex: 999,
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.5, color: T.inkMuted, textTransform: "uppercase" }}>
          {step + 1} of {steps.length}
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: T.roi.navy, marginTop: 4 }}>{s.title}</div>
        <div style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.55, marginTop: 6 }}>{s.body}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => (last ? onClose() : onStep(step + 1))}>
            {last ? "Finish ✓" : "Next →"}
          </button>
          {step > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStep(step - 1)}>
              ← Back
            </button>
          )}
          <button type="button" className="btn-link" style={{ marginLeft: "auto", fontSize: 11, color: T.inkMuted }} onClick={onClose}>
            Skip tour
          </button>
        </div>
      </div>
    </>
  );
}
