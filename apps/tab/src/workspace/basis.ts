import { applyModel, standardFactorTemplate, type RoiModel, type WorkspaceFactor } from "@agp/roi";

/**
 * Turn a sandbox ROI basis into engine factors — honestly. applyModel
 * pre-fills the four derived money factors as estimated/C, but a basis line
 * the manager never filled in must NOT masquerade as an estimated $0: it goes
 * back to unknown so the grade cap and the "numbers to gather" list stay true.
 */
export function factorsFromBasis(basis: RoiModel): WorkspaceFactor[] {
  let factors = applyModel(standardFactorTemplate(), basis);

  const resetToUnknown = (key: string, evidence: string) => {
    factors = factors.map((f) =>
      f.key === key ? { ...f, value: null, status: "unknown" as const, confidence: null, evidence } : f,
    );
  };

  if (basis.buildHours <= 0) resetToUnknown("fully_loaded_build_cost", "Build not scoped yet");
  if (basis.manual.length === 0) {
    resetToUnknown("time_saved_cashable", "Manual process not described yet");
    resetToUnknown("human_in_loop_residual", "Depends on the time-saved line");
  }
  if (basis.comparables.length === 0) {
    factors = factors.map((f) =>
      f.key === "license_avoidance"
        ? { ...f, value: null, status: "unknown" as const, confidence: null, evidence: "No replaced tool cited yet" }
        : f,
    );
  }
  return factors;
}

export function emptyBasis(): RoiModel {
  return { summary: "", comparables: [], manual: [], buildHours: 0, buildRate: 100 };
}
