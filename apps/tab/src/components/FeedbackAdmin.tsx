import { useMemo, useState } from "react";
import { T } from "../theme.js";
import { Button, Card } from "./ui.js";
import { SectionTitle } from "./bits.js";
import { feedbackToCsv, respondentCount, tallyByStep } from "../workspace/feedback.js";
import type { TourFeedback } from "../workspace/types.js";

/**
 * Tour-feedback admin — reachable only at #admin/feedback, and only past the
 * passcode. Nothing in the UI links here, by design.
 *
 * On the honesty of the lock: this is a shared passcode, not authentication.
 * The app has no identity layer yet (`AUTH_REQUIRED` is dormant until the
 * Entra registration lands — BLOCKERS #5), so anyone who learns both the
 * route and the code can read the responses. That is fine for internal
 * testing feedback and would NOT be fine for anything confidential. When SSO
 * lands, replace the passcode with an email allowlist — the surface stays the
 * same, only `unlocked` changes meaning.
 */

const UNLOCK_KEY = "agp-collab-feedback-admin-v1";
/** Overridable per environment; the fallback keeps local dev usable. */
const CODE = (import.meta.env.VITE_FEEDBACK_ADMIN_CODE as string | undefined)?.trim() || "agp-feedback";

function downloadCsv(entries: readonly TourFeedback[]): void {
  const blob = new Blob([feedbackToCsv(entries)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  // Date-stamped: testing runs in rounds, and three files called
  // "feedback.csv" in a downloads folder help nobody.
  a.download = `agp-tour-feedback-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function Bar({ percent }: { percent: number }) {
  return (
    <div style={{ height: 6, borderRadius: 999, background: "#f0efec", overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${percent}%`, height: "100%", background: T.roi.navy, borderRadius: 999 }} />
    </div>
  );
}

export function FeedbackAdmin({ feedback, onBack }: { feedback: TourFeedback[]; onBack: () => void }) {
  const [unlocked, setUnlocked] = useState(() => {
    try {
      return window.localStorage.getItem(UNLOCK_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [code, setCode] = useState("");
  const [wrong, setWrong] = useState(false);

  const tally = useMemo(() => tallyByStep(feedback), [feedback]);
  const people = useMemo(() => respondentCount(feedback), [feedback]);
  const comments = useMemo(() => feedback.filter((f) => f.comment.trim()).length, [feedback]);

  const tryUnlock = () => {
    if (code.trim() === CODE) {
      setUnlocked(true);
      setWrong(false);
      try {
        window.localStorage.setItem(UNLOCK_KEY, "1");
      } catch {
        // private browsing — unlocked for this session only, which is fine
      }
    } else {
      setWrong(true);
    }
  };

  const lock = () => {
    try {
      window.localStorage.removeItem(UNLOCK_KEY);
    } catch {
      // nothing to clear
    }
    setUnlocked(false);
    setCode("");
  };

  if (!unlocked) {
    return (
      <div style={{ maxWidth: 380, margin: "80px auto" }}>
        <Card>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.ink }}>Feedback admin</div>
          <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 6, lineHeight: 1.55 }}>
            Tour responses from everyone testing the workspace. Enter the admin passcode.
          </p>
          <input
            type="password"
            value={code}
            autoFocus
            onChange={(e) => {
              setCode(e.target.value);
              setWrong(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && tryUnlock()}
            placeholder="Passcode"
            style={{
              width: "100%",
              marginTop: 12,
              border: `1px solid ${wrong ? T.status.critical : T.grid}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 13,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          {wrong && <div style={{ fontSize: 11.5, color: T.status.critical, marginTop: 6 }}>That passcode isn't right.</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <Button onClick={tryUnlock}>Unlock</Button>
            <Button variant="ghost" onClick={onBack}>
              Back to Clients
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 19, fontWeight: 700, color: T.ink }}>Tour feedback</h1>
          <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>
            What testers answered as they walked through the workspace. Everyone's responses pool here — the CSV
            carries one row per answer, with the free text intact.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Button onClick={() => downloadCsv(feedback)} disabled={feedback.length === 0}>
            ⬇ Download CSV
          </Button>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        {[
          { label: "Responses", value: feedback.length },
          { label: "People", value: people },
          { label: "Steps answered", value: tally.length },
          { label: "With comments", value: comments },
        ].map((s) => (
          <div
            key={s.label}
            style={{ border: `1px solid ${T.grid}`, borderRadius: 10, padding: "10px 14px", background: "#fff", minWidth: 108 }}
          >
            <div style={{ fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: -0.4 }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {feedback.length === 0 ? (
        <Card>
          <div style={{ fontSize: 13, color: T.inkSecondary, lineHeight: 1.6 }}>
            No responses yet. They arrive as people take the tour — each step asks one multiple-choice question and
            offers a comment box, and answers save as testers move through.
          </div>
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tally.map((step) => (
            <Card key={step.stepKey}>
              <SectionTitle right={<span style={{ fontSize: 11, color: T.inkMuted }}>{step.answered} answered</span>}>
                {step.stepTitle}
              </SectionTitle>
              <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 2, marginBottom: 10 }}>{step.prompt}</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                {step.options.map((o) => (
                  <div key={o.choice} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: "#f0efec",
                        color: T.inkSecondary,
                        display: "grid",
                        placeItems: "center",
                        fontSize: 10,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {o.choice.toUpperCase()}
                    </span>
                    <span style={{ fontSize: 12, color: T.ink, width: 210, flexShrink: 0 }}>{o.label}</span>
                    <Bar percent={o.percent} />
                    <span style={{ fontSize: 11.5, color: T.inkSecondary, width: 62, textAlign: "right", flexShrink: 0 }}>
                      {o.count} · {o.percent}%
                    </span>
                  </div>
                ))}
              </div>

              {step.comments.length > 0 && (
                <div style={{ marginTop: 12, borderTop: `1px solid ${T.grid}`, paddingTop: 10 }}>
                  <div
                    style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: T.inkMuted }}
                  >
                    Comments ({step.comments.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                    {step.comments.map((c, i) => (
                      <div key={`${c.at}-${i}`} style={{ borderLeft: `3px solid ${T.grid}`, paddingLeft: 10 }}>
                        <div style={{ fontSize: 12.5, color: T.ink, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{c.text}</div>
                        <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 3 }}>
                          {c.person} · {new Date(c.at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 11, color: T.inkMuted, lineHeight: 1.6 }}>
        Passcode-gated, not authenticated — anyone with the route and the code can read this. Swap it for a
        sign-in check once Entra SSO is configured (BLOCKERS #5).{" "}
        <button type="button" className="btn-link" style={{ fontSize: 11 }} onClick={lock}>
          Lock again
        </button>
      </div>
    </div>
  );
}
