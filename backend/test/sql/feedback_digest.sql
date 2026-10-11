\set ON_ERROR_STOP on
begin;
-- All fixtures and mutations in this integration test are rolled back.
delete from public.feedback_digest_runs;
delete from public.user_feedback;
do $$
declare
  v_user uuid;
  v_interview uuid := gen_random_uuid();
  v_batch jsonb;
  v_again jsonb;
  v_id uuid;
  v_count integer;
  v_denied boolean;
  v_day date := (now() at time zone 'Europe/Berlin')::date;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'local auth fixture is required'; end if;
  insert into public.interviews (id, user_id, position, language, duration)
    values (v_interview, v_user, 'Digest test', 'English', 10);
  perform set_config('role', 'service_role', true);
  v_batch := public.prepare_feedback_digest(v_day, 'owner@example.com', 'FlowLab <mail@example.com>', 'https://example.com');
  if v_batch->>'status' <> 'empty' then raise exception 'empty database must not create a digest'; end if;
  insert into public.user_feedback (feedback_id, user_id, source, message, rating, interview_id)
    values ('digest-help-test', v_user, 'help', 'Private message', null, null),
      ('digest-interview-test', v_user, 'interview', '', 'down', v_interview);
  v_batch := public.prepare_feedback_digest(v_day, 'owner@example.com', 'FlowLab <mail@example.com>', 'https://example.com');
  v_id := (v_batch->>'id')::uuid;
  if v_batch->>'total_count' <> '2' or v_batch->>'help_count' <> '1'
    or v_batch->>'interview_count' <> '1' or v_batch->>'down_count' <> '1'
    or v_batch ? 'feedback_ids' then raise exception 'wrong snapshot summary'; end if;
  insert into public.user_feedback (feedback_id, user_id, source, message)
    values ('digest-late-test', v_user, 'help', 'Arrived after snapshot');
  v_again := public.prepare_feedback_digest(v_day, 'changed@example.com', 'Other <mail@example.com>', 'https://other.example.com');
  if v_again <> v_batch then raise exception 'retry changed the snapshot or envelope'; end if;
  v_batch := public.begin_feedback_digest_attempt(v_id);
  if v_batch->>'first_send_attempt_at' is null then raise exception 'attempt time was not persisted'; end if;
  v_again := public.begin_feedback_digest_attempt(v_id);
  if v_again <> v_batch then raise exception 'retry changed attempt time'; end if;
  perform public.complete_feedback_digest(v_id, 'test-provider-id');
  perform public.complete_feedback_digest(v_id, 'test-provider-id');
  select count(*) into v_count from public.user_feedback where digest_sent_at is not null;
  if v_count <> 2 then raise exception 'completion marked wrong feedback rows'; end if;
  if public.preview_feedback_digest()->>'total_count' <> '1' then raise exception 'late feedback was lost'; end if;
  v_again := public.prepare_feedback_digest(v_day, 'owner@example.com', 'FlowLab <mail@example.com>', 'https://example.com');
  if v_again->>'status' <> 'already_sent' then raise exception 'second email allowed on same day'; end if;

  -- Simulate a later calendar day; only the arrival outside the old snapshot
  -- is eligible, including when more than 24 hours have elapsed.
  update public.feedback_digest_runs set digest_day = v_day - 2,
    sent_at = now() - interval '2 days' where id = v_id;
  v_again := public.prepare_feedback_digest(v_day, 'owner@example.com', 'FlowLab <mail@example.com>', 'https://example.com');
  if v_again->>'total_count' <> '1' or v_again->>'help_count' <> '1'
    or v_again->>'interview_count' <> '0' then raise exception 'next digest lost or repeated feedback'; end if;
  v_id := (v_again->>'id')::uuid;
  perform public.begin_feedback_digest_attempt(v_id);
  perform public.complete_feedback_digest(v_id, 'second-provider-id');
  if public.preview_feedback_digest()->>'total_count' <> '0' then raise exception 'second snapshot not acknowledged'; end if;

  -- Simulate an unattempted batch prepared yesterday: resume it rather than
  -- forgetting its contents when the next scheduled job starts.
  update public.feedback_digest_runs set sent_at = null, digest_day = v_day - 1,
    first_send_attempt_at = null, provider_email_id = null where id = v_id;
  v_again := public.prepare_feedback_digest(v_day, 'owner@example.com', 'FlowLab <mail@example.com>', 'https://example.com');
  if v_again->>'id' <> v_id::text then raise exception 'pending batch was not resumed'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  v_denied := false;
  begin
    perform public.preview_feedback_digest();
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could access global feedback counts'; end if;
  v_denied := false;
  begin
    perform public.prepare_feedback_digest(v_day, 'thief@example.com', 'Fake <mail@example.com>', 'https://example.com');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could prepare digest'; end if;
  v_denied := false;
  begin
    perform public.begin_feedback_digest_attempt(v_id);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could claim digest'; end if;
  v_denied := false;
  begin
    perform public.complete_feedback_digest(v_id, 'forged');
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could acknowledge delivery'; end if;
  v_denied := false;
  begin
    perform 1 from public.feedback_digest_runs;
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could see recipients'; end if;
  v_denied := false;
  begin
    insert into public.user_feedback (feedback_id, user_id, source, message, digest_sent_at)
      values ('digest-forged-state', v_user, 'help', 'Hide me', now());
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'user could bypass notifications'; end if;
  -- Existing submission endpoint still works with its exact insert columns.
  insert into public.user_feedback (feedback_id, user_id, source, message, rating, interview_id, page_path)
    values ('digest-normal-submit', v_user, 'help', 'Allowed', null, null, '/setup');
end;
$$;
rollback;
