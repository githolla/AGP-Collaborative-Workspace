import type { KantataFixtureData } from "./kantataFixture.js";
import type { HubSpotFixtureData } from "./hubspotFixture.js";

/**
 * Seed dataset shaped by AGP's actual domain (SPEC §AGP Domain Requirements):
 * three engagements spanning vertical × service line × commercial model, with
 * pass-through expenses on the direct-mail work, a hard in-home date, and
 * seven weeks of allocations + time entries so burn/margin/planner surfaces
 * have realistic contours. Deterministic — no randomness.
 * Financial figures are ILLUSTRATIVE until the tenant grounding doc arrives
 * (ADR 0003) — never show them to AGP as real numbers.
 */

export const SEED_WEEKS = [
  "2026-06-01",
  "2026-06-08",
  "2026-06-15",
  "2026-06-22",
  "2026-06-29",
  "2026-07-06",
  "2026-07-13",
] as const;

export const SEED_PEOPLE = [
  { id: "u-501", full_name: "Dana Whitfield", title: "Creative Director", bill: 22_500, cost: 11_000 },
  { id: "u-502", full_name: "Marcus Okafor", title: "Digital Strategist", bill: 19_500, cost: 9_500 },
  { id: "u-503", full_name: "Priya Raman", title: "Senior Project Manager", bill: 21_000, cost: 10_000 },
  { id: "u-504", full_name: "Tom Alvarez", title: "Data Analyst", bill: 17_500, cost: 8_500 },
  { id: "u-505", full_name: "Grace Liu", title: "Production Manager", bill: 15_000, cost: 7_000 },
] as const;

/** (workspace, user, minutes/week, hard-allocation flag) */
const ALLOCATION_PLAN = [
  { ws: "ws-1001", user: "u-501", minutes: 1200, hard: true },
  { ws: "ws-1001", user: "u-503", minutes: 600, hard: true },
  { ws: "ws-1001", user: "u-505", minutes: 900, hard: false },
  { ws: "ws-1002", user: "u-502", minutes: 600, hard: false },
  { ws: "ws-1002", user: "u-504", minutes: 450, hard: false },
  { ws: "ws-1003", user: "u-503", minutes: 600, hard: true },
  { ws: "ws-1003", user: "u-504", minutes: 900, hard: true },
] as const;

const ENTRY_NOTES: Record<string, string[]> = {
  "ws-1001": [
    "Concepted outer envelope variants; donor segmentation review with data team.",
    "Variable-data programming for ask-string matrix.",
    "Package copy revisions after client review.",
    "Coordinated print schedule with production floor.",
  ],
  "ws-1002": [
    "Sustainer journey copy, subject-line testing plan.",
    "Email automation branch logic for lapsed donors.",
    "Monthly performance readout prep.",
    "Pledge-drive audience segmentation refresh.",
  ],
  "ws-1003": [
    "Grateful patient data mapping workshop.",
    "Sprint planning and backlog grooming.",
    "Screening model requirements with foundation staff.",
    "Wealth-screening vendor field alignment.",
  ],
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function generateAllocations(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let n = 4001;
  for (const plan of ALLOCATION_PLAN) {
    for (const week of SEED_WEEKS) {
      rows.push({
        id: `al-${n++}`,
        workspace_id: plan.ws,
        user_id: plan.user,
        week_start: week,
        minutes: plan.minutes,
        hard: plan.hard,
        updated_at: `${addDays(week, -3)}T09:00:00Z`,
      });
    }
  }
  return rows;
}

function generateTimeEntries(): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let n = 3101; // literal te-3001/te-3002 below keep their well-known ids
  ALLOCATION_PLAN.forEach((plan, pairIdx) => {
    const person = SEED_PEOPLE.find((p) => p.id === plan.user)!;
    const notes = ENTRY_NOTES[plan.ws]!;
    SEED_WEEKS.forEach((week, weekIdx) => {
      // Two entries per week (Tue/Thu); effort wobbles deterministically ±15%.
      const factor = [0.85, 1.0, 1.15][(weekIdx + pairIdx) % 3]!;
      for (const [slot, dayOffset] of [
        [0, 1],
        [1, 3],
      ] as const) {
        const minutes = Math.round(((plan.minutes / 2) * factor) / 15) * 15;
        const date = addDays(week, dayOffset);
        rows.push({
          id: `te-${n++}`,
          workspace_id: plan.ws,
          user_id: plan.user,
          story_id: null,
          date_performed: date,
          time_in_minutes: minutes,
          notes: notes[(weekIdx * 2 + slot) % notes.length],
          bill_rate_cents: person.bill,
          cost_rate_cents: person.cost,
          billable: true,
          updated_at: `${date}T18:00:00Z`,
        });
      }
    });
  });
  return rows;
}

