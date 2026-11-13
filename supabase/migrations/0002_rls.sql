-- =====================================================================
-- MyPro — Row Level Security
-- Model: default deny. Every row is reachable only by its owner
-- (auth.uid()). Child tables authorise by joining to their parent.
-- Health data gets an extra, database-enforced consent gate for the
-- assistant (see assistant_read_health at the bottom).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enable RLS on everything (default deny until a policy allows)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','user_phone_numbers','user_activity','tags',
    'gmail_accounts','email_messages','email_labels','email_message_labels',
    'email_attachments','email_insights',
    'event_categories','calendar_events','event_reminders','tasks','task_tags',
    'library_items','book_details','podcast_details','article_details','note_details',
    'collections','collection_items',
    'annotations','annotation_tags','bookmarks','reading_sessions','listening_sessions',
    'item_sources',
    'health_records','health_symptoms','health_medications','health_documents',
    'health_access_grants',
    'assistant_persona','assistant_settings','assistant_conversations',
    'assistant_messages','assistant_memory',
    'assistant_schedules','assistant_schedule_days','schedule_runs','system_jobs',
    'notification_channels','device_tokens','notifications','audit_log'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Owner policies for tables that carry user_id directly
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'user_phone_numbers','user_activity','tags',
    'gmail_accounts','email_messages','email_labels','email_insights',
    'event_categories','calendar_events','tasks',
    'library_items','collections',
    'annotations','bookmarks','reading_sessions','listening_sessions',
    'item_sources',
    'health_records','health_access_grants',
    'assistant_persona','assistant_settings','assistant_conversations',
    'assistant_messages','assistant_memory',
    'assistant_schedules','schedule_runs','system_jobs',
    'notification_channels','device_tokens','notifications'
  ] loop
    execute format($f$
      create policy %1$I_owner_select on %1$I for select using (user_id = auth.uid());
      create policy %1$I_owner_insert on %1$I for insert with check (user_id = auth.uid());
      create policy %1$I_owner_update on %1$I for update using (user_id = auth.uid())
                                                    with check (user_id = auth.uid());
      create policy %1$I_owner_delete on %1$I for delete using (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- profiles keyed on user_id (its PK) rather than a user_id column alias
create policy profiles_owner_select on profiles for select using (user_id = auth.uid());
create policy profiles_owner_insert on profiles for insert with check (user_id = auth.uid());
create policy profiles_owner_update on profiles for update using (user_id = auth.uid())
                                                      with check (user_id = auth.uid());

-- audit_log: the user may read their own trail, but never write or alter it.
create policy audit_owner_select on audit_log for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Child tables — authorise by joining to the owning parent
-- ---------------------------------------------------------------------

-- helper: generate the four policies for a child table given its parent join
create or replace function _child_policies(child text, parent_sql text)
returns void language plpgsql as $$
begin
  execute format('create policy %1$I_owner_select on %1$I for select using (%2$s)', child, parent_sql);
  execute format('create policy %1$I_owner_insert on %1$I for insert with check (%2$s)', child, parent_sql);
  execute format('create policy %1$I_owner_update on %1$I for update using (%2$s) with check (%2$s)', child, parent_sql);
  execute format('create policy %1$I_owner_delete on %1$I for delete using (%2$s)', child, parent_sql);
end $$;

select _child_policies('email_message_labels',
  'exists (select 1 from email_messages m where m.id = email_message_id and m.user_id = auth.uid())');

select _child_policies('email_attachments',
  'exists (select 1 from email_messages m where m.id = email_message_id and m.user_id = auth.uid())');

select _child_policies('event_reminders',
  'exists (select 1 from calendar_events e where e.id = calendar_event_id and e.user_id = auth.uid())');

select _child_policies('task_tags',
  'exists (select 1 from tasks t where t.id = task_id and t.user_id = auth.uid())');

select _child_policies('book_details',
  'exists (select 1 from library_items l where l.id = library_item_id and l.user_id = auth.uid())');
select _child_policies('podcast_details',
  'exists (select 1 from library_items l where l.id = library_item_id and l.user_id = auth.uid())');
select _child_policies('article_details',
  'exists (select 1 from library_items l where l.id = library_item_id and l.user_id = auth.uid())');
select _child_policies('note_details',
  'exists (select 1 from library_items l where l.id = library_item_id and l.user_id = auth.uid())');

select _child_policies('collection_items',
  'exists (select 1 from collections c where c.id = collection_id and c.user_id = auth.uid())');

select _child_policies('annotation_tags',
  'exists (select 1 from annotations a where a.id = annotation_id and a.user_id = auth.uid())');

select _child_policies('assistant_schedule_days',
  'exists (select 1 from assistant_schedules s where s.id = schedule_id and s.user_id = auth.uid())');

-- health children inherit the owner check from health_records
select _child_policies('health_symptoms',
  'exists (select 1 from health_records r where r.id = health_record_id and r.user_id = auth.uid())');
select _child_policies('health_medications',
  'exists (select 1 from health_records r where r.id = health_record_id and r.user_id = auth.uid())');
select _child_policies('health_documents',
  'exists (select 1 from health_records r where r.id = health_record_id and r.user_id = auth.uid())');

drop function _child_policies(text, text);

-- ---------------------------------------------------------------------
-- 4. Health consent gate (database-enforced, not just UI)
--
-- The assistant never queries health_* directly. It may ONLY call
-- assistant_read_health(), which refuses without a live grant and
-- records every access in audit_log. Because the function is SECURITY
-- DEFINER the check cannot be bypassed by the caller.
-- ---------------------------------------------------------------------

create or replace function has_active_health_grant(p_user uuid, p_grantee text default 'assistant')
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from health_access_grants g
     where g.user_id = p_user
       and g.grantee = p_grantee
       and g.revoked_at is null
       and g.expires_at > now()
  );
$$;

create or replace function assistant_read_health(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not has_active_health_grant(p_user, 'assistant') then
    insert into audit_log (user_id, actor, action, detail)
    values (p_user, 'assistant', 'health.read.denied',
            jsonb_build_object('reason', 'no active grant'));
    raise exception 'health access denied: no active grant'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_agg(jsonb_build_object(
           'name', r.name, 'status', r.status, 'severity', r.severity,
           'started_on', r.started_on, 'ended_on', r.ended_on,
           'diagnosis', r.diagnosis,
           'symptoms',    (select jsonb_agg(s.name) from health_symptoms s where s.health_record_id = r.id),
           'medications', (select jsonb_agg(m.name) from health_medications m where m.health_record_id = r.id)
         ))
    into result
    from health_records r
   where r.user_id = p_user;

  insert into audit_log (user_id, actor, action, detail)
  values (p_user, 'assistant', 'health.read.granted',
          jsonb_build_object('records', coalesce(jsonb_array_length(result), 0)));

  return coalesce(result, '[]'::jsonb);
end $$;

revoke all on function assistant_read_health(uuid) from public;
grant execute on function assistant_read_health(uuid) to service_role;

-- ---------------------------------------------------------------------
-- 5. Auto-provision a profile row on signup
-- ---------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, display_name) values (new.id, new.email);
  insert into user_activity (user_id, last_active_at) values (new.id, now());
  insert into assistant_persona (user_id) values (new.id);
  insert into assistant_settings (user_id) values (new.id);
  insert into assistant_conversations (user_id, title, is_primary)
       values (new.id, 'MyPro', true);
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
