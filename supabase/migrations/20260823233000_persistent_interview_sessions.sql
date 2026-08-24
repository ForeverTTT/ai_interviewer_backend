-- Phase 1: persistent, interview-scoped session state.
-- transcript_json remains the compatibility read model for existing clients/reports.

alter table public.interviews
  add column if not exists mode text not null default 'formal',
  add column if not exists difficulty text not null default 'medium',
  add column if not exists role_track text not null default 'work',
  add column if not exists job_description_snapshot text,
  add column if not exists current_question_id uuid,
  add column if not exists question_index integer not null default 0,
  add column if not exists graph_state_json jsonb not null default '{}'::jsonb,
  add column if not exists state_version bigint not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists paused_at timestamptz,
  add column if not exists accumulated_seconds integer not null default 0,
  add column if not exists deadline_at timestamptz,
  add column if not exists completed_at timestamptz;

update public.interviews
set job_description_snapshot = coalesce(job_description_snapshot, job_description, ''),
    started_at = coalesce(started_at, created_at),
    status = case when status = 'in_progress' then 'active' else status end
where job_description_snapshot is null or started_at is null;

update public.interviews set status = 'active' where status = 'in_progress';

alter table public.interviews
  alter column job_description_snapshot set default '',
  alter column job_description_snapshot set not null;

alter table public.interviews drop constraint if exists interviews_mode_check;
alter table public.interviews
  add constraint interviews_mode_check check (mode in ('practice', 'formal'));
alter table public.interviews drop constraint if exists interviews_difficulty_check;
alter table public.interviews
  add constraint interviews_difficulty_check check (difficulty in ('easy', 'medium', 'hard', 'adaptive'));
alter table public.interviews drop constraint if exists interviews_role_track_check;
alter table public.interviews
  add constraint interviews_role_track_check check (role_track in ('school', 'work'));
alter table public.interviews drop constraint if exists interviews_state_version_check;
alter table public.interviews
  add constraint interviews_state_version_check check (state_version >= 0);
alter table public.interviews drop constraint if exists interviews_status_check;
alter table public.interviews
  add constraint interviews_status_check
  check (status in ('draft', 'active', 'paused', 'finalizing', 'completed', 'abandoned'));
alter table public.interviews alter column status set default 'draft';

create table if not exists public.interview_messages (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null check (length(btrim(content)) > 0),
  sequence bigint not null,
  created_at timestamptz not null default now(),
  unique (interview_id, sequence)
);

create index if not exists interview_messages_interview_sequence_idx
  on public.interview_messages(interview_id, sequence);

create table if not exists public.interview_requests (
  interview_id uuid not null references public.interviews(id) on delete cascade,
  idempotency_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (interview_id, idempotency_key)
);

create or replace function public.claim_interview_request(
  p_interview_id uuid,
  p_user_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_response jsonb;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'interview owner mismatch' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.interviews where id = p_interview_id and user_id = p_user_id
  ) then
    raise exception 'interview not found' using errcode = 'P0002';
  end if;

  insert into public.interview_requests (interview_id, idempotency_key, user_id, response_json)
  values (p_interview_id, p_idempotency_key, p_user_id, '{"pending":true}'::jsonb)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return jsonb_build_object('claimed', true);
  end if;

  -- Let a retry recover an idempotency claim abandoned by a crashed instance.
  update public.interview_requests
  set updated_at = now()
  where interview_id = p_interview_id
    and idempotency_key = p_idempotency_key
    and response_json = '{"pending":true}'::jsonb
    and updated_at < now() - interval '2 minutes';
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    return jsonb_build_object('claimed', true, 'recovered', true);
  end if;

  select response_json into v_response from public.interview_requests
  where interview_id = p_interview_id and idempotency_key = p_idempotency_key;
  if coalesce((v_response->>'pending')::boolean, false) then
    return jsonb_build_object('claimed', false, 'pending', true);
  end if;
  return v_response || jsonb_build_object('claimed', false, 'replay', true);
end;
$$;

