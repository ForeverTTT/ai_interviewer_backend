-- 区分「岗位发布时间」与「来源更新时间」。
-- sort_date 只用于列表排序：优先官网发布时间，缺失时回退到来源更新日期。

alter table public.job_postings
  add column if not exists published_at date;

-- 旧版导入器把「发布时间」写到 start_date；官网/ATS 记录可安全回填。
update public.job_postings
set published_at = start_date
where published_at is null
  and source_type in ('official', 'ats')
  and start_date is not null;

alter table public.job_postings
  add column if not exists sort_date date
  generated always as (coalesce(published_at, source_updated_at)) stored;

create index if not exists job_postings_open_sort_date_idx
  on public.job_postings(status, sort_date desc, id);

-- 低优先级来源合并时不得清空已有的官方发布日期。
create or replace function public.preserve_job_published_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.published_at is null or old.source_priority > new.source_priority then
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

drop trigger if exists job_postings_zz_preserve_published_at on public.job_postings;
create trigger job_postings_zz_preserve_published_at
before update on public.job_postings
for each row execute function public.preserve_job_published_at();
