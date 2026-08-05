/**
 * /api/mirror — the live KANTATA pull, server-side on Vercel.
 *
 * Kantata-only (ADR 0008 + 2026-07-20 decision): AGP's other systems run
 * on Kantata data alone, and so does this one. HubSpot is pre-acquisition
 * CRM and is no longer pulled; the client directory is DERIVED from
 * Kantata itself in the browser mapping (title prefixes like "ARMS:",
 * full-name title conventions, group companies). The payload keeps the
 * `companies`/`deals` fields (always empty) so older cached payload shapes
 * stay parseable.
 *
 * KANTATA_API_TOKEN is read from env and NEVER reaches the browser.
 * Self-contained on purpose (no workspace imports): Vercel bundles this
 * file independently of the pnpm monorepo.
 */

interface MirrorPayload {
  live: boolean;
  fetchedAt: string;
  sources: {
    hubspot: { ok: boolean; note: string; companies: number; deals: number };
    kantata: { ok: boolean; note: string; projects: number };
  };
  companies: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  kantataProjects: Record<string, unknown>[];
  kantataMilestones: Record<string, unknown>[];
  kantataGroups: Record<string, unknown>[];
  kantataCustomFields: Record<string, unknown>[];
  /** Full task tree (story_type=task) — feeds the review-gated task import.
   * Each task now carries `assignees` (owner names) + `percent`. */
  kantataTasks: Record<string, unknown>[];
  /** Recent project conversation — Kantata posts (workspace/story comments). */
  kantataPosts: Record<string, unknown>[];
  /**
   * Per-workspace hours AGGREGATED SERVER-SIDE from time entries. Only
   * minutes and dates cross the wire — bill/cost rates are stripped here,
   * never sent to the browser (no-financials rule).
   */
  kantataHours: Record<string, unknown>[];
  /** The AGP team — every member of the AGP Kantata account (id, name, title,
   * email). This is the live roster the collaboration UI adds teammates from. */
  kantataStaff: Record<string, unknown>[];
  /**
   * Resource allocations — Kantata's Resource Center grid: reserved hours per
   * person, per week (the numbers Kellie's team maintains by hand every
   * Thursday). This is where scheduled hours actually live (NOT the story's
   * estimated_minutes, which the tenant leaves empty). Read-only mirror of the
   * same `workspace_allocations` object the write-back pushes to.
   */
  kantataAllocations: Record<string, unknown>[];
  /**
   * A tiny raw sample of allocation rows (financial keys stripped) — the
   * diagnostic that answers the one open question: does an allocation link to
   * a specific task (story_id) or only to the workspace+person? That decides
   * whether hours can be re-spread per task on a timeline shift, or only
   * mirrored as the weekly grid.
   */
  kantataAllocationsSample: Record<string, unknown>[];
  /**
   * AGP's Kantata PROJECT TEMPLATES — the role-and-task blueprints Kellie's
   * team applies to spin up a timeline ("direct mail" → the standard phases,
   * roles, and tasks). This is the backbone of the resourcing model: roles map
   * to people, and the default hour split rides on the template's structure.
   */
  kantataTemplates: Record<string, unknown>[];
  /** Raw template sample + the endpoint it came from — the diagnostic that
   * pins down where Kantata exposes templates and in what shape. */
  kantataTemplatesSample: Record<string, unknown>[];
}

// Per-instance cache: previews are demo traffic; 5 minutes keeps upstream
// rate limits comfortable without staleness anyone would notice.
let cache: { at: number; payload: MirrorPayload } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** One request, hard 8s cap, one retry on a 429 rate limit. */
async function timedFetch(url: string, headers: Record<string, string>): Promise<Response> {
  const attempt = () => fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  let res = await attempt();
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1100));
    res = await attempt();
  }
  return res;
}

