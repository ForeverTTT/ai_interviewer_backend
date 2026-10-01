-- Billing authorization hardening.
--
-- Before this migration a signed-in user could, with only the public anon key:
--   * set profiles.tokens to any value (table-level UPDATE + "update own profile" RLS);
--   * rewind profiles.last_activity_at / daily_streak to claim the check-in reward again;
--   * call deduct_user_tokens for any user id (security definer, no caller check);
--   * call create_interview_session with p_token_cost = 0.
--
-- Balances and check-in state are now written only by the backend service role.
-- Users keep write access to the profile fields the backend writes on their
-- behalf through a user-scoped client.
--
-- Deploy order: the backend that calls create_interview_session with the
-- service role and performs check-in writes with the service role must be live
-- before this migration runs; otherwise interview creation fails with 42501.

-- 1. profiles: column-level write privileges instead of table-level.
revoke insert, update on public.profiles from anon, authenticated;

grant insert (id, resume_text, resume_notes, profile_json, job_search_status)
  on public.profiles to authenticated;

grant update (
  resume_text,
  resume_notes,
  profile_json,
  job_search_status,
  avatar_id,
  resume_coach,
  resume_updated_at
) on public.profiles to authenticated;

-- 2. deduct_user_tokens: service role only. Supabase grants EXECUTE on new
-- public functions to anon and authenticated by default, so revoke explicitly.
revoke all on function public.deduct_user_tokens(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.deduct_user_tokens(uuid, integer) to service_role;

-- 3. create_interview_session: service role only, so the caller can no longer
-- choose p_token_cost. The function's auth.uid() guard stays as defence in depth.
revoke all on function public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.create_interview_session(
  uuid, text, text, text, text, integer, text, text, text, text, text, text, jsonb, integer
) to service_role;
