-- Make interview creation and its token charge one atomic idempotent operation.

create table public.interview_creation_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  response_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

alter table public.interview_creation_requests enable row level security;
grant all on public.interview_creation_requests to service_role;

create or replace function public.create_interview_session(
  p_user_id uuid,
  p_idempotency_key text,
  p_position text,
  p_job_description text,
  p_language text,
  p_duration integer,
  p_resume_snapshot text,
  p_interviewer_style text,
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

  -- The profile lock serializes concurrent creation attempts for this user,
  -- including attempts using different idempotency keys.
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
    resume_snapshot, interviewer_style, role_track, mode, difficulty, current_difficulty,
    competency_matrix_json, status, state_version, graph_state_json, started_at, active_since,
    deadline_at
  ) values (
    p_user_id, btrim(p_position), btrim(coalesce(p_job_description, '')),
    btrim(coalesce(p_job_description, '')), p_language, p_duration,
    nullif(left(btrim(coalesce(p_resume_snapshot, '')), 50000), ''),
    case when p_interviewer_style in ('balanced', 'supportive', 'demanding', 'analytical') then p_interviewer_style else 'balanced' end,
    case when p_role_track in ('school', 'work') then p_role_track else 'work' end,
    case when p_mode in ('practice', 'formal') then p_mode else 'formal' end,
    case when p_difficulty in ('easy', 'medium', 'hard', 'adaptive') then p_difficulty else 'medium' end,
    case when v_effective_difficulty in ('easy', 'medium', 'hard') then v_effective_difficulty else 'medium' end,
    coalesce(p_competency_matrix, '[]'::jsonb), 'active', 0, '{}'::jsonb, now(), now(),
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
  uuid, text, text, text, text, integer, text, text, text, text, text, jsonb, integer
) from public;
grant execute on function public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, jsonb, integer
) to authenticated, service_role;

