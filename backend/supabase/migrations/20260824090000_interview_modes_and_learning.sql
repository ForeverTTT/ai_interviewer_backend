-- Phase 2/3: practice/formal state machines and traceable learning data.

alter table public.interviews
  add column if not exists active_since timestamptz,
  add column if not exists current_difficulty text not null default 'medium',
  add column if not exists reconnect_grace_seconds integer not null default 90,
  add column if not exists last_connected_at timestamptz,
  add column if not exists competency_matrix_json jsonb not null default '[]'::jsonb;

update public.interviews
set active_since = coalesce(active_since, started_at, created_at),
    current_difficulty = case
      when difficulty = 'adaptive' then 'medium'
      else difficulty
    end
where active_since is null;

alter table public.interviews drop constraint if exists interviews_current_difficulty_check;
alter table public.interviews add constraint interviews_current_difficulty_check
  check (current_difficulty in ('easy', 'medium', 'hard'));
alter table public.interviews drop constraint if exists interviews_reconnect_grace_check;
alter table public.interviews add constraint interviews_reconnect_grace_check
  check (reconnect_grace_seconds between 0 and 600);

create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  question_text text not null check (length(btrim(question_text)) > 0),
  question_type text not null default 'general',
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  competency text not null default 'general',
  source text not null default 'generated',
  source_metadata jsonb not null default '{}'::jsonb,
  rubric_json jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('pending', 'active', 'answered', 'mastered', 'skipped')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (interview_id, sequence)
);

create index interview_questions_interview_sequence_idx
  on public.interview_questions(interview_id, sequence);

create table public.interview_attempts (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid not null references public.interview_questions(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  answer_text text not null check (length(btrim(answer_text)) > 0),
  feedback_json jsonb,
  hint_level_used text check (hint_level_used is null or hint_level_used in ('nudge', 'structure', 'key_points', 'example')),
  created_at timestamptz not null default now(),
  unique (question_id, attempt_number)
);

create index interview_attempts_interview_question_idx
  on public.interview_attempts(interview_id, question_id, attempt_number);

create table public.interview_hints (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid not null references public.interview_questions(id) on delete cascade,
  level text not null check (level in ('nudge', 'structure', 'key_points', 'example')),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default now(),
  unique (question_id, level)
);

create table public.interview_notes (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid references public.interview_questions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (interview_id, question_id, user_id)
);

create table public.interview_competency_evidence (
  id uuid primary key default gen_random_uuid(),
  interview_id uuid not null references public.interviews(id) on delete cascade,
  question_id uuid not null references public.interview_questions(id) on delete cascade,
  attempt_id uuid not null references public.interview_attempts(id) on delete cascade,
  competency text not null,
  score numeric(5,2) not null check (score between 0 and 100),
  evidence_json jsonb not null default '[]'::jsonb,
  rubric_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (attempt_id, competency)
);

create index interview_competency_evidence_user_progress_idx
  on public.interview_competency_evidence(interview_id, competency, created_at);

create table public.practice_progress_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_json jsonb not null,
  source_interview_count integer not null default 0,
  generated_at timestamptz not null default now()
);

create index practice_progress_reports_user_generated_idx
  on public.practice_progress_reports(user_id, generated_at desc);

alter table public.interview_questions enable row level security;
alter table public.interview_attempts enable row level security;
alter table public.interview_hints enable row level security;
alter table public.interview_notes enable row level security;
alter table public.interview_competency_evidence enable row level security;
alter table public.practice_progress_reports enable row level security;

create policy "users read own interview questions" on public.interview_questions
for select to authenticated using (exists (
  select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()
));
create policy "users read own interview attempts" on public.interview_attempts
for select to authenticated using (exists (
  select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()
));
create policy "users read own interview hints" on public.interview_hints
for select to authenticated using (exists (
  select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()
));
create policy "users manage own interview notes" on public.interview_notes
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users read own competency evidence" on public.interview_competency_evidence
for select to authenticated using (exists (
  select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()
));
create policy "users read own progress reports" on public.practice_progress_reports
for select to authenticated using (user_id = auth.uid());

grant select on public.interview_questions, public.interview_attempts, public.interview_hints,
  public.interview_competency_evidence, public.practice_progress_reports to authenticated;
