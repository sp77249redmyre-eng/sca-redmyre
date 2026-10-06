-- Redmyre House — Stage 3B door control schema (DRAFT: NOT YET RUN. Needs Jacob approval + 챗이사 PASS)
-- Doors: D1, D2, D5 only. Actions: unlock, lock only.
-- Clients (portal) can only call request_door_command() / set_door_autolock(); they cannot write the tables.
-- The door daemon uses service_role (bypasses RLS) and the claim/recover functions below.

-- ---------------------------------------------------------------- settings
create table if not exists public.door_settings (
  door_id text primary key check (door_id in ('D1','D2','D5')),
  autolock_seconds integer not null default 180 check (autolock_seconds between 30 and 300),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.door_settings (door_id) values ('D1'),('D2'),('D5') on conflict do nothing;

-- ---------------------------------------------------------------- commands
create table if not exists public.door_commands (
  id uuid primary key default gen_random_uuid(),
  door_id text not null check (door_id in ('D1','D2','D5')),
  action text not null check (action in ('unlock','lock')),
  source text not null default 'manual' check (source in ('manual','autolock')),
  status text not null default 'pending'
    check (status in ('pending','claimed','executing','success','failed','expired','unknown','cancelled')),
  requested_by text not null,                          -- set by request_door_command() from the verified login email
  created_at timestamptz not null default now(),
  scheduled_at timestamptz not null default now(),     -- autolock: when the Lock is due
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  autolock_seconds_snapshot integer check (autolock_seconds_snapshot between 30 and 300),
  parent_command_id uuid references public.door_commands(id),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  result_status text check (result_status in ('Locked','Unlocked','Unknown')),
  error text,
  cancel_reason text,
  alert_sent_at timestamptz,                           -- one alert per failed/unknown command; never re-run a door command because of alert problems
  check (source <> 'autolock' or action = 'lock'),
  check (source <> 'autolock' or (autolock_seconds_snapshot is not null and parent_command_id is not null))
);
-- at most ONE active command per door
create unique index if not exists door_commands_one_active_per_door
  on public.door_commands (door_id) where status in ('pending','claimed','executing');
-- at most ONE autolock per Unlock (idempotent Autolock creation)
create unique index if not exists door_commands_one_autolock_per_unlock
  on public.door_commands (parent_command_id) where source = 'autolock';
create index if not exists door_commands_created_idx on public.door_commands (created_at desc);

-- ---------------------------------------------------------------- RLS: admin read only, no direct writes
alter table public.door_settings enable row level security;
alter table public.door_commands enable row level security;
revoke all on public.door_settings from anon, authenticated;
revoke all on public.door_commands from anon, authenticated;
grant select on public.door_settings to authenticated;
grant select on public.door_commands to authenticated;
drop policy if exists door_settings_admin_select on public.door_settings;
create policy door_settings_admin_select on public.door_settings for select to authenticated using (public.get_my_role() = 'admin');
drop policy if exists door_commands_admin_select on public.door_commands;
create policy door_commands_admin_select on public.door_commands for select to authenticated using (public.get_my_role() = 'admin');

-- ---------------------------------------------------------------- portal RPC: request a command
create or replace function public.request_door_command(p_door_id text, p_action text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_active public.door_commands%rowtype;
  v_id uuid;
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'not_admin'; end if;
  if v_email = '' then raise exception 'no_identity'; end if;
  if p_door_id not in ('D1','D2','D5') then raise exception 'bad_door'; end if;
  if p_action not in ('unlock','lock') then raise exception 'bad_action'; end if;

  perform pg_advisory_xact_lock(hashtext('door:' || p_door_id));

  select * into v_active from public.door_commands
   where door_id = p_door_id and status in ('pending','claimed','executing') limit 1;
  if found then
    if v_active.source = 'autolock' and v_active.status = 'pending' and p_action = 'lock' then
      -- manual Lock replaces a waiting Auto-Lock (cancel is audited)
      update public.door_commands
         set status = 'cancelled', cancel_reason = 'manual_lock:' || v_email, finished_at = now()
       where id = v_active.id;
      insert into public.audit_logs (action, user_email, user_role, details)
      values ('door_autolock_cancelled', v_email, 'admin',
              jsonb_build_object('door', p_door_id, 'cancelled_command', v_active.id));
    else
      raise exception 'door_busy';       -- any other active command (incl. waiting Auto-Lock vs manual Unlock) is refused
    end if;
  end if;

  insert into public.door_commands (door_id, action, requested_by)
  values (p_door_id, p_action, v_email) returning id into v_id;

  insert into public.audit_logs (action, user_email, user_role, details)
  values ('door_command_requested', v_email, 'admin',
          jsonb_build_object('door', p_door_id, 'action', p_action, 'command', v_id));
  return v_id;
end $$;

-- ---------------------------------------------------------------- portal RPC: per-door auto-lock time (30..300 s)
create or replace function public.set_door_autolock(p_door_id text, p_seconds integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_old integer;
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'not_admin'; end if;
  if v_email = '' then raise exception 'no_identity'; end if;
  if p_door_id not in ('D1','D2','D5') then raise exception 'bad_door'; end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 300 then raise exception 'out_of_range'; end if;
  select autolock_seconds into v_old from public.door_settings where door_id = p_door_id;
  update public.door_settings set autolock_seconds = p_seconds, updated_by = v_email, updated_at = now()
   where door_id = p_door_id;
  insert into public.audit_logs (action, user_email, user_role, details)
  values ('door_autolock_change', v_email, 'admin',
          jsonb_build_object('door', p_door_id, 'old_seconds', v_old, 'new_seconds', p_seconds));
end $$;

-- ---------------------------------------------------------------- daemon RPC: atomic claim (service_role only)
create or replace function public.claim_door_command()
returns setof public.door_commands language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.door_commands set status = 'expired', finished_at = now()
   where status = 'pending' and expires_at <= now();   -- an expired AUTOLOCK frees the door and the daemon alerts (alert_sent_at)
  return query
  update public.door_commands c
     set status = 'claimed', claimed_at = now()
   where c.id = (select id from public.door_commands
                  where status = 'pending' and scheduled_at <= now() and expires_at > now()
                  order by scheduled_at limit 1 for update skip locked)
     and c.status = 'pending'
  returning c.*;
end $$;

-- ---------------------------------------------------------------- daemon RPC: on start, never re-run interrupted commands
create or replace function public.recover_door_commands()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  update public.door_commands
     set status = 'unknown', error = 'daemon_restart', finished_at = now()
   where status in ('claimed','executing');
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.request_door_command(text, text) from public, anon;
revoke all on function public.set_door_autolock(text, integer) from public, anon;
revoke all on function public.claim_door_command() from public, anon, authenticated;
revoke all on function public.recover_door_commands() from public, anon, authenticated;
grant execute on function public.request_door_command(text, text) to authenticated;
grant execute on function public.set_door_autolock(text, integer) to authenticated;
grant execute on function public.claim_door_command() to service_role;
grant execute on function public.recover_door_commands() to service_role;

-- Notes for the daemon (not SQL):
--  * After an Unlock succeeds the daemon inserts ONE autolock command: action 'lock', source 'autolock',
--    scheduled_at = now() + autolock_seconds (snapshot taken at that moment), expires_at = scheduled_at + 1 hour
--    (an overdue Lock is the safe direction, so it is allowed to run late), requested_by 'system:autolock'.
--  * Autolock that ends failed/unknown/expired -> alert once (alert_sent_at).

--  * FAIL-SAFE (daemon): if the Autolock insert fails after a successful Unlock -> retry 3x in 10 s; if still failing,
--    keep an in-memory timer, mark the Unlock command error='autolock_not_scheduled', raise a CRITICAL alert
--    (portal warning + email) and show 'Auto-Lock protection failed' on the portal.
--  * RECOVERY (daemon start + every minute): ONLY if a successful portal Unlock has NO autolock command at all
--    (any status) create one due immediately + alert. If an autolock exists in failed/unknown/expired/cancelled state: NO new command, alert only. Only portal-originated unlocks are covered;
--    doors unlocked directly in Integriti are left alone.
--  * AUDIT FAIL-CLOSED: audit_logs inserts inside the RPCs have no exception handler; an audit failure aborts the whole RPC (no command without audit).