export function kantataSeed(): KantataFixtureData {
  return {
    entities: {
      workspace: [
        {
          id: "ws-1001",
          title: "Harvest Hope Food Bank — Fall Acquisition Mail",
          status: "active",
          vertical: "food_banks",
          service_line: "direct_mail",
          commercial_model: "fixed_fee",
          budget_cents: 18_500_000,
          start_date: "2026-06-01",
          due_date: "2026-11-20",
          workspace_group_company_id: "hs-co-77", // workspace_groups <-> HubSpot company join
          updated_at: "2026-07-10T09:00:00Z",
        },
        {
          id: "ws-1002",
          title: "KPBX Public Media — Year-Round Digital Retainer",
          status: "active",
          vertical: "public_media",
          service_line: "digital_fundraising",
          commercial_model: "retainer",
          budget_cents: 9_000_000, // annual; monthly envelope = /12
          start_date: "2026-01-01",
          due_date: "2026-12-31",
          workspace_group_company_id: "hs-co-78",
          updated_at: "2026-07-12T14:30:00Z",
        },
        {
          id: "ws-1003",
          title: "St. Anselm Health — Grateful Patient Program Build",
          status: "active",
          vertical: "hospitals",
          service_line: "mid_major_gifts",
          commercial_model: "sprint_build",
          budget_cents: 24_000_000,
          start_date: "2026-05-15",
          due_date: "2026-10-30",
          workspace_group_company_id: "hs-co-79",
          updated_at: "2026-07-08T11:00:00Z",
        },
      ],
      story: [
        {
          id: "st-2001",
          workspace_id: "ws-1001",
          title: "In-home date — fall acquisition package",
          story_type: "milestone",
          state: "not_started",
          due_date: "2026-10-12",
          hard_date: true, // immovable (SPEC domain rule 5)
          updated_at: "2026-06-20T10:00:00Z",
        },
        {
          id: "st-2002",
          workspace_id: "ws-1001",
          title: "Package creative + variable-data programming",
          story_type: "task",
          state: "in_progress",
          due_date: "2026-08-15",
          hard_date: false,
          updated_at: "2026-07-11T16:00:00Z",
        },
        {
          id: "st-2007",
          workspace_id: "ws-1001",
          title: "Print + mail production window (in-house facility)",
          story_type: "milestone",
          state: "not_started",
          due_date: "2026-09-14",
          hard_date: false,
          updated_at: "2026-06-20T10:05:00Z",
        },
        {
          id: "st-2003",
          workspace_id: "ws-1002",
          title: "August email series — monthly sustainers",
          story_type: "task",
          state: "in_progress",
          due_date: "2026-08-05",
          hard_date: false,
          updated_at: "2026-07-13T08:45:00Z",
        },
        {
          id: "st-2005",
          workspace_id: "ws-1002",
          title: "Fall pledge drive launch",
          story_type: "milestone",
          state: "not_started",
          due_date: "2026-10-01",
          hard_date: true,
          updated_at: "2026-06-25T09:00:00Z",
        },
        {
          id: "st-2004",
          workspace_id: "ws-1003",
          title: "Discovery + data mapping sprint complete",
          story_type: "milestone",
          state: "completed",
          due_date: "2026-06-12",
          hard_date: false,
          updated_at: "2026-06-12T17:00:00Z",
        },
        {
          id: "st-2006",
          workspace_id: "ws-1003",
          title: "Sprint 3 demo — screening model v1",
          story_type: "milestone",
          state: "not_started",
          due_date: "2026-08-21",
          hard_date: false,
          updated_at: "2026-07-01T09:00:00Z",
        },
      ],
      time_entry: [
        {
          id: "te-3001",
          workspace_id: "ws-1001",
          user_id: "u-501",
          story_id: "st-2002",
          date_performed: "2026-07-09",
          time_in_minutes: 240,
          notes: "Concepted outer envelope variants; donor segmentation review with data team.",
          bill_rate_cents: 22_500,
          cost_rate_cents: 11_000,
          billable: true,
          updated_at: "2026-07-09T18:00:00Z",
        },
        {
          id: "te-3002",
          workspace_id: "ws-1002",
          user_id: "u-502",
          story_id: "st-2003",
          date_performed: "2026-07-10",
          time_in_minutes: 180,
          notes: "Sustainer journey copy, subject-line testing plan.",
          bill_rate_cents: 19_500,
          cost_rate_cents: 9_500,
          billable: true,
          updated_at: "2026-07-10T17:30:00Z",
        },
        ...generateTimeEntries(),
      ],
      allocation: generateAllocations(),
      expense: [
        {
          id: "ex-5001",
          workspace_id: "ws-1001",
          category: "Print Production", // pass-through (GL-coded COGS)
          amount_cents: 4_200_000,
          incurred_on: "2026-07-02",
          updated_at: "2026-07-02T12:00:00Z",
        },
        {
          id: "ex-5002",
          workspace_id: "ws-1001",
          category: "Postage", // pass-through
          amount_cents: 2_800_000,
          incurred_on: "2026-07-02",
          updated_at: "2026-07-02T12:01:00Z",
        },
        {
          id: "ex-5003",
          workspace_id: "ws-1002",
          category: "Media Buys", // pass-through
          amount_cents: 1_200_000,
          incurred_on: "2026-06-15",
          updated_at: "2026-06-15T12:00:00Z",
        },
      ],
      user: SEED_PEOPLE.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        email: `${p.full_name.toLowerCase().replace(" ", ".")}@agp.example`,
        headline: p.title,
        updated_at: "2026-01-05T00:00:00Z",
      })),
      participation: [],
      assignment: [],
      invoice: [
        {
          id: "in-7001",
          workspace_id: "ws-1001",
          status: "paid",
          amount_cents: 6_000_000,
          issued_on: "2026-06-15",
          paid_on: "2026-07-01",
          updated_at: "2026-07-01T12:00:00Z",
        },
        {
          id: "in-7002",
          workspace_id: "ws-1003",
          status: "sent",
          amount_cents: 8_000_000,
          issued_on: "2026-06-01",
          paid_on: null,
          updated_at: "2026-06-01T12:00:00Z",
        },
      ],
      custom_field_value: [
        {
          id: "cf-6001",
          subject_type: "workspace",
          subject_id: "ws-1001",
          field_name: "Service Line Detail",
          value: "Acquisition — Direct Mail",
          updated_at: "2026-06-01T00:00:00Z",
        },
      ],
    },
    events: [
      {
        id: "evt-1",
        eventType: "workspace:updated",
        subjectType: "workspace",
        subjectId: "ws-1001",
        occurredAt: "2026-07-10T09:00:05Z",
        payload: {},
      },
      {
        id: "evt-2",
        eventType: "story:updated",
        subjectType: "story",
        subjectId: "st-2002",
        occurredAt: "2026-07-11T16:00:10Z",
        payload: {},
      },
      {
        id: "evt-3",
        eventType: "time_entry:created",
        subjectType: "time_entry",
        subjectId: "te-3002",
        occurredAt: "2026-07-10T17:31:00Z",
        payload: {},
      },
    ],
  };
}