grant select, insert, update, delete on public.interview_notes to authenticated;
grant all on public.interview_questions, public.interview_attempts, public.interview_hints,
  public.interview_notes, public.interview_competency_evidence, public.practice_progress_reports to service_role;

create or replace function public.expire_formal_interview_if_due(
  p_interview_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired boolean := false;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'interview owner mismatch' using errcode = '42501';
  end if;

  update public.interviews
  set status = 'finalizing',
      graph_state_json = coalesce(graph_state_json, '{}'::jsonb)
        || jsonb_build_object('phase', 'closed', 'closeReason', 'formal_deadline_reached'),
      state_version = state_version + 1,
      active_since = null
  where id = p_interview_id
    and user_id = p_user_id
    and mode = 'formal'
    and status in ('draft', 'active')
    and deadline_at is not null
    and deadline_at <= now();
  v_expired := found;

  if v_expired then
    insert into public.interview_events (
      interview_id, user_id, event_type, event_source, stage, metadata
    ) values (
      p_interview_id, p_user_id, 'formal_deadline_reached', 'backend', 'deadline', '{}'::jsonb
    );
  end if;
  return v_expired;
end;
$$;

create or replace function public.apply_interview_action(
  p_interview_id uuid,
  p_user_id uuid,
  p_expected_version bigint,
  p_idempotency_key text,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview public.interviews%rowtype;
  v_question public.interview_questions%rowtype;
  v_attempt public.interview_attempts%rowtype;
  v_existing jsonb;
  v_response jsonb;
  v_attempt_number integer;
  v_next_sequence integer;
  v_score numeric(5,2);
  v_hint_level text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'interview owner mismatch' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;

  select * into v_interview from public.interviews
  where id = p_interview_id and user_id = p_user_id for update;
  if not found then raise exception 'interview not found' using errcode = 'P0002'; end if;

  select response_json into v_existing from public.interview_requests
  where interview_id = p_interview_id and idempotency_key = p_idempotency_key;
  if found and not coalesce((v_existing->>'pending')::boolean, false) then
    return v_existing || jsonb_build_object('replay', true);
  end if;
  if not found then
    insert into public.interview_requests(interview_id, idempotency_key, user_id, response_json)
    values (p_interview_id, p_idempotency_key, p_user_id, '{"pending":true}'::jsonb);
  end if;

  if v_interview.state_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'conflict', true, 'currentVersion', v_interview.state_version);
  end if;
  if v_interview.status in ('completed', 'abandoned') then
    raise exception 'interview is locked' using errcode = '55000';
  end if;
  if v_interview.mode = 'formal' and v_interview.deadline_at is not null and v_interview.deadline_at <= now()
      and p_action <> 'deadline' then
    raise exception 'formal interview deadline reached' using errcode = '57014';
  end if;

  if p_action = 'pause' then
    if v_interview.mode <> 'practice' then
      raise exception 'formal interviews cannot be paused' using errcode = '22023';
    end if;
    if v_interview.status <> 'active' then raise exception 'interview is not active' using errcode = '55000'; end if;
    update public.interviews set
      status = 'paused', paused_at = now(),
      accumulated_seconds = accumulated_seconds + greatest(0, extract(epoch from (now() - coalesce(active_since, now())))::integer),
      active_since = null,
      graph_state_json = graph_state_json || jsonb_build_object('phase', 'paused'),
      state_version = state_version + 1
    where id = p_interview_id;
  elsif p_action = 'resume' then
    if v_interview.mode <> 'practice' then
      raise exception 'formal interviews cannot be resumed' using errcode = '22023';
    end if;
    if v_interview.status <> 'paused' then raise exception 'interview is not paused' using errcode = '55000'; end if;
    update public.interviews set status = 'active', paused_at = null, active_since = now(),
      graph_state_json = graph_state_json || jsonb_build_object('phase', 'questioning'),
      state_version = state_version + 1 where id = p_interview_id;
  elsif p_action = 'question' then
    select coalesce(max(sequence), 0) + 1 into v_next_sequence
      from public.interview_questions where interview_id = p_interview_id;
    insert into public.interview_questions (
      id, interview_id, sequence, question_text, question_type, difficulty,
      competency, source, source_metadata, rubric_json, status
    ) values (
      coalesce(nullif(p_payload->>'questionId', '')::uuid, gen_random_uuid()),
      p_interview_id, v_next_sequence, btrim(p_payload->>'questionText'),
      coalesce(nullif(p_payload->>'questionType', ''), 'general'),
      coalesce(nullif(p_payload->>'difficulty', ''), v_interview.current_difficulty),
      coalesce(nullif(p_payload->>'competency', ''), 'general'),
      coalesce(nullif(p_payload->>'source', ''), 'generated'),
      coalesce(p_payload->'sourceMetadata', '{}'::jsonb),
      coalesce(p_payload->'rubric', '{}'::jsonb), 'active'
    ) returning * into v_question;
    update public.interviews set current_question_id = v_question.id,
      question_index = v_question.sequence, status = 'active', active_since = coalesce(active_since, now()),
      competency_matrix_json = coalesce(p_payload->'competencyMatrix', competency_matrix_json),
      graph_state_json = graph_state_json || jsonb_build_object(
        'currentQuestionId', v_question.id, 'questionIndex', v_question.sequence,
        'phase', 'questioning', 'currentDifficulty', v_question.difficulty
      ), state_version = state_version + 1 where id = p_interview_id;
    v_response := jsonb_build_object('question', to_jsonb(v_question));
  elsif p_action = 'attempt' then
    select * into v_question from public.interview_questions
      where id = nullif(p_payload->>'questionId', '')::uuid and interview_id = p_interview_id for update;
    if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
    select coalesce(max(attempt_number), 0) + 1 into v_attempt_number
      from public.interview_attempts where question_id = v_question.id;
    if v_interview.mode = 'formal' and v_attempt_number > 1 then
      raise exception 'formal questions cannot be retried' using errcode = '22023';
    end if;
    select level into v_hint_level from public.interview_hints
      where question_id = v_question.id order by created_at desc limit 1;
    insert into public.interview_attempts (
      interview_id, question_id, attempt_number, answer_text, feedback_json, hint_level_used
    ) values (
      p_interview_id, v_question.id, v_attempt_number, btrim(p_payload->>'answerText'),
      case when v_interview.mode = 'practice' then p_payload->'feedback' else null end,
      v_hint_level
    ) returning * into v_attempt;
    update public.interview_questions set status = 'answered',
      completed_at = case when v_interview.mode = 'formal' then now() else completed_at end
      where id = v_question.id;
    if v_interview.mode = 'formal' then
      update public.interviews set current_question_id = null where id = p_interview_id;
    end if;
    v_score := greatest(0, least(100, coalesce((p_payload->'feedback'->>'score')::numeric, 0)));
    if v_interview.mode = 'practice' and p_payload ? 'feedback' then
      insert into public.interview_competency_evidence (
        interview_id, question_id, attempt_id, competency, score, evidence_json, rubric_json
      ) values (
        p_interview_id, v_question.id, v_attempt.id, v_question.competency, v_score,
        coalesce(p_payload->'feedback'->'evidence', '[]'::jsonb), v_question.rubric_json
      );
    end if;
    update public.interviews set state_version = state_version + 1,
      current_difficulty = case
        when difficulty = 'adaptive' then coalesce(nullif(p_payload->>'nextDifficulty', ''), current_difficulty)
        else current_difficulty end,
      graph_state_json = graph_state_json || jsonb_build_object(
        'lastAttemptId', v_attempt.id,
        'currentDifficulty', case
          when difficulty = 'adaptive' then coalesce(nullif(p_payload->>'nextDifficulty', ''), current_difficulty)
          else current_difficulty end
      )
      where id = p_interview_id;
    v_response := jsonb_build_object('attempt', to_jsonb(v_attempt));
  elsif p_action = 'hint' then
    if v_interview.mode <> 'practice' then raise exception 'formal interviews do not allow hints' using errcode = '22023'; end if;
    select * into v_question from public.interview_questions
      where id = nullif(p_payload->>'questionId', '')::uuid and interview_id = p_interview_id;
    if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
    insert into public.interview_hints(interview_id, question_id, level, content)
      values (p_interview_id, v_question.id, p_payload->>'level', btrim(p_payload->>'content'))
      on conflict (question_id, level) do update set content = excluded.content
      returning to_jsonb(interview_hints.*) into v_response;
    update public.interviews set state_version = state_version + 1 where id = p_interview_id;
  elsif p_action = 'note' then
    if v_interview.mode <> 'practice' then raise exception 'formal interviews do not allow notes' using errcode = '22023'; end if;
    insert into public.interview_notes(interview_id, question_id, user_id, content)
      values (p_interview_id, nullif(p_payload->>'questionId', '')::uuid, p_user_id, coalesce(p_payload->>'content', ''))
      on conflict (interview_id, question_id, user_id) do update
        set content = excluded.content, updated_at = now();
    update public.interviews set state_version = state_version + 1 where id = p_interview_id;
  elsif p_action in ('master', 'skip') then
    if v_interview.mode <> 'practice' then raise exception 'action is only available in practice mode' using errcode = '22023'; end if;
    update public.interview_questions set status = case when p_action = 'master' then 'mastered' else 'skipped' end,
      completed_at = now() where id = nullif(p_payload->>'questionId', '')::uuid
      and interview_id = p_interview_id returning * into v_question;
    if not found then raise exception 'question not found' using errcode = 'P0002'; end if;
    update public.interviews set current_question_id = null, state_version = state_version + 1,
      graph_state_json = graph_state_json - 'currentQuestionId'
      where id = p_interview_id;
    v_response := jsonb_build_object('question', to_jsonb(v_question));
  elsif p_action = 'retry' then
    if v_interview.mode <> 'practice' then raise exception 'formal questions cannot be retried' using errcode = '22023'; end if;
    if not exists (select 1 from public.interview_questions where id = nullif(p_payload->>'questionId', '')::uuid and interview_id = p_interview_id) then
      raise exception 'question not found' using errcode = 'P0002';
    end if;
    update public.interviews set state_version = state_version + 1 where id = p_interview_id;
  elsif p_action = 'reconnect' then
    update public.interviews set last_connected_at = now(), state_version = state_version + 1 where id = p_interview_id;
  else
    raise exception 'unsupported interview action' using errcode = '22023';
  end if;

  insert into public.interview_events (
    interview_id, user_id, request_id, event_type, event_source, stage, metadata
  ) values (
    p_interview_id, p_user_id, left(p_idempotency_key, 100),
    case p_action
      when 'pause' then 'session_paused' when 'resume' then 'session_resumed'
      when 'question' then 'question_generated' when 'attempt' then 'answer_submitted'
      when 'hint' then 'hint_requested' when 'retry' then 'answer_retried'
      when 'master' then 'question_mastered' when 'skip' then 'question_skipped'
      when 'reconnect' then 'reconnected' else 'note_saved' end,
    'backend', p_action, jsonb_build_object('action', p_action)
  );

  if p_action = 'attempt' and v_interview.difficulty = 'adaptive'
      and coalesce(nullif(p_payload->>'nextDifficulty', ''), v_interview.current_difficulty) <> v_interview.current_difficulty then
    insert into public.interview_events (
      interview_id, user_id, request_id, event_type, event_source, stage, metadata
    ) values (
      p_interview_id, p_user_id, left(p_idempotency_key, 100), 'difficulty_adjusted',
      'backend', 'adaptive', jsonb_build_object(
        'from', v_interview.current_difficulty,
        'to', p_payload->>'nextDifficulty',
        'score', v_score
      )
    );
  end if;

  select state_version into p_expected_version from public.interviews where id = p_interview_id;
  v_response := jsonb_build_object('ok', true, 'conflict', false, 'replay', false,
    'stateVersion', p_expected_version) || coalesce(v_response, '{}'::jsonb);
  insert into public.interview_requests(interview_id, idempotency_key, user_id, response_json)
    values (p_interview_id, p_idempotency_key, p_user_id, v_response)
    on conflict (interview_id, idempotency_key) do update
      set response_json = excluded.response_json, updated_at = now();
  return v_response;
end;
$$;

revoke all on function public.expire_formal_interview_if_due(uuid, uuid) from public;
revoke all on function public.apply_interview_action(uuid, uuid, bigint, text, text, jsonb) from public;
grant execute on function public.expire_formal_interview_if_due(uuid, uuid) to authenticated, service_role;
grant execute on function public.apply_interview_action(uuid, uuid, bigint, text, text, jsonb) to authenticated, service_role;
