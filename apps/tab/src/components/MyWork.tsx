import { useEffect, useState } from "react";
import { card, T } from "../theme.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import { hoursForPerson, isOnPersonList } from "../workspace/taskAssignments.js";
import { fetchMyTasks, type MyWorkTask } from "../workspace/msAccountData.js";
import { MsApiError } from "../workspace/msApiFetch.js";

const navy = T.roi.navy;

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** today + n days, as a YYYY-MM-DD string (UTC, matching the date-only model). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

type BucketKey = "overdue" | "today" | "week" | "later" | "someday";
const BUCKETS: { key: BucketKey; label: string; accent?: string }[] = [
  { key: "overdue", label: "Overdue", accent: T.status.critical },
  { key: "today", label: "Today", accent: navy },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "someday", label: "No date" },
];

function bucketOf(due: string | undefined, today: string, weekEnd: string): BucketKey {
  if (!due) return "someday";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= weekEnd) return "week";
  return "later";
}

/**
 * Cross-client "My Work" (Kellie's pilot ask): a PM/AM works across ~15 clients
 * and needs ONE list of everything they carry, regardless of client, sorted by
 * when it's due — not five workspaces opened side by side. Reads the Postgres
 * mirror via /api/my-tasks (RLS-scoped + name-matched), refines to the tasks the
 * person actually owns/carries hours on (isOnPersonList — same rule as the
 * in-account list, so cc-only rows stay out), and groups by due date. Each row
 * jumps straight into that task in its own workspace.
 */
export function MyWork({ onOpen }: { onOpen: (accountId: string, taskId: string) => void }) {
  const [tasks, setTasks] = useState<MyWorkTask[] | null>(null);
  const [userName, setUserName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMyTasks()
      .then((r) => {
        if (cancelled) return;
        setUserName(r.userName);
        setTasks(r.tasks);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof MsApiError ? e.message : "couldn't load your tasks");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const today = AS_OF_TODAY();
  const weekEnd = addDays(today, 7);

  const mine = (tasks ?? [])
    .filter((t) => t.status !== "done" && isOnPersonList(t, userName))
    .sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));

  const byBucket = new Map<BucketKey, MyWorkTask[]>();
  for (const t of mine) {
    const k = bucketOf(t.due, today, weekEnd);
    (byBucket.get(k) ?? byBucket.set(k, []).get(k)!).push(t);
  }
  const overdue = byBucket.get("overdue")?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#eef3f9", borderColor: navy }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>My Work{userName ? ` — ${userName.split(" ")[0]}’s week` : ""}</div>
        <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, lineHeight: 1.5 }}>
          Every open task you own or carry hours on, across every client — {mine.length} task{mine.length === 1 ? "" : "s"}
          {overdue > 0 ? <>, <span style={{ color: T.status.critical, fontWeight: 700 }}>{overdue} overdue</span></> : ""}, sorted by due date. Tasks you’re only cc’d on stay out.
        </div>
      </div>

      {err ? (
        <div style={{ ...card, color: T.status.critical, fontSize: 12.5 }}>{err}</div>
      ) : tasks === null ? (
        <div style={{ ...card, color: T.inkMuted, fontSize: 12.5 }}>Loading your tasks…</div>
      ) : mine.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "26px 14px", color: T.inkMuted }}>
          <div style={{ fontSize: 22 }} aria-hidden>☑</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.inkSecondary, marginTop: 4 }}>Nothing on your plate right now</div>
          <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
            A task shows here once you have hours on it (or you own it) in any workspace.
          </div>
        </div>
      ) : (
        BUCKETS.filter((b) => (byBucket.get(b.key)?.length ?? 0) > 0).map((b) => {
          const rows = byBucket.get(b.key)!;
          return (
            <div key={b.key} style={card}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: b.accent ?? T.ink }}>{b.label}</span>
                <span style={{ fontSize: 10.5, color: T.inkMuted }}>{rows.length} task{rows.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rows.map((t) => {
                  const od = t.due && t.due < today;
                  const myHours = hoursForPerson(t, userName);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="table-row-hover"
                      onClick={() => onOpen(t.accountId, t.id)}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: `1px solid ${T.grid}`, background: "none", border: "none", borderTopStyle: "solid", cursor: "pointer", textAlign: "left", width: "100%" }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                        <span style={{ fontSize: 10.5, color: T.inkMuted }}>
                          <span style={{ fontWeight: 700, color: navy }}>{t.clientName}</span>
                          {t.projectLabel ? ` · ${t.projectLabel}${t.phaseLabel ? ` · ${t.phaseLabel}` : ""}` : ""}
                        </span>
                      </span>
                      {myHours > 0 && <span style={{ fontSize: 10.5, color: T.inkMuted, whiteSpace: "nowrap" }}>{myHours}h</span>}
                      {t.due && (
                        <span style={{ fontSize: 11, fontWeight: od ? 700 : 400, color: od ? T.status.critical : T.inkSecondary, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                          {od ? "⚠ " : ""}{fmtDay(t.due)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
