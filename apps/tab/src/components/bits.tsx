import { useState, type CSSProperties, type ReactNode } from "react";
import { T, severityMeta, type Severity } from "../theme.js";

/** Provenance chip (SPEC cross-cutting): every number resolves to its source. */
export function ProvenanceChip({ source }: { source: string }) {
  return (
    <span
      title={`Source: ${source}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        color: T.inkMuted,
        border: `1px solid ${T.grid}`,
        borderRadius: 999,
        padding: "1px 8px",
        cursor: "help",
        whiteSpace: "nowrap",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      ⌕ {source}
    </span>
  );
}

export function StatusBadge({ severity, label }: { severity: Severity; label: string }) {
  const meta = severityMeta[severity];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11.5,
        fontWeight: 600,
        color: T.ink,
      }}
    >
      <span aria-hidden style={{ color: meta.color, fontSize: 10 }}>
        {meta.icon}
      </span>
      {label}
    </span>
  );
}

export function TagChip({ children }: { children: ReactNode }) {
  return <span className="chip">{children}</span>;
}

/** Provenance mark: this element is synced live from Kantata. One look
 * separates system-of-record data from locally created content. */
export function KantataChip({ compact = false }: { compact?: boolean }) {
  return (
    <span
      title="Synced live from Kantata"
      style={{
        fontSize: compact ? 8.5 : 9.5,
        fontWeight: 800,
        color: "#116a43",
        background: "#e3f4ec",
        border: "1px solid #b9e0cc",
        borderRadius: 999,
        padding: compact ? "0.5px 6px" : "1.5px 8px",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      ⇄ Kantata
    </span>
  );
}

export interface StatTileProps {
  label: string;
  value: string;
  detail?: string;
  detailColor?: string;
  source?: string;
}

/** Stat tile: hero value in text ink (never series color), detail line, provenance. */
export function StatTile({ label, value, detail, detailColor, source }: StatTileProps) {
  return (
    <div
      style={{
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 3,
        minWidth: 150,
        flex: 1,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", color: T.inkMuted }}>
        {label}
      </div>
      {/* Long phrase values ("Never at current numbers") step down from hero size. */}
      <div style={{ fontSize: value.length > 12 ? 15 : 26, fontWeight: 700, color: T.ink, lineHeight: value.length > 12 ? 1.35 : 1.1, minHeight: 29, display: "flex", alignItems: "center" }}>
        {value}
      </div>
      {detail && <div style={{ fontSize: 11.5, color: detailColor ?? T.inkSecondary }}>{detail}</div>}
      {source && <ProvenanceChip source={source} />}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.3, color: T.ink, textTransform: "uppercase" }}>
        {children}
      </h2>
      {right}
    </div>
  );
}

export function useTooltip(): {
  tip: { x: number; y: number; body: ReactNode } | null;
  show: (e: { clientX: number; clientY: number }, body: ReactNode) => void;
  hide: () => void;
  node: ReactNode;
} {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const style: CSSProperties = tip
    ? {
        position: "fixed",
        left: tip.x + 12,
        top: tip.y + 12,
        background: T.ink,
        color: "#fff",
        fontSize: 11.5,
        padding: "6px 9px",
        borderRadius: 6,
        pointerEvents: "none",
        zIndex: 50,
        maxWidth: 260,
      }
    : {};
  return {
    tip,
    show: (e, body) => setTip({ x: e.clientX, y: e.clientY, body }),
    hide: () => setTip(null),
    node: tip ? <div style={style}>{tip.body}</div> : null,
  };
}
