-- Add door D3 (Car Park Door) to door control. Only the allowed-ID lists change; no data is touched.
-- Replace the door_id CHECK on all three tables (found by definition, not by guessed name).
do $$
declare r record; t text;
begin
  foreach t in array array['door_settings','door_commands','door_status'] loop
    for r in select c.conname from pg_constraint c
              where c.conrelid = ('public.' || t)::regclass and c.contype = 'c'
                and pg_get_constraintdef(c.oid) ilike '%door_id%' and pg_get_constraintdef(c.oid) ilike '%D5%' loop
      execute format('alter table public.%I drop constraint %I', t, r.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (door_id in (''D1'',''D2'',''D3'',''D5''))', t, t || '_door_id_check');
  end loop;
end $$;
insert into public.door_settings (door_id) values ('D3') on conflict do nothing;

create or replace function public.request_door_command(p_door_id text, p_action text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_active public.door_commands%rowtype;
  v_id uuid;
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'not_admin'; end if;
  if v_email = '' then raise exception 'no_identity'; end if;
  if p_door_id not in ('D1','D2','D3','D5') then raise exception 'bad_door'; end if;
  if p_action not in ('unlock','lock') then raise exception 'bad_action'; end if;

  perform pg_advisory_xact_lock(hashtext('door:' || p_door_id));

  select * into v_active from public.door_commands
   where door_id = p_door_id and status in ('pending','claimed','executing') limit 1;
  if found then
    if v_active.source = 'autolock' and v_active.status = 'pending' and p_action = 'lock' then
      update public.door_commands
         set status = 'cancelled', cancel_reason = 'manual_lock:' || v_email, finished_at = now()
       where id = v_active.id;
      insert into public.audit_logs (action, user_email, user_role, details)
      values ('door_autolock_cancelled', v_email, 'admin',
              jsonb_build_object('door', p_door_id, 'cancelled_command', v_active.id));
    else
      raise exception 'door_busy';
    end if;
  end if;

  insert into public.door_commands (door_id, action, requested_by)
  values (p_door_id, p_action, v_email) returning id into v_id;

  insert into public.audit_logs (action, user_email, user_role, details)
  values ('door_command_requested', v_email, 'admin',
          jsonb_build_object('door', p_door_id, 'action', p_action, 'command', v_id));
  return v_id;
end $$;

create or replace function public.set_door_autolock(p_door_id text, p_seconds integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_old integer;
begin
  if public.get_my_role() is distinct from 'admin' then raise exception 'not_admin'; end if;
  if v_email = '' then raise exception 'no_identity'; end if;
  if p_door_id not in ('D1','D2','D3','D5') then raise exception 'bad_door'; end if;
  if p_seconds is null or p_seconds < 30 or p_seconds > 300 then raise exception 'out_of_range'; end if;
  select autolock_seconds into v_old from public.door_settings where door_id = p_door_id;
  update public.door_settings set autolock_seconds = p_seconds, updated_by = v_email, updated_at = now()
   where door_id = p_door_id;
  insert into public.audit_logs (action, user_email, user_role, details)
  values ('door_autolock_change', v_email, 'admin',
          jsonb_build_object('door', p_door_id, 'old_seconds', v_old, 'new_seconds', p_seconds));
end $$;

revoke all on function public.request_door_command(text, text) from public, anon;
revoke all on function public.set_door_autolock(text, integer) from public, anon;
grant execute on function public.request_door_command(text, text) to authenticated;
grant execute on function public.set_door_autolock(text, integer) to authenticated;