export function hubspotSeed(): HubSpotFixtureData {
  return {
    entities: {
      // Field names match the real AGP portal (docs/hubspot-property-map.md):
      // agp_industry is the custom vertical; health/renewal/GDNA fields are
      // the confirmed touchpoint/company_activity properties.
      company: [
        {
          id: "hs-co-77",
          name: "Harvest Hope Food Bank",
          domain: "harvesthope.example.org",
          agp_industry: "food_banks",
          lifecyclestage: "customer",
          client_health_index__c: "Green",
          renewal: "2026-11-01",
          gdna_subscription_level: "Pro",
          hs_lastmodifieddate: "2026-07-01T10:00:00Z",
        },
        {
          id: "hs-co-78",
          name: "KPBX Public Media",
          domain: "kpbx.example.org",
          agp_industry: "public_media",
          lifecyclestage: "customer",
          client_health_index__c: "Yellow",
          renewal: "2026-09-15",
          hs_lastmodifieddate: "2026-07-03T10:00:00Z",
        },
        {
          id: "hs-co-79",
          name: "St. Anselm Health Foundation",
          domain: "stanselm.example.org",
          agp_industry: "hospitals",
          lifecyclestage: "opportunity",
          hs_lastmodifieddate: "2026-07-05T10:00:00Z",
        },
      ],
      deal: [
        {
          id: "hs-dl-901",
          company_id: "hs-co-77",
          dealname: "Fall Acquisition Mail 2026",
          dealstage: "closedwon",
          amount_cents: 18_500_000,
          service_line: "direct_mail",
          commercial_model: "fixed_fee",
          is_won: true,
          is_closed: true,
          hs_lastmodifieddate: "2026-05-20T09:00:00Z",
        },
        {
          id: "hs-dl-902",
          company_id: "hs-co-78",
          dealname: "GivingDNA Add-On — Donor Analytics",
          dealstage: "presentationscheduled",
          amount_cents: 3_600_000,
          service_line: "givingdna",
          commercial_model: "product_support",
          is_won: false,
          is_closed: false,
          hs_lastmodifieddate: "2026-07-14T15:00:00Z",
        },
      ],
      contact: [
        {
          id: "hs-ct-801",
          company_id: "hs-co-77",
          email: "mruiz@harvesthope.example.org",
          full_name: "Maria Ruiz",
          hs_lastmodifieddate: "2026-06-15T10:00:00Z",
        },
        {
          id: "hs-ct-802",
          company_id: "hs-co-78",
          email: "jchen@kpbx.example.org",
          full_name: "James Chen",
          hs_lastmodifieddate: "2026-05-02T10:00:00Z",
        },
      ],
      engagement: [
        {
          id: "hs-en-701",
          company_id: "hs-co-77",
          deal_id: "hs-dl-901",
          engagement_type: "email",
          occurred_at: "2026-07-08T14:00:00Z",
          subject: "Re: fall package — accessibility question",
          body: "Could we make sure the reply device meets accessibility guidelines this year?",
          hs_lastmodifieddate: "2026-07-08T14:00:00Z",
        },
        {
          id: "hs-en-702",
          company_id: "hs-co-78",
          deal_id: null,
          engagement_type: "call",
          occurred_at: "2026-06-10T16:00:00Z",
          subject: "Q2 check-in call",
          body: "Reviewed sustainer numbers; station wants pledge-drive plan by early August.",
          hs_lastmodifieddate: "2026-06-10T16:00:00Z",
        },
        {
          id: "hs-en-703",
          company_id: "hs-co-79",
          deal_id: null,
          engagement_type: "meeting",
          occurred_at: "2026-07-15T15:00:00Z",
          subject: "Sprint 2 review with foundation leadership",
          body: "Leadership pleased with data mapping; asked about a physician-engagement module.",
          hs_lastmodifieddate: "2026-07-15T15:00:00Z",
        },
      ],
      ticket: [],
      line_item: [
        {
          id: "hs-li-601",
          deal_id: "hs-dl-901",
          name: "Acquisition package — creative & production management",
          amount_cents: 11_500_000,
          quantity: 1,
          hs_lastmodifieddate: "2026-05-20T09:00:00Z",
        },
      ],
    },
  };
}
