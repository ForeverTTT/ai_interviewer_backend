\set ON_ERROR_STOP on
begin;
do $$
declare
  v_user uuid;
  v_other uuid := gen_random_uuid();
  v_own_interview uuid := gen_random_uuid();
  v_other_interview uuid := gen_random_uuid();
  v_denied boolean;
  v_count integer;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'local auth fixture is required'; end if;
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
    values (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      v_other::text || '@feedback-test.example', now(), now());
  insert into public.interviews (id, user_id, position, language, duration)
    values (v_own_interview, v_user, 'Feedback test', 'English', 10),
      (v_other_interview, v_other, 'Other feedback test', 'English', 10);
  insert into public.user_feedback (feedback_id, user_id, source, message)
    values ('other-feedback-entry', v_other, 'help', 'Hidden from the first user');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.user_feedback (feedback_id, user_id, source, message)
    values ('own-feedback-entry', v_user, 'help', '我的反馈');
  insert into public.user_feedback (feedback_id, user_id, source, rating, interview_id)
    values ('own-interview-feedback', v_user, 'interview', 'up', v_own_interview);
  select count(*) into v_count from public.user_feedback where user_id = v_other;
  if v_count <> 0 then raise exception 'feedback from another user was visible'; end if;

  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, message)
      values ('forged-user-feedback', v_other, 'help', 'Forged');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'could forge the feedback user'; end if;

  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, rating, interview_id)
      values ('forged-interview-feedback', v_user, 'interview', 'down', v_other_interview);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'could attach feedback to another user interview'; end if;

  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, rating)
      values ('missing-interview-feedback', v_user, 'interview', 'up');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'interview feedback allowed without an interview'; end if;

  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, message)
      values ('own-feedback-entry', v_user, 'help', 'Retry');
  exception when unique_violation then v_denied := true; end;
  if not v_denied then raise exception 'duplicate feedback id was not prevented'; end if;

  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, message)
      values ('empty-feedback-entry', v_user, 'help', '   ');
  exception when check_violation then v_denied := true; end;
  if not v_denied then raise exception 'empty support feedback was allowed'; end if;

  v_denied := false;
  begin
    update public.user_feedback set message = 'Changed' where feedback_id = 'own-feedback-entry';
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'feedback records could be edited'; end if;

  perform set_config('role', 'anon', true);
  v_denied := false;
  begin
    perform 1 from public.user_feedback;
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'anonymous users could read feedback'; end if;
end;
$$;
rollback;
