-- 企业招聘来源目录、内容质量以及“连续两次缺失才下架”。

alter table public.job_postings add column if not exists content_quality text not null default 'link_only';
alter table public.job_postings add column if not exists quality_score smallint not null default 15;

update public.job_postings
set content_quality = case
      when is_legacy_aggregate then 'aggregate'
      when length(regexp_replace(coalesce(job_description, ''), '\s', '', 'g')) >= 120 then 'full'
      when length(regexp_replace(coalesce(job_description, ''), '\s', '', 'g')) >= 35 then 'partial'
      else 'link_only'
    end,
    quality_score = case
      when is_legacy_aggregate then case when coalesce(apply_url, jd_url) is null then 20 else 30 end
      when length(regexp_replace(coalesce(job_description, ''), '\s', '', 'g')) >= 120 then
        case source_type when 'official' then 100 when 'ats' then 90 else 75 end
      when length(regexp_replace(coalesce(job_description, ''), '\s', '', 'g')) >= 35 then 55
      when coalesce(apply_url, jd_url) is not null then 40
      else 15
    end;

alter table public.job_postings drop constraint if exists job_postings_content_quality_check;
alter table public.job_postings add constraint job_postings_content_quality_check
  check (content_quality in ('full', 'partial', 'aggregate', 'link_only'));
alter table public.job_postings drop constraint if exists job_postings_quality_score_check;
alter table public.job_postings add constraint job_postings_quality_score_check check (quality_score between 0 and 100);
create index if not exists job_postings_quality_idx on public.job_postings(status, quality_score desc);

alter table public.job_posting_sources add column if not exists missing_snapshot_count integer not null default 0;
alter table public.job_posting_sources add column if not exists last_missing_at timestamptz;

-- 低优先级来源更新主记录时，沿用当前高优先级来源的质量标记。
create or replace function public.preserve_job_posting_quality_by_priority()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.source_priority > new.source_priority then
    new.content_quality := old.content_quality;
    new.quality_score := old.quality_score;
  end if;
  return new;
end;
$$;

drop trigger if exists aa_job_postings_preserve_quality on public.job_postings;
create trigger aa_job_postings_preserve_quality
before update on public.job_postings for each row execute function public.preserve_job_posting_quality_by_priority();

-- 每次在完整快照中重新看到来源，就清空连续缺失计数。
create or replace function public.reset_job_source_missing_count()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_active and (tg_op = 'INSERT' or new.last_seen_at is distinct from old.last_seen_at) then
    new.missing_snapshot_count := 0;
    new.last_missing_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists job_sources_reset_missing_count on public.job_posting_sources;
create trigger job_sources_reset_missing_count
before insert or update on public.job_posting_sources
for each row execute function public.reset_job_source_missing_count();

drop function if exists public.deactivate_missing_job_sources(text, text[]);
create function public.deactivate_missing_job_sources(
  p_source_name text,
  p_source_keys text[],
  p_required_misses integer default 2
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  closed_count integer := 0;
  required_misses integer := greatest(coalesce(p_required_misses, 2), 1);
begin
  update public.job_posting_sources
  set missing_snapshot_count = missing_snapshot_count + 1,
      last_missing_at = now(),
      is_active = case when missing_snapshot_count + 1 >= required_misses then false else true end
  where source_name = p_source_name
    and is_active = true
    and not (source_key = any(coalesce(p_source_keys, '{}'::text[])));

  with closed as (
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
      )
    returning 1
  ) select count(*) into closed_count from closed;

  return closed_count;
end;
$$;

revoke all on function public.deactivate_missing_job_sources(text, text[], integer) from public, anon, authenticated;
grant execute on function public.deactivate_missing_job_sources(text, text[], integer) to service_role;

create table if not exists public.company_job_sources (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  canonical_company_key text not null,
  company_name text not null,
  platform text not null,
  adapter text,
  seed_url text not null,
  status text not null default 'pending',
  discovery_source text not null default '飞书求职汇总表',
  options jsonb not null default '{}'::jsonb,
  last_discovered_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_job_sources_status_check check (status in ('active', 'pending', 'fallback', 'paused', 'unsupported'))
);

create index if not exists company_job_sources_company_idx on public.company_job_sources(canonical_company_key);
create index if not exists company_job_sources_sync_idx on public.company_job_sources(status, platform);

alter table public.company_job_sources enable row level security;
grant all on public.company_job_sources to service_role;
