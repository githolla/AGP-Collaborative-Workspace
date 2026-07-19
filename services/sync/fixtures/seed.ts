import type { KantataFixtureData } from "./kantataFixture.js";
import type { HubSpotFixtureData } from "./hubspotFixture.js";

/**
 * Seed dataset shaped by AGP's actual domain (SPEC §AGP Domain Requirements):
 * three engagements spanning vertical × service line × commercial model, with
 * pass-through expenses on the direct-mail work and a hard in-home date.
 * Financial figures are ILLUSTRATIVE until the tenant grounding doc arrives
 * (ADR 0003) — never show them to AGP as real numbers.
 */

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
          budget_cents: 9_000_000,
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
          id: "st-2003",
          workspace_id: "ws-1002",
          title: "August email series — monthly sustainers",
          story_type: "task",
          state: "in_progress",
          due_date: "2026-08-05",
          hard_date: false,
          updated_at: "2026-07-13T08:45:00Z",
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
      ],
      allocation: [
        {
          id: "al-4001",
          workspace_id: "ws-1001",
          user_id: "u-501",
          week_start: "2026-07-06",
          minutes: 1200,
          hard: true,
          updated_at: "2026-07-01T09:00:00Z",
        },
        {
          id: "al-4002",
          workspace_id: "ws-1002",
          user_id: "u-502",
          week_start: "2026-07-06",
          minutes: 600,
          hard: false,
          updated_at: "2026-07-01T09:05:00Z",
        },
      ],
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
      ],
      user: [
        { id: "u-501", full_name: "Dana Whitfield", email: "dana.whitfield@agp.example", updated_at: "2026-01-05T00:00:00Z" },
        { id: "u-502", full_name: "Marcus Okafor", email: "marcus.okafor@agp.example", updated_at: "2026-01-05T00:00:00Z" },
      ],
      participation: [],
      assignment: [],
      invoice: [],
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
      company: [
        {
          id: "hs-co-77",
          name: "Harvest Hope Food Bank",
          domain: "harvesthope.example.org",
          vertical: "food_banks",
          hs_lastmodifieddate: "2026-07-01T10:00:00Z",
        },
        {
          id: "hs-co-78",
          name: "KPBX Public Media",
          domain: "kpbx.example.org",
          vertical: "public_media",
          hs_lastmodifieddate: "2026-07-03T10:00:00Z",
        },
        {
          id: "hs-co-79",
          name: "St. Anselm Health Foundation",
          domain: "stanselm.example.org",
          vertical: "hospitals",
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
