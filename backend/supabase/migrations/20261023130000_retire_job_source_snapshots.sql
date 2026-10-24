-- ATS 来源目录合并别名后，只在新租户快照成功写入后停用旧快照。
-- 仍有飞书或其他有效来源的岗位保持开放；没有任何有效来源的岗位才关闭。
create or replace function public.retire_job_source_snapshots(p_source_names text[])
returns integer language plpgsql security definer set search_path = public as $$
declare
  closed_count integer := 0;
begin
  update public.job_posting_sources
  set is_active = false,
      last_missing_at = now()
  where is_active = true
    and source_name = any(coalesce(p_source_names, '{}'::text[]));

  with closed as (
    update public.job_postings j
    set status = 'closed'
    where j.status <> 'closed'
      and exists (
        select 1 from public.job_posting_sources s
        where s.job_posting_id = j.id
          and s.source_name = any(coalesce(p_source_names, '{}'::text[]))
      )
      and not exists (
        select 1 from public.job_posting_sources s
        where s.job_posting_id = j.id and s.is_active = true
      )
    returning 1
  ) select count(*) into closed_count from closed;

  return closed_count;
end;
$$;

revoke all on function public.retire_job_source_snapshots(text[]) from public, anon, authenticated;
grant execute on function public.retire_job_source_snapshots(text[]) to service_role;
