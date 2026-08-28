-- Per-person weekly CAPACITY — the supply side of resourcing (Kellie/Cara).
--
-- Our Resourcing tab derives DEMAND (weekly hours) from Kantata tasks, but had
-- no notion of how much time a person actually has — so it could never say
-- "over-allocated." This table adds that one missing input: a person's
-- available hours per week. With it, the cross-client Team Load view computes
-- workload-vs-capacity across every client at once (over-allocated / near-full
-- / idle), which per-client hours alone can't answer.
--
-- Keyed by a normalized person name, because that's the only identity Kantata
-- task assignments carry (assignments[].name) — the same name-based join the
-- rest of resourcing already uses. weekly_hours defaults to 40 when unset, so
-- the view works before anyone tunes capacities.
--
-- Global (not per-account): capacity is a property of the person across the
-- whole portfolio. Any signed-in AGP user may READ it (it feeds everyone's Team
-- Load view); only app admins may WRITE it.

create table collab.person_capacity (
  person_key text primary key,           -- lower(trim(display_name))
  display_name text not null,
  weekly_hours numeric not null default 40 check (weekly_hours >= 0 and weekly_hours <= 168),
  updated_at timestamptz not null default now()
);

alter table collab.person_capacity enable row level security;

-- Readable by any authenticated user (it's not sensitive — hours available, no
-- rates), so every person's Team Load view can render the whole team's picture.
create policy person_capacity_read on collab.person_capacity
  for select to authenticated using (true);

-- Writes (upsert) are app-admin only, enforced by the setter below rather than a
-- broad policy, same column-discipline pattern as set_notify_pref/set_view_config.
create or replace function collab.set_person_capacity(
  p_display_name text,
  p_weekly_hours numeric
)
returns collab.person_capacity
language plpgsql
security definer
set search_path = collab, public
as $$
declare
  v_key text := lower(trim(p_display_name));
  v_result collab.person_capacity;
begin
  if v_key = '' then
    raise exception 'display_name is required' using errcode = '22023';
  end if;
  if p_weekly_hours is null or p_weekly_hours < 0 or p_weekly_hours > 168 then
    raise exception 'weekly_hours must be between 0 and 168' using errcode = '22023';
  end if;
  if not collab.is_app_admin() then
    raise exception 'only app admins may set capacity' using errcode = '42501';
  end if;

  insert into collab.person_capacity (person_key, display_name, weekly_hours, updated_at)
  values (v_key, trim(p_display_name), p_weekly_hours, now())
  on conflict (person_key) do update set
    display_name = excluded.display_name,
    weekly_hours = excluded.weekly_hours,
    updated_at = now()
  returning * into v_result;

  return v_result;
end;
$$;

grant execute on function collab.set_person_capacity(text, numeric) to authenticated;
