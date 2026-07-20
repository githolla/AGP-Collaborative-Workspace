import { useState } from "react";
import { computeProjectROI } from "@agp/roi";
import { T } from "../theme.js";
import { TagChip } from "./bits.js";
import { Button, Card, Crumbs } from "./ui.js";
import { GradeBadge } from "./GradeBadge.js";
import { FactorEditor } from "./FactorEditor.js";
import { ExecCard, GatherList, ScenarioStrip, Waterfall } from "./RoiPanel.js";
import { Thread } from "./Thread.js";
import { BriefCard, PhaseTimeline, TeamParts } from "./PlanCards.js";
import { TasksCard } from "./TasksCard.js";
import { WhatsNew } from "./WhatsNew.js";
import { AGENTS } from "../workspace/agents.js";
import { fmtUsd, timeAgoLabel } from "../workspace/format.js";
import { TYPE_LABEL, type Initiative, type TaskStatus } from "../workspace/types.js";
import type { WorkspaceFactor } from "@agp/roi";

/**
 * The Build workspace, tabbed for calm (the manager's simplicity mandate,
 * applied to our own side): Overview is glanceable; the ROI depth lives in
 * Numbers; delivery lives in Plan & Tasks; conversation in Discussion.
 */

type BuildTab = "overview" | "numbers" | "plan" | "discussion";

const TABS: { key: BuildTab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "numbers", label: "Numbers" },
  { key: "plan", label: "Plan & Tasks" },
  { key: "discussion", label: "Discussion" },
];

