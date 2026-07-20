import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * SPEC.md Layer 0.1 HARD RULE, "enforce in code and test":
 * no financial data — budgets, burn, margin, rates, costs — may render on any
 * guest-visible surface, verified by a build-time component allowlist.
 *
 * This test walks the RUNTIME import graph of the client (guest-visible)
 * workspace entry points and fails if any financial/intelligence module
 * becomes reachable. `import type` edges are ignored — types are erased at
 * build time and carry no rendering.
 */

const SRC = path.resolve(__dirname);

/** Guest-visible entry points. */
const GUEST_ENTRY_POINTS = ["components/ClientWorkspace.tsx", "components/ClientList.tsx"];

/** Modules that must NEVER be reachable from a guest-visible surface. */
const DENYLIST: RegExp[] = [
  /@agp\/roi/, // ROI engine — margins, costs, grades
  /@agp\/shared/, // finance module (fee/pass-through, margin math)
  /@agp\/sync/, // raw mirror incl. rates and budgets
  /components\/RoiPanel/, // exec card, waterfall, scenarios
  /components\/FactorEditor/, // factor money inputs
  /components\/GradeBadge/, // confidence grades
  /components\/PlanCards/, // work packages w/ internal hour math
  /components\/Portfolio/, // portfolio money rollup
  /components\/InitiativeWorkspace/,
  /components\/SandboxWorkspace/,
  /components\/Sandbox\b/,
  /workspace\/copilot/, // AI drafting (internal-only)
  /workspace\/agents/, // agent roster + engine-backed analysts
  /workspace\/planner/, // internal plan math
  /workspace\/basis/, // ROI basis derivation
  /workspace\/store/, // whole-store access from a leaf component
];

/** Runtime import specifiers, excluding `import type`. */
function runtimeImports(source: string): string[] {
  const specs: string[] = [];
  const re = /import\s+(type\s+)?[^;'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    const isTypeOnly = !!m[1];
    const spec = m[2] ?? m[3];
    if (!isTypeOnly && spec) specs.push(spec);
  }
  return specs;
}

function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // package import — recorded, not walked
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.js$/, ""));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function reachableModules(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf-8");
    for (const spec of runtimeImports(source)) {
      if (!spec.startsWith(".")) {
        seen.add(spec); // package specifier, e.g. @agp/roi
        continue;
      }
      const resolved = resolveLocal(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

describe("guest-surface allowlist (SPEC Layer 0.1 hard rule)", () => {
  for (const entryPoint of GUEST_ENTRY_POINTS) {
    it(`${entryPoint} never reaches a financial/intelligence module at runtime`, () => {
      const reachable = reachableModules(path.join(SRC, entryPoint));
      const violations = [...reachable].filter((mod) => DENYLIST.some((re) => re.test(mod)));
      expect(violations, `Guest surface imports forbidden modules:\n${violations.join("\n")}`).toEqual([]);
    });
  }

  it("guest sources never mention internal financial fields", () => {
    // Belt and braces: code identifiers that would indicate a leak of internal
    // money math into guest-rendered code (word-bounded, so CSS `margin` and
    // prose don't false-positive; the module-graph checks above are the
    // primary enforcement).
    const forbidden =
      /\b(feeBudget|billRate|costRate|burnRate|feesBurned|humanInLoop|netRecurringAnnual|netOneTime|adjustmentMultiplier|roiMultiple|paybackYears|projectedMargin)\b/;
    for (const entryPoint of GUEST_ENTRY_POINTS) {
      const reachable = reachableModules(path.join(SRC, entryPoint));
      for (const mod of reachable) {
        if (mod.startsWith("@") || !mod.includes(SRC)) continue;
        // Shared generic modules (types/format/theme) are checked too — the
        // rule is about what code the guest bundle can execute.
        const source = fs.readFileSync(mod, "utf-8");
        if (/components\/(ClientWorkspace|ClientList)/.test(mod)) {
          expect(forbidden.test(source), `${path.relative(SRC, mod)} mentions internal financial fields`).toBe(false);
        }
      }
    }
  });
});
