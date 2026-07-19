import { T } from "../theme.js";
import { SectionTitle } from "./bits.js";
import { fmtUsd } from "../workspace/format.js";
import type { Grade, WorkspaceFactor } from "@agp/roi";

/**
 * Factor editor implementing the UI behavior rules (roi-calculator-spec §9):
 * empty $ fields show an amber NEED pill + the "assuming $X" default hint;
 * enum dropdowns mark the default; placeholders are disabled "Once live";
 * confirmed factors are visually locked (green) with only evidence editable.
 * Every change recomputes immediately via the shared engine.
 */

const GROUPS: { title: string; match: (f: WorkspaceFactor) => boolean }[] = [
  { title: "Value created", match: (f) => f.kind === "one_time_saving" || f.kind === "recurring_saving" },
  { title: "Costs (counted in full — never haircut)", match: (f) => f.kind === "one_time_cost" || f.kind === "recurring_cost" },
  { title: "Reality dial", match: (f) => f.kind === "adjustment" },
  { title: "Context — moves no money", match: (f) => f.kind === "classification" || f.kind === "placeholder" },
];

const STATUS_STYLE: Record<WorkspaceFactor["status"], { bg: string; fg: string; label: string }> = {
  confirmed: { bg: "#e3f4ec", fg: T.roi.confirmed, label: "Confirmed" },
  estimated: { bg: "#e8f4fa", fg: "#1a7fa8", label: "Estimated" },
  unknown: { bg: "#faf0dd", fg: T.roi.amber, label: "Unknown" },
};

function StatusChip({ factor }: { factor: WorkspaceFactor }) {
  const s = STATUS_STYLE[factor.status];
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        color: s.fg,
        background: s.bg,
        borderRadius: 4,
        padding: "2px 7px",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
      {factor.confidence ? ` · ${factor.confidence}` : ""}
    </span>
  );
}

function NeedPill() {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.6,
        color: "#fff",
        background: T.roi.amber,
        borderRadius: 999,
        padding: "2px 9px",
      }}
    >
      NEED
    </span>
  );
}

export interface FactorEditorProps {
  factors: WorkspaceFactor[];
  onChange: (key: string, patch: Partial<WorkspaceFactor>) => void;
}

const inputStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: "5px 8px",
  border: `1px solid ${T.grid}`,
  borderRadius: 6,
  width: 120,
  background: "#fff",
  color: T.ink,
};

function FactorRow({ factor, onChange }: { factor: WorkspaceFactor; onChange: FactorEditorProps["onChange"] }) {
  const locked = factor.status === "confirmed";
  const isMoney = factor.unit === "usd" || factor.unit === "usd_per_year";
  const isPlaceholder = factor.kind === "placeholder";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: "10px 10px",
        borderRadius: 8,
        background: locked ? "#f2faf6" : "transparent",
        borderTop: `1px solid ${T.grid}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span title={factor.description} style={{ flex: 1, minWidth: 180, fontSize: 12.5, color: T.ink }}>
          {factor.label}
          {factor.required && (
            <span title="Required — grade is capped at C until this lands" style={{ color: T.roi.amber, fontWeight: 700 }}>
              {" "}
              *
            </span>
          )}
        </span>

        {isMoney && (
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: T.inkMuted }}>$</span>
            <input
              type="number"
              disabled={locked}
              value={factor.value ?? ""}
              placeholder={`${factor.defaultValue ?? 0}`}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw === "" ? null : Number(raw);
                onChange(factor.key, {
                  value: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                  status: parsed === null ? "unknown" : "estimated",
                });
              }}
              style={{ ...inputStyle, opacity: locked ? 0.7 : 1 }}
            />
            {factor.unit === "usd_per_year" && <span style={{ fontSize: 11, color: T.inkMuted }}>/yr</span>}
          </span>
        )}

        {factor.unit === "enum" && (
          <select
            disabled={isPlaceholder}
            value={factor.selectedOption ?? factor.options?.find((o) => o.isDefault)?.label ?? ""}
            onChange={(e) => onChange(factor.key, { selectedOption: e.target.value, status: "estimated" })}
            style={{ ...inputStyle, width: 180 }}
          >
            {(factor.options ?? []).map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
                {o.isDefault ? " (default)" : ""}
                {factor.affects === "multiply" ? ` — ×${o.value}` : ""}
              </option>
            ))}
          </select>
        )}

        {factor.unit === "percent" && (
          <input
            type="number"
            disabled={isPlaceholder}
            value={factor.value ?? ""}
            placeholder="—"
            onChange={(e) => {
              const parsed = e.target.value === "" ? null : Number(e.target.value);
              onChange(factor.key, { value: Number.isFinite(parsed as number) ? parsed : null });
            }}
            style={{ ...inputStyle, width: 70 }}
          />
        )}

        {isPlaceholder && (
          <span style={{ fontSize: 10, color: T.inkMuted, border: `1px solid ${T.grid}`, borderRadius: 4, padding: "2px 6px" }}>
            Once live
          </span>
        )}

        {isMoney && factor.status === "unknown" && <NeedPill />}
        <StatusChip factor={factor} />

        {!isPlaceholder && factor.affects !== "none" && (
          <select
            title="Evidence confidence for this factor"
            value={factor.confidence ?? ""}
            onChange={(e) => onChange(factor.key, { confidence: (e.target.value || null) as Grade | null })}
            style={{ ...inputStyle, width: 56 }}
          >
            <option value="">–</option>
            {["A", "B", "C", "D"].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}

        {!isPlaceholder && factor.affects !== "none" && factor.status !== "unknown" && (
          <button
            type="button"
            onClick={() => onChange(factor.key, { status: locked ? "estimated" : "confirmed" })}
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              padding: "4px 9px",
              borderRadius: 6,
              cursor: "pointer",
              border: `1px solid ${locked ? T.grid : T.roi.confirmed}`,
              background: locked ? "transparent" : T.roi.confirmed,
              color: locked ? T.inkSecondary : "#fff",
            }}
          >
            {locked ? "Unlock" : "Confirm"}
          </button>
        )}
      </div>

      {isMoney && factor.status === "unknown" && (
        <div style={{ fontSize: 11, color: T.inkMuted }}>
          assuming {fmtUsd(factor.defaultValue ?? 0)} until entered
        </div>
      )}

      <input
        value={factor.evidence ?? ""}
        placeholder="Evidence — what proof backs (or will back) this number"
        onChange={(e) => onChange(factor.key, { evidence: e.target.value || null })}
        style={{ ...inputStyle, width: "100%", fontSize: 11, color: T.inkSecondary }}
      />
    </div>
  );
}

export function FactorEditor({ factors, onChange }: FactorEditorProps) {
  const sorted = [...factors].sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99));
  return (
    <div>
      <SectionTitle>ROI factors — the 12-factor template</SectionTitle>
      {GROUPS.map((group) => {
        const members = sorted.filter(group.match);
        if (members.length === 0) return null;
        return (
          <div key={group.title} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "10px 0 4px" }}>
              {group.title}
            </div>
            {members.map((f) => (
              <FactorRow key={f.key} factor={f} onChange={onChange} />
            ))}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: T.inkMuted }}>
        * required — the grade can never claim A/B while a required number is missing. Defaults are
        conservative: an empty project is worth $0 until evidence lands.
      </div>
    </div>
  );
}
