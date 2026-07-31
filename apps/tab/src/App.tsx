import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { SearchBox } from "./components/SearchBox.js";
import { ClientList } from "./components/ClientList.js";
import { DataInspector } from "./components/DataInspector.js";
import { ClientWorkspace, type ClientTab } from "./components/ClientWorkspace.js";
import { DiscussLauncher } from "./components/DiscussLauncher.js";
import { FeedbackAdmin } from "./components/FeedbackAdmin.js";
import { FeedbackButton } from "./components/FeedbackButton.js";
import { Button, EmptyState } from "./components/ui.js";
import { Tour, type TourStep } from "./components/Tour.js";
import { TeamManager } from "./components/TeamManager.js";
import { useWorkspace } from "./workspace/store.js";
import { useProfile } from "./workspace/profile.js";
import { clearIdentity, loadIdentity, saveIdentity, type LocalIdentity } from "./auth/localAuth.js";
import { classifyClientTitle, initLiveMirror, refreshLiveMirror, type LiveStatus } from "./workspace/liveMirror.js";
import { loadMirror } from "./workspace/agpKnowledge.js";
import { accountLiveContext, campaignsFromMirror, isInBook, suggestClients, taskColumn, taskIsDone } from "./workspace/campaignImport.js";
import { AS_OF_TODAY } from "./workspace/format.js";
import type { ClientAccount } from "./workspace/types.js";
import { T } from "./theme.js";

/**
 * One surface: Cara's client-account workspace (the wireframe, exactly).
 * The Sandbox lives INSIDE each client as a tab — every idea is tied to
 * the client it's for, never a separate top-level pile. Promoted builds
 * keep their full ROI workspace — reached from their idea or via search.
 */

type Route =
  | { view: "clients" }
  | { view: "initiative"; id: string }
  | { view: "idea"; id: string }
  | { view: "account"; id: string }
  /** Tour-feedback admin. Deliberately unlinked — reachable by URL only. */
  | { view: "admin" };

