-- 岗位库改为「一个岗位 + 一家公司」的主记录，并单独保存飞书、官网等来源。
-- external_key / canonical_key 不含来源名称，因此同一岗位可跨来源合并。

alter table public.job_postings add column if not exists job_title text;
alter table public.job_postings add column if not exists job_description text;
alter table public.job_postings add column if not exists jd_url text;
alter table public.job_postings add column if not exists department text;
alter table public.job_postings add column if not exists employment_type text;
alter table public.job_postings add column if not exists source_type text not null default 'feishu';
alter table public.job_postings add column if not exists source_priority integer not null default 50;
alter table public.job_postings add column if not exists source_job_id text;
alter table public.job_postings add column if not exists canonical_key text;
alter table public.job_postings add column if not exists source_key text;
alter table public.job_postings add column if not exists status text not null default 'open';
alter table public.job_postings add column if not exists is_legacy_aggregate boolean not null default false;

update public.job_postings
set job_title = coalesce(nullif(trim(positions), ''), company),
    canonical_key = coalesce(canonical_key, external_key),
    source_key = coalesce(source_key, 'legacy:' || external_key),
    is_legacy_aggregate = case
      when positions ~ E'[\\n,，、;；|]' then true
      else is_legacy_aggregate
    end
where job_title is null or canonical_key is null or source_key is null;

alter table public.job_postings alter column job_title set not null;
alter table public.job_postings add constraint job_postings_status_check check (status in ('open', 'closed', 'unknown'));
create unique index if not exists job_postings_canonical_key_idx on public.job_postings(canonical_key);
create index if not exists job_postings_status_idx on public.job_postings(status);

create table if not exists public.job_posting_sources (
  id uuid primary key default gen_random_uuid(),
  job_posting_id uuid not null references public.job_postings(id) on delete cascade,
  source_key text not null unique,
  source_type text not null,
  source_name text not null,
  source_external_id text,
  source_url text,
  apply_url text,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists job_posting_sources_job_idx on public.job_posting_sources(job_posting_id);
create index if not exists job_posting_sources_name_active_idx on public.job_posting_sources(source_name, is_active);

insert into public.job_posting_sources (
  job_posting_id, source_key, source_type, source_name, source_external_id, source_url, apply_url
)
select id, source_key, source_type, coalesce(source, '历史导入'), source_job_id, jd_url, apply_url
from public.job_postings
where source_key is not null
on conflict (source_key) do nothing;

create or replace function public.sync_job_posting_source()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.source_key is null or new.source is null then
    return new;
  end if;
  insert into public.job_posting_sources (
    job_posting_id, source_key, source_type, source_name, source_external_id, source_url, apply_url,
    is_active, last_seen_at
  ) values (
    new.id, new.source_key, coalesce(new.source_type, 'feishu'), new.source,
    new.source_job_id, new.jd_url, new.apply_url, true, now()
  )
  on conflict (source_key) do update set
    job_posting_id = excluded.job_posting_id,
    source_type = excluded.source_type,
    source_name = excluded.source_name,
    source_external_id = excluded.source_external_id,
    source_url = excluded.source_url,
    apply_url = excluded.apply_url,
    is_active = true,
    last_seen_at = now();
  return new;
end;
$$;

-- 迁移完成到新版后端部署之间，旧同步脚本仍可能运行；自动补齐新字段，避免这段窗口导入失败。
create or replace function public.ensure_job_posting_compat_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  new.job_title := coalesce(nullif(trim(new.job_title), ''), nullif(trim(new.positions), ''), new.company);
  new.canonical_key := coalesce(new.canonical_key, new.external_key);
  new.source_key := coalesce(new.source_key, 'legacy:' || new.external_key);
  if new.positions ~ E'[\\n,，、;；|]' then new.is_legacy_aggregate := true; end if;
  return new;
end;
$$;

drop trigger if exists job_postings_ensure_compat_fields on public.job_postings;
create trigger job_postings_ensure_compat_fields
before insert on public.job_postings for each row execute function public.ensure_job_posting_compat_fields();

-- 官网数据比 ATS、飞书汇总和用户粘贴更接近原始 JD。低优先级来源仍会被记录到
-- job_posting_sources，但不能覆盖已经存在的高优先级岗位正文。
create or replace function public.merge_job_posting_by_source_priority()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status <> 'closed' and new.source_key is not null and new.source is not null then
    insert into public.job_posting_sources (
      job_posting_id, source_key, source_type, source_name, source_external_id, source_url, apply_url,
      is_active, last_seen_at
    ) values (
      old.id, new.source_key, coalesce(new.source_type, 'feishu'), new.source,
      new.source_job_id, new.jd_url, new.apply_url, true, now()
    )
    on conflict (source_key) do update set
      job_posting_id = excluded.job_posting_id,
      source_type = excluded.source_type,
      source_name = excluded.source_name,
      source_external_id = excluded.source_external_id,
      source_url = excluded.source_url,
      apply_url = excluded.apply_url,
      is_active = true,
      last_seen_at = now();
  end if;

  if old.source_priority > new.source_priority then
    new.category := old.category;
    new.company := old.company;
    new.company_type := old.company_type;
    new.graduation_years := old.graduation_years;
    new.industries := old.industries;
    new.industry_keys := old.industry_keys;
    new.positions := old.positions;
    new.job_title := old.job_title;
    new.job_description := old.job_description;
    new.jd_url := old.jd_url;
    new.department := old.department;
    new.employment_type := old.employment_type;
    new.job_functions := old.job_functions;
    new.locations := old.locations;
    new.deadline := old.deadline;
    new.deadline_date := old.deadline_date;
    new.education := old.education;
    new.major_requirement := old.major_requirement;
    new.written_test := old.written_test;
    new.apply_url := old.apply_url;
    new.notes := old.notes;
    new.start_date := old.start_date;
    new.source_priority := old.source_priority;
    new.source_updated_at := old.source_updated_at;
    new.is_legacy_aggregate := old.is_legacy_aggregate;
  end if;
  return new;
end;
$$;

drop trigger if exists job_postings_merge_source_priority on public.job_postings;
create trigger job_postings_merge_source_priority
before update on public.job_postings for each row execute function public.merge_job_posting_by_source_priority();

drop trigger if exists job_postings_sync_source on public.job_postings;
create trigger job_postings_sync_source
after insert
on public.job_postings for each row execute function public.sync_job_posting_source();

create or replace function public.deactivate_missing_job_sources(
  p_source_name text,
  p_source_keys text[]
)
returns integer language plpgsql security definer set search_path = public as $$
declare
  closed_count integer := 0;
begin
  update public.job_posting_sources
  set is_active = false, last_seen_at = now()
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

revoke all on function public.deactivate_missing_job_sources(text, text[]) from public, anon, authenticated;
grant execute on function public.deactivate_missing_job_sources(text, text[]) to service_role;

alter table public.job_posting_sources enable row level security;
create policy "members read job sources" on public.job_posting_sources for select to authenticated using (true);
grant select on public.job_posting_sources to authenticated;
grant all on public.job_posting_sources to service_role;
