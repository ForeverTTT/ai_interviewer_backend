-- Growth Center phases 2 and 3:
-- unified question collections, auditable effective-training events, and
-- report-backed readiness metadata without duplicating interview sessions.

create table if not exists public.interview_question_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interview_id uuid references public.interviews(id) on delete set null,
  question_id uuid references public.interview_questions(id) on delete set null,
  question_index integer,
  origin_key text not null,
  question_text text not null check (length(btrim(question_text)) > 0),
  answer_text text not null default '',
  feedback_snapshot jsonb not null default '{}'::jsonb,
  position text not null default '',
  language text not null default 'English',
  interviewer_type text not null default 'mixed'
    check (interviewer_type in ('hr', 'technical', 'mixed')),
  source text not null check (source in ('practice', 'report')),
  personal_note text,
  tags text[] not null default '{}'::text[],
  is_pinned boolean not null default false,
  review_status text not null default 'to_review'
    check (review_status in ('to_review', 'reviewed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, origin_key)
);

create index if not exists interview_question_collections_user_review_idx
  on public.interview_question_collections(user_id, review_status, is_pinned desc, updated_at desc);
create index if not exists interview_question_collections_user_position_idx
  on public.interview_question_collections(user_id, position, interviewer_type, source);
create index if not exists interview_question_collections_tags_idx
  on public.interview_question_collections using gin(tags);

create table if not exists public.interview_training_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interview_id uuid references public.interviews(id) on delete set null,
  event_type text not null
    check (event_type in ('valid_answer', 'interview_completed', 'system_task_completed', 'effective_duration')),
  dedupe_key text not null,
  activity_date date not null default (timezone('utc', now()))::date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists interview_training_events_user_date_idx
  on public.interview_training_events(user_id, activity_date desc, created_at desc);

alter table public.interview_question_collections enable row level security;
alter table public.interview_training_events enable row level security;

drop policy if exists "users manage own question collections" on public.interview_question_collections;
create policy "users manage own question collections"
  on public.interview_question_collections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users read own training events" on public.interview_training_events;
create policy "users read own training events"
  on public.interview_training_events for select
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.interview_question_collections to authenticated;
grant select on public.interview_training_events to authenticated;
grant all on public.interview_question_collections, public.interview_training_events to service_role;

create or replace function public.set_growth_center_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists interview_question_collections_updated_at on public.interview_question_collections;
create trigger interview_question_collections_updated_at
before update on public.interview_question_collections
for each row execute function public.set_growth_center_updated_at();

create or replace function public.record_effective_answer_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  -- The answer route has already rejected empty submissions. Re-check the
  -- persisted fact here so only server-accepted, non-empty answers count.
  if length(btrim(new.answer_text)) < 1 then return new; end if;
  select user_id into v_user_id from public.interviews where id = new.interview_id;
  if v_user_id is null then return new; end if;
  insert into public.interview_training_events(user_id, interview_id, event_type, dedupe_key, metadata)
  values (
    v_user_id,
    new.interview_id,
    'valid_answer',
    'attempt:' || new.id::text,
    jsonb_build_object('questionId', new.question_id, 'answerLength', length(btrim(new.answer_text)))
  ) on conflict (user_id, dedupe_key) do nothing;
  return new;
end;
$$;

drop trigger if exists interview_attempt_effective_training on public.interview_attempts;
create trigger interview_attempt_effective_training
after insert on public.interview_attempts
for each row execute function public.record_effective_answer_event();

create or replace function public.record_interview_training_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.interview_training_events(user_id, interview_id, event_type, dedupe_key, metadata)
    values (new.user_id, new.id, 'interview_completed', 'completed:' || new.id::text,
      jsonb_build_object('mode', new.mode, 'completedAt', coalesce(new.completed_at, now())))
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  if coalesce(new.accumulated_seconds, 0) >= 480 and coalesce(old.accumulated_seconds, 0) < 480 then
    insert into public.interview_training_events(user_id, interview_id, event_type, dedupe_key, metadata)
    values (new.user_id, new.id, 'effective_duration', 'duration-8m:' || new.id::text,
      jsonb_build_object('accumulatedSeconds', new.accumulated_seconds))
    on conflict (user_id, dedupe_key) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists interviews_growth_training_milestones on public.interviews;
create trigger interviews_growth_training_milestones
after update on public.interviews
for each row execute function public.record_interview_training_milestones();

-- Preserve existing private practice notes as the optional personal_note on
-- the same question/answer/feedback collection structure.
insert into public.interview_question_collections (
  user_id, interview_id, question_id, origin_key, question_text, answer_text,
  feedback_snapshot, position, language, interviewer_type, source, personal_note,
  review_status, created_at, updated_at
)
select
  n.user_id,
  n.interview_id,
  n.question_id,
  'practice:' || n.interview_id::text || ':' || n.question_id::text,
  q.question_text,
  coalesce(a.answer_text, ''),
  coalesce(a.feedback_json, '{}'::jsonb),
  i.position,
  i.language,
  i.interviewer_type,
  'practice',
  nullif(n.content, ''),
  'to_review',
  n.created_at,
  n.updated_at
from public.interview_notes n
join public.interviews i on i.id = n.interview_id and i.user_id = n.user_id
join public.interview_questions q on q.id = n.question_id
left join lateral (
  select answer_text, feedback_json
  from public.interview_attempts
  where question_id = n.question_id
  order by attempt_number desc
  limit 1
) a on true
where length(btrim(n.content)) > 0
on conflict (user_id, origin_key) do update set
  personal_note = excluded.personal_note,
  answer_text = excluded.answer_text,
  feedback_snapshot = excluded.feedback_snapshot,
  updated_at = greatest(public.interview_question_collections.updated_at, excluded.updated_at);