async function pullKantata(token: string): Promise<{
  projects: Record<string, unknown>[];
  milestones: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  groups: Record<string, unknown>[];
  customFields: Record<string, unknown>[];
  hours: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  staff: Record<string, unknown>[];
  allocations: Record<string, unknown>[];
  allocationsSample: Record<string, unknown>[];
  templates: Record<string, unknown>[];
  templatesSample: Record<string, unknown>[];
  note: string;
}> {
  const headers = { Authorization: `Bearer ${token}` };

  // Mavenlink pages are numbered, 200 rows max — walk until a short page or
  // the cap. First-page failure throws; later failures keep partial results.
  // `harvest` sees each raw page — used to collect side buckets (users) that
  // ride along with `include=` associations.
  const pullKantataPaged = async <T>(
    baseUrl: string,
    collection: string,
    cap: number,
    harvest?: (json: Record<string, unknown>) => void,
  ): Promise<T[]> => {
    const rows: T[] = [];
    for (let page = 1; rows.length < cap && page <= Math.ceil(cap / 200); page += 1) {
      const res = await timedFetch(`${baseUrl}&page=${page}`, headers);
      if (!res.ok) {
        if (page === 1) throw new Error(`${collection} HTTP ${res.status}`);
        break;
      }
      const json = (await res.json()) as Record<string, Record<string, T> | unknown>;
      harvest?.(json as Record<string, unknown>);
      const batch = Object.values((json[collection] as Record<string, T>) ?? {});
      rows.push(...batch);
      if (batch.length < 200) break;
    }
    return rows.slice(0, cap);
  };

  type KantataWorkspace = {
    id: string;
    title?: string;
    status?: { message?: string };
    start_date?: string;
    due_date?: string;
    updated_at?: string;
    archived?: boolean;
    participant_ids?: (string | number)[];
  };
  type KantataStory = {
    id: string;
    title?: string;
    workspace_id?: string | number;
    due_date?: string;
    state?: string;
    story_type?: string;
    /**
     * The PARENT story. At AGP a Kantata workspace is a fiscal-year contract,
     * the milestones inside it are the real projects, and tasks are nested
     * under a milestone via this field. Without it every task from a year-long
     * contract lands in one flat list with no way to tell which project it
     * belongs to — the thing Kellie's team flagged as blocking.
     */
    parent_id?: string | number;
    /** WHO owns the work — the missing half of a collaboration board. */
    assignee_ids?: (string | number)[];
    percentage_complete?: number;
    /** Start of the work window (with due_date, the span hours spread across). */
    start_date?: string;
    /**
     * The PM's scheduled-hours estimate for the task, in MINUTES — the number
     * they already enter in Kantata. Pulled so resourcing populates from
     * Kantata instead of being re-typed; the app keeps the weekly allocation
     * current as the timeline shifts, which is the part Kantata doesn't do.
     */
    estimated_minutes?: number;
  };
  type KantataPost = {
    id: string;
    workspace_id?: string | number;
    story_id?: string | number;
    subject_id?: string | number;
    message?: string;
    user_id?: string | number;
    created_at?: string;
  };
  type KantataGroup = {
    id: string;
    name?: string;
    company?: string;
    contact_name?: string;
    email?: string;
    workspace_ids?: (string | number)[];
  };
  type KantataCfv = { id: string; subject_id?: string | number; custom_field_name?: string; display_value?: string; value?: unknown };
  type KantataTimeEntry = { id: string; workspace_id?: string | number; user_id?: string | number; date_performed?: string; time_in_minutes?: number };

  type KantataMembership = { id: string; user_id?: string | number; role?: string };

  // Resource Center allocation — reserved hours for one person over a date
  // window. Field names read defensively: the tenant/API version may name the
  // person `user_id` or `assignee_id`, and the hours `allocated_hours`,
  // `total_hours`, `hours`, or `scheduled_hours`. A `story_id` (if present) is
  // the task the reservation is against — the link that lets hours re-spread
  // per task when a timeline shifts.
  type KantataAllocation = {
    id: string;
    workspace_id?: string | number;
    user_id?: string | number;
    assignee_id?: string | number;
    resource_user_id?: string | number;
    story_id?: string | number;
    sub_group_id?: string | number;
    start_date?: string;
    end_date?: string;
    date?: string;
    allocated_hours?: number;
    total_hours?: number;
    hours?: number;
    scheduled_hours?: number;
    percentage?: number;
    percent_of_capacity?: number;
  };

  // A Kantata project template — the blueprint Kellie's team applies to create
  // a timeline. Fields read defensively: the title may be `title` or `name`,
  // and the discipline/role hint could arrive under several names. Exposure
  // varies by tenant/API version, so the pull tries a few endpoints (below).
  type KantataTemplate = {
    id: string;
    title?: string;
    name?: string;
    description?: string;
    discipline?: string;
    template_type?: string;
    updated_at?: string;
    archived?: boolean;
  };

  // Users side-bucket harvested from `include=participants` — id → full name.
  const userNames = new Map<string, string>();
  const harvestUsers = (json: Record<string, unknown>): void => {
    const users = (json.users ?? {}) as Record<string, { full_name?: string }>;
    for (const [id, u] of Object.entries(users)) {
      if (u?.full_name) userNames.set(String(id), u.full_name);
    }
  };

  // The AGP team roster — everyone in the AGP Kantata account. Harvested from
  // the account_memberships walk's `include=user` side-bucket, so it's the
  // internal staff (not external client collaborators). id → name/title/email.
  const staffById = new Map<string, { id: string; name: string; title: string; email: string }>();
  const harvestStaff = (json: Record<string, unknown>): void => {
    const users = (json.users ?? {}) as Record<
      string,
      { full_name?: string; headline?: string; email_address?: string }
    >;
    for (const [id, u] of Object.entries(users)) {
      if (u?.full_name) {
        staffById.set(String(id), {
          id: String(id),
          name: u.full_name,
          title: u.headline ?? "",
          email: u.email_address ?? "",
        });
        // Also feed the name map so owners/authors resolve even if a user
        // never appears on a story/post.
        if (!userNames.has(String(id))) userNames.set(String(id), u.full_name);
      }
    }
  };

  // All endpoints walk in parallel — workspaces (+participants), milestones,
  // the full task tree (+assignees, so tasks carry an OWNER), workspace
  // groups (the client↔project join, SPEC §7), custom-field taxonomy, recent
  // time entries, and recent posts (the project conversation). Each degrades
  // independently; only a workspaces failure is fatal.
  // Kantata exposes project templates differently across tenants/API
  // versions. Try the known collections in order; the first that returns rows
  // wins, and its name is reported so we know which one the tenant uses. A
  // FLAGGED-WORKSPACE fallback (templates modeled as workspaces) is handled
  // after the pull, from the workspaces already fetched.
  const pullTemplates = async (): Promise<{ rows: KantataTemplate[]; source: string }> => {
    const candidates: [string, string][] = [
      ["https://api.mavenlink.com/api/v1/workspace_templates?per_page=200", "workspace_templates"],
      ["https://api.mavenlink.com/api/v1/story_templates?per_page=200", "story_templates"],
      ["https://api.mavenlink.com/api/v1/templates?per_page=200", "templates"],
    ];
    for (const [url, collection] of candidates) {
      try {
        const rows = await pullKantataPaged<KantataTemplate>(url, collection, 500);
        if (rows.length > 0) return { rows, source: collection };
      } catch {
        // endpoint absent on this tenant — try the next candidate
      }
    }
    return { rows: [], source: "none" };
  };

  const [wsResult, storiesResult, tasksResult, groupsResult, cfvResult, hoursResult, postsResult, membersResult, allocResult, templatesResult] = await Promise.allSettled([
    pullKantataPaged<KantataWorkspace>(
      "https://api.mavenlink.com/api/v1/workspaces?per_page=200&order=updated_at:desc&include=participants",
      "workspaces",
      1000,
      harvestUsers,
    ),
    // Caps sized from the tenant census (~160k stories, ~617k time entries
    // lifetime): recency-ordered walks capture the live slice. Milestones
    // window around today — an unfiltered due_date:asc walk at this scale
    // spends the whole cap on ancient history. If the between-filter is
    // rejected by the tenant, fall back to future-first (still beats asc).
    pullKantataPaged<KantataStory>(
      `https://api.mavenlink.com/api/v1/stories?story_type=milestone&per_page=200&order=due_date:asc&due_date_between=${new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)}:${new Date(Date.now() + 540 * 86_400_000).toISOString().slice(0, 10)}`,
      "stories",
      1200,
    ).catch(() =>
      // Filter rejected by the tenant — fall back to recently-TOUCHED
      // milestones (updated_at), not due_date:desc, which would fill the cap
      // with far-future placeholder dates instead of the live slice.
      pullKantataPaged<KantataStory>(
        "https://api.mavenlink.com/api/v1/stories?story_type=milestone&per_page=200&order=updated_at:desc",
        "stories",
        1200,
      ),
    ),
    // NOT story_type=task: tenants that file work as "deliverable" (or sub-
    // tasks) would return zero and every workspace would look task-empty.
    // Pull recent stories of every type; milestones are filtered out below
    // (they're pulled separately), everything else is work.
    pullKantataPaged<KantataStory>(
      "https://api.mavenlink.com/api/v1/stories?per_page=200&order=updated_at:desc&include=assignees",
      "stories",
      2500,
      harvestUsers,
    ),
    // ~688 groups in the tenant — and the client-record ones (company/
    // contact fields) ARE the client directory. Never truncate them again.
    pullKantataPaged<KantataGroup>(
      "https://api.mavenlink.com/api/v1/workspace_groups?per_page=200&include=workspaces",
      "workspace_groups",
      1000,
    ),
    pullKantataPaged<KantataCfv>(
      "https://api.mavenlink.com/api/v1/custom_field_values?subject_type=Workspace&per_page=200",
      "custom_field_values",
      1000,
    ),
    pullKantataPaged<KantataTimeEntry>(
      `https://api.mavenlink.com/api/v1/time_entries?per_page=200&order=date_performed:desc&date_performed_between=${new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)}:${new Date().toISOString().slice(0, 10)}`,
      "time_entries",
      4000,
    ),
    // Recent posts — the actual project conversation (Kantata comments on
    // workspaces & stories). include=user harvests the authors' names.
    pullKantataPaged<KantataPost>(
      "https://api.mavenlink.com/api/v1/posts?per_page=200&order=created_at:desc&include=user",
      "posts",
      2000,
      harvestUsers,
    ),
    // The AGP team — every member of the AGP Kantata account. include=user
    // carries each member's name/title/email into the side-bucket that
    // harvestStaff reads. This is the roster the collaboration UI adds from.
    pullKantataPaged<KantataMembership>(
      "https://api.mavenlink.com/api/v1/account_memberships?per_page=200&include=user",
      "account_memberships",
      1000,
      harvestStaff,
    ),
    // Resource Center allocations — the reserved-hours grid. Recency-ordered
    // (recently-touched first = the live slice Kellie is actually maintaining);
    // include=user resolves the person's name. If the tenant rejects the order
    // param, fall back to an unordered walk rather than losing allocations.
    pullKantataPaged<KantataAllocation>(
      "https://api.mavenlink.com/api/v1/workspace_allocations?per_page=200&order=updated_at:desc&include=user",
      "workspace_allocations",
      4000,
      harvestUsers,
    ).catch(() =>
      pullKantataPaged<KantataAllocation>(
        "https://api.mavenlink.com/api/v1/workspace_allocations?per_page=200&include=user",
        "workspace_allocations",
        4000,
        harvestUsers,
      ),
    ),
    // AGP project templates — the role/task blueprints. Endpoint varies, so
    // this cascades through candidates and reports which one answered.
    pullTemplates(),
  ]);

  if (wsResult.status === "rejected") {
    throw new Error(wsResult.reason instanceof Error ? wsResult.reason.message : "workspaces failed");
  }
  const projects = wsResult.value
    .filter((w) => !w.archived)
    .map((w) => ({
      id: String(w.id),
      title: w.title ?? "",
      status: w.status?.message ?? "",
      start_date: w.start_date ?? "",
      due_date: w.due_date ?? "",
      updated_at: w.updated_at ?? "",
      // Real delivery team, resolved server-side from the participants join.
      participant_names: (w.participant_ids ?? [])
        .map((id) => userNames.get(String(id)))
        .filter((n): n is string => !!n),
      // service_line / vertical / commercial_model are AGP custom fields —
      // mapping them needs the tenant grounding doc (BLOCKERS #1).
    }));
  const notes: string[] = [`${projects.length} workspaces`, `${userNames.size} staff`];

  let milestones: Record<string, unknown>[] = [];
  if (storiesResult.status === "fulfilled") {
    milestones = storiesResult.value.map((s) => ({
      id: String(s.id),
      title: s.title ?? "",
      workspace_id: String(s.workspace_id ?? ""),
      due_date: s.due_date ?? "",
      state: s.state ?? "",
      ...(s.parent_id != null ? { parent_id: String(s.parent_id) } : {}),
    }));
    notes.push(`${milestones.length} milestones`);
  } else {
    notes.push(storiesResult.reason instanceof Error ? storiesResult.reason.message : "milestones failed");
  }

  let tasks: Record<string, unknown>[] = [];
  if (tasksResult.status === "fulfilled") {
    tasks = tasksResult.value
      // Milestones ride along in the unfiltered pull — they're mapped
      // separately; keep only actual work here.
      .filter((s) => s.story_type !== "milestone")
      .map((s) => ({
        id: String(s.id),
        title: s.title ?? "",
        workspace_id: String(s.workspace_id ?? ""),
        due_date: s.due_date ?? "",
        state: s.state ?? "",
        // The milestone (real project) this task hangs under — see parent_id.
        ...(s.parent_id != null ? { parent_id: String(s.parent_id) } : {}),
        ...(s.start_date ? { start_date: s.start_date } : {}),
        // The PM's scheduled hours (minutes) already in Kantata — so resourcing
        // populates from here rather than being re-entered.
        ...(typeof s.estimated_minutes === "number" ? { estimated_minutes: s.estimated_minutes } : {}),
        // WHO owns it — resolved from the assignees side-bucket. This is what
        // turns an imported task list into a shared, accountable plan.
        assignees: (s.assignee_ids ?? [])
          .map((id) => userNames.get(String(id)))
          .filter((n): n is string => !!n),
        ...(typeof s.percentage_complete === "number" ? { percent: s.percentage_complete } : {}),
      }));
    const withOwner = tasks.filter((t) => Array.isArray(t.assignees) && (t.assignees as unknown[]).length > 0).length;
    notes.push(`${tasks.length} tasks (${withOwner} assigned)`);
  } else {
    notes.push(tasksResult.reason instanceof Error ? tasksResult.reason.message : "tasks failed");
  }

  // Posts — the project conversation. Author resolved from the users bucket;
  // the message is trimmed but not otherwise transformed.
  let posts: Record<string, unknown>[] = [];
  if (postsResult.status === "fulfilled") {
    posts = postsResult.value
      .filter((p) => String(p.message ?? "").trim().length > 0)
      .map((p) => ({
        id: String(p.id),
        workspace_id: String(p.workspace_id ?? ""),
        story_id: String(p.story_id ?? p.subject_id ?? ""),
        message: String(p.message ?? "").slice(0, 2000),
        author: userNames.get(String(p.user_id ?? "")) ?? "",
        created_at: p.created_at ?? "",
      }));
    notes.push(`${posts.length} posts`);
  } else {
    notes.push(postsResult.reason instanceof Error ? postsResult.reason.message : "posts failed");
  }

  // Time entries aggregate per workspace HERE — minutes and dates only.
  // Rates/amounts on the raw entries never leave this function.
  let hours: Record<string, unknown>[] = [];
  if (hoursResult.status === "fulfilled") {
    const cutoff30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const byWs = new Map<string, { m30: number; m90: number; last: string; users30: Set<string> }>();
    for (const te of hoursResult.value) {
      const ws = String(te.workspace_id ?? "");
      if (!ws) continue;
      const date = (te.date_performed ?? "").slice(0, 10);
      const mins = Number(te.time_in_minutes) || 0;
      const agg = byWs.get(ws) ?? { m30: 0, m90: 0, last: "", users30: new Set<string>() };
      agg.m90 += mins;
      if (date >= cutoff30) {
        agg.m30 += mins;
        if (te.user_id) agg.users30.add(String(te.user_id));
      }
      if (date > agg.last) agg.last = date;
      byWs.set(ws, agg);
    }
    hours = [...byWs.entries()].map(([ws, a]) => ({
      workspace_id: ws,
      minutes_30d: a.m30,
      minutes_recent: a.m90,
      last_entry_date: a.last,
      people_30d: a.users30.size,
    }));
    notes.push(`${hoursResult.value.length} time entries`);
  } else {
    notes.push(hoursResult.reason instanceof Error ? hoursResult.reason.message : "time entries failed");
  }

  let groups: Record<string, unknown>[] = [];
  if (groupsResult.status === "fulfilled") {
    groups = groupsResult.value.map((g) => ({
      id: String(g.id),
      name: g.name ?? "",
      company: g.company ?? "",
      contact_name: g.contact_name ?? "",
      email: g.email ?? "",
      workspace_ids: (g.workspace_ids ?? []).map(String),
    }));
    const clientRecords = groups.filter((g) => g.company || g.contact_name || g.email).length;
    notes.push(`${groups.length} groups (${clientRecords} client records)`);
  } else {
    notes.push(groupsResult.reason instanceof Error ? groupsResult.reason.message : "groups failed");
  }

  let customFields: Record<string, unknown>[] = [];
  if (cfvResult.status === "fulfilled") {
    customFields = cfvResult.value.map((v) => ({
      subject_id: String(v.subject_id ?? ""),
      name: v.custom_field_name ?? "",
      value: v.display_value ?? (typeof v.value === "string" ? v.value : ""),
    }));
    notes.push(`${customFields.length} custom-field values`);
  } else {
    notes.push(cfvResult.reason instanceof Error ? cfvResult.reason.message : "custom fields failed");
  }

  // The AGP team roster — harvestStaff filled staffById during the members
  // walk. Sorted by name so the picker is stable. If the endpoint was
  // rejected, staffById is empty and the app keeps its built-in roster.
  const staff = [...staffById.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (membersResult.status === "fulfilled") {
    notes.push(`${staff.length} AGP team members`);
  } else {
    notes.push(membersResult.reason instanceof Error ? membersResult.reason.message : "team roster failed");
  }

  // Resource Center allocations → reserved hours per person over a window.
  // Fields are read defensively (see KantataAllocation) and NARROWED to
  // hours/dates/ids — never a rate or amount (no-financials wall). A story_id,
  // when present, is carried so the browser can attribute hours to a task.
  let allocations: Record<string, unknown>[] = [];
  let allocationsSample: Record<string, unknown>[] = [];
  if (allocResult.status === "fulfilled") {
    const pick = <T>(...vals: (T | undefined)[]): T | undefined => vals.find((v) => v != null);
    const FINANCIAL = /rate|cost|bill|price|amount|charge|revenue|budget|dollar|currency/i;
    allocations = allocResult.value
      .map((a) => {
        const userId = String(pick(a.user_id, a.assignee_id, a.resource_user_id) ?? "");
        const hoursVal = Number(pick(a.allocated_hours, a.total_hours, a.hours, a.scheduled_hours) ?? 0);
        const start = String(a.start_date ?? a.date ?? "").slice(0, 10);
        const end = String(a.end_date ?? a.start_date ?? a.date ?? "").slice(0, 10);
        const storyId = String(pick(a.story_id, a.sub_group_id) ?? "");
        return {
          id: String(a.id),
          workspace_id: String(a.workspace_id ?? ""),
          user_id: userId,
          user_name: userNames.get(userId) ?? "",
          start_date: start,
          end_date: end,
          hours: Number.isFinite(hoursVal) ? hoursVal : 0,
          ...(storyId ? { story_id: storyId } : {}),
          ...(typeof a.percentage === "number" ? { percentage: a.percentage } : {}),
        };
      })
      // Only rows that actually reserve time — a 0-hour placeholder isn't a
      // scheduled allocation and would just clutter the grid.
      .filter((a) => (a.hours as number) > 0 && a.workspace_id && a.user_id);
    // Raw sample (financial keys stripped) — the diagnostic that reveals the
    // real field shape, especially whether an allocation ties to a story/task.
    allocationsSample = allocResult.value.slice(0, 3).map((a) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
        if (!FINANCIAL.test(k)) out[k] = v;
      }
      return out;
    });
    const withStory = allocations.filter((a) => a.story_id).length;
    notes.push(`${allocations.length} allocations (${withStory} task-linked)`);
  } else {
    notes.push(allocResult.reason instanceof Error ? allocResult.reason.message : "allocations failed");
  }

  // Project templates → the role/task blueprints. Primary source is whichever
  // template endpoint answered; if none did, fall back to workspaces that carry
  // a template flag (some tenants model templates as flagged workspaces).
  let templates: Record<string, unknown>[] = [];
  let templatesSample: Record<string, unknown>[] = [];
  if (templatesResult.status === "fulfilled") {
    const { rows, source } = templatesResult.value;
    let raw: KantataTemplate[] = rows;
    let via = source;
    if (raw.length === 0) {
      // Fallback: a workspace flagged as a template (defensive key check — the
      // flag name varies). AGP files templates under a Templates tab, so this
      // only fires if the dedicated endpoints are all absent.
      const flagged = (wsResult.status === "fulfilled" ? wsResult.value : []).filter((w) => {
        const r = w as Record<string, unknown>;
        return r.template === true || r.is_template === true || r.workspace_template === true;
      }) as unknown as KantataTemplate[];
      if (flagged.length > 0) {
        raw = flagged;
        via = "workspaces[template-flag]";
      }
    }
    templates = raw
      .filter((tpl) => !tpl.archived && (tpl.title || tpl.name))
      .map((tpl) => ({
        id: String(tpl.id),
        title: String(tpl.title ?? tpl.name ?? ""),
        ...(tpl.description ? { description: String(tpl.description).slice(0, 500) } : {}),
        ...(tpl.discipline ? { discipline: String(tpl.discipline) } : {}),
        ...(tpl.template_type ? { template_type: String(tpl.template_type) } : {}),
      }));
    templatesSample = raw.slice(0, 3).map((tpl) => ({ ...(tpl as Record<string, unknown>) }));
    notes.push(`${templates.length} templates (via ${via})`);
  } else {
    notes.push(templatesResult.reason instanceof Error ? templatesResult.reason.message : "templates failed");
  }

  return { projects, milestones, tasks, groups, customFields, hours, posts, staff, allocations, allocationsSample, templates, templatesSample, note: notes.join(" · ") };
}