export function InitiativeWorkspace({
  initiative,
  onBack,
  onFactorChange,
  onPost,
  onAskAnalyst,
  onSummaryChange,
  onInvite,
  onPartAdded,
  onAddTask,
  accounts,
  onSetClientAccount,
  onToggleClientVisible,
  onTaskStatus,
  onArchive,
}: {
  initiative: Initiative;
  onBack: () => void;
  onFactorChange: (key: string, patch: Partial<WorkspaceFactor>) => void;
  onPost: (body: string) => void;
  onAskAnalyst: () => void;
  onSummaryChange: (summary: string) => void;
  onInvite: (personId: string) => void;
  onPartAdded: (personId: string) => void;
  onAddTask: (title: string, ownerName?: string, due?: string, label?: string) => void;
  accounts: { id: string; clientName: string }[];
  onSetClientAccount: (accountId: string | null) => void;
  onToggleClientVisible: (taskId: string) => void;
  onTaskStatus: (taskId: string, status: TaskStatus) => void;
  onArchive: (archived: boolean) => void;
}) {
  const [tab, setTab] = useState<BuildTab>("overview");
  const roi = computeProjectROI(initiative.factors);
  const openTasks = initiative.tasks.filter((t) => t.status !== "done").length;
  const partsIn = initiative.plan ? initiative.plan.packages.filter((p) => p.status === "part_added").length : 0;
  const owners = [
    ...new Set([
      ...(initiative.plan?.packages.map((p) => p.name) ?? []),
      ...initiative.tasks.map((t) => t.ownerName).filter((o): o is string => !!o),
    ]),
  ];

  const badge = (n: number) =>
    n > 0 ? <span style={{ opacity: 0.8, fontWeight: 500, marginLeft: 5 }}>{n}</span> : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <Crumbs trail={[{ label: "Sandbox", onClick: onBack }, { label: initiative.name }]} />
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <GradeBadge grade={roi.grade} size={30} />
          <h1 style={{ fontSize: 19, fontWeight: 700, color: T.ink }}>{initiative.name}</h1>
          <TagChip>{TYPE_LABEL[initiative.type]}</TagChip>
          {initiative.archived && <TagChip>Archived — history retained</TagChip>}
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: T.ink }} className="num">
              {fmtUsd(roi.netRecurringAnnual)}<span style={{ fontSize: 11, fontWeight: 500, color: T.inkMuted }}>/yr net</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => onArchive(!initiative.archived)}>
              {initiative.archived ? "Restore" : "Archive"}
            </Button>
          </span>
        </div>

        <div role="tablist" aria-label="Build workspace" style={{ display: "flex", gap: 2, marginTop: 12, borderBottom: `2px solid ${T.roi.navy}`, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === tab} type="button" className="ws-tab" onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === "plan" && badge(openTasks)}
              {t.key === "numbers" && roi.hasUnknowns && (
                <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 800, color: t.key === tab ? "#fff" : T.roi.amber }}>●</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div className="two-col fade-in">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Summary">
              <textarea
                className="textarea"
                value={initiative.summary}
                onChange={(e) => onSummaryChange(e.target.value)}
                placeholder="What is this build? One or two sentences."
                rows={2}
                style={{ width: "100%" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>Internal zone of:</span>
                <select
                  className="select"
                  value={initiative.clientAccountId ?? ""}
                  onChange={(e) => onSetClientAccount(e.target.value || null)}
                >
                  <option value="">No client account (fully internal)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.clientName}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: T.inkMuted, flex: 1, minWidth: 200 }}>
                  {initiative.clientAccountId
                    ? "Tasks marked “client ✓” mirror onto the client's shared plan; financials never leave this side."
                    : "Link to a client account to share selected tasks onto its plan."}
                </span>
              </div>
            </Card>
            <WhatsNew activity={initiative.activity} thread={initiative.thread} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ExecCard factors={initiative.factors} />
            {initiative.plan && <PhaseTimeline plan={initiative.plan} />}
            {initiative.plan && (
              <Card title="Team at a glance" right={<Button variant="link" onClick={() => setTab("plan")}>Open Plan & Tasks ›</Button>}>
                <div style={{ fontSize: 12.5, color: T.inkSecondary, lineHeight: 1.6 }}>
                  {initiative.plan.packages.length} people · {partsIn}/{initiative.plan.packages.length} parts in ·{" "}
                  {openTasks} open task{openTasks === 1 ? "" : "s"}
                </div>
                <div style={{ display: "flex", marginTop: 8 }}>
                  {initiative.plan.packages.slice(0, 6).map((p, i) => (
                    <span
                      key={p.personId}
                      title={`${p.name} — ${p.part}`}
                      style={{
                        width: 30, height: 30, borderRadius: "50%", background: "#e6e4ee", color: T.roi.navy,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, border: "2px solid #fff", marginLeft: i === 0 ? 0 : -8,
                      }}
                    >
                      {p.name.split(" ").map((w) => w[0]).join("")}
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "numbers" && (
        <div className="two-col fade-in">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card>
              <FactorEditor factors={initiative.factors} onChange={onFactorChange} />
            </Card>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ExecCard factors={initiative.factors} />
            <ScenarioStrip
              factors={initiative.factors}
              onApply={(option) => onFactorChange("realism", { selectedOption: option, status: "estimated" })}
            />
            <Waterfall factors={initiative.factors} />
            <GatherList factors={initiative.factors} onChange={onFactorChange} />
            <Card title="Snapshot history (audit trail)">
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 140, overflowY: "auto" }}>
                {[...initiative.snapshots].reverse().map((s, idx) => (
                  <div key={`${s.at}-${idx}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.inkSecondary }}>
                    <span>{timeAgoLabel(s.at)}</span>
                    <span className="num">
                      {fmtUsd(s.netRecurringAnnual)}/yr · {fmtUsd(s.netOneTime)} once · {s.grade}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: T.inkMuted, marginTop: 6 }}>
                A snapshot is written on every factor change — the provenance trail when these
                numbers go in front of finance.
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "plan" && (
        <div className="two-col fade-in">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <TasksCard
              tasks={initiative.tasks}
              owners={owners}
              onAdd={onAddTask}
              onStatus={onTaskStatus}
              {...(initiative.clientAccountId ? { onToggleClientVisible } : {})}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {initiative.plan && <PhaseTimeline plan={initiative.plan} />}
            {initiative.plan && <TeamParts plan={initiative.plan} onInvite={onInvite} onPartAdded={onPartAdded} />}
            {initiative.plan && <BriefCard brief={initiative.plan.brief} />}
          </div>
        </div>
      )}

      {tab === "discussion" && (
        <div className="two-col fade-in">
          <Thread messages={initiative.thread} onPost={onPost} onAskAnalyst={onAskAnalyst} roster={AGENTS} />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ExecCard factors={initiative.factors} />
            <WhatsNew activity={initiative.activity} thread={initiative.thread} />
          </div>
        </div>
      )}
    </div>
  );
}
