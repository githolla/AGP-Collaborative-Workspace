/**
 * Visual tokens for the workspace UI, instantiated from the validated
 * reference dataviz palette (light mode; Teams theme tokens arrive in M3).
 */
export const T = {
  page: "#f6f6f3",
  surface: "#fcfcfb",
  ink: "#0b0b0b",
  inkSecondary: "#52514e",
  inkMuted: "#898781",
  grid: "#e1e0d9",
  baseline: "#c3c2b7",
  border: "rgba(11,11,11,0.10)",
  series1: "#2a78d6", // blue — fee burn, primary series
  series2: "#008300", // green
  successText: "#006300",
  status: {
    good: "#0ca30c",
    warning: "#fab219",
    serious: "#ec835a",
    critical: "#d03b3b",
  },
  // sequential blue ramp (heat shading; lightest = near zero)
  seq: ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#256abf", "#1c5cab"],
  // ROI calculator brand colors (roi-calculator-spec §9)
  roi: {
    navy: "#0b3c6e",
    cyan: "#4fb8e0",
    confirmed: "#1f9d6b",
    amber: "#d8932f",
  },
} as const;

export type Grade = "A" | "B" | "C" | "D";

export const gradeColor: Record<Grade, string> = {
  A: "#1f9d6b",
  B: "#4fb8e0",
  C: "#d8932f",
  D: "#d03b3b",
};

export const card: React.CSSProperties = {
  background: T.surface,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: 16,
};

export type Severity = "good" | "warning" | "serious" | "critical" | "info";

export const severityMeta: Record<Severity, { color: string; icon: string; label: string }> = {
  good: { color: T.status.good, icon: "✓", label: "Good" },
  warning: { color: T.status.warning, icon: "▲", label: "Watch" },
  serious: { color: T.status.serious, icon: "◆", label: "Serious" },
  critical: { color: T.status.critical, icon: "●", label: "Critical" },
  info: { color: T.series1, icon: "→", label: "Info" },
};
