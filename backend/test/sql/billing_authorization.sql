\set ON_ERROR_STOP on

-- Billing authorization: a signed-in user must not be able to change any
-- balance or the price of an interview through PostgREST (anon key + JWT),
-- while the profile fields the backend writes with a user-scoped client keep
-- working. Runs in one transaction and rolls back.

begin;

do $$
declare
  v_user uuid;
  v_victim constant uuid := '00000000-0000-4000-8000-0000000000b2';
  v_denied boolean;
  v_rows integer;
  v_created jsonb;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'local auth fixture is required'; end if;

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v_victim, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'billing-victim@example.com', now(), now());
  update public.profiles set tokens = 1000, daily_streak = 0, last_activity_at = null
  where id in (v_user, v_victim);

  -- Act as the signed-in user, exactly as PostgREST does for a user JWT.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- 1. The balance is not user-writable.
  v_denied := false;
  begin
    update public.profiles set tokens = 999999 where id = v_user;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could set their own tokens'; end if;

  -- 2. Check-in state gates the daily reward and is not user-writable.
  v_denied := false;
  begin
    update public.profiles set last_activity_at = now() - interval '2 days' where id = v_user;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could rewind last_activity_at'; end if;

  v_denied := false;
  begin
    update public.profiles set daily_streak = 99 where id = v_user;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could set daily_streak'; end if;

  -- 3. A user cannot choose a starting balance when inserting a profile row.
  v_denied := false;
  begin
    insert into public.profiles (id, tokens) values (v_user, 999999) on conflict (id) do nothing;
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could insert a profile with tokens'; end if;

  -- 4. A user cannot drain another user's balance.
  v_denied := false;
  begin
    perform public.deduct_user_tokens(v_victim, 500);
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could call deduct_user_tokens'; end if;

  -- 5. A user cannot create an interview at a price of their choosing.
  v_denied := false;
  begin
    perform public.create_interview_session(
      v_user, 'billing-free-interview', 'Free', '', 'English', 10, '',
      'balanced', 'mixed', 'work', 'formal', 'medium', '[]'::jsonb, 0
    );
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'user could call create_interview_session'; end if;

  -- 6. Fields the backend writes with the user-scoped client still work.
  update public.profiles
  set resume_text = 'resume', resume_notes = 'notes', profile_json = '{"cvProfile":{}}'::jsonb,
      job_search_status = 'seeking', avatar_id = 'professional_female_1',
      resume_coach = '{"generatedAt":"2026-10-01"}'::jsonb, resume_updated_at = now()
  where id = v_user;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'user could not update own profile fields'; end if;

  insert into public.profiles (id, resume_text, resume_notes, profile_json, job_search_status)
  values (v_user, '', '', '{}'::jsonb, 'seeking')
  on conflict (id) do nothing;

  if (select tokens from public.profiles where id = v_user) is null then
    raise exception 'user could not read own balance';
  end if;

  -- 7. The backend (service role) still charges through both functions.
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  v_created := public.create_interview_session(
    v_user, 'billing-paid-interview', 'Paid', '', 'English', 10, '',
    'balanced', 'mixed', 'work', 'formal', 'medium', '[]'::jsonb, 300
  );
  if (v_created->>'tokensDeducted')::integer <> 300 then
    raise exception 'service role creation did not charge 300';
  end if;
  perform public.deduct_user_tokens(v_victim, 200);

  perform set_config('role', 'postgres', true);

  if (select tokens from public.profiles where id = v_user) <> 700 then
    raise exception 'unexpected user balance after paid interview';
  end if;
  if (select tokens from public.profiles where id = v_victim) <> 800 then
    raise exception 'unexpected victim balance after service deduction';
  end if;

  raise notice 'billing authorization assertions passed';
end;
$$;

rollback;
