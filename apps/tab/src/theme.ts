/**
 * Visual tokens for the workspace UI, instantiated from the validated
 * reference dataviz palette (light mode; Teams theme tokens arrive in M3).
 */
export const T = {
  // Client Health design system: deep indigo navy, teal accent, lime.
  page: "#eef1f5",
  surface: "#ffffff",
  ink: "#10152e",
  inkSecondary: "#545b70",
  inkMuted: "#8a90a3",
  grid: "#e2e5ec",
  baseline: "#c6cbd6",
  border: "rgba(16,21,46,0.10)",
  series1: "#2bb8c9", // teal — primary series/accent
  series2: "#2ea44f", // green
  successText: "#1c7a3f",
  lime: "#c2e24c",
  status: {
    good: "#2ea44f",
    warning: "#e0a92e",
    serious: "#ec835a",
    critical: "#e5484d",
  },
  // sequential teal ramp (heat shading; lightest = near zero)
  seq: ["#d6f0f3", "#bde6ec", "#a1dbe3", "#84cfda", "#63c2d0", "#43b5c6", "#2bb8c9", "#249fb0", "#1e8695", "#186d7a"],
  // Brand accent set.
  roi: {
    navy: "#22346f",
    cyan: "#2bb8c9",
    confirmed: "#2ea44f",
    amber: "#e0a92e",
  },
} as const;

export type Grade = "A" | "B" | "C" | "D";

export const gradeColor: Record<Grade, string> = {
  A: "#2ea44f",
  B: "#2bb8c9",
  C: "#e0a92e",
  D: "#e5484d",
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
