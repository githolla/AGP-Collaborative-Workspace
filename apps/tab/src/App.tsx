import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "./components/AppHeader.js";
import { InitiativeWorkspace } from "./components/InitiativeWorkspace.js";
import { Sandbox } from "./components/Sandbox.js";
import { SandboxWorkspace } from "./components/SandboxWorkspace.js";
import { SearchBox } from "./components/SearchBox.js";
import { ClientList } from "./components/ClientList.js";
import { DataInspector } from "./components/DataInspector.js";
import { myTaskCount } from "./components/MyTasks.js";
import { MyWork } from "./components/MyWork.js";
import { TeamLoad } from "./components/TeamLoad.js";
import { ClientWorkspace, type ClientTab, type ImportCandidate, type TaskCandidate } from "./components/ClientWorkspace.js";
import { DiscussLauncher } from "./components/DiscussLauncher.js";
import { FeedbackAdmin } from "./components/FeedbackAdmin.js";
import { GraphCheck } from "./components/GraphCheck.js";
import { ExternalWorkspace } from "./components/ExternalWorkspace.js";
import { FeedbackButton } from "./components/FeedbackButton.js";
import { TeamsConfig } from "./components/TeamsConfig.js";
import { Button, EmptyState } from "./components/ui.js";
import { Tour, type TourStep } from "./components/Tour.js";
import { TeamManager } from "./components/TeamManager.js";
import { useWorkspace } from "./workspace/store.js";
import { useProfile } from "./workspace/profile.js";
import { fetchMe, type Me } from "./workspace/meApi.js";
import { clearIdentity, loadIdentity, saveIdentity, type LocalIdentity } from "./auth/localAuth.js";
import { classifyClientTitle, initLiveMirror, refreshLiveMirror, type LiveStatus } from "./workspace/liveMirror.js";
import { initTeams } from "./teams/teamsHost.js";
import { loadMirror } from "./workspace/agpKnowledge.js";
import { accountLiveContext, campaignsFromMirror, suggestClients, taskColumn, taskIsDone } from "./workspace/campaignImport.js";
import { allocationIntent, pendingWrites, pushIntents, resolveStaffId } from "./workspace/kantataWrite.js";
import { weeklyAllocations } from "./workspace/resourcing.js";
import { effectiveHours, reconcileAssignments } from "./workspace/taskAssignments.js";
import { AS_OF_TODAY } from "./workspace/format.js";
import { isAppAdmin, parseAdminAllowlist, viewTierFor } from "./workspace/roles.js";
import type { ClientAccount } from "./workspace/types.js";
import { fetchAccountCollabData, resolveAccountIdByName, toOldTask, type WorkspaceAccountPayload } from "./workspace/msAccountData.js";
import { linkKantataProjects, updateAccount, addMember, addExternal, createAccount } from "./workspace/msPeople.js";
import {
  createTask,
  updateTask,
  setTaskAssignments,
  patchAssignment,
  setAssignmentOrder,
  markTasksSynced as markTasksSyncedCollab,
  importFromKantata,
  removeCampaign as removeCampaignCollab,
  clearCampaigns as clearCampaignsCollab,
  setAccountScope,
  copyInitiativeTask,
  type ImportResult,
} from "./workspace/msTasks.js";
import { createFileApproval, deleteFileApproval, decideFileApproval } from "./workspace/msFileApproval.js";
import { T } from "./theme.js";

/** Same pattern as auth/ssoAuth.ts's local `env()` — Vite bakes VITE_*
 * values into the bundle at build time; anything without that prefix never
 * reaches the browser and must not be read this way. */
function readViteEnv(key: string): string | undefined {
  const meta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return meta[key]?.trim();
}

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
  /**
   * A client workspace. `tab` and `focus` make it DEEP-LINKABLE: a Teams/email
   * message ("Janine is over-booked — adjust these tasks") can drop the person
   * straight on the Project Plan with the exact task highlighted and its hours
   * field focused, instead of the app's front door. See taskDeepLink().
   */
  | { view: "account"; id: string; tab?: ClientTab; focus?: string }
  /** Tour-feedback admin. Deliberately unlinked — reachable by URL only. */
  | { view: "admin" }
  /** Teams' own tab-setup screen. Teams opens it; people never navigate here. */
  | { view: "teams-config" };

