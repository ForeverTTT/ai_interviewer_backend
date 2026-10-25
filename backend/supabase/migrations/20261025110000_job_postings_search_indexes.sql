-- Chinese job searches use substring matching rather than language stemming.
-- Trigram indexes let PostgreSQL serve company/title/direction ILIKE filters
-- without scanning every open posting for every keystroke.
create extension if not exists pg_trgm with schema extensions;

create index if not exists job_postings_open_company_trgm_idx
  on public.job_postings using gin (company extensions.gin_trgm_ops)
  where status = 'open' and sort_date is not null;

create index if not exists job_postings_open_title_trgm_idx
  on public.job_postings using gin (job_title extensions.gin_trgm_ops)
  where status = 'open' and sort_date is not null;

create index if not exists job_postings_open_positions_trgm_idx
  on public.job_postings using gin (positions extensions.gin_trgm_ops)
  where status = 'open' and sort_date is not null;
