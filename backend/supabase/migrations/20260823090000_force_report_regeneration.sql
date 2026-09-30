drop function if exists public.claim_interview_finalize(uuid, text, integer);

create or replace function public.claim_interview_finalize(
  p_interview_id uuid,
  p_request_id text,
  p_lock_seconds integer default 120,
  p_force boolean default false
)
returns public.interviews
language plpgsql
security invoker
set search_path = public
as $$
declare
  claimed public.interviews;
begin
  update public.interviews
  set
    finalize_status = 'processing',
    finalize_attempts = finalize_attempts + 1,
    finalize_last_error = null,
    finalize_last_error_stage = null,
    finalize_request_id = left(p_request_id, 100),
    finalize_started_at = now()
  where id = p_interview_id
    and user_id = auth.uid()
    and (p_force or not (status = 'completed' and report_json is not null))
    and (
      finalize_status <> 'processing'
      or finalize_started_at is null
      or finalize_started_at < now() - make_interval(secs => greatest(p_lock_seconds, 1))
    )
  returning * into claimed;

  return claimed;
end;
$$;

grant execute on function public.claim_interview_finalize(uuid, text, integer, boolean) to authenticated;

comment on function public.claim_interview_finalize(uuid, text, integer, boolean) is
  'Atomically claims report generation; p_force allows an owner-requested full regeneration.';
