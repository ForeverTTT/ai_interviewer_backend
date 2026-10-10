-- 企业分类（互联网 / 汽车 / 金融 …），由 importJobs.js 根据行业类别、公司名、表格分类归类，
-- 存分类 key（见 backend/src/lib/jobTaxonomy.js 的 INDUSTRIES），一条招聘可以有多个。
-- 面经库按公司名复用这里的分类（GET /api/experiences 返回时计算，不落库）。
-- 已有数据需要重新跑一遍导入才会有分类。

alter table public.job_postings add column industry_keys text[] not null default '{}';
create index job_postings_industries_idx on public.job_postings using gin(industry_keys);
