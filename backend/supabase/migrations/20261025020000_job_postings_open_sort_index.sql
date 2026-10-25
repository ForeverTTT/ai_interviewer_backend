-- 岗位首页默认按最新日期分页。只为可展示的开放岗位建立紧凑索引，
-- 让 PostgreSQL 沿索引直接读取 20 条，而不是扫描并排序整张表。
create index if not exists job_postings_open_sort_date_nonnull_idx
  on public.job_postings (sort_date desc, id)
  where status = 'open' and sort_date is not null;
