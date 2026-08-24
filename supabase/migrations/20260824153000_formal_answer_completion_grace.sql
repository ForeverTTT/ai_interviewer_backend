-- Let a candidate finish the question already on screen when the formal
-- deadline arrives. No new question may be created after this transition.

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
    and deadline_at <= now()
    and current_question_id is null;
  v_expired := found;

  if v_expired then
    insert into public.interview_events (
      interview_id, user_id, event_type, event_source, stage, metadata
    ) values (
      p_interview_id, p_user_id, 'formal_deadline_reached', 'backend', 'deadline',
      jsonb_build_object('answerGraceUsed', false)
    );
  end if;
  return v_expired;
end;
$$;

create or replace function public.complete_formal_answer_after_deadline(
  p_interview_id uuid,
  p_user_id uuid,
  p_idempotency_key text,
  p_answer_text text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview public.interviews%rowtype;
  v_question public.interview_questions%rowtype;
  v_attempt_number integer;
  v_state_version bigint;
  v_existing jsonb;
  v_response jsonb;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'interview owner mismatch' using errcode = '42501';
  end if;
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'idempotency key is required' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_answer_text, ''))) = 0 then
    raise exception 'answer text is required' using errcode = '22023';
  end if;

  select * into v_interview from public.interviews
  where id = p_interview_id and user_id = p_user_id for update;
  if not found then raise exception 'interview not found' using errcode = 'P0002'; end if;

  select response_json into v_existing from public.interview_requests
  where interview_id = p_interview_id and idempotency_key = p_idempotency_key;
  if found and not coalesce((v_existing->>'pending')::boolean, false) then
    return v_existing || jsonb_build_object('replay', true);
  end if;

  if v_interview.mode <> 'formal' or v_interview.deadline_at is null or v_interview.deadline_at > now() then
    raise exception 'formal deadline has not been reached' using errcode = '22023';
  end if;
  if v_interview.status not in ('draft', 'active', 'finalizing') then
    raise exception 'interview is locked' using errcode = '55000';
  end if;
  if v_interview.current_question_id is null then
    raise exception 'no current question to complete' using errcode = '55000';
  end if;

  select * into v_question from public.interview_questions
  where id = v_interview.current_question_id and interview_id = p_interview_id for update;
  if not found then raise exception 'question not found' using errcode = 'P0002'; end if;

  select coalesce(max(attempt_number), 0) + 1 into v_attempt_number
  from public.interview_attempts where question_id = v_question.id;
  if v_attempt_number > 1 then
    raise exception 'formal questions cannot be retried' using errcode = '22023';
  end if;

  insert into public.interview_attempts (
    interview_id, question_id, attempt_number, answer_text
  ) values (
    p_interview_id, v_question.id, v_attempt_number, btrim(p_answer_text)
  );

  update public.interview_questions
  set status = 'answered', completed_at = now()
  where id = v_question.id;

  update public.interviews
  set current_question_id = null,
      status = 'finalizing',
      active_since = null,
      graph_state_json = coalesce(graph_state_json, '{}'::jsonb)
        || jsonb_build_object('phase', 'closed', 'closeReason', 'formal_deadline_answer_completed'),
      state_version = state_version + 1
  where id = p_interview_id
  returning state_version into v_state_version;

  insert into public.interview_events (
    interview_id, user_id, event_type, event_source, stage, metadata
  ) values (
    p_interview_id, p_user_id, 'formal_deadline_answer_completed', 'backend', 'deadline',
    jsonb_build_object('questionId', v_question.id, 'answerGraceUsed', true)
  );

  v_response := jsonb_build_object('ok', true, 'deadlineReached', true, 'stateVersion', v_state_version);
  insert into public.interview_requests(interview_id, idempotency_key, user_id, response_json)
  values (p_interview_id, p_idempotency_key, p_user_id, v_response)
  on conflict (interview_id, idempotency_key) do update
    set response_json = excluded.response_json, updated_at = now();
  return v_response;
end;
$$;

revoke all on function public.complete_formal_answer_after_deadline(uuid, uuid, text, text) from public;
grant execute on function public.complete_formal_answer_after_deadline(uuid, uuid, text, text) to authenticated, service_role;
