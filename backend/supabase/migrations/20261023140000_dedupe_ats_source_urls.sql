-- ATS 的一个官方职位 URL 只应对应一个岗位。
-- 历史代码曾把含逗号/斜杠的 ATS 标题当成飞书汇总行拆分，这里在新快照成功后停用旧拆分来源。
create or replace function public.dedupe_active_job_source_urls(p_source_name text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  deactivated_count integer := 0;
begin
  with ranked as (
    select id,
           row_number() over (
             partition by source_name, source_url
             order by last_seen_at desc, id desc
           ) as rank
    from public.job_posting_sources
    where source_name = p_source_name
      and source_type = 'ats'
      and is_active = true
      and source_url is not null
  ), deactivated as (
    update public.job_posting_sources s
    set is_active = false,
        last_missing_at = now()
    from ranked r
    where s.id = r.id and r.rank > 1
    returning 1
  ) select count(*) into deactivated_count from deactivated;

  update public.job_postings j
  set status = 'closed'
  where j.status <> 'closed'
    and exists (
      select 1 from public.job_posting_sources s
      where s.job_posting_id = j.id and s.source_name = p_source_name
    )
    and not exists (
      select 1 from public.job_posting_sources s
      where s.job_posting_id = j.id and s.is_active = true
    );

  return deactivated_count;
end;
$$;

revoke all on function public.dedupe_active_job_source_urls(text) from public, anon, authenticated;
grant execute on function public.dedupe_active_job_source_urls(text) to service_role;
