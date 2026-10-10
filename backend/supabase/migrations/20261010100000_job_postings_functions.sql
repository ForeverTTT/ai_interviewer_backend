-- 岗位类别（技术 / 产品 / 运营 …），由 importJobs.js 根据「招聘岗位」关键词归类，
-- 存类别 key（见 backend/src/lib/feishuImport.js 的 JOB_FUNCTIONS），一条招聘可以有多个。
-- 已有数据需要重新跑一遍导入才会有类别。

alter table public.job_postings add column job_functions text[] not null default '{}';
create index job_postings_functions_idx on public.job_postings using gin(job_functions);
