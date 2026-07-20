import type { Comparable, ManualTask, RoiModel } from "@agp/roi";
import { computeProjectROI } from "@agp/roi";
import {
  AGP_PEOPLE,
  FUNCTION_NOTES,
  PROCESS_PATTERNS,
  SERVICE_LINES,
  TOOL_CATALOG,
  VERTICALS,
  loadMirror,
  personById,
  type AgpFunction,
} from "./agpKnowledge.js";
import { factorsFromBasis } from "./basis.js";
import { fmtUsd } from "./format.js";
import { makePlan } from "./planner.js";
import type { CastMember, IdeaClassification, ProjectPlan, RelatedItem, SandboxIdea } from "./types.js";

/**
 * The AGP Copilot: deterministic, knowledge-base-backed drafting. It reads an
 * idea in plain words and drafts everything — classification, ROI basis, the
 * cast, related AGP context — proactively, approval-by-exception: the manager
 * removes what's wrong instead of filling forms. Every suggestion carries its
 * "because". When the Anthropic key lands this same interface is backed by an
 * LLM; today it is honest pattern-matching over the AGP knowledge base and
 * the Kantata/HubSpot mirror.
 */

export interface IdeaDraft {
  classification: IdeaClassification;
  basis: RoiModel;
  team: CastMember[];
  plan: ProjectPlan;
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
  briefing: string;
}

const norm = (s: string) => s.toLowerCase();

