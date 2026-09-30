-- Interviewer type is immutable session configuration. Add database-level
-- guards for practice mastery while preserving existing interviews as mixed.

alter table public.interviews
  add column if not exists interviewer_type text not null default 'mixed';

alter table public.interviews drop constraint if exists interviews_interviewer_type_check;
alter table public.interviews add constraint interviews_interviewer_type_check
  check (interviewer_type in ('hr', 'technical', 'mixed'));

alter table public.interviews_backup
  add column if not exists interviewer_type text not null default 'mixed';

alter table public.interviews_backup drop constraint if exists interviews_backup_interviewer_type_check;
alter table public.interviews_backup add constraint interviews_backup_interviewer_type_check
  check (interviewer_type in ('hr', 'technical', 'mixed'));

drop function if exists public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, jsonb, integer
);

create function public.create_interview_session(
  p_user_id uuid,
  p_idempotency_key text,
  p_position text,
  p_job_description text,
  p_language text,
  p_duration integer,
  p_resume_snapshot text,
  p_interviewer_style text,
  p_interviewer_type text,
  p_role_track text,
  p_mode text,
  p_difficulty text,
  p_competency_matrix jsonb,
  p_token_cost integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing jsonb;
  v_interview public.interviews%rowtype;
  v_tokens integer;
  v_effective_difficulty text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'user mismatch' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_position, ''))) = 0 or length(btrim(coalesce(p_language, ''))) = 0
      or p_duration <= 0 then
    raise exception 'position, language, and positive duration are required' using errcode = '22023';
  end if;

  select tokens into v_tokens from public.profiles where id = p_user_id for update;
  if not found then raise exception 'profile not found' using errcode = 'P0002'; end if;

  select response_json into v_existing from public.interview_creation_requests
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then return v_existing || jsonb_build_object('replay', true); end if;

  if v_tokens < greatest(0, p_token_cost) then
    raise exception 'insufficient tokens' using errcode = 'P0001';
  end if;

  v_effective_difficulty := case when p_difficulty = 'adaptive' then 'medium' else p_difficulty end;
  insert into public.interviews (
    user_id, position, job_description, job_description_snapshot, language, duration,
    resume_snapshot, interviewer_style, interviewer_type, role_track, mode, difficulty,
    current_difficulty, competency_matrix_json, status, state_version, graph_state_json,
    started_at, active_since, deadline_at
  ) values (
    p_user_id, btrim(p_position), btrim(coalesce(p_job_description, '')),
    btrim(coalesce(p_job_description, '')), p_language, p_duration,
    nullif(left(btrim(coalesce(p_resume_snapshot, '')), 50000), ''),
    case when p_interviewer_style in ('balanced', 'supportive', 'demanding', 'analytical') then p_interviewer_style else 'balanced' end,
    case when p_interviewer_type in ('hr', 'technical', 'mixed') then p_interviewer_type else 'mixed' end,
    case when p_role_track in ('school', 'work') then p_role_track else 'work' end,
    case when p_mode in ('practice', 'formal') then p_mode else 'formal' end,
    case when p_difficulty in ('easy', 'medium', 'hard', 'adaptive') then p_difficulty else 'medium' end,
    case when v_effective_difficulty in ('easy', 'medium', 'hard') then v_effective_difficulty else 'medium' end,
    coalesce(p_competency_matrix, '[]'::jsonb), 'active', 0,
    jsonb_build_object('interviewerType', case when p_interviewer_type in ('hr', 'technical', 'mixed') then p_interviewer_type else 'mixed' end),
    now(), now(),
    case when p_mode = 'practice' then null else now() + make_interval(mins => p_duration) end
  ) returning * into v_interview;

  update public.profiles set tokens = tokens - greatest(0, p_token_cost) where id = p_user_id;
  v_existing := jsonb_build_object(
    'interview', to_jsonb(v_interview),
    'tokensDeducted', greatest(0, p_token_cost),
    'remainingTokens', v_tokens - greatest(0, p_token_cost),
    'replay', false
  );
  insert into public.interview_creation_requests(user_id, idempotency_key, response_json)
    values (p_user_id, p_idempotency_key, v_existing);
  return v_existing;
end;
$$;

revoke all on function public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, text, jsonb, integer
) from public;
grant execute on function public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, text, jsonb, integer
) to authenticated, service_role;

create or replace function public.guard_practice_question_mastery()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'mastered' and old.status is distinct from 'mastered'
      and not exists (select 1 from public.interview_attempts a where a.question_id = new.id) then
    raise exception 'answer the question before marking it mastered' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists interview_questions_guard_mastery on public.interview_questions;
create trigger interview_questions_guard_mastery
before update of status on public.interview_questions
for each row execute function public.guard_practice_question_mastery();

