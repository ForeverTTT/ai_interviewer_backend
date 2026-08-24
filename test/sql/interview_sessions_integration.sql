\set ON_ERROR_STOP on

begin;

do $$
declare
  v_user uuid;
  v_practice uuid;
  v_other uuid;
  v_formal uuid;
  v_question uuid;
  v_formal_question uuid;
  v_version bigint := 0;
  v_result jsonb;
  v_creation_first jsonb;
  v_creation_replay jsonb;
  v_failed boolean;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'local auth fixture is required'; end if;
  update public.profiles set tokens = 1000 where id = v_user;

  v_creation_first := public.create_interview_session(
    v_user, 'sql-create-idempotent', 'Creation Test', 'API', 'English', 10, '',
    'balanced', 'technical', 'work', 'formal', 'medium', '[]'::jsonb, 300
  );
  v_creation_replay := public.create_interview_session(
    v_user, 'sql-create-idempotent', 'SHOULD NOT CREATE', 'API', 'English', 10, '',
    'balanced', 'hr', 'work', 'formal', 'medium', '[]'::jsonb, 300
  );
  if v_creation_first->'interview'->>'id' <> v_creation_replay->'interview'->>'id' then
    raise exception 'creation replay returned a different interview';
  end if;
  if not coalesce((v_creation_replay->>'replay')::boolean, false) then
    raise exception 'creation request was not replayed';
  end if;
  if v_creation_replay->'interview'->>'interviewer_type' <> 'technical' then
    raise exception 'idempotent replay changed interviewer type';
  end if;
  if (select tokens from public.profiles where id = v_user) <> 700 then
    raise exception 'idempotent creation deducted tokens more than once';
  end if;

  insert into public.interviews (
    user_id, position, job_description, job_description_snapshot, language, duration,
    interviewer_type, mode, difficulty, current_difficulty, status, started_at, active_since,
    graph_state_json, state_version
  ) values (
    v_user, 'Backend Engineer A', 'Node PostgreSQL', 'Node PostgreSQL', 'English', 30,
    'technical', 'practice', 'adaptive', 'medium', 'active', now(), now(), '{}'::jsonb, 0
  ) returning id into v_practice;

  insert into public.interviews (
    user_id, position, job_description, job_description_snapshot, language, duration,
    interviewer_type, mode, difficulty, current_difficulty, status, started_at, active_since,
    graph_state_json, state_version
  ) values (
    v_user, 'Data Analyst B', 'SQL analytics', 'SQL analytics', 'English', 30,
    'hr', 'practice', 'easy', 'easy', 'active', now(), now(), '{}'::jsonb, 0
  ) returning id into v_other;

  v_question := gen_random_uuid();
  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-question-1', 'question',
    jsonb_build_object(
      'questionId', v_question,
      'questionText', 'How would you isolate a cascading database failure?',
      'questionType', 'case', 'difficulty', 'medium',
      'competency', 'technical_depth', 'source', 'experience_rag',
      'rubric', jsonb_build_object('criteria', jsonb_build_array('failure isolation'))
    )
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if v_version <> 1 then raise exception 'question did not advance version'; end if;

  -- Same idempotency key must replay without inserting another question.
  v_result := public.apply_interview_action(
    v_practice, v_user, 0, 'sql-question-1', 'question',
    jsonb_build_object('questionText', 'DUPLICATE', 'difficulty', 'hard')
  );
  if not coalesce((v_result->>'replay')::boolean, false) then raise exception 'question was not replayed'; end if;
  if (select count(*) from public.interview_questions where interview_id = v_practice) <> 1 then
    raise exception 'idempotent replay duplicated a question';
  end if;
  if (select state_version from public.interviews where id = v_other) <> 0 then
    raise exception 'second interview was contaminated';
  end if;

  -- A practice question cannot be marked mastered before any answer exists.
  v_failed := false;
  begin
    perform public.apply_interview_action(
      v_practice, v_user, v_version, 'sql-master-before-answer', 'master',
      jsonb_build_object('questionId', v_question)
    );
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'unanswered question was marked mastered'; end if;

  -- Checkpoint + append-only messages are committed together.
  v_result := public.commit_interview_turn(
    v_practice, v_user, v_version, 'sql-turn-1',
    '{"phase":"questioning","planIndex":1}'::jsonb,
    '[{"role":"assistant","content":"Question A"}]'::jsonb,
    '[{"role":"assistant","content":"Question A"}]'::jsonb,
    '{}'::jsonb
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select count(*) from public.interview_messages where interview_id = v_practice) <> 1 then
    raise exception 'message append failed';
  end if;

  -- A stale writer sees a conflict and cannot overwrite the newer checkpoint.
  v_result := public.commit_interview_turn(
    v_practice, v_user, v_version - 1, 'sql-stale-turn',
    '{"phase":"corrupted"}'::jsonb, '[]'::jsonb, null, '{}'::jsonb
  );
  if not coalesce((v_result->>'conflict')::boolean, false) then raise exception 'stale write was accepted'; end if;
  if (select graph_state_json->>'phase' from public.interviews where id = v_practice) <> 'questioning' then
    raise exception 'stale checkpoint overwrote state';
  end if;
  delete from public.interview_requests where interview_id = v_practice and idempotency_key = 'sql-stale-turn';

  v_result := public.apply_interview_action(v_practice, v_user, v_version, 'sql-pause', 'pause', '{}');
  v_version := (v_result->>'stateVersion')::bigint;
  if (select status from public.interviews where id = v_practice) <> 'paused' then raise exception 'pause failed'; end if;
  v_result := public.apply_interview_action(v_practice, v_user, v_version, 'sql-resume', 'resume', '{}');
  v_version := (v_result->>'stateVersion')::bigint;

  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-hint', 'hint',
    jsonb_build_object('questionId', v_question, 'level', 'nudge', 'content', 'Start with the first failed dependency.')
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select count(*) from public.interview_hints where question_id = v_question) <> 1 then raise exception 'hint failed'; end if;

  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-note', 'note',
    jsonb_build_object('questionId', v_question, 'content', 'Mention circuit breakers')
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select content from public.interview_notes where question_id = v_question and user_id = v_user) <> 'Mention circuit breakers' then
    raise exception 'note failed';
  end if;

  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-attempt-1', 'attempt',
    jsonb_build_object(
      'questionId', v_question, 'answerText', 'I would isolate the dependency.',
      'feedback', jsonb_build_object('score', 90, 'evidence', jsonb_build_array(jsonb_build_object('claim', 'isolate'))),
      'nextDifficulty', 'hard'
    )
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select current_difficulty from public.interviews where id = v_practice) <> 'hard' then
    raise exception 'adaptive difficulty did not increase';
  end if;
  if (select count(*) from public.interview_competency_evidence where interview_id = v_practice) <> 1 then
    raise exception 'competency evidence missing';
  end if;
  if not exists (select 1 from public.interview_events where interview_id = v_practice and event_type = 'difficulty_adjusted') then
    raise exception 'adaptive event missing';
  end if;

  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-retry', 'retry', jsonb_build_object('questionId', v_question)
  );
  v_version := (v_result->>'stateVersion')::bigint;
  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-attempt-2', 'attempt',
    jsonb_build_object(
      'questionId', v_question, 'answerText', 'I would isolate it, add a circuit breaker, and test recovery.',
      'feedback', jsonb_build_object('score', 82, 'evidence', '[]'::jsonb),
      'nextDifficulty', 'hard'
    )
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select count(*) from public.interview_attempts where question_id = v_question) <> 2 then raise exception 'retry attempt missing'; end if;

  v_result := public.apply_interview_action(
    v_practice, v_user, v_version, 'sql-master', 'master', jsonb_build_object('questionId', v_question)
  );
  if (select status from public.interview_questions where id = v_question) <> 'mastered' then raise exception 'master failed'; end if;

  -- Formal mode: continuous deadline, no pause/hints/retries.
  insert into public.interviews (
    user_id, position, job_description, job_description_snapshot, language, duration,
    interviewer_type, mode, difficulty, current_difficulty, status, started_at, active_since, deadline_at,
    graph_state_json, state_version
  ) values (
    v_user, 'Formal Engineer', 'Systems', 'Systems', 'English', 30,
    'technical', 'formal', 'hard', 'hard', 'active', now(), now(), now() + interval '30 minutes', '{}'::jsonb, 0
  ) returning id into v_formal;

  v_failed := false;
  begin
    perform public.apply_interview_action(v_formal, v_user, 0, 'formal-pause', 'pause', '{}');
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'formal pause was allowed'; end if;

  v_formal_question := gen_random_uuid();
  v_result := public.apply_interview_action(
    v_formal, v_user, 0, 'formal-question', 'question',
    jsonb_build_object('questionId', v_formal_question, 'questionText', 'Explain the trade-off.', 'difficulty', 'hard')
  );
  v_version := (v_result->>'stateVersion')::bigint;
  v_result := public.apply_interview_action(
    v_formal, v_user, v_version, 'formal-attempt-1', 'attempt',
    jsonb_build_object('questionId', v_formal_question, 'answerText', 'A concise answer', 'feedback', jsonb_build_object('score', 99))
  );
  v_version := (v_result->>'stateVersion')::bigint;
  if (select feedback_json from public.interview_attempts where question_id = v_formal_question) is not null then
    raise exception 'formal feedback was persisted or exposed early';
  end if;
  v_failed := false;
  begin
    perform public.apply_interview_action(
      v_formal, v_user, v_version, 'formal-attempt-2', 'attempt',
      jsonb_build_object('questionId', v_formal_question, 'answerText', 'Duplicate answer')
    );
  exception when sqlstate '22023' then v_failed := true;
  end;
  if not v_failed then raise exception 'formal retry was allowed'; end if;

  update public.interviews set deadline_at = now() - interval '1 second' where id = v_formal;
  if not public.expire_formal_interview_if_due(v_formal, v_user) then raise exception 'deadline did not expire'; end if;
  if (select status from public.interviews where id = v_formal) <> 'finalizing' then raise exception 'deadline did not lock interview'; end if;
  if not exists (select 1 from public.interview_events where interview_id = v_formal and event_type = 'formal_deadline_reached') then
    raise exception 'deadline event missing';
  end if;

  raise notice 'persistent interview integration assertions passed';
end;
$$;

rollback;
