/**
 * Unified provenance type (SPEC cross-cutting). Every AI-generated number,
 * claim, or suggestion carries one or more SourceRefs resolvable to a real
 * source record. No generation path may emit unreferenced quantitative claims.
 */
export interface SourceRef {
  /** Originating system of record. */
  system: "kantata" | "hubspot" | "givingdna" | "registry" | "artifact";
  /** Entity type within that system, e.g. "time_entry", "deal". */
  entity: string;
  /** The entity's id in the source system. */
  id: string;
  /** When the referenced state was observed (ISO 8601). */
  snapshotAt: string;
  /** Optional human label for the chip, e.g. "Riverside 2024 actuals". */
  label?: string;
}

/** A quantitative claim that must travel with its evidence. */
export interface GroundedClaim<T = number> {
  value: T;
  sources: [SourceRef, ...SourceRef[]];
}

export function groundedClaim<T>(value: T, sources: SourceRef[]): GroundedClaim<T> {
  if (sources.length === 0) {
    throw new Error("GroundedClaim requires at least one SourceRef — no vibes.");
  }
  return { value, sources: sources as [SourceRef, ...SourceRef[]] };
}

export function formatSourceRef(ref: SourceRef): string {
  return ref.label ?? `${ref.system}:${ref.entity}/${ref.id}@${ref.snapshotAt}`;
}