function parseHash(): Route {
  const hash = window.location.hash;
  if (/^#admin\/feedback$/.test(hash)) return { view: "admin" };
  if (/^#teams-config$/.test(hash)) return { view: "teams-config" };
  const initiative = hash.match(/^#i\/(.+)$/);
  if (initiative?.[1]) return { view: "initiative", id: initiative[1] };
  const idea = hash.match(/^#s\/(.+)$/);
  if (idea?.[1]) return { view: "idea", id: idea[1] };
  // #c/<id>  ·  #c/<id>/<tab>  ·  #c/<id>/<tab>/<taskId>  — ids carry no slash.
  const account = hash.match(/^#c\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/);
  if (account?.[1]) {
    const tab = account[2] as ClientTab | undefined;
    return {
      view: "account",
      id: account[1],
      ...(tab ? { tab } : {}),
      ...(account[3] ? { focus: account[3] } : {}),
    };
  }
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
      return `c/${route.id}${route.tab ? `/${route.tab}` : ""}${route.focus ? `/${route.focus}` : ""}`;
    case "admin":
      return "admin/feedback";
    case "teams-config":
      return "teams-config";
    default:
      return "";
  }
}

/**
 * The canonical deep link to one task's hours on the Project Plan — the URL a
 * Teams/email exception message points at so the person lands exactly where
 * they need to adjust. Absolute so it works from outside the app.
 */
export function taskDeepLink(origin: string, accountId: string, taskId: string): string {
  return `${origin.replace(/\/+$/, "")}/#c/${accountId}/resourcing/${taskId}`;
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
    body: "“Who's collaborating” is who's actually assigned open work right now — the people owning live Kantata tasks, with their role — and “Working on” is the real projects those tasks sit under (the milestones inside a fiscal-year contract, not the contract itself). It's the working picture, not the whole roster booked on the year.",
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
    title: "A handover record for every contractor",
    quote: { text: "Removing a user revokes access across the workspace immediately.", from: "Cara — features doc, a Must" },
    body: "One card per person: what they were sent, when and by whom, whether they've opened it, and the work still assigned to them. When they're done, the card lists exactly what to revoke and what to reassign — then does it in one click. Revoking never deletes the record, so “what did this contractor ever have” is answerable a year later.",
    question: {
      prompt: "Does this answer what you need to know when a contractor finishes?",
      options: [
        { key: "a", label: "Yes — that's the whole picture" },
        { key: "b", label: "Nearly — something's missing" },
        { key: "c", label: "No — this isn't what I'd check" },
      ],
      placeholder: "What else would you need to see before signing them off? (optional)",
    },
  },
  {
    key: "resourcing",
    route: "",
    title: "Resourcing that keeps itself current",
    quote: { text: "As soon as that timeline shifts, that initial resourcing is now outdated… is there a way to keep our resourcing up to date as timelines shift?", from: "Kellie — on the resourcing pain" },
    body: "Inside a client, the Resourcing tab pulls the scheduled hours your team already put in Kantata — you just validate or fine-tune them, never re-type. It spreads each task's hours across its dates into a week-by-week view per person, so you see where the work piles up. When a timeline moves, it re-figures on its own — no expand-all-and-redistribute every Thursday — then sends the weekly reservations back to Kantata. Setting who's overloaded down stays a higher-level call; this just keeps the numbers honest.",
    question: {
      prompt: "Would this keep your weekly resourcing current as timelines shift?",
      options: [
        { key: "a", label: "Yes — this saves the weekly redo" },
        { key: "b", label: "Partly — I'd still tweak a lot" },
        { key: "c", label: "No — this doesn't fit how we resource" },
      ],
      placeholder: "What would have to be true to trust these numbers into Kantata? (optional)",
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
  // Teams opens the tab-setup screen in its own small dialog. Rendering the
  // whole workspace behind it would be noise, so this returns early.
  if (parseHash().view === "teams-config") return <TeamsConfig />;
  return <IdentityGate />;
}

/**
 * C1 (teams-provisioning-plan.md): "Identity class decides the shell after
 * authentication... resolved from app_user and external_link, not from the
 * account's domain." This is that gate, and the reason it has to exist
 * ABOVE `Workspace()` rather than as a branch inside it: `Workspace()` calls
 * `useWorkspace()` unconditionally at its own top, which fetches the whole
 * internal JSON document (`/api/state` — every ROI initiative, idea, and
 * financial figure in the workspace) the instant it mounts, with no
 * per-caller filtering at all. Mounting `Workspace()` for an external even
 * for one render would already have fetched that document into their
 * browser — the leak C2 exists to prevent happens at the FETCH, not the
 * render, so the classification has to happen before `Workspace()` is ever
 * reached, not inside it.
 *
 * FAILS OPEN TO INTERNAL, deliberately, in every case except an EXPLICIT
 * "external" answer from the server: no collab schema in this environment,
 * a network error, or the classification still loading all render nothing
 * of the internal app while pending, then fall through to it once resolved
 * unless the server said "external". This matches today's status quo for
 * every session that isn't external (no regression) while adding real
 * protection the moment a real external identity is confirmed — a stricter
 * "fail closed always" would lock out every internal AGP user whenever this
 * one endpoint hiccups, which is a worse regression than the gap being closed.
 *
 * Never applies to the interim local email+password identity
 * (`!ssoConfigured`): that path predates the collab schema entirely and has
 * no `app_user`/`external_link` row to classify — it stays on the existing
 * internal path unchanged, exactly as it already was.
 */
function IdentityGate() {
  const { signedIn: ssoSignedIn, email: ssoEmail, ssoConfigured, signOut: ssoSignOut } = useProfile();
  const [localId] = useState<LocalIdentity | null>(() => loadIdentity());
  const signedIn = ssoConfigured ? ssoSignedIn : ssoSignedIn || localId != null;
  const needsClassification = ssoConfigured && signedIn;

  // `me` and the EXACT needsClassification value it was resolved for are
  // tracked together, so "is classification still pending for THIS render"
  // can be derived live, on the very same render `needsClassification`
  // flips to true — never through a separately-updated boolean flag, which
  // would still be one render behind (confirmed real bug: `classifying`
  // seeded once via `useState(needsClassification)` only reflects the FIRST
  // render's value; when `useProfile()`'s own signedIn resolves
  // asynchronously — the normal path for a first-time sign-in with no
  // cached local identity — `needsClassification` can flip false→true
  // across renders while the stale `classifying` flag hasn't caught up yet,
  // letting `<Workspace/>` mount, and its unconditional `/api/state` fetch
  // fire, for one or more renders before classification even starts).
  const [meResult, setMeResult] = useState<{ resolvedFor: boolean; me: Me | null }>({ resolvedFor: false, me: null });

  useEffect(() => {
    if (!needsClassification) {
      setMeResult({ resolvedFor: false, me: null });
      return;
    }
    let live = true;
    fetchMe()
      .then((result) => {
        if (live) setMeResult({ resolvedFor: true, me: result });
      })
      .catch(() => {
        if (live) setMeResult({ resolvedFor: true, me: null });
      });
    return () => {
      live = false;
    };
  }, [needsClassification]);

  const stillClassifying = needsClassification && meResult.resolvedFor !== needsClassification;
  const me = meResult.me;

  if (stillClassifying) {
    return <div style={{ padding: 60, textAlign: "center", color: T.inkMuted, fontSize: 13 }}>Loading…</div>;
  }

  if (needsClassification && me?.kind === "external") {
    return <ExternalWorkspace me={me} {...(ssoEmail ? { loginHintEmail: ssoEmail } : {})} onSignOut={ssoSignOut} />;
  }

  return <Workspace />;
}

function Workspace() {
  const ws = useWorkspace();
  const { name: userName, setName, signedIn: ssoSignedIn, email: ssoEmail, ssoConfigured, signIn, signOut: ssoSignOut } = useProfile();
  // Interim email+password identity (until Microsoft SSO). Persisted per-browser.
  const [localId, setLocalId] = useState<LocalIdentity | null>(() => loadIdentity());
  const [teamOpen, setTeamOpen] = useState(false);
  const signedIn = ssoConfigured ? ssoSignedIn : ssoSignedIn || localId != null;
  const email = ssoConfigured ? ssoEmail : localId?.email ?? ssoEmail;
  // App admin (teams-provisioning-plan.md D1/D2): bootstrapped from a
  // build-time allowlist, never editable in the app. HONEST LIMITATION: this
  // is presentation-layer only — it hides #admin and "Clear workspace" from
  // a normal signed-in user, but nothing server-side checks it yet (that is
  // B6's job). Do not treat this as the security boundary.
  const appAdminAllowlist = useMemo(() => parseAdminAllowlist(readViteEnv("VITE_APP_ADMIN_EMAILS")), []);
  const amIAppAdmin = isAppAdmin(email ?? undefined, appAdminAllowlist);
  // Whoever creates a workspace becomes its first workspace admin (D2) — but
  // only once we actually know who they are; without an email there is
  // nothing to match a later signed-in session against, so the workspace is
  // created admin-less rather than seeded with an unusable row.
  const creatorInfo = email ? { name: userName || email, title: "AGP team", email } : undefined;
  // Resourcing is AGP-internal. Show it to AGP people only — a client looped
  // into a workspace shouldn't see it unless AGP decides to. No email yet
  // (interim local sign-in, pilot is all-AGP) counts as internal.
  const viewerIsInternal = !email || /@teamallegiance\.com$/i.test(email);

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
  // Teams shows a spinner until the embedded page says it's ready, so this
  // has to run on mount. In a browser it resolves immediately, having loaded
  // nothing.
  // Called for its side effect, not its answer: Teams keeps showing its own
  // loading state until the embedded page initializes and reports success.
  // Nothing in the UI branches on being inside Teams — the tab is the same
  // workspace — so there is no state to hold here.
  useEffect(() => {
    void initTeams();
  }, []);

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
  // Per-workspace deepen guard (declared here so the auto-refresh below can
  // clear it). Cleared on each background refresh so the open workspace re-loads
  // its full tree against the fresh pull.
  const deepenedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    void initLiveMirror(setLiveStatus);
    // Keep data current on its own — no manual refresh. Re-pull from Kantata
    // every 5 minutes (matches the server cache).
    const id = setInterval(() => {
      deepenedRef.current = new Set();
      void refreshLiveMirror(setLiveStatus);
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-populate on open: the moment a live client workspace is opened, fill
  // it from Kantata's full task tree — no button, no "Import everything".
  // ensureAutoPopulated runs the deepen + import once per workspace and marks
  // it done; the ref guards against firing twice while that first call is in
  // flight. This is what makes EVERY client populate, not just the ones the
  // user happens to click through.
  const autoTriedRef = useRef<Set<string>>(new Set());
  // Bumped when a deepen finishes, to recompute the live context (which reads
  // the module-level mirror the deepen just enriched) — a plain re-render.
  const [, setDeepTick] = useState(0);
  useEffect(() => {
    if (!liveStatus.live || route.view !== "account") return;
    const acct = ws.accounts.find((a) => a.id === route.id);
    if (!acct || acct.archived) return;
    // ALWAYS load the workspace's full Kantata tree on open — this is what
    // gives task→project resolution the milestones it needs, and a tenant-wide
    // refresh drops them, so an already-populated workspace still needs it.
    // Guarded once per session per account; a manual refresh clears the guard.
    if (!deepenedRef.current.has(acct.id)) {
      deepenedRef.current.add(acct.id);
      void ws.ensureDeepened(acct.id).then((n) => { if (n > 0) setDeepTick((t) => t + 1); });
    }
    // Import from Kantata only ONCE (never re-adds work the user removed).
    if (acct.autoPopulated || autoTriedRef.current.has(acct.id)) return;
    autoTriedRef.current.add(acct.id);
    void ws.ensureAutoPopulated(acct.id);
    // Keyed on the open account and the live flag — reopening after the live
    // mirror arrives retries a workspace that had nothing to match before.
  }, [route, liveStatus.live, ws.accounts, ws.ensureAutoPopulated, ws.ensureDeepened]);

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

  // JSON-document migration (docs/api-spec-workspace-mutations.md): the
  // selected account's real Postgres id, bridged by matching clientName (no
  // shared id between the two account universes — same pattern
  // ClientAdminTab/store.ts's bridgeKantataProjectIds already use), plus its
  // live tasks/campaigns/thread/etc. Resolved once here rather than inside
  // ClientWorkspace, because the Kantata-mirror enrichment pass below
  // (`byStory`/`byTitleDue`) and the write-back queue both need the SAME
  // Postgres task list this produces — not a second, disconnected copy of it.
  const [collabAccountId, setCollabAccountId] = useState<string | null>(null);
  const [collabData, setCollabData] = useState<WorkspaceAccountPayload | null>(null);
  // Always the LATEST collabAccountId, read after an in-flight fetch
  // resolves — a plain closure over the state would still hold whatever id
  // was current when reloadCollabData was CALLED, not whichever is current
  // when it RESOLVES, letting a switch to a different account mid-reload
  // have its stale response land anyway.
  const collabAccountIdRef = useRef(collabAccountId);
  useEffect(() => {
    collabAccountIdRef.current = collabAccountId;
  }, [collabAccountId]);

  const reloadCollabData = useCallback(async () => {
    const id = collabAccountId;
    if (!id) return;
    try {
      const data = await fetchAccountCollabData(id);
      // Discard a reload that was still in flight when the person switched
      // to a different account — applying it now would show account B
      // selected while briefly rendering account A's tasks/thread/campaigns.
      if (collabAccountIdRef.current === id) setCollabData(data);
    } catch {
      // A transient read failure leaves the last-known collabData in place
      // rather than blanking the plan/campaigns out from under the person
      // looking at it — the next successful reload (the next mutation, or a
      // clientName change) replaces it.
    }
  }, [collabAccountId]);

  // Set whenever resolving/fetching the collab account fails after this
  // effect starts — lets ClientAdminTab tell "still resolving" (wait for
  // collabData) apart from "the parent's own attempt failed" (fall back to
  // its own resolve() instead of showing a permanent spinner).
  const [collabDataError, setCollabDataError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCollabAccountId(null);
    setCollabData(null);
    setCollabDataError(false);
    if (!selectedAccount) return;
    const acct = selectedAccount;
    (async () => {
      let id = await resolveAccountIdByName(acct.clientName);
      // Zero-setup: a workspace that has Kantata work but no Client Admin record
      // yet gets one created automatically on open — so nobody has to click
      // "Create Client Admin record" before anything works, and auto-import can
      // then fill it. Best-effort: if creation fails, the Admin tab still offers
      // the manual button. Only for workspaces with linked Kantata projects, so
      // we don't mint empty records for demo/placeholder names.
      // Never auto-create for an archived workspace (a stale deep link, or
      // restore-then-open) — that would resurrect and re-populate a client that
      // was deliberately archived.
      if (!id && !acct.archived && (acct.kantataProjectIds?.length ?? 0) > 0) {
        try {
          await createAccount(acct.clientName);
          id = await resolveAccountIdByName(acct.clientName);
        } catch { /* leave id null — manual "Create Client Admin record" remains */ }
      }
      if (cancelled || !id) return;
      setCollabAccountId(id);
      const data = await fetchAccountCollabData(id);
      if (!cancelled) setCollabData(data);
    })().catch(() => {
      if (!cancelled) setCollabDataError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedAccount?.clientName]);

  // Re-run the same resolve+fetch the effect above does, on demand — for
  // "a collab account was just created for this client, but its clientName
  // hasn't changed so the effect above won't re-fire on its own" (the
  // Admin tab's "Create Client Admin record" button).
  async function reResolveCollabAccount() {
    if (!selectedAccount) return;
    try {
      const id = await resolveAccountIdByName(selectedAccount.clientName);
      if (!id) return;
      setCollabAccountId(id);
      setCollabDataError(false);
      const data = await fetchAccountCollabData(id);
      setCollabData(data);
    } catch {
      setCollabDataError(true);
    }
  }

  // Workspaces pointing at names that don't exist in the live book (demo
  // leftovers, misspellings) — badged on the Clients list.
  // Debug surfaces (the Kantata Data Inspector) are OFF in the front office —
  // opt in with ?debug in the URL or localStorage agp-debug=1.
  const debugMode = typeof window !== "undefined" && (window.localStorage.getItem("agp-debug") === "1" || /[?&#]debug\b/.test(window.location.href));

  // Landing sub-view: the client directory, or the personal cross-client task
  // list (the spec's "My Tasks" home). Local — not a deep-linked route.
  const [landingTab, setLandingTab] = useState<"workspaces" | "mytasks" | "teamload">("workspaces");
  const myTasksTotal = useMemo(() => myTaskCount(ws.accounts, userName), [ws.accounts, userName]);

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
      // Who's collaborating — the people actually assigned OPEN work, not
      // everyone booked on the fiscal-year contract. Kellie's feedback: the
      // participant roster on a year-long workspace "doesn't really mean
      // anything to the team members working on it." So the working picture is
      // who owns live tasks; only when nothing is assigned do we fall back to
      // the participant list rather than show an empty row.
      const activeAssignees = [
        ...new Set(
          ctx.projects
            .flatMap((p) => p.tasks)
            .filter((t) => !taskIsDone(t.state))
            .flatMap((t) => t.assignees ?? []),
        ),
      ];
      const teamNames = activeAssignees.length > 0 ? activeAssignees : [...new Set(ctx.projects.flatMap((p) => p.team ?? []))];
      const collaborators = teamNames.map((n) => ({ name: n, role: staffTitle.get(n) ?? "" }));
      // What they're working on — the real projects with OPEN work. At AGP
      // those are the Kantata milestones inside the fiscal-year workspace, so
      // "on what" should read "November CYE I Appeal", not "CWS: FY27". Fall
      // back to campaign names only when no task carries a project label.
      const activeProjects = [
        ...new Set(
          ctx.projects
            .flatMap((p) => p.tasks)
            .filter((t) => !taskIsDone(t.state))
            .map((t) => t.projectLabel)
            .filter((l): l is string => !!l),
        ),
      ];
      const areas =
        activeProjects.length > 0
          ? activeProjects
          : [
              ...new Set(
                campaignsFromMirror(mirror, name, today, account?.kantataProjectIds)
                  .filter((c) => c.status !== "complete")
                  .map((c) => c.name),
              ),
            ];
      // Most-recent collaboration on this client — LIVE (Kantata posts + last
      // time entry). The workspace thread/activity used to feed this too, but
      // both moved to Postgres (collab.thread_message/activity) per-account,
      // not bulk-fetched for this whole-directory computation — the OLD
      // `account.thread`/`account.activity` arrays are frozen at whatever
      // they held before the migration, so including them here would make a
      // long-migrated account look falsely fresh (or falsely stale) forever.
      // Dropped rather than left stale; a real fix needs a bulk collab read
      // across every account, not just the selected one.
      const max = (arr: (string | undefined)[]) => arr.filter((x): x is string => !!x).sort().pop();
      const lastCollab = max([...ctx.posts.map((p) => p.createdAt), ...ctx.projects.map((p) => p.lastEntryDate)]);
      // …and the freshest collaboration by THIS person specifically (a
      // Kantata post/entry under their name) — same reasoning, own-account
      // thread posts dropped for the same staleness reason.
      const myLastCollab = max([...ctx.posts.filter((p) => p.author === userName).map((p) => p.createdAt)]);
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
          // Already imported? Match on Kantata story id, not title — identical
          // phase names repeat across every milestone in a fiscal-year
          // contract, so a title match would hide real, un-imported tasks.
          .filter((t) =>
            !(collabData?.tasks ?? []).some((e) =>
              e.kantataStoryId ? e.kantataStoryId === t.id : e.title.toLowerCase() === t.title.toLowerCase(),
            ),
          )
          .map((t) => ({
            title: t.title,
            status: taskColumn(t.state),
            ...(t.dueDate ? { due: t.dueDate } : {}),
            project: p.title,
            kantataStoryId: t.id,
            kantataProjectId: t.projectId,
            ...(t.projectLabel ? { projectLabel: t.projectLabel } : {}),
            ...(t.phaseLabel ? { phaseLabel: t.phaseLabel } : {}),
            ...(t.phaseId ? { phaseId: t.phaseId } : {}),
            ...(t.milestoneId ? { kantataMilestoneId: t.milestoneId } : {}),
            ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
            ...(t.startDate ? { startDate: t.startDate } : {}),
            ...(t.assignees && t.assignees.length > 0 ? { assignees: t.assignees } : {}),
          })),
      )
    : [];

  // Auto-import — a workspace should never open empty (Kellie: "there was
  // nothing this morning"). When a workspace that HAS a Client Admin record and
  // linked Kantata work shows zero imported tasks, pull everything in
  // automatically instead of making someone click "Review import." Fires once
  // per account per session (the ref guards re-entry across the async gap and
  // re-renders); the moment tasks land, the empty-guard stops it, so it never
  // loops or re-imports a populated workspace. Review import stays for
  // selective top-ups.
  const autoImportedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const id = collabAccountId;
    if (!id || !collabData) return;
    if (collabData.tasks.length > 0) return; // already populated — leave it alone
    if (autoImportedRef.current.has(id)) return; // already auto-imported this session
    if (selectedTaskCandidates.length === 0) return; // nothing to pull (or mirror still loading)
    autoImportedRef.current.add(id);
    void handleImportAll();
  }, [collabAccountId, collabData, selectedTaskCandidates]);

  // Backfill the project (milestone) label onto tasks that were imported before
  // the label existed, so existing workspaces group by project without anyone
  // re-importing. Two ways to match a stored task to its live Kantata story:
  //   1. By story id — for tasks imported since the id link landed.
  //   2. By title + due date — for OLDER tasks with no stored story id. Due
  //      date is what disambiguates the repeated phase names ("Copywriting
  //      (Base)" under every job): Kellie's own point is that the dates are
  //      staggered per job, so title+date is unique where title alone isn't.
  //      A title+date that matches more than one live story is left unlabeled
  //      rather than guessed. When this path hits, we also fill in the missing
  //      story id, so the write-back can reach the task later too.
  // Carries the project label AND the Kantata-sourced resourcing fields
  // (scheduled hours, start date) so both flow onto stored tasks without
  // re-entry. Indexed on EVERY live task, not just labelled ones, so an
  // hours-only match still lands.
  type LiveRef = { storyId: string; label?: string; milestoneId?: string; phaseLabel?: string; phaseId?: string; estimatedHours?: number; startDate?: string; assignees?: string[] };
  const byStory = new Map<string, LiveRef>();
  const byTitleDue = new Map<string, LiveRef | null>(); // null = ambiguous
  if (selectedLiveCtx) {
    for (const p of selectedLiveCtx.projects) {
      for (const t of p.tasks) {
        const ref: LiveRef = {
          storyId: t.id,
          ...(t.projectLabel ? { label: t.projectLabel } : {}),
          ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
          ...(t.phaseLabel ? { phaseLabel: t.phaseLabel } : {}),
          ...(t.phaseId ? { phaseId: t.phaseId } : {}),
          ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
          ...(t.startDate ? { startDate: t.startDate } : {}),
          ...(t.assignees && t.assignees.length > 0 ? { assignees: t.assignees } : {}),
        };
        byStory.set(t.id, ref);
        const key = `${t.title.toLowerCase()}|${t.dueDate ?? ""}`;
        byTitleDue.set(key, byTitleDue.has(key) ? null : ref);
      }
    }
  }
  // Own tasks now come from collab.task (already carrying project/phase
  // labels, hours and assignments from the Kantata import job itself, so the
  // enrichment pass below mostly no-ops for them) — only the "shared from an
  // internal build" half (docs' own deferred "copy at share time" case,
  // Phase 7) still comes from ws.sharedTasksFor's JSON-document side.
  const collabSharedTasks = (collabData?.tasks ?? []).map((t) => ({ task: toOldTask(t), fromInternal: false as const }));
  const mirroredSharedTasks = selectedAccount ? ws.sharedTasksFor(selectedAccount.id).filter((e) => e.fromInternal) : [];
  const enrichedSharedTasks = selectedAccount
    ? [...collabSharedTasks, ...mirroredSharedTasks].map((entry) => {
        const task = entry.task;
        const ref =
          (task.kantataStoryId ? byStory.get(task.kantataStoryId) : undefined) ??
          byTitleDue.get(`${task.title.toLowerCase()}|${task.due ?? ""}`) ??
          undefined;
        if (!ref) return entry;
        // Fill only what's MISSING — a PM's own hours edit always wins over the
        // Kantata pull; the pull just seeds the value so nobody re-types it.
        const patched = {
          ...task,
          ...(!task.projectLabel && ref.label ? { projectLabel: ref.label } : {}),
          ...(!task.phaseLabel && ref.phaseLabel ? { phaseLabel: ref.phaseLabel } : {}),
          ...(!task.phaseId && ref.phaseId ? { phaseId: ref.phaseId } : {}),
          ...(!task.kantataMilestoneId && ref.milestoneId ? { kantataMilestoneId: ref.milestoneId } : {}),
          ...(!task.kantataStoryId ? { kantataStoryId: ref.storyId } : {}),
          ...(task.estimatedHours == null && ref.estimatedHours != null ? { estimatedHours: ref.estimatedHours } : {}),
          ...(!task.startDate && ref.startDate ? { startDate: ref.startDate } : {}),
          // Seed the team from Kantata's assignees for display on the task card —
          // only when the PM hasn't already set up the split (persisted
          // assignments always win). Single assignee just fills ownerName.
          ...(!task.assignments && ref.assignees && ref.assignees.length > 1
            ? { assignments: reconcileAssignments([], ref.assignees) }
            : {}),
          ...(!task.assignments && !task.ownerName && ref.assignees && ref.assignees.length === 1
            ? { ownerName: ref.assignees[0]! }
            : {}),
        };
        return { ...entry, task: patched };
      })
    : [];

  // The write-back's review queue: workspace task edits Kantata hasn't got.
  // Computed from the same mirror the workspace reads, so the diff shown is
  // against what Kantata last told us — never against a stale local guess.
  const pendingKantataWrites =
    selectedAccount && selectedLiveCtx && liveStatus.live
      ? pendingWrites((collabData?.tasks ?? []).map(toOldTask), selectedLiveCtx.projects, loadMirror().staff ?? [])
      : [];

  // Task/campaign mutations against collab.task/collab.campaign
  // (docs/api-spec-workspace-mutations.md) — the JSON-document migration's
  // Tasks/Plan/Resourcing phase. A task-id action that doesn't match a
  // collab.task row (the "shared from an internal build" half, still
  // JSON-document-backed) silently no-ops here, same as the OLD
  // ws.setAccountTask*/ws.toggleAccountTask* calls already did for that half
  // — this isn't a new gap, just the same one carried forward — EXCEPT
  // status, which already had real cross-model routing (ws.setSharedTaskStatus)
  // and keeps it.
  function findCollabTask(taskId: string) {
    return collabData?.tasks.find((t) => t.id === taskId);
  }
  const [taskError, setTaskError] = useState<string | null>(null);
  // Every mutation below funnels through this: run it, reload so the UI
  // reflects whatever the server actually has (not what was optimistically
  // assumed), and surface a failure instead of letting it vanish as an
  // unhandled rejection — updateTask's own doc comment promises a conflict
  // "reloads and retries", which only happens if something actually catches
  // it. Also the one place all 17 of these handlers' near-identical
  // guard/call/reload shape is written once instead of copied per handler.
  async function runCollabMutation(fn: () => Promise<unknown>) {
    try {
      await fn();
      setTaskError(null);
    } catch (e) {
      setTaskError(e instanceof Error ? e.message : "That change didn't save — reloading the latest data.");
    } finally {
      await reloadCollabData();
    }
  }
  async function handleAddTask(title: string, ownerName?: string, due?: string, label?: string) {
    if (!collabAccountId) return;
    await runCollabMutation(() => createTask(collabAccountId, title, ownerName, due, label));
  }
  async function handleTaskStatus(taskId: string, status: "todo" | "doing" | "done") {
    const t = findCollabTask(taskId);
    if (t) {
      await runCollabMutation(() => updateTask(taskId, { status }, t.updatedAt));
    } else if (selectedAccount) {
      ws.setSharedTaskStatus(selectedAccount.id, taskId, status);
    }
  }
  async function handleSetTaskHours(taskId: string, hours: number | undefined) {
    const t = findCollabTask(taskId);
    if (!t) return;
    await runCollabMutation(() => updateTask(taskId, { estimatedHours: hours ?? null }, t.updatedAt));
  }
  async function handleSetTaskDependencies(taskId: string, dependsOn: string[]) {
    const t = findCollabTask(taskId);
    if (!t) return;
    await runCollabMutation(() => updateTask(taskId, { dependsOn }, t.updatedAt));
  }
  async function handleToggleTaskClientVisible(taskId: string) {
    const t = findCollabTask(taskId);
    if (!t) return;
    await runCollabMutation(() => updateTask(taskId, { clientVisible: !t.clientVisible }, t.updatedAt));
  }
  async function handleToggleTaskContractorVisible(taskId: string) {
    const t = findCollabTask(taskId);
    if (!t) return;
    await runCollabMutation(() => updateTask(taskId, { contractorVisible: !t.contractorVisible }, t.updatedAt));
  }
  async function handleSetTaskAssignments(taskId: string, names: string[]) {
    if (!findCollabTask(taskId)) return;
    await runCollabMutation(() => setTaskAssignments(taskId, names));
  }
  async function handleSetAssignmentHours(taskId: string, name: string, hours: number | undefined) {
    if (!findCollabTask(taskId)) return;
    await runCollabMutation(() => patchAssignment(taskId, name, { hours: hours ?? null }));
  }
  async function handleToggleAssignmentDone(taskId: string, name: string, done: boolean) {
    if (!findCollabTask(taskId)) return;
    await runCollabMutation(() => patchAssignment(taskId, name, { done }));
  }
  async function handleSetAssignmentPrimary(taskId: string, name: string) {
    if (!findCollabTask(taskId)) return;
    await runCollabMutation(() => patchAssignment(taskId, name, { primary: true }));
  }
  async function handleSetAssignmentOrder(taskId: string, orderedNames: string[]) {
    if (!findCollabTask(taskId)) return;
    await runCollabMutation(() => setAssignmentOrder(taskId, orderedNames));
  }
  // POST /api/account-import hard-requires collab.client_account.
  // kantata_project_ids to be populated (it refuses to fuzzy-match the wider
  // tenant, by design) — but nothing keeps that column synced with the OLD
  // model's own kantataProjectIds/scopedToProjects except store.ts's
  // bridgeKantataProjectIds, which only the now-bypassed
  // ws.importAllFromKantata/importCampaigns ever called. Without this,
  // import would silently do nothing for any account not ALSO configured
  // by hand through the Admin tab's separate "linked Kantata projects"
  // field. Cheap and idempotent (a plain overwrite), so it's just re-run
  // before every import rather than tracked as a one-time migration step.
  async function ensureKantataProjectsLinked() {
    if (!collabAccountId || !selectedAccount) return;
    const ids = selectedAccount.kantataProjectIds ?? [];
    if (ids.length === 0) return;
    try {
      await linkKantataProjects(collabAccountId, ids);
    } catch {
      // Best-effort, same "never break the import it's attached to" rule
      // bridgeKantataProjectIds itself documents.
    }
  }
  // Import's own success/failure isn't just thrown-or-not: a 200 response
  // can still mean "0 added, here's why" (no linked projects, nothing new
  // found) — runCollabMutation alone would report that as a silent success.
  async function runImport(fn: () => Promise<ImportResult>) {
    try {
      const result = await fn();
      const nothingLanded = result.campaignsAdded === 0 && result.campaignsUpdated === 0 && result.tasksAdded === 0;
      setTaskError(result.note ?? (nothingLanded ? "Nothing new to import." : null));
    } catch (e) {
      setTaskError(e instanceof Error ? e.message : "Import failed — reloading the latest data.");
    } finally {
      await reloadCollabData();
    }
  }
  async function handleImportAll() {
    if (!collabAccountId) return;
    await ensureKantataProjectsLinked();
    await runImport(() => importFromKantata(collabAccountId, "all"));
  }
  async function handleImportCampaigns(selected: ImportCandidate[]) {
    if (!collabAccountId) return;
    await ensureKantataProjectsLinked();
    const campaignProjectIds = selected.map((c) => c.kantataProjectId).filter((x): x is string => !!x);
    await runImport(() => importFromKantata(collabAccountId, "campaigns", { campaignProjectIds }));
  }
  async function handleImportTasks(selected: TaskCandidate[]) {
    if (!collabAccountId) return;
    await ensureKantataProjectsLinked();
    const taskStoryIds = selected.map((t) => t.kantataStoryId).filter((x): x is string => !!x);
    await runImport(() => importFromKantata(collabAccountId, "tasks", { taskStoryIds }));
  }
  async function handleRemoveCampaign(campaignId: string) {
    if (!collabAccountId) return;
    await runCollabMutation(() => removeCampaignCollab(collabAccountId, campaignId));
  }
  async function handleClearCampaigns() {
    if (!collabAccountId) return;
    await runCollabMutation(() => clearCampaignsCollab(collabAccountId));
  }

  // Files & approvals (docs/api-spec-workspace-mutations.md) — the OLD
  // ClientFileLink/clientShare model is retired outright, not dual-written:
  // "the folder IS the file list" (B7), so there's no app-side file
  // inventory left to keep in sync.
  async function handleShareFile(msItemId: string, name: string, purpose: "fyi" | "approval") {
    if (!collabAccountId) return;
    await runCollabMutation(() => createFileApproval(collabAccountId, msItemId, name, purpose));
  }
  async function handleUnshareFile(approvalId: string) {
    await runCollabMutation(() => deleteFileApproval(approvalId));
  }
  async function handleDecideFileApproval(approvalId: string, decision: "approved" | "changes", note?: string) {
    await runCollabMutation(() => decideFileApproval(approvalId, decision, note));
  }

  // CollaborateHub's inline quick-add (unlike rename/archive/scope, this was
  // never dual-written) — was still writing only to the OLD JSON model,
  // silently out of sync with the real, Postgres-backed Access tab roster.
  // Unified onto the same collab endpoints Access already uses; the
  // header's "on this account" list and count are now sourced from
  // `collabData.members`/`collabData.externals` too (ClientWorkspace.tsx).
  async function handleAddAccountMember(personId: string) {
    if (!collabAccountId) return;
    const person = ws.availablePeople.find((p) => p.id === personId);
    if (!person) return;
    await runCollabMutation(() => addMember(collabAccountId, person.name, { title: person.title, personId }));
  }
  async function handleAddNewAccountMember(name: string, title: string) {
    if (!collabAccountId) return;
    await runCollabMutation(() => addMember(collabAccountId, name, title ? { title } : {}));
  }
  async function handleAddAccountExternal(name: string, org: string, role: "client" | "contractor") {
    if (!collabAccountId) return;
    await runCollabMutation(() => addExternal(collabAccountId, name, org, role));
  }

  // The initiative->task bridge (docs/api-spec-workspace-mutations.md "the
  // one place the two stores meet"): flagging a build/initiative task
  // client-visible COPIES it into a real collab.task row instead of live-
  // projecting the JSON document onto a surface an external can reach.
  // Un-flagging does NOT retract the copy — once shared, it's an
  // independent record, same "record, not a live link" rule Share/
  // file-approval already follow elsewhere in this migration.
  async function handleToggleInitiativeTaskClientVisible(taskId: string) {
    if (!selectedInitiative) return;
    const task = selectedInitiative.tasks.find((t) => t.id === taskId);
    const wasVisible = task?.clientVisible ?? false;
    ws.toggleTaskClientVisible(selectedInitiative.id, taskId);
    if (!task || wasVisible || !selectedInitiative.clientAccountId) return;
    const account = ws.accounts.find((a) => a.id === selectedInitiative.clientAccountId);
    if (!account) return;
    try {
      const targetAccountId = await resolveAccountIdByName(account.clientName);
      if (!targetAccountId) return;
      await copyInitiativeTask(targetAccountId, selectedInitiative.id, task.id, task.title, task.ownerName, task.due, task.label);
      if (targetAccountId === collabAccountId) await reloadCollabData();
    } catch {
      // Best-effort — the internal flag already flipped either way, and
      // staff can always re-flag it later to retry the copy.
    }
  }

  // Account lifecycle (docs/api-spec-workspace-mutations.md) — rename/
  // archive/scope/link-projects. clientName is dual-written: the OLD model
  // stays the thing almost every screen displays (Crumbs, tab titles, the
  // Clients list) AND is the only side of the clientName bridge every
  // Postgres lookup this migration built (resolveAccountIdByName) matches
  // against — if only the Postgres copy changed, the very next resolve
  // would find zero accounts named what the UI still shows, breaking
  // Discussions/Tasks/Admin for this account outright, not just going
  // stale. `archived` is dual-written for a narrower reason: the Clients
  // list's archived view (App.tsx's `archivedAccounts`) still filters on
  // the OLD model's own flag — untouched by this migration so far.
  async function handleRelink(name: string) {
    if (!selectedAccount) return;
    // Postgres FIRST, old model SECOND: ws.renameAccount changes
    // selectedAccount.clientName synchronously, which re-triggers the
    // clientName-keyed resolve effect above against the NEW name — if that
    // ran before updateAccount landed, Postgres would still have the OLD
    // name, resolveAccountIdByName would find zero matches, and the account
    // would lose its collab link for the rest of the session.
    if (collabAccountId) {
      try {
        await updateAccount(collabAccountId, { clientName: name });
      } catch (e) {
        setTaskError(e instanceof Error ? e.message : "failed to rename in the shared account record");
      }
    }
    ws.renameAccount(selectedAccount.id, name);
    if (collabAccountId) await reloadCollabData();
  }
  async function handleArchive() {
    if (!selectedAccount) return;
    ws.setAccountArchived(selectedAccount.id, true);
    if (collabAccountId) {
      try {
        await updateAccount(collabAccountId, { archived: true });
      } catch {
        // Best-effort — the OLD model (what the Clients list actually
        // reads today) already reflects the archive either way.
      }
    }
    setRoute({ view: "clients" });
  }
  // setProjectScope/linkProjects also drive campaignsFromMirror/
  // accountLiveContext's CANDIDATE computation (still OLD-model-sourced,
  // untouched so far), so the old calls still run for that reason — their
  // own populate-into-the-JSON-blob side effect is otherwise unused now
  // that tasks/campaigns render from Postgres; the NEW endpoint is what
  // actually produces the visible, re-imported result.
  async function handleSetProjectScope(ids: string[], scoped: boolean) {
    if (!selectedAccount) return;
    ws.setProjectScope(selectedAccount.id, ids, scoped);
    if (!collabAccountId) return;
    await runImport(() => setAccountScope(collabAccountId, ids, scoped));
  }
  async function handleLinkProjects(ids: string[]) {
    if (!selectedAccount) return;
    void ws.linkProjects(selectedAccount.id, ids);
    if (!collabAccountId) return;
    await runImport(() => linkKantataProjects(collabAccountId, ids));
  }

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
              className={`nav-pill${(route.view === "clients" && landingTab === "workspaces") || route.view === "account" ? " active" : ""}`}
              title="Client workspaces you've set up — the full Kantata client roster is under “All clients — list”."
              onClick={() => { setLandingTab("workspaces"); setRoute({ view: "clients" }); }}
            >
              Workspaces ({ws.accounts.filter((a) => !a.archived).length})
            </button>
            <button
              type="button"
              className={`nav-pill${route.view === "clients" && landingTab === "mytasks" ? " active" : ""}`}
              title="Your open tasks across every account — the ones you actually carry hours on."
              onClick={() => { setLandingTab("mytasks"); setRoute({ view: "clients" }); }}
            >
              My Work{myTasksTotal > 0 ? ` (${myTasksTotal})` : ""}
            </button>
            <button
              type="button"
              className={`nav-pill${route.view === "clients" && landingTab === "teamload" ? " active" : ""}`}
              title="Everyone's weekly workload vs capacity across every client — who's overloaded, who's free."
              onClick={() => { setLandingTab("teamload"); setRoute({ view: "clients" }); }}
            >
              Team Load
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
        {route.view === "clients" && landingTab === "mytasks" && (
          <MyWork
            onOpen={(id, taskId) => setRoute({ view: "account", id, tab: "plan", focus: taskId })}
          />
        )}
        {route.view === "clients" && landingTab === "teamload" && (
          <TeamLoad canManage={amIAppAdmin} />
        )}
        {route.view === "clients" && landingTab === "workspaces" && (
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
              onCreate={(name) => setRoute({ view: "account", id: ws.createAccount(name, creatorInfo) })}
              onCreateFromClient={(name) => setRoute({ view: "account", id: ws.createAccountFromMirror(name, creatorInfo) })}
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
            <DataInspector live={liveStatus.live} enabled={debugMode} />
          </>
        )}

        {listView && (
          <div style={{ marginTop: 18, fontSize: 11, color: T.inkMuted }}>
            {/* Destructive across the whole team's data (D4: app admin only).
                Presentation-layer only until B6 — see amIAppAdmin above. */}
            {ws.syncStatus.mode === "shared" ? (
              <>
                Shared team workspace — synced to Supabase
                {ws.syncStatus.savedAt ? ` · last saved ${new Date(ws.syncStatus.savedAt).toLocaleTimeString()}` : ""}
                {ws.syncStatus.error ? " · retrying…" : ""}
                {amIAppAdmin && (
                  <>
                    {" "}
                    <Button variant="link" style={{ fontSize: 11 }} onClick={ws.clearWorkspace}>
                      Clear shared workspace
                    </Button>
                  </>
                )}
              </>
            ) : (
              <>
                Workspaces are stored locally in your browser.
                {amIAppAdmin && (
                  <>
                    {" "}
                    <Button variant="link" style={{ fontSize: 11 }} onClick={ws.clearWorkspace}>
                      Clear workspace
                    </Button>
                  </>
                )}
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
            onToggleClientVisible={(taskId) => void handleToggleInitiativeTaskClientVisible(taskId)}
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
            sharedTasks={enrichedSharedTasks}
            userName={userName}
            {...(email ? { loginHintEmail: email } : {})}
            {...(route.view === "account" && route.tab ? { initialTab: route.tab } : {})}
            {...(route.view === "account" && route.focus ? { focusTaskId: route.focus } : {})}
            showResourcing={viewerIsInternal}
            canManage={amIAppAdmin}
            viewTier={viewTierFor(collabData?.accounts.find((a) => a.id === collabAccountId)?.viewConfig, email ?? undefined, amIAppAdmin)}
            onBack={() => setRoute({ view: "clients" })}
            collabAccountId={collabAccountId}
            collabData={collabData}
            collabDataError={collabDataError}
            onReloadCollabData={reloadCollabData}
            onAccountCreated={() => void reResolveCollabAccount()}
            taskError={taskError}
            onAddTask={(title, ownerName, due, label) => void handleAddTask(title, ownerName, due, label)}
            onTaskStatus={(taskId, status) => void handleTaskStatus(taskId, status)}
            onAddExternal={(name, org, role) => void handleAddAccountExternal(name, org, role)}
            onToggleClientVisible={(taskId) => void handleToggleTaskClientVisible(taskId)}
            onToggleContractorVisible={(taskId) => void handleToggleTaskContractorVisible(taskId)}
            onRemindDeliverable={(taskId) => ws.remindClientDeliverable(selectedAccount.id, taskId, userName)}
            onTabChange={setClientTab}
            onSetProjectScope={(ids, scoped) => void handleSetProjectScope(ids, scoped)}
            importCandidates={campaignsFromMirror(
              loadMirror(),
              selectedAccount.clientName,
              AS_OF_TODAY(),
              selectedAccount.kantataProjectIds,
              selectedAccount.scopedToProjects,
            ).filter((c) => !(collabData?.campaigns ?? []).some((e) => e.name.toLowerCase() === c.name.toLowerCase()))}
            onImportCampaigns={(selected) => void handleImportCampaigns(selected)}
            onRemoveCampaign={(campaignId) => void handleRemoveCampaign(campaignId)}
            onClearCampaigns={() => void handleClearCampaigns()}
            taskCandidates={selectedTaskCandidates}
            onImportTasks={(selected) => void handleImportTasks(selected)}
            onImportAll={() => void handleImportAll()}
            pendingKantataWrites={pendingKantataWrites}
            onPushToKantata={async (refs) => {
              const chosen = pendingKantataWrites.filter((w) => refs.includes(w.ref));
              const response = await pushIntents(chosen.map((w) => w.intent));
              // Stamp ONLY what actually landed. A dry run changes nothing, so
              // the queue stays put and the panel says why. `ref` is now a
              // collab.task id (tasks moved to Postgres) — markTasksSyncedCollab
              // stamps kantata_synced_at/kantata_story_id there directly.
              if (!response.dryRun && collabAccountId) {
                await markTasksSyncedCollab(
                  collabAccountId,
                  response.results
                    .filter((r) => r.ok && !r.planned)
                    .map((r) => ({ ref: r.ref, ...(r.createdId ? { createdId: r.createdId } : {}) })),
                );
                await reloadCollabData();
              }
              return response;
            }}
            {...(selectedLiveCtx ? { liveContext: selectedLiveCtx } : {})}
            liveDataOn={liveStatus.live}
            linkSuggestions={selectedLinkSuggestions}
            onRelink={(name) => void handleRelink(name)}
            onLinkProjects={(ids) => void handleLinkProjects(ids)}
            onArchive={() => void handleArchive()}
            people={ws.availablePeople.map((p) => ({ id: p.id, name: p.name, title: p.title }))}
            onAddMember={(personId) => void handleAddAccountMember(personId)}
            onAddNewMember={(name, title) => void handleAddNewAccountMember(name, title)}
            onShareFile={(msItemId, name, purpose) => void handleShareFile(msItemId, name, purpose)}
            onUnshareFile={(approvalId) => void handleUnshareFile(approvalId)}
            onClientDecision={(approvalId, decision, note) => void handleDecideFileApproval(approvalId, decision, note)}
            onSetTaskHours={(taskId, hours) => void handleSetTaskHours(taskId, hours)}
            onSetTaskAssignments={(taskId, names) => void handleSetTaskAssignments(taskId, names)}
            onSetAssignmentHours={(taskId, name, hours) => void handleSetAssignmentHours(taskId, name, hours)}
            onToggleAssignmentDone={(taskId, name, done) => void handleToggleAssignmentDone(taskId, name, done)}
            onSetAssignmentPrimary={(taskId, name) => void handleSetAssignmentPrimary(taskId, name)}
            onSetAssignmentOrder={(taskId, orderedNames) => void handleSetAssignmentOrder(taskId, orderedNames)}
            onSetTaskDependencies={(taskId, dependsOn) => void handleSetTaskDependencies(taskId, dependsOn)}
            onPublishResourcing={async () => {
              // Derive weekly reservations from the CURRENT plan (hours + due
              // dates) and push them per person, per week. Accurate per person —
              // not Kantata's even split across a task's assignees. A person we
              // can't resolve to a Kantata user is skipped (can't book them).
              const staff = loadMirror().staff ?? [];
              const tasks = enrichedSharedTasks.map((e) => e.task);
              const projectId =
                selectedAccount.kantataProjectIds?.[0] ??
                tasks.find((t) => t.kantataProjectId)?.kantataProjectId ??
                "";
              const intents = weeklyAllocations(
                tasks.map((t) => {
                  // Split tasks book per person from the edited hour split; the
                  // rest fall back to the single owner + estimate.
                  const eff = t.assignments && t.assignments.length > 0 ? effectiveHours(t) : null;
                  return {
                    id: t.id,
                    status: t.status,
                    ...(t.ownerName ? { ownerName: t.ownerName } : {}),
                    ...(t.startDate ? { start: t.startDate } : {}),
                    ...(t.due ? { due: t.due } : {}),
                    ...(t.estimatedHours != null ? { estimatedHours: t.estimatedHours } : {}),
                    ...(eff ? { assignments: [...eff].map(([name, hours]) => ({ name, hours })) } : {}),
                  };
                }),
              )
                .map((a) => {
                  const userId = resolveStaffId(a.personName, staff);
                  if (!userId || !projectId) return null;
                  return allocationIntent({ ref: `${a.personName}|${a.weekStart}`, projectId, userId, date: a.weekStart, hours: a.hours });
                })
                .filter((x): x is NonNullable<typeof x> => x !== null);
              return pushIntents(intents);
            }}
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

        {route.view === "admin" && amIAppAdmin && (
          <>
            <GraphCheck {...(email ? { loginHintEmail: email } : {})} />
            <FeedbackAdmin feedback={ws.feedback} onBack={() => setRoute({ view: "clients" })} />
          </>
        )}
        {route.view === "admin" && !amIAppAdmin && (
          <EmptyState
            icon="🔒"
            title="App admins only"
            hint="This area is limited to app admins (teams-provisioning-plan.md D1)."
            action={<Button variant="secondary" onClick={() => setRoute({ view: "clients" })}>Back to Clients</Button>}
          />
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
