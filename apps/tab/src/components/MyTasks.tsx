import { card, T } from "../theme.js";
import { AS_OF_TODAY } from "../workspace/format.js";
import type { ClientAccount } from "../workspace/types.js";
import { hoursForPerson, isOnPersonList } from "../workspace/taskAssignments.js";

const navy = T.roi.navy;

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Cross-client "My Tasks" — the personal home the spec calls for (§2). A PM (or
 * any AGP person) works across many accounts; this pulls the open tasks they
 * actually carry hours on — via isOnPersonList, the same rule as the in-account
 * personal list — into ONE list, grouped by client, so they don't open five
 * workspaces to assemble their week. Click a task to jump straight to it.
 */
export function MyTasks({ accounts, userName, onOpen }: { accounts: ClientAccount[]; userName: string; onOpen: (accountId: string, taskId: string) => void }) {
  const today = AS_OF_TODAY();
  const groups = accounts
    .filter((a) => !a.archived)
    .map((a) => ({
      account: a,
      tasks: a.tasks
        .filter((t) => t.status !== "done" && isOnPersonList(t, userName))
        .sort((x, y) => (x.due ?? "9999").localeCompare(y.due ?? "9999")),
    }))
    .filter((g) => g.tasks.length > 0)
    .sort((x, y) => x.account.clientName.localeCompare(y.account.clientName));
  const total = groups.reduce((s, g) => s + g.tasks.length, 0);
  const overdue = groups.reduce((s, g) => s + g.tasks.filter((t) => t.due && t.due < today).length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, background: "#eef3f9", borderColor: navy }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: navy }}>My Tasks — {userName.split(" ")[0]}’s week</div>
        <div style={{ fontSize: 12, color: T.inkSecondary, marginTop: 3, lineHeight: 1.5 }}>
          Open tasks across every account where you carry hours or own the work — {total} task{total === 1 ? "" : "s"}
          {overdue > 0 ? <>, <span style={{ color: T.status.critical, fontWeight: 700 }}>{overdue} overdue</span></> : ""}. Tasks you’re only cc’d on stay out of this list.
        </div>
      </div>

      {groups.length === 0 ? (
        <div style={{ ...card, textAlign: "center", padding: "26px 14px", color: T.inkMuted }}>
          <div style={{ fontSize: 22 }} aria-hidden>☑</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.inkSecondary, marginTop: 4 }}>Nothing on your plate right now</div>
          <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.5 }}>
            You’ll see a task here once you have hours on it (or you’re its owner) in any workspace.
          </div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.account.id} style={card}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <button type="button" className="btn-link" style={{ fontSize: 13.5, fontWeight: 800, color: navy }} onClick={() => onOpen(g.account.id, g.tasks[0]!.id)}>
                {g.account.clientName}
              </button>
              <span style={{ fontSize: 10.5, color: T.inkMuted }}>{g.tasks.length} task{g.tasks.length === 1 ? "" : "s"}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {g.tasks.map((t) => {
                const od = t.due && t.due < today;
                const myHours = hoursForPerson(t, userName);
                return (
                  <button
                    key={t.id}
                    type="button"
                    className="table-row-hover"
                    onClick={() => onOpen(g.account.id, t.id)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderTop: `1px solid ${T.grid}`, background: "none", border: "none", borderTopStyle: "solid", cursor: "pointer", textAlign: "left", width: "100%" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                      {t.projectLabel && <span style={{ fontSize: 10.5, color: T.inkMuted }}>{t.projectLabel}{t.phaseLabel ? ` · ${t.phaseLabel}` : ""}</span>}
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
        ))
      )}
    </div>
  );
}

/** Count of a person's open tasks across all accounts — for the nav pill. */
export function myTaskCount(accounts: ClientAccount[], userName: string): number {
  return accounts
    .filter((a) => !a.archived)
    .reduce((s, a) => s + a.tasks.filter((t) => t.status !== "done" && isOnPersonList(t, userName)).length, 0);
}
