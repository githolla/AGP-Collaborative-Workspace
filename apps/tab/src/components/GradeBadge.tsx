import { gradeColor, type Grade } from "../theme.js";

const GRADE_MEANING: Record<Grade, string> = {
  A: "Confirmed evidence",
  B: "Good evidence",
  C: "Directional — estimates or required numbers missing",
  D: "Weak evidence",
};

export function GradeBadge({ grade, size = 26 }: { grade: Grade; size?: number }) {
  return (
    <span
      title={`Confidence grade ${grade}: ${GRADE_MEANING[grade]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: "50%",
        background: gradeColor[grade],
        color: "#fff",
        fontSize: size * 0.5,
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {grade}
    </span>
  );
}