/** Word-boundary keyword test — "npr" must not match inside "nonprofit". */
function hasKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`, "i").test(text);
}

function matchEntries<T extends { keywords: string[] }>(text: string, entries: T[]): T[] {
  return entries.filter((e) => e.keywords.some((k) => hasKeyword(text, k)));
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(key(i)) ? false : (seen.add(key(i)), true)));
}

function classify(text: string): IdeaClassification {
  const mirror = loadMirror();
  const t = norm(text);
  const serviceLine = matchEntries(text, SERVICE_LINES)[0];
  const vertical = matchEntries(text, VERTICALS)[0];
  // Word-boundary match on the client's first word — "St." must not fire on "last.".
  const clientNames = mirror.clients.filter((c) => hasKeyword(t, norm(c.name).split(" ")[0] ?? "~")).map((c) => c.name);
  return {
    ...(serviceLine ? { serviceLine: serviceLine.label } : {}),
    ...(vertical ? { vertical: vertical.label } : {}),
    clientNames,
  };
}

function draftCast(functions: AgpFunction[]): CastMember[] {
  const members: CastMember[] = [];
  for (const fn of functions) {
    const person = AGP_PEOPLE.find((p) => p.fn === fn && p.routing === "direct") ?? AGP_PEOPLE.find((p) => p.fn === fn);
    if (!person) continue;
    const viaManager = person.routing === "via_manager" ? personById(person.managerId ?? "")?.name : undefined;
    members.push({
      personId: person.id,
      name: person.name,
      title: person.title,
      role: fn === "project_management" ? "Delivery lead" : "Contributor",
      why: `Because ${FUNCTION_NOTES[fn]}.`,
      ...(viaManager ? { viaManager } : {}),
    });
  }
  // The PM team pilots every internal tool — always present, always first.
  if (!members.some((m) => personById(m.personId)?.fn === "project_management")) {
    const pm = AGP_PEOPLE.find((p) => p.fn === "project_management");
    if (pm) {
      members.unshift({
        personId: pm.id,
        name: pm.name,
        title: pm.title,
        role: "Delivery lead",
        why: `Because ${FUNCTION_NOTES.project_management}.`,
      });
    }
  }
  return dedupeBy(members, (m) => m.personId).slice(0, 5);
}

function relatedContext(text: string, classification: IdeaClassification): {
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
} {
  const mirror = loadMirror();
  const t = norm(text);
  const slKey = SERVICE_LINES.find((s) => s.label === classification.serviceLine)?.key;
  const vKey = VERTICALS.find((v) => v.label === classification.vertical)?.key;

  const relatedProjects = mirror.projects
    .filter((p) => p.serviceLine === slKey || p.vertical === vKey || t.includes(norm(p.title).split(" ")[0] ?? "~"))
    .map((p) => ({
      title: p.title,
      why:
        p.serviceLine === slKey
          ? `same service line (${classification.serviceLine}) — its actuals can calibrate this estimate`
          : `same vertical (${classification.vertical}) — comparable client context`,
    }))
    .slice(0, 3);

  const relatedCampaigns = mirror.campaigns
    .filter((c) => classification.clientNames.includes(c.clientName) || matchEntries(c.title, [{ keywords: t.split(/\s+/).filter((w) => w.length > 5) }]).length > 0)
    .map((c) => ({
      title: `${c.title} (${c.clientName})`,
      why: c.kind === "deal" ? `open HubSpot deal at stage ${c.stage}` : `recent client touchpoint (${c.stage})`,
    }))
    .slice(0, 3);

  return { relatedProjects, relatedCampaigns };
}

/** Departments a user can pick at intake — mapped to org functions. */
export const DEPARTMENTS: { fn: AgpFunction; label: string }[] = [
  { fn: "project_management", label: "Project Management" },
  { fn: "creative", label: "Brand & Creative" },
  { fn: "data_solutions", label: "Data Solutions & Deployment" },
  { fn: "analytics", label: "Analytics" },
  { fn: "digital_fundraising", label: "Digital Fundraising" },
  { fn: "web_development", label: "Web & AI Development" },
  { fn: "production", label: "Print & Mail Production" },
  { fn: "business_development", label: "Business Development" },
  { fn: "product_givingdna", label: "GivingDNA Product" },
];

/** Overrides a user picks at intake (tap-to-fill buttons) — they win over inference. */
export interface DraftOverrides {
  departmentFn?: AgpFunction;
  serviceLine?: string;
  vertical?: string;
  clientName?: string;
}

export interface IntakeChoices {
  departments: { fn: AgpFunction; label: string }[];
  serviceLines: string[];
  verticals: string[];
  clients: string[];
}

/**
 * The tap-to-fill option sets shown at intake: instead of typing everything
 * into the pitch, the user clicks the department, service line, vertical, and
 * client — and the Copilot crafts the draft around those picks.
 */
export function intakeChoices(): IntakeChoices {
  return {
    departments: DEPARTMENTS,
    serviceLines: SERVICE_LINES.map((s) => s.label),
    verticals: VERTICALS.map((v) => v.label),
    clients: loadMirror().clients.map((c) => c.name),
  };
}

/** Silent analysis for observer mode — the Copilot knows, but stays quiet. */
export function observeIdea(title: string, pitch: string): {
  classification: IdeaClassification;
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
} {
  const text = `${title}. ${pitch}`;
  const classification = classify(text);
  return { classification, ...relatedContext(text, classification) };
}

/** Analyze an idea's text and draft everything — basis, cast, plan, context. */
export function draftFromIdea(title: string, pitch: string, startDate?: string, overrides?: DraftOverrides): IdeaDraft {
  const text = `${title}. ${pitch}`;
  let classification = classify(text);
  // Intake picks win over inference — the user said so explicitly.
  if (overrides) {
    classification = {
      ...classification,
      ...(overrides.serviceLine ? { serviceLine: overrides.serviceLine } : {}),
      ...(overrides.vertical ? { vertical: overrides.vertical } : {}),
      ...(overrides.clientName ? { clientNames: [...new Set([overrides.clientName, ...classification.clientNames])] } : {}),
    };
  }
  const deptEntry = overrides?.departmentFn ? DEPARTMENTS.find((d) => d.fn === overrides.departmentFn) : undefined;
  if (deptEntry) classification = { ...classification, department: deptEntry.label };

  const processes = matchEntries(text, PROCESS_PATTERNS);
  const tools = dedupeBy(matchEntries(text, TOOL_CATALOG), (c) => c.name).slice(0, 3);

  const manual: ManualTask[] = processes.slice(0, 3).map((p) => ({
    task: p.task,
    hoursPerWeek: p.hoursPerWeek,
    people: p.people,
    rate: p.rate,
  }));
  const comparables: Comparable[] = tools.map((c) => ({ name: c.name, url: c.url, annual: c.annual, basis: c.basis }));
  const buildHours = processes.length > 0 ? Math.max(...processes.map((p) => p.buildHours)) : 0;

  const basis: RoiModel = { summary: pitch, comparables, manual, buildHours, buildRate: 100 };
  // The owning department leads the function list so its person is cast first.
  const functions = dedupeBy(
    [...(overrides?.departmentFn ? [overrides.departmentFn] : []), ...processes.flatMap((p) => p.functions)],
    (f) => f,
  );
  let team = draftCast(functions);
  // Fill in the department label when inference (not an override) found it.
  if (!classification.department) {
    const inferredDept = DEPARTMENTS.find((d) => d.fn === functions[0]);
    if (inferredDept) classification = { ...classification, department: inferredDept.label };
  }

  // Every build needs a builder: if nothing suggested engineering, add it.
  if (buildHours > 0 && !team.some((m) => personById(m.personId)?.fn === "web_development")) {
    const eng = AGP_PEOPLE.find((p) => p.fn === "web_development");
    if (eng) {
      team = [
        ...team,
        { personId: eng.id, name: eng.name, title: eng.title, role: "Builder", why: `Because ${FUNCTION_NOTES.web_development}.` },
      ].slice(0, 6);
    }
  }

  const { relatedProjects, relatedCampaigns } = relatedContext(text, classification);
  const plan = makePlan(team, basis, startDate ?? new Date().toISOString().slice(0, 10), title, classification);

  return {
    classification,
    basis,
    team,
    plan,
    relatedProjects,
    relatedCampaigns,
    briefing: composeBriefing({ classification, basis, team, plan, relatedProjects, relatedCampaigns }),
  };
}

function composeBriefing(args: {
  classification: IdeaClassification;
  basis: RoiModel;
  team: CastMember[];
  plan: ProjectPlan;
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
}): string {
  const { classification, basis, team, plan, relatedProjects, relatedCampaigns } = args;
  const lines: string[] = [];

  const clsBits = [
    classification.department && `department: ${classification.department}`,
    classification.serviceLine && `service line: ${classification.serviceLine}`,
    classification.vertical && `vertical: ${classification.vertical}`,
    classification.clientNames.length > 0 && `client match: ${classification.clientNames.join(", ")}`,
  ].filter(Boolean);
  lines.push(
    clsBits.length > 0
      ? `Here's what I understood — ${clsBits.join(" · ")}.`
      : "I couldn't classify this against AGP's service lines yet — tell me more about what it touches (mail? email? reporting? donor data?).",
  );

  if (basis.manual.length > 0 || basis.comparables.length > 0) {
    const roi = computeProjectROI(factorsFromBasis(basis));
    lines.push(
      `I drafted the basis from AGP patterns: ${basis.manual.length} manual process${basis.manual.length === 1 ? "" : "es"} it would remove, ${basis.comparables.length} tool${basis.comparables.length === 1 ? "" : "s"} it could replace, and a ${basis.buildHours}h build guess → napkin ${fmtUsd(roi.netRecurringAnnual)}/yr net. Everything is estimated at C — edit or tell me what's off.`,
    );
  }

  if (team.length > 0) {
    lines.push(
      `I planned the project and split the work: ${plan.packages
        .map((p) => `${p.name} — ${p.part.split("—")[0]?.trim().toLowerCase() ?? "their part"} (~${p.hours}h, ${p.phaseKey})`)
        .join("; ")}. Each part lists the one input only that person can bring. Invite them when you're ready — dispatch-managed people route via their manager automatically.`,
    );
    const span = plan.phases[0] && plan.phases[plan.phases.length - 1];
    if (span) {
      lines.push(
        `Timeline: ${plan.phases.map((p) => `${p.label} ${p.start.slice(5)}`).join(" → ")}, wrapping ${plan.phases[plan.phases.length - 1]!.end}.`,
      );
    }
  }

  if (relatedProjects.length > 0) {
    lines.push(`Related AGP work in Kantata: ${relatedProjects.map((r) => r.title).join(" · ")}.`);
  }
  if (relatedCampaigns.length > 0) {
    lines.push(`HubSpot context: ${relatedCampaigns.map((r) => r.title).join(" · ")}.`);
  }

  lines.push("Refine me in plain words — e.g. “assume 300 build hours”, “this is mainly for food banks”, “drop the Loopio line”, “add someone from analytics”.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Conversational refinement
// ---------------------------------------------------------------------------

export interface RefineResult {
  idea: SandboxIdea;
  reply: string;
}

/** Apply a plain-words refinement to the idea. Deterministic, explains itself. */
export function refineIdea(idea: SandboxIdea, message: string): RefineResult {
  const t = norm(message);
  const changes: string[] = [];
  let next: SandboxIdea = { ...idea, basis: { ...idea.basis } };

  // "assume 300 build hours" / "300 hours"
  const hours = t.match(/(\d{2,4})\s*(build\s*)?hours?/);
  if (hours?.[1]) {
    next.basis = { ...next.basis, buildHours: Number(hours[1]) };
    changes.push(`build guess set to ${hours[1]}h`);
  }
  // "$120/hr" / "rate 120"
  const rate = t.match(/\$?\s?(\d{2,3})\s*(\/|per\s*)h(ou)?r/);
  if (rate?.[1]) {
    next.basis = { ...next.basis, buildRate: Number(rate[1]) };
    changes.push(`build rate set to $${rate[1]}/h`);
  }

  // "drop/remove the X line" — tools, tasks, people by fuzzy name match
  const removal = t.match(/(?:drop|remove|cut|lose)\s+(?:the\s+)?(.{3,40}?)(?:\s+line|\s+row|$|[.,])/);
  if (removal?.[1]) {
    const target = removal[1].trim();
    const beforeTools = next.basis.comparables.length;
    next.basis = { ...next.basis, comparables: next.basis.comparables.filter((c) => !norm(c.name).includes(target)) };
    if (next.basis.comparables.length < beforeTools) changes.push(`removed tool “${target}”`);

    const beforeTasks = next.basis.manual.length;
    next.basis = { ...next.basis, manual: next.basis.manual.filter((m) => !norm(m.task).includes(target)) };
    if (next.basis.manual.length < beforeTasks) changes.push(`removed manual-process line matching “${target}”`);

    const beforeTeam = next.team.length;
    next = { ...next, team: next.team.filter((m) => !norm(m.name).includes(target)) };
    if (next.team.length < beforeTeam) changes.push(`removed ${removal[1].trim()} from the cast`);
  }

  // "add someone from analytics" / function keywords
  const addFn = t.match(/add\s+(?:someone\s+from\s+|a\s+|the\s+)?([a-z\s&]+?)(?:\s+person|\s+team|$|[.,])/);
  if (addFn?.[1]) {
    const fnText = addFn[1].trim();
    const fnMap: Record<string, AgpFunction> = {
      analytics: "analytics", creative: "creative", pm: "project_management", "project management": "project_management",
      production: "production", print: "production", digital: "digital_fundraising", email: "digital_fundraising",
      data: "data_solutions", deployment: "data_solutions", web: "web_development", engineering: "web_development",
      givingdna: "product_givingdna", product: "product_givingdna", "business development": "business_development", bd: "business_development",
    };
    const fn = Object.entries(fnMap).find(([k]) => fnText.includes(k))?.[1];
    const person = fn ? AGP_PEOPLE.find((p) => p.fn === fn && !next.team.some((m) => m.personId === p.id)) : undefined;
    if (person) {
      const viaManager = person.routing === "via_manager" ? personById(person.managerId ?? "")?.name : undefined;
      next = {
        ...next,
        team: [
          ...next.team,
          {
            personId: person.id, name: person.name, title: person.title, role: "Contributor",
            why: `Because ${FUNCTION_NOTES[person.fn]}.`,
            ...(viaManager ? { viaManager } : {}),
          },
        ],
      };
      changes.push(`added ${person.name} (${person.title})${viaManager ? `, routed via ${viaManager}` : ""}`);
    }
  }

  // New domain keywords in the message → merge fresh patterns into the draft
  const newProcesses = matchEntries(message, PROCESS_PATTERNS).filter(
    (p) => !next.basis.manual.some((m) => m.task === p.task),
  );
  if (newProcesses.length > 0) {
    next.basis = {
      ...next.basis,
      manual: [...next.basis.manual, ...newProcesses.slice(0, 2).map((p) => ({ task: p.task, hoursPerWeek: p.hoursPerWeek, people: p.people, rate: p.rate }))],
    };
    changes.push(`added ${newProcesses.length} manual-process pattern${newProcesses.length === 1 ? "" : "s"} (${newProcesses.map((p) => p.why).join("; ")})`);
  }
  const newTools = matchEntries(message, TOOL_CATALOG).filter((c) => !next.basis.comparables.some((e) => e.name === c.name));
  if (newTools.length > 0) {
    next.basis = { ...next.basis, comparables: [...next.basis.comparables, ...newTools.slice(0, 2).map((c) => ({ name: c.name, url: c.url, annual: c.annual, basis: c.basis }))] };
    changes.push(`added replaced-tool candidate${newTools.length === 1 ? "" : "s"}: ${newTools.map((c) => c.name).join(", ")}`);
  }

  // Re-classify if vertical/service-line words showed up
  const cls = classify(`${idea.title}. ${idea.pitch}. ${message}`);
  if (cls.serviceLine !== idea.classification.serviceLine || cls.vertical !== idea.classification.vertical || cls.clientNames.length !== idea.classification.clientNames.length) {
    next = { ...next, classification: cls };
    const ctx = relatedContext(`${idea.title}. ${idea.pitch}. ${message}`, cls);
    next = { ...next, relatedProjects: ctx.relatedProjects, relatedCampaigns: ctx.relatedCampaigns };
    changes.push(
      `reclassified: ${[cls.serviceLine, cls.vertical, ...cls.clientNames].filter(Boolean).join(" · ") || "no match yet"}`,
    );
  }

  // Any change re-plans the project, preserving invite/part statuses.
  if (changes.length > 0) {
    next = { ...next, plan: replanPreservingStatus(next) };
  }

  const roi = computeProjectROI(factorsFromBasis(next.basis));
  const reply =
    changes.length > 0
      ? `Done — ${changes.join("; ")}. Napkin now reads ${fmtUsd(roi.netRecurringAnnual)}/yr net at realism ×${roi.adjustmentMultiplier.toFixed(2)}; the plan and parts re-drafted to match.`
      : `I didn't find a change to make from that. I can adjust build hours (“assume 300 hours”), add/remove tools, processes, or people (“drop the Loopio line”, “add someone from analytics”), or reclassify if you mention a service line, vertical, or client. Current napkin: ${fmtUsd(roi.netRecurringAnnual)}/yr net.`;

  return { idea: next, reply };
}

/** Re-draft the plan after a change without losing invite / part-added state. */
export function replanPreservingStatus(idea: SandboxIdea): ProjectPlan {
  const start = idea.plan?.phases[0]?.start ?? new Date().toISOString().slice(0, 10);
  const plan = makePlan(idea.team, idea.basis, start, idea.title, idea.classification);
  return {
    ...plan,
    packages: plan.packages.map((p) => {
      const prev = idea.plan?.packages.find((x) => x.personId === p.personId);
      return prev ? { ...p, status: prev.status } : p;
    }),
  };
}

/**
 * The Copilot's watchlist: deterministic checks it runs continuously — shown
 * as flags when it's in the room, counted quietly while it only observes.
 */
export function copilotFlags(idea: SandboxIdea): string[] {
  const flags: string[] = [];
  const roi = computeProjectROI(factorsFromBasis(idea.basis));

  if (idea.basis.manual.length === 0 && idea.basis.comparables.length === 0) {
    flags.push("No value basis yet — nothing manual removed, no tool replaced. The honest number is $0 until someone brings one.");
  }
  if (idea.basis.buildHours <= 0) {
    flags.push("No build estimate — payback and ROI multiple are meaningless without it.");
  }
  if (roi.hasUnknowns) {
    flags.push(`${roi.unknownRequiredKeys.length} required number${roi.unknownRequiredKeys.length > 1 ? "s" : ""} still missing — grade capped at C.`);
  }
  if (!idea.team.some((m) => personById(m.personId)?.fn === "project_management")) {
    flags.push("No PM on the team — the PM team runs daily delivery at AGP; every build needs one.");
  }
  if (idea.basis.buildHours > 0 && !idea.team.some((m) => personById(m.personId)?.fn === "web_development")) {
    flags.push("A build is scoped but no engineer is on the team.");
  }
  for (const m of idea.team) {
    const p = personById(m.personId);
    if (p?.routing === "via_manager" && !m.viaManager) {
      flags.push(`${m.name} is on a dispatch-managed team — route the invite via ${personById(p.managerId ?? "")?.name ?? "their manager"}, not directly.`);
    }
  }
  const timeSaved = idea.basis.manual.reduce((s, t) => s + t.hoursPerWeek * t.people * t.rate * 46, 0);
  if (timeSaved > 0 && roi.netRecurringAnnual > 0 && timeSaved * 0.15 > roi.netRecurringAnnual * 0.4) {
    flags.push("The human-in-the-loop residual is a large share of the net — the classic way internal AI tools quietly lose money.");
  }
  return flags;
}

/**
 * Invite the observing Copilot into the room: it merges gap-fill suggestions
 * (never overwriting human work) and composes an already-informed briefing.
 */
export function inviteCopilot(idea: SandboxIdea): { idea: SandboxIdea; briefing: string } {
  const conversation = idea.thread.map((m) => m.body).join(" ");
  const draft = draftFromIdea(idea.title, `${idea.pitch} ${conversation}`);

  // Gap-fill only: add what's missing, keep everything humans already put in.
  const basis: RoiModel = {
    ...idea.basis,
    comparables: [
      ...idea.basis.comparables,
      ...draft.basis.comparables.filter((c) => !idea.basis.comparables.some((e) => e.name === c.name)),
    ],
    manual: [
      ...idea.basis.manual,
      ...draft.basis.manual.filter((t) => !idea.basis.manual.some((e) => e.task === t.task)),
    ],
    buildHours: idea.basis.buildHours > 0 ? idea.basis.buildHours : draft.basis.buildHours,
  };
  const team = [
    ...idea.team,
    ...draft.team.filter((m) => !idea.team.some((e) => e.personId === m.personId)),
  ].slice(0, 6);

  let next: SandboxIdea = {
    ...idea,
    aiMode: "copilot",
    basis,
    team,
    classification: idea.classification.serviceLine ? idea.classification : draft.classification,
    relatedProjects: idea.relatedProjects.length > 0 ? idea.relatedProjects : draft.relatedProjects,
    relatedCampaigns: idea.relatedCampaigns.length > 0 ? idea.relatedCampaigns : draft.relatedCampaigns,
  };
  next = { ...next, plan: replanPreservingStatus(next) };

  const flags = copilotFlags(next);
  const roi = computeProjectROI(factorsFromBasis(next.basis));
  const addedTools = basis.comparables.length - idea.basis.comparables.length;
  const addedTasks = basis.manual.length - idea.basis.manual.length;
  const addedPeople = team.length - idea.team.length;

  const briefing = [
    `Thanks for the invite — I've been following along, so here's where I think you are: ${fmtUsd(roi.netRecurringAnnual)}/yr napkin at realism ×${roi.adjustmentMultiplier.toFixed(2)}, grade ${roi.grade}.`,
    addedTools + addedTasks + addedPeople > 0
      ? `I filled gaps without touching your work: ${[
          addedTools > 0 && `${addedTools} replaced-tool candidate${addedTools > 1 ? "s" : ""}`,
          addedTasks > 0 && `${addedTasks} manual-process line${addedTasks > 1 ? "s" : ""}`,
          addedPeople > 0 && `${addedPeople} team suggestion${addedPeople > 1 ? "s" : ""}`,
        ]
          .filter(Boolean)
          .join(", ")} — all removable.`
      : `Your draft already covers what I would have suggested — nothing added.`,
    flags.length > 0 ? `Flags I'm watching:\n${flags.map((f) => `⚑ ${f}`).join("\n")}` : "No flags right now.",
    `From here I'll reply to messages and keep the plan in sync. Tell me things in plain words and I'll apply them.`,
  ].join("\n");

  return { idea: next, briefing };
}
