import { rollup, type Comparable, type ManualTask, type RoiModel } from "@agp/roi";
import { card, T } from "../theme.js";
import { SectionTitle, TagChip } from "./bits.js";
import { ExecCard } from "./RoiPanel.js";
import { Thread } from "./Thread.js";
import { fmtUsd } from "../workspace/format.js";
import { factorsFromBasis } from "../workspace/basis.js";
import { TYPE_LABEL, type InitiativeType, type SandboxIdea } from "../workspace/types.js";
import { useState } from "react";

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 8px",
  border: `1px solid ${T.grid}`,
  borderRadius: 6,
  color: T.ink,
  background: "#fff",
};

function NumberCell({ value, onChange, width = 80 }: { value: number; onChange: (n: number) => void; width?: number }) {
  return (
    <input
      type="number"
      value={value || ""}
      placeholder="0"
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      style={{ ...inputStyle, width }}
    />
  );
}

export function SandboxWorkspace({
  idea,
  onBack,
  onUpdate,
  onPost,
  onAskAnalyst,
  onPromote,
  onOpenInitiative,
}: {
  idea: SandboxIdea;
  onBack: () => void;
  onUpdate: (patch: Partial<Pick<SandboxIdea, "title" | "pitch" | "basis">>) => void;
  onPost: (body: string) => void;
  onAskAnalyst: () => void;
  onPromote: (type: InitiativeType) => void;
  onOpenInitiative: (id: string) => void;
}) {
  const [promoteType, setPromoteType] = useState<InitiativeType>("new_build");
  const basis = idea.basis;
  const r = rollup(basis);
  const setBasis = (patch: Partial<RoiModel>) => onUpdate({ basis: { ...basis, ...patch } });

  const setComparable = (idx: number, patch: Partial<Comparable>) =>
    setBasis({ comparables: basis.comparables.map((c, i) => (i === idx ? { ...c, ...patch } : c)) });
  const setTask = (idx: number, patch: Partial<ManualTask>) =>
    setBasis({ manual: basis.manual.map((t, i) => (i === idx ? { ...t, ...patch } : t)) });

  const promoted = idea.status === "promoted";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <button type="button" onClick={onBack} style={{ fontSize: 12, color: T.inkSecondary, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
          ← Sandbox
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <input
            value={idea.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            style={{ fontSize: 18, fontWeight: 700, color: T.ink, border: "none", background: "transparent", minWidth: 320, padding: 0 }}
          />
          <TagChip>Sandbox — not tied to any product</TagChip>
          {promoted && <TagChip>Promoted ✓</TagChip>}
        </div>
        <textarea
          value={idea.pitch}
          onChange={(e) => onUpdate({ pitch: e.target.value })}
          placeholder="The idea, in your own words."
          rows={2}
          style={{ marginTop: 8, width: "100%", fontSize: 12.5, color: T.inkSecondary, padding: "8px 10px", border: `1px solid ${T.grid}`, borderRadius: 8, resize: "vertical", fontFamily: "inherit", background: T.surface }}
        />
      </div>

      {promoted && idea.promotedInitiativeId && (
        <div style={{ ...card, display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2faf6", borderColor: T.roi.confirmed }}>
          <span style={{ fontSize: 12.5, color: T.ink, fontWeight: 600 }}>
            ✓ This idea graduated into a build. The sandbox copy stays read-only for history.
          </span>
          <button
            type="button"
            onClick={() => onOpenInitiative(idea.promotedInitiativeId!)}
            style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8, border: "none", background: T.roi.confirmed, color: "#fff", cursor: "pointer" }}
          >
            Open the build →
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 5fr) minmax(0, 4fr)", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={card}>
            <SectionTitle>Rough out the basis — what would this replace?</SectionTitle>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 0" }}>
              Tools / spend it would avoid
            </div>
            {basis.comparables.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={c.name} placeholder="Tool, e.g. Loopio" onChange={(e) => setComparable(i, { name: e.target.value })} style={{ ...inputStyle, flex: 2, minWidth: 120 }} />
                <span style={{ fontSize: 11, color: T.inkMuted }}>$</span>
                <NumberCell value={c.annual} onChange={(n) => setComparable(i, { annual: n })} />
                <span style={{ fontSize: 11, color: T.inkMuted }}>/yr</span>
                <input value={c.basis} placeholder="basis, e.g. $75/user/mo × 5" onChange={(e) => setComparable(i, { basis: e.target.value })} style={{ ...inputStyle, flex: 2, minWidth: 140 }} />
                <button type="button" aria-label="Remove" onClick={() => setBasis({ comparables: basis.comparables.filter((_, j) => j !== i) })} style={{ ...inputStyle, cursor: "pointer", color: T.inkMuted, width: 28 }}>
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBasis({ comparables: [...basis.comparables, { name: "", url: "", annual: 0, basis: "" }] })}
              style={{ fontSize: 11.5, color: T.series1, background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
            >
              + add a tool it replaces
            </button>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px" }}>
              Manual work it would remove
            </div>
            {basis.manual.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={t.task} placeholder="The manual task today" onChange={(e) => setTask(i, { task: e.target.value })} style={{ ...inputStyle, flex: 3, minWidth: 160 }} />
                <NumberCell value={t.hoursPerWeek} onChange={(n) => setTask(i, { hoursPerWeek: n })} width={54} />
                <span style={{ fontSize: 11, color: T.inkMuted }}>h/wk ×</span>
                <NumberCell value={t.people} onChange={(n) => setTask(i, { people: n })} width={44} />
                <span style={{ fontSize: 11, color: T.inkMuted }}>people × $</span>
                <NumberCell value={t.rate} onChange={(n) => setTask(i, { rate: n })} width={54} />
                <span style={{ fontSize: 11, color: T.inkMuted }}>/h</span>
                <button type="button" aria-label="Remove" onClick={() => setBasis({ manual: basis.manual.filter((_, j) => j !== i) })} style={{ ...inputStyle, cursor: "pointer", color: T.inkMuted, width: 28 }}>
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setBasis({ manual: [...basis.manual, { task: "", hoursPerWeek: 0, people: 1, rate: 90 }] })}
              style={{ fontSize: 11.5, color: T.series1, background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
            >
              + add a manual process
            </button>

            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "14px 0 6px" }}>
              Rough build guess
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <NumberCell value={basis.buildHours} onChange={(n) => setBasis({ buildHours: n })} width={70} />
              <span style={{ fontSize: 11, color: T.inkMuted }}>hours × $</span>
              <NumberCell value={basis.buildRate} onChange={(n) => setBasis({ buildRate: n })} width={60} />
              <span style={{ fontSize: 11, color: T.inkMuted }}>/h loaded = {fmtUsd(r.buildCost)}</span>
            </div>

            <div style={{ marginTop: 12, fontSize: 11, color: T.inkMuted }}>
              Everything derives at confidence C (estimated). Lines you leave empty stay honestly
              unknown — the napkin never flatters.
            </div>
          </div>

          <Thread messages={idea.thread} onPost={onPost} onAskAnalyst={onAskAnalyst} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ExecCard factors={factorsFromBasis(basis)} />

          <div style={card}>
            <SectionTitle>Napkin rollup</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5 }}>
              {[
                { label: "License / SaaS avoided", v: r.licenseAvoidance, suffix: "/yr" },
                { label: `Time saved — cashable (${basis.manual.length} task${basis.manual.length === 1 ? "" : "s"})`, v: r.timeSavedCashable, suffix: "/yr" },
                { label: "Human-in-the-loop residual (15%)", v: -r.humanInLoop, suffix: "/yr" },
                { label: "Build cost", v: -r.buildCost, suffix: "" },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: T.inkSecondary }}>{row.label}</span>
                  <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>
                    {fmtUsd(row.v)}
                    {row.suffix}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {!promoted && (
            <div style={{ ...card, borderColor: T.roi.navy }}>
              <SectionTitle>Start the build</SectionTitle>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <select value={promoteType} onChange={(e) => setPromoteType(e.target.value as InitiativeType)} style={{ ...inputStyle, width: "100%" }}>
                  <option value="new_build">{TYPE_LABEL.new_build}</option>
                  <option value="ai_iteration">{TYPE_LABEL.ai_iteration}</option>
                </select>
                <button
                  type="button"
                  onClick={() => onPromote(promoteType)}
                  style={{ fontSize: 12.5, fontWeight: 700, padding: "10px 14px", borderRadius: 8, border: "none", background: T.roi.navy, color: "#fff", cursor: "pointer" }}
                >
                  Promote to a build →
                </button>
                <div style={{ fontSize: 11, color: T.inkMuted }}>
                  Creates a full initiative seeded from this basis — the 12-factor template, the
                  conversation, and the gather list come along. The sandbox copy stays for history.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
