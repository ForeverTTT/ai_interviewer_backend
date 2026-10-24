-- 岗位页筛选项的持久化派生快照。岗位主表仍是唯一真实数据源；同步任务成功计算完整
-- payload 后原子替换 current，读取端无需为每位用户扫描全部开放岗位。

create table if not exists public.job_facets_snapshot (
  snapshot_key text primary key,
  payload jsonb not null,
  job_count integer not null check (job_count >= 0),
  generated_at timestamptz not null default now(),
  schema_version integer not null default 1 check (schema_version > 0),
  constraint job_facets_snapshot_single_key check (snapshot_key = 'current')
);

comment on table public.job_facets_snapshot is
  'Derived current job-filter counts, atomically refreshed after company job syncs.';

alter table public.job_facets_snapshot enable row level security;
revoke all on table public.job_facets_snapshot from public, anon, authenticated;
grant all on table public.job_facets_snapshot to service_role;
