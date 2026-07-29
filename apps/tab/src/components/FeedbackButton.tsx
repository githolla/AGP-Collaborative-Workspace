import { useEffect, useRef, useState } from "react";
import { T } from "../theme.js";
import { locationLabel, questionFor, type PageLocation } from "../workspace/pageContext.js";

/**
 * Floating feedback button, present on every surface that makes sense to
 * comment on. It reads where the person is and asks about that screen by name
 * — including the client's name — so what comes back is specific enough to
 * act on and arrives already labelled with its origin.
 *
 * Answers land in the same store as the tour's, so the admin roll-up and the
 * CSV cover both without a second pipeline.
 */

export function FeedbackButton({
  location,
  onSubmit,
}: {
  location: PageLocation;
  onSubmit: (entry: { stepKey: string; stepTitle: string; prompt: string; choice: string; choiceLabel: string; comment: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const question = questionFor(location);

  // Moving to another screen resets the form: a half-written note about Files
  // must never be submitted against Access.
  const key = question?.key;
  useEffect(() => {
    setOpen(false);
    setChoice("");
    setComment("");
    setSent(false);
  }, [key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // Deferred: the click that opened the panel would otherwise close it.
    const t = window.setTimeout(() => window.addEventListener("mousedown", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (!question) return null;

  const canSend = choice !== "" || comment.trim() !== "";

  const send = () => {
    if (!canSend) return;
    onSubmit({
      stepKey: question.key,
      stepTitle: locationLabel(location, question),
      prompt: question.prompt,
      choice,
      choiceLabel: question.options.find((o) => o.key === choice)?.label ?? "",
      comment: comment.trim(),
    });
    setSent(true);
    setChoice("");
    setComment("");
    window.setTimeout(() => {
      setSent(false);
      setOpen(false);
    }, 1400);
  };

  return (
    <div style={{ position: "fixed", right: 18, bottom: 18, zIndex: 9000 }}>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Send feedback about this page"
          style={{
            position: "absolute",
            right: 0,
            bottom: 52,
            width: 330,
            maxWidth: "calc(100vw - 36px)",
            background: "#fff",
            border: `1px solid ${T.grid}`,
            borderRadius: 12,
            boxShadow: "0 18px 50px rgba(7, 26, 47, 0.28)",
            padding: "14px 16px",
          }}
        >
          {sent ? (
            <div style={{ padding: "16px 0", textAlign: "center" }}>
              <div style={{ fontSize: 22 }}>✓</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>Thanks — that's logged.</div>
              <div style={{ fontSize: 11.5, color: T.inkMuted, marginTop: 3 }}>
                Add another any time; nothing gets overwritten.
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: 0.7,
                    textTransform: "uppercase",
                    color: T.inkMuted,
                  }}
                >
                  Feedback on
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={{ border: 0, background: "none", cursor: "pointer", color: T.inkMuted, fontSize: 15, lineHeight: 1 }}
                >
                  ×
                </button>
              </div>
              {/* Naming the surface is the point — people trust it more when
                  they can see it knows where they are. */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.roi.navy, marginTop: 2 }}>
                {locationLabel(location, question)}
              </div>
              <div style={{ fontSize: 12.5, color: T.ink, marginTop: 9, lineHeight: 1.45 }}>{question.prompt}</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 9 }}>
                {question.options.map((o) => {
                  const on = choice === o.key;
                  return (
                    <button
                      key={o.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setChoice(on ? "" : o.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        textAlign: "left",
                        background: on ? "#eef4fb" : "#fff",
                        border: `1px solid ${on ? T.roi.navy : T.grid}`,
                        borderRadius: 8,
                        padding: "6px 9px",
                        cursor: "pointer",
                        font: "inherit",
                      }}
                    >
                      <span
                        style={{
                          width: 17,
                          height: 17,
                          borderRadius: 5,
                          flexShrink: 0,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: on ? "#fff" : T.inkSecondary,
                          background: on ? T.roi.navy : "#f0efec",
                        }}
                      >
                        {o.key.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 11.8, color: T.ink, lineHeight: 1.35 }}>{o.label}</span>
                    </button>
                  );
                })}
              </div>

              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder={question.placeholder}
                style={{
                  width: "100%",
                  marginTop: 8,
                  border: `1px solid ${T.grid}`,
                  borderRadius: 8,
                  padding: "7px 9px",
                  fontSize: 12,
                  fontFamily: "inherit",
                  color: T.ink,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />

              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                <button type="button" className="btn btn-primary btn-sm" disabled={!canSend} onClick={send}>
                  Send
                </button>
                <span style={{ fontSize: 10.5, color: T.inkMuted }}>
                  {canSend ? "Goes to the product team" : "Pick one or write something"}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Tell us about this page"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: T.roi.navy,
          color: "#fff",
          border: 0,
          borderRadius: 999,
          padding: "9px 15px",
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: "inherit",
          cursor: "pointer",
          boxShadow: "0 8px 22px rgba(7, 26, 47, 0.3)",
        }}
      >
        <span aria-hidden>💬</span>
        Feedback
      </button>
    </div>
  );
}