/**
 * Focus pull: the COMPLETE story set (tasks + milestones) for specific
 * workspaces. The tenant-wide walks above are recency-sliced (2000 tasks of
 * ~160k stories) — fine for a book-of-business overview, but a client
 * workspace being populated needs EVERYTHING its projects carry. Filtering
 * by workspace_id makes the pull exhaustive per project, not sampled.
 */
async function pullWorkspaceStories(
  token: string,
  workspaceIds: string[],
): Promise<{ milestones: Record<string, unknown>[]; tasks: Record<string, unknown>[]; note: string }> {
  const headers = { Authorization: `Bearer ${token}` };
  type Story = { id: string; title?: string; workspace_id?: string | number; due_date?: string; start_date?: string; state?: string; story_type?: string; parent_id?: string | number; assignee_ids?: (string | number)[]; percentage_complete?: number; estimated_minutes?: number };
  const milestones: Record<string, unknown>[] = [];
  const tasks: Record<string, unknown>[] = [];
  // Assignee names harvested from the include=assignees users side-bucket, so
  // the deepened tasks keep their OWNER (the tenant-wide pull's is otherwise
  // overwritten by this focus pull).
  const userNames = new Map<string, string>();

  const pullOne = async (wsId: string): Promise<void> => {
    // 200/page, up to 4 pages = 800 stories per workspace — beyond any real
    // single project. All story types come back; we bucket what we map.
    for (let page = 1; page <= 4; page += 1) {
      const res = await timedFetch(
        `https://api.mavenlink.com/api/v1/stories?workspace_id=${wsId}&per_page=200&page=${page}&include=assignees`,
        headers,
      );
      if (!res.ok) return; // partial results beat none; note carries totals
      const json = (await res.json()) as { stories?: Record<string, Story>; users?: Record<string, { full_name?: string }> };
      for (const [id, u] of Object.entries(json.users ?? {})) {
        if (u?.full_name) userNames.set(String(id), u.full_name);
      }
      const batch = Object.values(json.stories ?? {});
      for (const s of batch) {
        if (!s.title) continue;
        const row = {
          id: String(s.id),
          title: s.title,
          workspace_id: String(s.workspace_id ?? wsId),
          due_date: s.due_date ?? "",
          state: s.state ?? "",
          // Parent story — the milestone (real project) a task hangs under.
          ...(s.parent_id != null ? { parent_id: String(s.parent_id) } : {}),
          ...(s.start_date ? { start_date: s.start_date } : {}),
          ...(typeof s.estimated_minutes === "number" ? { estimated_minutes: s.estimated_minutes } : {}),
          assignees: (s.assignee_ids ?? []).map((aid) => userNames.get(String(aid))).filter((n): n is string => !!n),
          ...(typeof s.percentage_complete === "number" ? { percent: s.percentage_complete } : {}),
        };
        // Milestones are the only special type; EVERYTHING else with a title
        // is work to surface — task, deliverable, sub-task, whatever the
        // tenant calls it. The old `story_type === "task"` filter silently
        // dropped every workspace that files work as "deliverable".
        if (s.story_type === "milestone") milestones.push(row);
        else tasks.push(row);
      }
      if (batch.length < 200) return;
    }
  };

  await Promise.allSettled(workspaceIds.map(pullOne));
  return { milestones, tasks, note: `focus: ${workspaceIds.length} workspaces · ${milestones.length} milestones · ${tasks.length} tasks` };
}

