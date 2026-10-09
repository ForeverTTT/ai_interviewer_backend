-- 求职信息库 + 批量导入面经。
--
-- job_postings：从飞书多维表格导出的 CSV 导入（backend/scripts/importJobs.js），
-- 只有登录用户能读；写入只走 service role。
--
-- interview_experiences：导入的面经（backend/scripts/importExperiences.js）没有站内作者，
-- 所以 user_id 允许为空，用 source 标明出处、external_key 保证重复导入不产生重复行。
-- 导入时直接写成 public / approved / reward_granted，不进审核队列。
-- 「作者删除未发布面经」的 RLS 用 auth.uid() = user_id，user_id 为空的行用户删不掉，只能管理员删。

create table public.job_postings (
  id uuid primary key default gen_random_uuid(),
  external_key text not null unique,
  category text not null,
  company text not null,
  company_type text,
  graduation_years text[] not null default '{}',
  industries text[] not null default '{}',
  positions text,
  locations text[] not null default '{}',
  deadline text,
  deadline_date date,
  education text,
  major_requirement text,
  written_test text,
  apply_url text,
  notes text,
  start_date date,
  source text,
  source_updated_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index job_postings_source_updated_idx on public.job_postings(source_updated_at desc nulls last);
create index job_postings_category_idx on public.job_postings(category);
create index job_postings_deadline_idx on public.job_postings(deadline_date);
create index job_postings_locations_idx on public.job_postings using gin(locations);
create index job_postings_years_idx on public.job_postings using gin(graduation_years);

create trigger job_postings_set_updated_at before update on public.job_postings
for each row execute function public.set_updated_at();

alter table public.job_postings enable row level security;
create policy "members read job postings" on public.job_postings for select to authenticated using (true);
grant select on public.job_postings to authenticated;
grant all on public.job_postings to service_role;

alter table public.interview_experiences alter column user_id drop not null;
alter table public.interview_experiences add column source text;
alter table public.interview_experiences add column external_key text unique;

-- 审核触发器：导入的面经没有作者，审核结果不发通知（user_notifications.user_id 非空，
-- 否则管理员驳回导入面经时会报错）。其余逻辑与 20261009120000 相同。
create or replace function public.handle_experience_review()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  awarded integer := 0;
begin
  -- A resubmission starts a fresh review, so the old rejection reason goes.
  if new.review_status = 'pending' and old.review_status is distinct from 'pending' then
    new.review_note := null;
  end if;

  if new.review_status = 'approved'
     and new.visibility = 'public'
     and not new.reward_granted then
    update public.profiles set tokens = tokens + 200 where id = new.user_id;
    new.reward_granted := true;
    awarded := 200;
  end if;

  if new.review_status is distinct from old.review_status
     and new.review_status in ('approved', 'rejected') then
    new.reviewed_at := now();
    if new.user_id is not null then
      insert into public.user_notifications (user_id, type, payload)
      values (new.user_id, 'experience_review', jsonb_build_object(
        'experience_id', new.id,
        'company', new.company,
        'position', new.position,
        'decision', new.review_status,
        'previous_status', old.review_status,
        'note', new.review_note,
        'tokens_awarded', awarded
      ));
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_experience_review() from public, anon, authenticated;