function parseHash(): Route {
  const hash = window.location.hash;
  if (/^#admin\/feedback$/.test(hash)) return { view: "admin" };
  const initiative = hash.match(/^#i\/(.+)$/);
  if (initiative?.[1]) return { view: "initiative", id: initiative[1] };
  const idea = hash.match(/^#s\/(.+)$/);
  if (idea?.[1]) return { view: "idea", id: idea[1] };
  const account = hash.match(/^#c\/(.+)$/);
  if (account?.[1]) return { view: "account", id: account[1] };
  // Legacy "#sandbox" links land on Clients — the sandbox is per-client now.
  return { view: "clients" };
}

function hashOf(route: Route): string {
  switch (route.view) {
    case "initiative":
      return `i/${route.id}`;
    case "idea":
      return `s/${route.id}`;
    case "account":
      return `c/${route.id}`;
    case "admin":
      return "admin/feedback";
    default:
      return "";
  }
}

const TOUR_KEY = "agp-collab-tour-v1";

/**
 * The spotlight walkthrough — written to be read aloud while demoing. Each
 * step pairs the ask (a line from Cara's features doc or the product-owner
 * brief) with what was built from it. Routes run on whatever the live
 * Kantata pull returns — there is no seeded demo workspace to fall back on.
 */
const TOUR_STEPS: TourStep[] = [
  {
    key: "welcome",
    route: "",
    title: "Welcome to the workspace",
    body: "A 90-second tour of how this works — ask by ask. Cara scoped the collaboration workspace; Kellie needs the plan to feed capacity. Everything you see here is live from Kantata. → or Enter to continue, Esc to exit.",
    quote: { text: "…the primary execution environment for client accounts — communication, tasks, files, and visibility across internal teams, clients, and contractors.", from: "Cara — features doc, opening line" },
    question: {
      prompt: "Before you start — how clear is it what this workspace is for?",
      options: [
        { key: "a", label: "Completely clear" },
        { key: "b", label: "Roughly — I'd want to see it first" },
        { key: "c", label: "Not clear yet" },
      ],
      placeholder: "What would have made it land faster? (optional)",
    },
  },
  {
    key: "directory",
    route: "",
    target: '[data-tour="directory"]',
    title: "One list, every client — live from Kantata",
    quote: { text: "Separate workspace per client/project/initiative; no cross-visibility by default.", from: "Cara — features doc, a Must" },
    body: "Every current client, straight from your Kantata tenant — no demo data, nothing typed by hand. Each row is one client; open it and it's a workspace of its own. Clients with no work booked this fiscal year are folded away, with a count and a “Show all” link so nothing is ever silently missing.",
    question: {
      prompt: "Could you find one of your own clients in this list?",
      options: [
        { key: "a", label: "Straight away" },
        { key: "b", label: "Yes, but it took some scanning" },
        { key: "c", label: "No — I couldn't find them" },
      ],
      placeholder: "Which client, and what got in the way? (optional)",
    },
  },
  {
    key: "collaborating",
    route: "",
    target: '[data-tour="directory"]',
    placement: "top",
    title: "Who's collaborating, and on what",
    quote: { text: "Communication, tasks, files, and visibility across internal teams, clients, and contractors.", from: "Cara — features doc" },
    body: "“Who's collaborating” is the real Kantata delivery team booked on that client — with their role — and “Working on” is the live campaigns in flight. Both come from Kantata's participants and projects, so the list shows the actual working picture, not a guess.",
    question: {
      prompt: "Does “who's collaborating” match who is really on that work?",
      options: [
        { key: "a", label: "Yes — that's the team" },
        { key: "b", label: "Mostly, with people missing or extra" },
        { key: "c", label: "No — this isn't the working picture" },
      ],
      placeholder: "Who's wrong, missing, or shouldn't be there? (optional)",
    },
  },
  {
    key: "sort",
    route: "",
    target: '[data-tour="sort"]',
    title: "Sort & filter around collaboration",
    quote: { text: "Users can find updates, tasks, and files within 60 seconds.", from: "Cara — features doc, the Home Must" },
    body: "Sort by what matters for working together — most active, open tasks, people, projects — and filter by vertical, lead, or setup status. Findability is the point: the client you need is a click away.",
    question: {
      prompt: "Which of these would you actually reach for first?",
      options: [
        { key: "a", label: "Sorting — most active, open tasks, people" },
        { key: "b", label: "Filtering — vertical, lead, setup status" },
        { key: "c", label: "Neither — I'd just search" },
      ],
      placeholder: "What would you sort or filter by that isn't here? (optional)",
    },
  },
  {
    key: "book",
    route: "",
    target: '[data-tour="book"]',
    title: "Set up a workspace — one standard template",
    quote: { text: "Ability to apply a template (channels/pages/lists) for consistent set up… you choose what imports.", from: "Cara — features doc, two Musts" },
    body: "Every client workspace starts identical — Home, plan, dashboard, files, discussions, access. One click sets it up and it opens already full: that client's real Kantata campaigns, milestones and tasks are pulled straight in, with the full task tree following in the background. Anything that doesn't belong comes out via “Review import”.",
    question: {
      prompt: "One standard template for every client — right call?",
      options: [
        { key: "a", label: "Yes — consistency is the point" },
        { key: "b", label: "Mostly, but some clients need their own shape" },
        { key: "c", label: "No — too rigid for how we work" },
      ],
      placeholder: "What would you add to or drop from the standard set? (optional)",
    },
  },
  {
    key: "people",
    route: "",
    title: "Collaborate from anywhere in a client",
    quote: { text: "Invite client/contractor users with controlled access (guest/external).", from: "Cara — features doc, a Must" },
    body: "Inside a client, the People hub sits on the navy band on EVERY tab — add an AGP teammate, invite a client or contractor, or post an update to the team without leaving what you're doing. The roster you add from is the live AGP team in Kantata.",
    question: {
      prompt: "Adding people and posting from any tab — does that fit how you work?",
      options: [
        { key: "a", label: "Yes — I'd use it where I am" },
        { key: "b", label: "I'd rather go to one place to do it" },
        { key: "c", label: "It feels like clutter on every tab" },
      ],
      placeholder: "Where would you expect this to live instead? (optional)",
    },
  },
  {
    key: "tasks",
    route: "",
    title: "Every task is clickable — and accountable",
    quote: { text: "Shared task lists — assign owners, due dates; track status/progress. @mentions notify.", from: "Cara — features doc, Tasks Musts" },
    body: "Task owners come from Kantata's assignees — no plan lands ownerless. Click any task to see everything about it, move its status, or raise it with the team in one step. One list, no double entry: the plan is the source.",
    question: {
      prompt: "Would you run a project from this task list, or keep using Kantata?",
      options: [
        { key: "a", label: "This — it's easier to work from" },
        { key: "b", label: "Both, depending on what I'm doing" },
        { key: "c", label: "Kantata — this doesn't add enough" },
      ],
      placeholder: "What's missing before you'd work here daily? (optional)",
    },
  },
  {
    key: "access",
    route: "",
    title: "Access that revokes for real",
    quote: { text: "Removing a user revokes access across the workspace immediately.", from: "Cara — features doc, a Must" },
    body: "The access register shows who invited whom and when they were last active. Remove revokes on the spot, and “Offboard everywhere” clears a person from every client workspace at once — audit-logged. Clients only ever see their own workspace; internal financials never appear.",
    question: {
      prompt: "Is this enough control to let a client or contractor in?",
      options: [
        { key: "a", label: "Yes — I'd invite someone today" },
        { key: "b", label: "Nearly — I'd want one more safeguard" },
        { key: "c", label: "No — I wouldn't risk it yet" },
      ],
      placeholder: "What would you need to see before inviting someone? (optional)",
    },
  },
  {
    key: "resource-sync",
    route: "",
    title: "The plan feeds capacity — through Kantata",
    quote: { text: "Weekly reservations are created in Kantata — and recalculated as the plan changes.", from: "Kellie — Resource capacity planner" },
    body: "The loop closes through Kantata: task owners, dates, and weekly hours written here flow back to Kantata, and the capacity planner reads them — one source of truth, by person, by week. Read side is live today; the write-back rides the same connection once write access is on.",
    question: {
      prompt: "The plan here feeding Kantata capacity — how much does that matter to you?",
      options: [
        { key: "a", label: "Critical — it's the reason to use this" },
        { key: "b", label: "Useful, not decisive" },
        { key: "c", label: "Not part of my job" },
      ],
      placeholder: "What would you want written back that isn't? (optional)",
    },
  },
  {
    key: "done",
    title: "That's the loop",
    quote: { text: "If the plan moves in the workspace, it has to move in Kantata — that's what I schedule capacity off of.", from: "Kellie — Resource capacity planner" },
    body: "Live Kantata book → a workspace per client → the real team, tasks, and campaigns populate in → everyone works one plan → it syncs back to Kantata for Kellie's capacity planner. No dummy data anywhere. Restart any time with “Take the tour”.",
    question: {
      prompt: "Overall — would this replace something you do today?",
      options: [
        { key: "a", label: "Yes — I'd switch to it" },
        { key: "b", label: "It would sit alongside what I use" },
        { key: "c", label: "No — not as it stands" },
      ],
      placeholder: "The one change that would make the biggest difference? (optional)",
    },
  },
];

function PageIntro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h1 style={{ fontSize: 19, fontWeight: 700, color: T.ink }}>{title}</h1>
      <p style={{ fontSize: 12.5, color: T.inkSecondary, marginTop: 4, maxWidth: 720, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

export function App() {
  const ws = useWorkspace();
  const { name: userName, setName, signedIn: ssoSignedIn, email: ssoEmail, ssoConfigured, signIn, signOut: ssoSignOut } = useProfile();
  // Interim email+password identity (until Microsoft SSO). Persisted per-browser.
  const [localId, setLocalId] = useState<LocalIdentity | null>(() => loadIdentity());
  const [teamOpen, setTeamOpen] = useState(false);
  const signedIn = ssoConfigured ? ssoSignedIn : ssoSignedIn || localId != null;
  const email = ssoConfigured ? ssoEmail : localId?.email ?? ssoEmail;

  // Once Microsoft SSO is configured, retire any old local identity.
  useEffect(() => {
    if (!ssoConfigured || !localId) return;
    clearIdentity();
    setLocalId(null);
  }, [ssoConfigured, localId]);

  const handlePasswordSignIn = async (em: string, pw: string): Promise<boolean> => {
    if (ssoConfigured) return false;
    const id = await ws.signInWithPassword(em, pw);
    if (!id) return false;
    saveIdentity(id);
    setLocalId(id);
    setName(id.name);
    return true;
  };
  const handleSignOut = () => {
    if (localId) {
      clearIdentity();
      setLocalId(null);
    }
    if (ssoSignedIn) ssoSignOut();
  };
  // Auto-start the walkthrough on first visit; the nav button restarts it.
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try {
      return window.localStorage.getItem(TOUR_KEY) ? null : 0;
    } catch {
      return null;
    }
  });
  const closeTour = () => {
    setTourStep(null);
    try {
      window.localStorage.setItem(TOUR_KEY, "seen");
    } catch {
      // storage unavailable — the tour just won't remember it ran
    }
  };
  // The client workspace reports its visible tab up so the floating
  // feedback button can ask about that exact surface.
  const [clientTab, setClientTab] = useState<ClientTab>("home");
  const [route, setRouteState] = useState<Route>(parseHash);
  const setRoute = (r: Route) => {
    setRouteState(r);
    window.location.hash = hashOf(r);
    window.scrollTo({ top: 0 });
  };

  // Browser back/forward and pasted #links must navigate, not just in-app clicks.
  useEffect(() => {
    const onHash = () => setRouteState(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Live Kantata + HubSpot mirror — the header tells the truth about it.
  const [liveStatus, setLiveStatus] = useState<LiveStatus>({
    live: false,
    label: "Demo data",
    detail: "checking /api/mirror…",
  });
  useEffect(() => {
    void initLiveMirror(setLiveStatus);
  }, []);

  // Auto-populate on open: the moment a live client workspace is opened, fill
  // it from Kantata's full task tree — no button, no "Import everything".
  // ensureAutoPopulated runs the deepen + import once per workspace and marks
  // it done; the ref guards against firing twice while that first call is in
  // flight. This is what makes EVERY client populate, not just the ones the
  // user happens to click through.
  const autoTriedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!liveStatus.live || route.view !== "account") return;
    const acct = ws.accounts.find((a) => a.id === route.id);
    if (!acct || acct.archived || acct.autoPopulated) return;
    if (autoTriedRef.current.has(acct.id)) return;
    autoTriedRef.current.add(acct.id);
    void ws.ensureAutoPopulated(acct.id);
    // Keyed on the open account and the live flag — reopening after the live
    // mirror arrives retries a workspace that had nothing to match before.
  }, [route, liveStatus.live, ws.accounts, ws.ensureAutoPopulated]);

  // The book-of-business candidates: every mirror client without a workspace,
  // scored by what a one-click create would import. Memoized — at a full
  // book (1000 clients × 1000 projects) this is real work.
  const clientCandidates = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    return mirror.clients
      .filter((c) => !ws.accounts.some((a) => a.clientName.toLowerCase() === c.name.toLowerCase()))
      .map((c) => ({
        name: c.name,
        vertical: c.vertical,
        ...(c.lifecycleStage ? { lifecycleStage: c.lifecycleStage } : {}),
        ...(c.targetAccount ? { targetAccount: true } : {}),
        ...(c.icpTier ? { icpTier: c.icpTier } : {}),
        workCount: campaignsFromMirror(mirror, c.name, today).length,
        isClient: c.lifecycleStage === "customer" || !!c.abbreviation,
        ...(c.active != null ? { active: c.active } : {}),
      }))
      // Delivery tool = clients only: active Kantata work, or a real client
      // marker. The server already filters the live pull; this guards the
      // demo fixture and any stale cached payload.
      .filter((c) => c.workCount > 0 || c.isClient)
      // ...and only CURRENT ones, the same rule the directory above applies.
      // Two lists on one screen disagreeing about who's active reads as a bug.
      .filter((c) => c.active !== false)
      .sort(
        (a, b) =>
          b.workCount - a.workCount ||
          Number(b.lifecycleStage === "customer") - Number(a.lifecycleStage === "customer") ||
          Number(b.targetAccount ?? false) - Number(a.targetAccount ?? false) ||
          a.name.localeCompare(b.name),
      );
    // liveStatus flips when the live mirror arrives — the trigger to recompute.
  }, [ws.accounts, liveStatus]);

  const selectedInitiative =
    route.view === "initiative" ? ws.initiatives.find((i) => i.id === route.id) ?? null : null;
  const selectedIdea = route.view === "idea" ? ws.ideas.find((i) => i.id === route.id) ?? null : null;
  const selectedAccount = route.view === "account" ? ws.accounts.find((a) => a.id === route.id) ?? null : null;

  // Workspaces pointing at names that don't exist in the live book (demo
  // leftovers, misspellings) — badged on the Clients list.
  const unlinkedNames = useMemo(() => {
    if (!liveStatus.live) return [];
    const mirror = loadMirror();
    return ws.accounts.filter((a) => !a.archived && !isInBook(mirror, a.clientName)).map((a) => a.clientName);
  }, [ws.accounts, liveStatus]);

  // Per-workspace live pulse for the Clients page: how many Kantata matches
  // are WAITING for review, and the next real milestone — so the hero grid
  // is a work queue, not a guessing game.
  const accountPulse = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    const pulse: Record<string, { waiting: number; nextMilestone?: string; nextMilestoneDate?: string }> = {};
    for (const a of ws.accounts) {
      if (a.archived) continue;
      const matched = campaignsFromMirror(mirror, a.clientName, today, a.kantataProjectIds);
      const waiting = matched.filter(
        (c) => !a.campaigns.some((e) => e.name.toLowerCase() === c.name.toLowerCase()),
      ).length;
      const next = matched
        .filter((c) => c.nextMilestone && c.nextMilestoneDate && c.nextMilestoneDate >= today)
        .sort((x, y) => (x.nextMilestoneDate ?? "").localeCompare(y.nextMilestoneDate ?? ""))[0];
      pulse[a.clientName] = {
        waiting,
        ...(next ? { nextMilestone: next.nextMilestone!, nextMilestoneDate: next.nextMilestoneDate! } : {}),
      };
    }
    return pulse;
  }, [ws.accounts, liveStatus]);

  // Sortable directory: EVERY client the app sees — derived-from-Kantata and
  // existing workspaces alike — with its live project count and next
  // milestone. Computed here (App can reach the matcher) and passed to
  // ClientList as plain data, keeping the guest-safety boundary intact.
  const clientDirectory = useMemo(() => {
    const mirror = loadMirror();
    const today = AS_OF_TODAY();
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const activeAccounts = ws.accounts.filter((a) => !a.archived);
    const accountByName = new Map(activeAccounts.map((a) => [norm(a.clientName), a] as const));
    // Live AGP roster (Kantata staff) → name→title, so collaborators carry a
    // real role. No hardcoded people.
    const staffTitle = new Map((mirror.staff ?? []).map((s) => [s.name, s.title] as const));
    const rows: {
      name: string;
      vertical?: string;
      liveProjects: number;
      nextMilestone?: string;
      nextMilestoneDate?: string;
      accountId?: string;
      collaborators?: { name: string; role: string }[];
      areas?: string[];
      lastCollab?: string;
      myLastCollab?: string;
      active?: boolean;
    }[] = [];
    const usedAccounts = new Set<string>();
    const emit = (name: string, vertical: string | undefined, account?: ClientAccount, active?: boolean) => {
      const ctx = accountLiveContext(mirror, name, account?.kantataProjectIds, account?.scopedToProjects);
      let nextMilestone: string | undefined;
      let nextMilestoneDate: string | undefined;
      for (const p of ctx.projects) {
        for (const m of p.milestones) {
          if (m.state !== "completed" && m.dueDate >= today && (nextMilestoneDate === undefined || m.dueDate < nextMilestoneDate)) {
            nextMilestoneDate = m.dueDate;
            nextMilestone = m.title;
          }
        }
      }
      // Who's collaborating — the REAL Kantata delivery team on this client's
      // projects (participants), deduped. Role from the live staff roster.
      const teamNames = [...new Set(ctx.projects.flatMap((p) => p.team ?? []))];
      const collaborators = teamNames.map((n) => ({ name: n, role: staffTitle.get(n) ?? "" }));
      // What they're working on — the live campaigns in flight for this client.
      const areas = [
        ...new Set(
          campaignsFromMirror(mirror, name, today, account?.kantataProjectIds)
            .filter((c) => c.status !== "complete")
            .map((c) => c.name),
        ),
      ];
      // Most-recent collaboration on this client — LIVE (Kantata posts + last
      // time entry) and local (the workspace thread/activity), so the list can
      // float the freshest work to the top.
      const max = (arr: (string | undefined)[]) => arr.filter((x): x is string => !!x).sort().pop();
      const lastCollab = max([
        ...ctx.posts.map((p) => p.createdAt),
        ...ctx.projects.map((p) => p.lastEntryDate),
        ...(account?.thread ?? []).map((m) => m.at),
        ...(account?.activity ?? []).map((e) => e.at),
      ]);
      // …and the freshest collaboration by THIS person specifically (their own
      // posts here, or a Kantata post/entry under their name).
      const myLastCollab = max([
        ...(account?.thread ?? []).filter((m) => m.author === userName).map((m) => m.at),
        ...ctx.posts.filter((p) => p.author === userName).map((p) => p.createdAt),
      ]);
      rows.push({
        name,
        ...(vertical ? { vertical } : {}),
        liveProjects: ctx.projects.length,
        ...(nextMilestone ? { nextMilestone } : {}),
        ...(nextMilestoneDate ? { nextMilestoneDate } : {}),
        ...(account ? { accountId: account.id } : {}),
        ...(collaborators.length > 0 ? { collaborators } : {}),
        ...(areas.length > 0 ? { areas } : {}),
        ...(lastCollab ? { lastCollab } : {}),
        ...(myLastCollab ? { myLastCollab } : {}),
        // Workspaces you've built are always current, whatever the Kantata
        // history says — you made one because the client matters now.
        ...(account ? { active: true } : active != null ? { active } : {}),
      });
    };
    for (const c of mirror.clients) {
      const account = accountByName.get(norm(c.name));
      if (account) usedAccounts.add(account.id);
      emit(c.name, c.vertical, account, c.active);
    }
    // Workspaces whose name isn't in the derived directory (manual / renamed).
    for (const a of activeAccounts) {
      if (usedAccounts.has(a.id)) continue;
      emit(a.clientName, undefined, a);
    }
    return rows;
  }, [ws.accounts, liveStatus, userName]);

  // How the client count breaks down by title convention — shown in the
  // directory header so the number explains itself (colon-prefix clients vs
  // dash vs the verbatim project-titles that are deliberately NOT counted).
  const directoryStats = useMemo(() => {
    const mirror = loadMirror();
    const s = { colon: 0, dash: 0, verbatim: 0 };
    for (const p of mirror.projects) {
      const via = classifyClientTitle(p.title).via;
      if (via === "colon") s.colon += 1;
      else if (via === "dash") s.dash += 1;
      else if (via === "verbatim") s.verbatim += 1;
    }
    return s;
  }, [liveStatus]);

  // Everything the mirror knows about the open account, computed once per
  // render of that workspace — the workspace renders it as plain props.
  const selectedLiveCtx = selectedAccount
    ? accountLiveContext(loadMirror(), selectedAccount.clientName, selectedAccount.kantataProjectIds, selectedAccount.scopedToProjects)
    : null;
  const selectedLinkSuggestions =
    selectedAccount && selectedLiveCtx && liveStatus.live && !selectedLiveCtx.crm
      ? suggestClients(loadMirror(), selectedAccount.clientName)
      : [];
  const selectedTaskCandidates = selectedAccount && selectedLiveCtx
    ? selectedLiveCtx.projects.flatMap((p) =>
        p.tasks
          .filter((t) => !taskIsDone(t.state))
          .filter((t) => !selectedAccount.tasks.some((e) => e.title.toLowerCase() === t.title.toLowerCase()))
          .map((t) => ({
            title: t.title,
            status: taskColumn(t.state),
            ...(t.dueDate ? { due: t.dueDate } : {}),
            project: p.title,
          })),
      )
    : [];

  const listView = route.view === "clients";

  // This person's own tour answers, so re-opening a step shows what they
  // chose. Everyone else's stay pooled for the admin roll-up.
  const myAnswers = useMemo(() => {
    const me = (email ?? "").trim().toLowerCase() || userName.trim().toLowerCase();
    const mine: Record<string, { choice: string; comment: string }> = {};
    for (const f of ws.feedback) {
      const who = f.personEmail.trim().toLowerCase() || f.personName.trim().toLowerCase();
      if (who === me) mine[f.stepKey] = { choice: f.choice, comment: f.comment };
    }
    return mine;
  }, [ws.feedback, email, userName]);

  // The sandbox lives inside each client: an idea's Back returns to its
  // owning workspace when one still exists.
  const ideaHome = (idea: { accountId?: string }): Route =>
    idea.accountId && ws.accounts.some((a) => a.id === idea.accountId)
      ? { view: "account", id: idea.accountId }
      : { view: "clients" };

  // This client's sandbox: its own ideas, plus legacy ideas not yet tied to
  // any client (claimable). Composed HERE so internal-only modules (ROI,
  // copilot) never enter ClientWorkspace's import graph — clientSafety.test.ts.
  const selectedAccountIdeas = selectedAccount ? ws.ideas.filter((i) => i.accountId === selectedAccount.id) : [];
  const unclaimedIdeas = ws.ideas.filter((i) => !i.accountId || !ws.accounts.some((a) => a.id === i.accountId));

  return (
    <div style={{ minHeight: "100vh", background: T.page }}>
      <AppHeader
        userName={userName}
        onChangeName={setName}
        live={liveStatus.live}
        liveLabel={liveStatus.label}
        liveDetail={liveStatus.detail}
        onRefreshData={() => void refreshLiveMirror(setLiveStatus)}
        onHome={() => setRoute({ view: "clients" })}
        {...(!ssoConfigured ? { onSettings: () => setTeamOpen(true) } : {})}
        signedIn={signedIn}
        email={email}
        ssoConfigured={ssoConfigured}
        onSignIn={signIn}
        onSignOut={handleSignOut}
        {...(!ssoConfigured ? { onSignInPassword: handlePasswordSignIn, onManageTeam: () => setTeamOpen(true) } : {})}
      />

      {ssoConfigured && !signedIn ? (
        <div className="auth-shell">
          <div className="auth-container">
            <div className="auth-brand" aria-hidden>
              <div className="auth-brand-marks">
                <span className="auth-logo-mark">AGP</span>
                <span className="auth-wordmark">
                  Allegiance Group <span className="auth-wordmark-plus">+ Pursuant</span>
                </span>
              </div>
              <p className="auth-brand-sub">Collaboration Workspace</p>
            </div>
            <div className="auth-card">
              <h1 className="auth-title">Sign in required</h1>
              <p className="auth-copy">
                This workspace now uses Microsoft SSO. Continue with your AGP Microsoft 365 account to access client workspaces and live data.
              </p>
              <button type="button" className="auth-ms-btn" onClick={signIn}>
                <svg width="16" height="16" viewBox="0 0 21 21" aria-hidden>
                  <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                  <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                  <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                  <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
                </svg>
                Continue with Microsoft
              </button>
              <p className="auth-foot">Use the same account you use for AGP Teams and Microsoft 365.</p>
            </div>
          </div>
        </div>
      ) : (
      <>
      {/* Persistent navigation — visible on every page, including workspaces. */}
      <div style={{ background: "#fff", borderBottom: `1px solid ${T.grid}` }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "10px 18px", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span data-tour="nav" style={{ display: "inline-flex", gap: 6 }}>
            <button
              type="button"
              className={`nav-pill${route.view === "clients" || route.view === "account" ? " active" : ""}`}
              title="Client workspaces you've set up — the full Kantata client roster is under “All clients — list”."
              onClick={() => setRoute({ view: "clients" })}
            >
              Workspaces ({ws.accounts.filter((a) => !a.archived).length})
            </button>
          </span>
          <button type="button" className="nav-pill" onClick={() => setTourStep(0)} title="Spotlight walkthrough of the workspace">
            ✦ Take the tour
          </button>
          {!ssoConfigured && (
            <button type="button" className="nav-pill" onClick={() => setTeamOpen(true)} title="Add team members and set sign-in passwords">
              Team{ws.team.length > 0 ? ` (${ws.team.length})` : ""}
            </button>
          )}
          <SearchBox accounts={ws.accounts} initiatives={ws.initiatives} ideas={ws.ideas} onNavigate={(target) => setRoute(target)} />
        </div>
      </div>

      {/* Live-data failures are debugging information — show them, don't
          bury them in a hover tooltip. */}
      {!liveStatus.live && liveStatus.detail && !liveStatus.detail.startsWith("checking") && liveStatus.label !== "Refreshing…" && (
        <div style={{ background: "#faf3dc", borderBottom: "1px solid #e7c66f" }}>
          <div style={{ maxWidth: 1240, margin: "0 auto", padding: "7px 18px", fontSize: 11.5, color: "#8a6d1a", lineHeight: 1.5 }}>
            <strong>Live data unavailable — showing demo data.</strong> {liveStatus.detail}. Click
            the ⟳ pill (top right) to retry.
          </div>
        </div>
      )}

      <div className="fade-in" key={hashOf(route)} style={{ maxWidth: 1240, margin: "0 auto", padding: 18 }}>
        {route.view === "clients" && (
          <>
            <PageIntro title="Client workspaces">
              One standardized execution workspace per client account — communication, tasks, files,
              and visibility for internal teams, clients, and contractors. Internal financials never
              appear here.
            </PageIntro>
            <ClientList
              accounts={ws.accounts.filter((a) => !a.archived)}
              archivedAccounts={ws.accounts.filter((a) => a.archived)}
              onRestore={(id) => ws.setAccountArchived(id, false)}
              candidates={clientCandidates}
              candidatesLive={liveStatus.live}
              directory={clientDirectory}
              directoryStats={directoryStats}
              pulse={accountPulse}
              onOpen={(id) => setRoute({ view: "account", id })}
              onCreate={(name) => setRoute({ view: "account", id: ws.createAccount(name) })}
              onCreateFromClient={(name) => setRoute({ view: "account", id: ws.createAccountFromMirror(name) })}
              onClearAll={() => ws.archiveAllAccounts()}
            />
            {(() => {
              const waitingTotal = Object.values(accountPulse).reduce((s, p) => s + p.waiting, 0);
              if (waitingTotal === 0) return null;
              return (
                <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", flexWrap: "wrap", borderColor: T.roi.navy }}>
                  <span style={{ fontSize: 12.5, color: T.inkSecondary, flex: 1, minWidth: 260 }}>
                    <strong style={{ color: T.ink }}>{waitingTotal} Kantata item{waitingTotal === 1 ? "" : "s"} waiting across your workspaces.</strong>{" "}
                    Populate everything at once — campaigns, milestones, and open tasks land in every workspace. Remove stays one click away per workspace.
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      // Sequential on purpose: each import deepens its own
                      // workspaces from Kantata first — don't stampede the API.
                      void (async () => {
                        for (const a of ws.accounts) {
                          if (!a.archived && (accountPulse[a.clientName]?.waiting ?? 0) > 0) await ws.importAllFromKantata(a.id);
                        }
                      })();
                    }}
                  >
                    ⚡ Populate all workspaces from Kantata →
                  </button>
                </div>
              );
            })()}
            <DataInspector live={liveStatus.live} unlinkedCount={unlinkedNames.length} />
          </>
        )}

        {listView && (
          <div style={{ marginTop: 18, fontSize: 11, color: T.inkMuted }}>
            {ws.syncStatus.mode === "shared" ? (
              <>
                Shared team workspace — synced to Supabase
                {ws.syncStatus.savedAt ? ` · last saved ${new Date(ws.syncStatus.savedAt).toLocaleTimeString()}` : ""}
                {ws.syncStatus.error ? " · retrying…" : ""}{" "}
                <Button variant="link" style={{ fontSize: 11 }} onClick={ws.clearWorkspace}>
                  Clear shared workspace
                </Button>
              </>
            ) : (
              <>
                Workspaces are stored locally in your browser.{" "}
                <Button variant="link" style={{ fontSize: 11 }} onClick={ws.clearWorkspace}>
                  Clear workspace
                </Button>
              </>
            )}
          </div>
        )}

        {selectedInitiative && (
          <InitiativeWorkspace
            initiative={selectedInitiative}
            onBack={() =>
              setRoute(
                selectedInitiative.clientAccountId && ws.accounts.some((a) => a.id === selectedInitiative.clientAccountId)
                  ? { view: "account", id: selectedInitiative.clientAccountId }
                  : { view: "clients" },
              )
            }
            onFactorChange={(key, patch) => ws.updateFactor(selectedInitiative.id, key, patch)}
            onPost={(body) => ws.postMessage(selectedInitiative.id, body, userName)}
            onAskAnalyst={() => ws.askRoiAnalyst(selectedInitiative.id)}
            onSummaryChange={(summary) => ws.setSummary(selectedInitiative.id, summary)}
            onInvite={(personId) => ws.setPackageStatus("initiative", selectedInitiative.id, personId, "invited")}
            onPartAdded={(personId) => ws.setPackageStatus("initiative", selectedInitiative.id, personId, "part_added")}
            onAddTask={(title, ownerName, due, label) => ws.addTask(selectedInitiative.id, title, ownerName, due, label)}
            onTaskStatus={(taskId, status) => ws.setTaskStatus(selectedInitiative.id, taskId, status)}
            onArchive={(archived) => ws.setArchived(selectedInitiative.id, archived)}
            accounts={ws.accounts.map((a) => ({ id: a.id, clientName: a.clientName }))}
            onSetClientAccount={(accountId) => ws.setClientAccount(selectedInitiative.id, accountId)}
            onToggleClientVisible={(taskId) => ws.toggleTaskClientVisible(selectedInitiative.id, taskId)}
          />
        )}

        {selectedIdea && (
          <SandboxWorkspace
            idea={selectedIdea}
            onBack={() => setRoute(ideaHome(selectedIdea))}
            backLabel={ws.accounts.find((a) => a.id === selectedIdea.accountId)?.clientName ?? "Clients"}
            onDelete={() => {
              const home = ideaHome(selectedIdea);
              ws.removeIdea(selectedIdea.id);
              setRoute(home);
            }}
            onUpdate={(patch) => ws.updateIdea(selectedIdea.id, patch)}
            onPost={(body) => ws.postIdeaMessage(selectedIdea.id, body, userName)}
            onAskAnalyst={() => ws.askIdeaAnalyst(selectedIdea.id)}
            onPromote={(type) => {
              const id = ws.promoteIdea(selectedIdea.id, type, userName);
              if (id) setRoute({ view: "initiative", id });
            }}
            onOpenInitiative={(id) => setRoute({ view: "initiative", id })}
            onInvite={(personId) => ws.setPackageStatus("idea", selectedIdea.id, personId, "invited")}
            onPartAdded={(personId) => ws.setPackageStatus("idea", selectedIdea.id, personId, "part_added")}
            onInviteCopilot={() => ws.inviteCopilotIn(selectedIdea.id)}
            onAddMember={(personId) => ws.addTeamMember(selectedIdea.id, personId)}
            onAcceptReview={() => ws.acceptDraftReview(selectedIdea.id)}
            people={ws.availablePeople}
            flags={ws.copilotFlags(selectedIdea)}
          />
        )}

        {selectedAccount && (
          <ClientWorkspace
            account={selectedAccount}
            sharedTasks={ws.sharedTasksFor(selectedAccount.id)}
            userName={userName}
            onBack={() => setRoute({ view: "clients" })}
            onAddTask={(title, ownerName, due, label) => ws.addAccountTask(selectedAccount.id, title, ownerName, due, label)}
            onTaskStatus={(taskId, status) => ws.setSharedTaskStatus(selectedAccount.id, taskId, status)}
            onPost={(body, topic) => ws.postAccountMessage(selectedAccount.id, body, userName, topic)}
            onAddLink={(name, kind, url) => ws.addAccountLink(selectedAccount.id, name, kind, url)}
            onSetLinkUrl={(linkId, url) => ws.setAccountLinkUrl(selectedAccount.id, linkId, url)}
            onRemoveLink={(linkId) => ws.removeAccountLink(selectedAccount.id, linkId)}
            onAddExternal={(name, org, role, access) => ws.addExternal(selectedAccount.id, name, org, role, access, userName)}
            onRemoveExternal={(externalId) => ws.removeExternal(selectedAccount.id, externalId)}
            onOffboardEverywhere={(personName) => ws.offboardEverywhere(personName)}
            onToggleClientVisible={(taskId) => ws.toggleAccountTaskClientVisible(selectedAccount.id, taskId)}
            onRemindDeliverable={(taskId) => ws.remindClientDeliverable(selectedAccount.id, taskId, userName)}
            onTabChange={setClientTab}
            onSetProjectScope={(ids, scoped) => ws.setProjectScope(selectedAccount.id, ids, scoped)}
            onEditPost={(messageId, body) => ws.editAccountPost(selectedAccount.id, messageId, body)}
            onDeletePost={(messageId) => ws.deleteAccountPost(selectedAccount.id, messageId)}
            onSetNotifyPref={(person, pref) => ws.setNotifyPref(selectedAccount.id, person, pref)}
            importCandidates={campaignsFromMirror(
              loadMirror(),
              selectedAccount.clientName,
              AS_OF_TODAY(),
              selectedAccount.kantataProjectIds,
            ).filter((c) => !selectedAccount.campaigns.some((e) => e.name.toLowerCase() === c.name.toLowerCase()))}
            onImportCampaigns={(selected) => ws.importCampaigns(selectedAccount.id, selected)}
            onRemoveCampaign={(campaignId) => ws.removeCampaign(selectedAccount.id, campaignId)}
            onClearCampaigns={() => ws.clearCampaigns(selectedAccount.id)}
            taskCandidates={selectedTaskCandidates}
            onImportTasks={(selected) => ws.importTasks(selectedAccount.id, selected)}
            onImportAll={() => ws.importAllFromKantata(selectedAccount.id)}
            {...(selectedLiveCtx ? { liveContext: selectedLiveCtx } : {})}
            liveDataOn={liveStatus.live}
            linkSuggestions={selectedLinkSuggestions}
            onRelink={(name) => ws.renameAccount(selectedAccount.id, name)}
            onLinkProjects={(ids) => ws.linkProjects(selectedAccount.id, ids)}
            onArchive={() => {
              ws.setAccountArchived(selectedAccount.id, true);
              setRoute({ view: "clients" });
            }}
            onApplyTemplate={(templateKey, startDate) => ws.applyTemplate(selectedAccount.id, templateKey, startDate)}
            people={ws.availablePeople.map((p) => ({ id: p.id, name: p.name, title: p.title }))}
            onAddMember={(personId) => ws.addAccountMember(selectedAccount.id, personId)}
            onAddNewMember={(name, title) => ws.addAccountMemberNamed(selectedAccount.id, name, title)}
            sandboxCount={selectedAccountIdeas.length}
            sandboxContent={
              <Sandbox
                ideas={selectedAccountIdeas}
                clientName={selectedAccount.clientName}
                unclaimed={unclaimedIdeas}
                roster={ws.availablePeople.map((p) => ({ id: p.id, name: p.name, title: p.title }))}
                pastProjects={(selectedLiveCtx?.projects ?? []).slice(0, 8).map((p) => ({
                  title: p.title,
                  ...(selectedLiveCtx?.crm?.vertical ? { vertical: selectedLiveCtx.crm.vertical } : {}),
                }))}
                onClaim={(ideaId) => ws.claimIdea(ideaId, selectedAccount.id)}
                onOpen={(id) => setRoute({ view: "idea", id })}
                onCreate={(title, pitch, aiMode, overrides) =>
                  setRoute({ view: "idea", id: ws.createIdea(title, pitch, aiMode, overrides, selectedAccount.id) })
                }
              />
            }
          />
        )}

        {route.view === "admin" && (
          <FeedbackAdmin feedback={ws.feedback} onBack={() => setRoute({ view: "clients" })} />
        )}

        {route.view === "account" && !selectedAccount && (
          <EmptyState
            icon="🔍"
            title="Client workspace not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
        {route.view === "initiative" && !selectedInitiative && (
          <EmptyState
            icon="🔍"
            title="Build not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
        {route.view === "idea" && !selectedIdea && (
          <EmptyState
            icon="🔍"
            title="Idea not found"
            hint="It may have been removed, or the link is stale."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
        )}
      </div>

      {/* Page-level feedback: always reachable, always about the surface in
          front of you. Hidden while the tour is running so the two feedback
          affordances never compete for the same click. */}
      {tourStep === null && (
        <FeedbackButton
          location={
            route.view === "account"
              ? { view: "account", tab: clientTab, ...(selectedAccount ? { subject: selectedAccount.clientName } : {}) }
              : { view: route.view }
          }
          onSubmit={(entry) =>
            ws.addPageFeedback({ ...entry, personName: userName, personEmail: email ?? "" })
          }
        />
      )}

      {tourStep !== null && (
        <Tour
          steps={TOUR_STEPS}
          step={tourStep}
          onStep={setTourStep}
          onClose={closeTour}
          answers={myAnswers}
          onAnswer={(stepKey, answer) => {
            const s = TOUR_STEPS.find((t) => t.key === stepKey);
            if (!s?.question) return;
            ws.recordFeedback({
              stepKey,
              stepTitle: s.title,
              prompt: s.question.prompt,
              choice: answer.choice,
              choiceLabel: s.question.options.find((o) => o.key === answer.choice)?.label ?? "",
              comment: answer.comment,
              personName: userName,
              personEmail: email ?? "",
            });
          }}
        />
      )}
      {/* Interim email+password accounts only exist while SSO is off. */}
      {!ssoConfigured && (
        <TeamManager open={teamOpen} team={ws.team} onAdd={ws.addSignInAccount} onRemove={ws.removeSignInAccount} onClose={() => setTeamOpen(false)} />
      )}
      {ws.accounts.some((a) => !a.archived) && (
        <DiscussLauncher
          accounts={ws.accounts}
          userName={userName}
          currentAccountId={selectedAccount?.id}
          roster={ws.availablePeople.map((p) => ({ id: p.id, name: p.name, title: p.title }))}
          onPost={(accountId, body, topic) => ws.postAccountMessage(accountId, body, userName, topic)}
          onOpenAccount={(id) => setRoute({ view: "account", id })}
          onAddMember={(accountId, personId) => ws.addAccountMember(accountId, personId)}
        />
      )}
      </>
      )}
    </div>
  );
}
