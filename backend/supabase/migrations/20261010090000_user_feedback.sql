-- Deliberately submitted support messages and post-interview experience ratings.
-- Kept out of product analytics; operators review these in Supabase Table Editor.
create table public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  feedback_id text not null check (feedback_id ~ '^[A-Za-z0-9-]{8,64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('help', 'interview')),
  message text not null default '' check (length(message) <= 2000),
  rating text check (rating in ('up', 'down')),
  interview_id uuid references public.interviews(id) on delete set null,
  page_path text check (length(page_path) <= 160 and page_path ~ '^/[^?#[:space:]]*$' and page_path !~ '^//'),
  created_at timestamptz not null default now(),
  unique (user_id, feedback_id),
  check (length(btrim(message)) > 0 or (source = 'interview' and rating is not null))
);

create index user_feedback_created_idx on public.user_feedback(created_at desc);
create index user_feedback_interview_idx on public.user_feedback(interview_id) where interview_id is not null;

alter table public.user_feedback enable row level security;
revoke all on public.user_feedback from anon, authenticated;
grant select, insert on public.user_feedback to authenticated;
grant all on public.user_feedback to service_role;

create policy "users read own feedback" on public.user_feedback
  for select to authenticated using (user_id = auth.uid());

create policy "users submit own feedback" on public.user_feedback
  for insert to authenticated with check (
    user_id = auth.uid()
    and (source <> 'interview' or interview_id is not null)
    and (interview_id is null or exists (
      select 1 from public.interviews i where i.id = interview_id and i.user_id = auth.uid()
    ))
  );
