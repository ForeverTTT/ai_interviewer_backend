-- PGroonga indexes one- and two-character Chinese queries that pg_trgm cannot
-- accelerate, while keeping the existing ILIKE API contract unchanged.
create extension if not exists pgroonga with schema extensions;

create index if not exists job_postings_open_text_pgroonga_idx
  on public.job_postings using pgroonga (company, job_title, positions)
  where status = 'open' and sort_date is not null;
