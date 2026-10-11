-- Delivery state is writable only by the service role, never by feedback authors.
alter table public.user_feedback add column digest_sent_at timestamptz;
create index user_feedback_undelivered_idx on public.user_feedback (created_at)
  where digest_sent_at is null;
revoke insert on public.user_feedback from authenticated;
grant insert (feedback_id, user_id, source, message, rating, interview_id, page_path)
  on public.user_feedback to authenticated;

create table public.feedback_digest_runs (
  id uuid primary key default gen_random_uuid(),
  digest_day date not null unique,
  feedback_ids uuid[] not null,
  total_count integer not null check (total_count > 0),
  help_count integer not null,
  interview_count integer not null,
  down_count integer not null,
  recipient text not null,
  sender text not null,
  dashboard_url text not null,
  created_at timestamptz not null default now(),
  first_send_attempt_at timestamptz,
  sent_at timestamptz,
  provider_email_id text
);
alter table public.feedback_digest_runs enable row level security;
revoke all on public.feedback_digest_runs from anon, authenticated;
grant all on public.feedback_digest_runs to service_role;
-- Even callers outside the scheduled workflow cannot create parallel batches.
create unique index feedback_digest_one_pending_idx
  on public.feedback_digest_runs ((true)) where sent_at is null;

create function public.preview_feedback_digest()
returns jsonb language sql security definer set search_path = public
as $$
  select jsonb_build_object(
    'total_count', count(*),
    'help_count', count(*) filter (where source = 'help'),
    'interview_count', count(*) filter (where source = 'interview'),
    'down_count', count(*) filter (where source = 'interview' and rating = 'down')
  ) from public.user_feedback where digest_sent_at is null;
$$;

create function public.prepare_feedback_digest(
  p_day date, p_recipient text, p_sender text, p_dashboard_url text
) returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  batch public.feedback_digest_runs;
  ids uuid[];
  help_total integer;
  interview_total integer;
  down_total integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('feedback_daily_digest', 0));
  if p_day is distinct from (now() at time zone 'Europe/Berlin')::date then
    raise exception 'Digest day must be today in Europe/Berlin';
  end if;
  if exists (select 1 from public.feedback_digest_runs
    where (sent_at at time zone 'Europe/Berlin')::date = p_day) then
    return jsonb_build_object('status', 'already_sent');
  end if;
  -- Retry the exact snapshot and envelope after any interruption.
  select * into batch from public.feedback_digest_runs where sent_at is null for update;
  if found then
    return (to_jsonb(batch) - 'feedback_ids') || jsonb_build_object('status', 'ready');
  end if;
  -- A day's completed batch prevents another email that day even if it was
  -- completed just across midnight. New arrivals are picked up next day.
  if exists (select 1 from public.feedback_digest_runs where digest_day = p_day) then
    return jsonb_build_object('status', 'already_sent');
  end if;
  select array_agg(id order by created_at, id),
    count(*) filter (where source = 'help'),
    count(*) filter (where source = 'interview'),
    count(*) filter (where source = 'interview' and rating = 'down')
  into ids, help_total, interview_total, down_total
  from public.user_feedback where digest_sent_at is null;
  if ids is null then
    return jsonb_build_object('status', 'empty');
  end if;
  insert into public.feedback_digest_runs
    (digest_day, feedback_ids, total_count, help_count, interview_count,
     down_count, recipient, sender, dashboard_url)
  values (p_day, ids, cardinality(ids), help_total, interview_total,
    down_total, p_recipient, p_sender, p_dashboard_url)
  returning * into batch;
  return (to_jsonb(batch) - 'feedback_ids') || jsonb_build_object('status', 'ready');
end;
$$;

create function public.begin_feedback_digest_attempt(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare batch public.feedback_digest_runs;
begin
  update public.feedback_digest_runs
  set first_send_attempt_at = coalesce(first_send_attempt_at, now())
  where id = p_id and sent_at is null returning * into batch;
  if not found then return jsonb_build_object('status', 'already_sent'); end if;
  return (to_jsonb(batch) - 'feedback_ids') || jsonb_build_object('status', 'ready');
end;
$$;

create function public.complete_feedback_digest(p_id uuid, p_provider_id text)
returns void language plpgsql security definer set search_path = public
as $$
declare batch public.feedback_digest_runs;
begin
  if nullif(trim(p_provider_id), '') is null then raise exception 'Email ID required'; end if;
  select * into batch from public.feedback_digest_runs where id = p_id for update;
  if not found then raise exception 'Digest not found'; end if;
  if batch.sent_at is not null then return; end if;
  update public.feedback_digest_runs set sent_at = now(), provider_email_id = p_provider_id
    where id = p_id;
  -- Feedback arriving during delivery is left for the next digest.
  update public.user_feedback set digest_sent_at = now()
    where id = any(batch.feedback_ids) and digest_sent_at is null;
end;
$$;

revoke all on function public.preview_feedback_digest() from public, anon, authenticated;
revoke all on function public.prepare_feedback_digest(date, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_feedback_digest_attempt(uuid) from public, anon, authenticated;
revoke all on function public.complete_feedback_digest(uuid, text) from public, anon, authenticated;
grant execute on function public.preview_feedback_digest() to service_role;
grant execute on function public.prepare_feedback_digest(date, text, text, text) to service_role;
grant execute on function public.begin_feedback_digest_attempt(uuid) to service_role;
grant execute on function public.complete_feedback_digest(uuid, text) to service_role;