import { requireAuth } from "./_lib/authGate.js";

export default async function handler(
  req: { method?: string; url?: string; headers?: Record<string, string | string[] | undefined> },
  res: {
    status: (code: number) => { json: (body: unknown) => void };
    setHeader: (k: string, v: string) => void;
  },
): Promise<void> {
  const auth = await requireAuth(typeof req.headers?.authorization === "string" ? req.headers.authorization : undefined);
  if (!auth.authorized) {
    res.status(auth.status).json(auth.body);
    return;
  }

  // ?workspaces=id1,id2 — focus pull for specific workspaces (complete
  // task tree, not the tenant-wide recency slice). Never cached: it's an
  // on-demand deepen triggered by populate/link actions.
  const wsMatch = /[?&]workspaces=([\d,]+)/.exec(req.url ?? "");
  if (wsMatch) {
    res.setHeader("Cache-Control", "no-store");
    const focusToken = process.env.KANTATA_API_TOKEN;
    const ids = [...new Set(wsMatch[1]!.split(",").filter((s) => /^\d+$/.test(s)))].slice(0, 12);
    if (!focusToken || ids.length === 0) {
      res.status(200).json({ live: false, note: focusToken ? "no valid workspace ids" : "KANTATA_API_TOKEN not set", kantataMilestones: [], kantataTasks: [] });
      return;
    }
    try {
      const focus = await pullWorkspaceStories(focusToken, ids);
      res.status(200).json({ live: true, note: focus.note, workspaces: ids, kantataMilestones: focus.milestones, kantataTasks: focus.tasks });
    } catch (e) {
      res.status(200).json({ live: false, note: e instanceof Error ? e.message : "focus pull failed", kantataMilestones: [], kantataTasks: [] });
    }
    return;
  }

  // ?fresh=1 (the Live pill's refresh) bypasses every cache layer.
  const fresh = /[?&]fresh=1/.test(req.url ?? "");
  res.setHeader("Cache-Control", fresh ? "no-store" : "s-maxage=300, stale-while-revalidate=600");
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) {
    res.status(200).json(cache.payload);
    return;
  }

  const kantataToken = process.env.KANTATA_API_TOKEN;

  const payload: MirrorPayload = {
    live: false,
    fetchedAt: new Date().toISOString(),
    sources: {
      // Kantata-only: HubSpot is no longer pulled (ADR 0008). The entry
      // stays so older clients parsing the payload shape don't break.
      hubspot: { ok: false, note: "off — Kantata-only (ADR 0008)", companies: 0, deals: 0 },
      kantata: { ok: false, note: kantataToken ? "" : "KANTATA_API_TOKEN not set", projects: 0 },
    },
    companies: [],
    deals: [],
    kantataProjects: [],
    kantataMilestones: [],
    kantataGroups: [],
    kantataCustomFields: [],
    kantataTasks: [],
    kantataHours: [],
    kantataPosts: [],
    kantataStaff: [],
    kantataAllocations: [],
    kantataAllocationsSample: [],
    kantataTemplates: [],
    kantataTemplatesSample: [],
  };

  const [kantataResult] = await Promise.allSettled([
    kantataToken ? pullKantata(kantataToken) : Promise.reject(new Error("token not set")),
  ]);

  if (kantataToken) {
    if (kantataResult.status === "fulfilled") {
      const k = kantataResult.value;
      payload.kantataProjects = k.projects;
      payload.kantataMilestones = k.milestones;
      payload.kantataGroups = k.groups;
      payload.kantataCustomFields = k.customFields;
      payload.kantataTasks = k.tasks;
      payload.kantataHours = k.hours;
      payload.kantataPosts = k.posts;
      payload.kantataStaff = k.staff;
      payload.kantataAllocations = k.allocations;
      payload.kantataAllocationsSample = k.allocationsSample;
      payload.kantataTemplates = k.templates;
      payload.kantataTemplatesSample = k.templatesSample;
      payload.sources.kantata = { ok: true, note: k.note, projects: k.projects.length };
    } else {
      payload.sources.kantata.note = `pull failed: ${kantataResult.reason instanceof Error ? kantataResult.reason.message : "unknown"}`;
    }
  }

  payload.live = payload.sources.kantata.ok;
  cache = { at: Date.now(), payload };
  res.status(200).json(payload);
}