create or replace function public.release_interview_request(
  p_interview_id uuid,
  p_user_id uuid,
  p_idempotency_key text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.interview_requests
  where interview_id = p_interview_id
    and user_id = p_user_id
    and idempotency_key = p_idempotency_key
    and response_json = '{"pending":true}'::jsonb
    and (auth.uid() is null or auth.uid() = p_user_id);
$$;

alter table public.interview_messages enable row level security;
alter table public.interview_requests enable row level security;

drop policy if exists "users read own interview messages" on public.interview_messages;
create policy "users read own interview messages" on public.interview_messages
for select to authenticated using (
  exists (
    select 1 from public.interviews i
    where i.id = interview_id and i.user_id = auth.uid()
  )
);

grant select on public.interview_messages to authenticated;
grant all on public.interview_messages, public.interview_requests to service_role;

create or replace function public.commit_interview_turn(
  p_interview_id uuid,
  p_user_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_graph_state jsonb,
  p_messages jsonb default '[]'::jsonb,
  p_transcript jsonb default null,
  p_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview public.interviews%rowtype;
  v_existing jsonb;
  v_response jsonb;
  v_next_sequence bigint;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'interview owner mismatch' using errcode = '42501';
  end if;

  select response_json into v_existing
  from public.interview_requests
  where interview_id = p_interview_id and idempotency_key = p_idempotency_key;
  if found and not coalesce((v_existing->>'pending')::boolean, false) then
    return v_existing || jsonb_build_object('replay', true);
  end if;

  select * into v_interview
  from public.interviews
  where id = p_interview_id and user_id = p_user_id
  for update;

  if not found then
    raise exception 'interview not found' using errcode = 'P0002';
  end if;

  -- Re-check after taking the row lock: another transaction may have committed
  -- this idempotency key while this transaction was waiting.
  select response_json into v_existing
  from public.interview_requests
  where interview_id = p_interview_id and idempotency_key = p_idempotency_key;
  if found and not coalesce((v_existing->>'pending')::boolean, false) then
    return v_existing || jsonb_build_object('replay', true);
  end if;

  if v_interview.state_version <> p_expected_version then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'expectedVersion', p_expected_version,
      'currentVersion', v_interview.state_version
    );
  end if;

  select coalesce(max(sequence), 0) + 1 into v_next_sequence
  from public.interview_messages where interview_id = p_interview_id;

  insert into public.interview_messages (interview_id, question_id, role, content, sequence)
  select
    p_interview_id,
    nullif(item.value->>'questionId', '')::uuid,
    case when item.value->>'role' in ('user', 'assistant', 'system')
      then item.value->>'role' else 'user' end,
    btrim(item.value->>'content'),
    v_next_sequence + item.ordinality - 1
  from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) with ordinality as item(value, ordinality)
  where length(btrim(coalesce(item.value->>'content', ''))) > 0;

  update public.interviews
  set graph_state_json = coalesce(p_graph_state, '{}'::jsonb),
      state_version = state_version + 1,
      question_index = greatest(0, coalesce((p_graph_state->>'planIndex')::integer, question_index)),
      transcript_json = coalesce(p_transcript, transcript_json),
      status = case
        when status in ('completed', 'abandoned') then status
        when p_graph_state->>'phase' = 'closed' then 'finalizing'
        else 'active'
      end,
      completed_at = case
        when status = 'completed' then coalesce(completed_at, now())
        else completed_at
      end
  where id = p_interview_id;

  v_response := jsonb_build_object(
    'ok', true,
    'conflict', false,
    'replay', false,
    'stateVersion', v_interview.state_version + 1
  ) || coalesce(p_response, '{}'::jsonb);

  insert into public.interview_requests (interview_id, idempotency_key, user_id, response_json)
  values (p_interview_id, p_idempotency_key, p_user_id, v_response)
  on conflict (interview_id, idempotency_key)
  do update set response_json = excluded.response_json, updated_at = now();

  return v_response;
end;
$$;

revoke all on function public.commit_interview_turn(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.claim_interview_request(uuid, uuid, text) from public;
revoke all on function public.release_interview_request(uuid, uuid, text) from public;
grant execute on function public.commit_interview_turn(uuid, uuid, bigint, text, jsonb, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.claim_interview_request(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.release_interview_request(uuid, uuid, text) to authenticated, service_role;
