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
import type { CastMember, IdeaClassification, RelatedItem, SandboxIdea } from "./types.js";

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
  const clientNames = mirror.clients.filter((c) => t.includes(norm(c.name).split(" ")[0] ?? "")).map((c) => c.name);
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

/** Analyze an idea's text and draft everything. */
export function draftFromIdea(title: string, pitch: string): IdeaDraft {
  const text = `${title}. ${pitch}`;
  const classification = classify(text);

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
  const functions = dedupeBy(processes.flatMap((p) => p.functions), (f) => f);
  const team = draftCast(functions);
  const { relatedProjects, relatedCampaigns } = relatedContext(text, classification);

  return {
    classification,
    basis,
    team,
    relatedProjects,
    relatedCampaigns,
    briefing: composeBriefing({ classification, basis, team, relatedProjects, relatedCampaigns, processes: processes.map((p) => p.why) }),
  };
}

function composeBriefing(args: {
  classification: IdeaClassification;
  basis: RoiModel;
  team: CastMember[];
  relatedProjects: RelatedItem[];
  relatedCampaigns: RelatedItem[];
  processes: string[];
}): string {
  const { classification, basis, team, relatedProjects, relatedCampaigns } = args;
  const lines: string[] = [];

  const clsBits = [
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
      `Suggested cast: ${team
        .map((m) => `${m.name} (${m.title})${m.viaManager ? ` — via ${m.viaManager}` : ""}`)
        .join(", ")}. Remove anyone who doesn't fit; each carries a why.`,
    );
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

  const roi = computeProjectROI(factorsFromBasis(next.basis));
  const reply =
    changes.length > 0
      ? `Done — ${changes.join("; ")}. Napkin now reads ${fmtUsd(roi.netRecurringAnnual)}/yr net at realism ×${roi.adjustmentMultiplier.toFixed(2)}.`
      : `I didn't find a change to make from that. I can adjust build hours (“assume 300 hours”), add/remove tools, processes, or people (“drop the Loopio line”, “add someone from analytics”), or reclassify if you mention a service line, vertical, or client. Current napkin: ${fmtUsd(roi.netRecurringAnnual)}/yr net.`;

  return { idea: next, reply };
}
