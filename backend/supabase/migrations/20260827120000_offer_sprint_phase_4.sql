-- Growth Center phase 4: Offer sprint goals, weekly tasks, evidence-backed
-- milestones, and user-controlled reminder outbox.

create table if not exists public.growth_offer_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  target_position text not null check (length(btrim(target_position)) > 0),
  target_job_description text not null default '',
  next_interview_date date,
  target_offer_date date,
  interviewer_type text not null default 'mixed'
    check (interviewer_type in ('hr', 'technical', 'mixed')),
  weekly_target_days integer not null default 5
    check (weekly_target_days in (3, 5, 7)),
  timezone text not null default 'Europe/Berlin',
  reminder_preferences jsonb not null default
    '{"inApp":true,"browser":false,"email":false,"weeklyReport":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.growth_offer_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.growth_offer_plans(id) on delete cascade,
  week_start date not null,
  task_key text not null,
  task_type text not null check (task_type in (
    'baseline', 'focus_question', 'formal_mock', 'review_collection',
    'pre_interview_checklist', 'self_intro', 'weekly_review'
  )),
  stage text not null check (stage in ('foundation', 'focused', 'imminent', 'final48', 'interview_day', 'renew')),
  priority integer not null default 100,
  estimated_minutes integer not null default 8 check (estimated_minutes between 3 and 60),
  dimension text,
  source_interview_id uuid references public.interviews(id) on delete set null,
  question_index integer,
  collection_id uuid references public.interview_question_collections(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped', 'expired')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, task_key)
);

create index if not exists growth_offer_tasks_user_week_idx
  on public.growth_offer_tasks(user_id, week_start desc, status, priority);

create table if not exists public.growth_offer_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.growth_offer_plans(id) on delete cascade,
  reminder_key text not null,
  reminder_type text not null check (reminder_type in ('interview_7d', 'interview_2d', 'interview_day', 'weekly_report')),
  channel text not null check (channel in ('in_app', 'browser', 'email')),
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'read', 'dismissed', 'sent', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, reminder_key, channel)
);

create index if not exists growth_offer_reminders_due_idx
  on public.growth_offer_reminders(user_id, status, scheduled_for);

create table if not exists public.growth_milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone_key text not null,
  milestone_type text not null check (milestone_type in ('first_formal_report', 'streak_5', 'readiness_gain_15')),
  evidence jsonb not null default '{}'::jsonb,
  earned_at timestamptz not null default now(),
  unique (user_id, milestone_key)
);

alter table public.growth_offer_plans enable row level security;
alter table public.growth_offer_tasks enable row level security;
alter table public.growth_offer_reminders enable row level security;
alter table public.growth_milestones enable row level security;

drop policy if exists "users manage own offer plan" on public.growth_offer_plans;
create policy "users manage own offer plan" on public.growth_offer_plans for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users read own offer tasks" on public.growth_offer_tasks;
create policy "users read own offer tasks" on public.growth_offer_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "users update own offer tasks" on public.growth_offer_tasks;

drop policy if exists "users read own offer reminders" on public.growth_offer_reminders;
create policy "users read own offer reminders" on public.growth_offer_reminders for select
  using (auth.uid() = user_id);

drop policy if exists "users update own offer reminders" on public.growth_offer_reminders;

drop policy if exists "users read own growth milestones" on public.growth_milestones;
create policy "users read own growth milestones" on public.growth_milestones for select
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.growth_offer_plans to authenticated;
revoke update on public.growth_offer_tasks, public.growth_offer_reminders from authenticated;
grant select on public.growth_offer_tasks, public.growth_offer_reminders to authenticated;
grant select on public.growth_milestones to authenticated;
grant all on public.growth_offer_plans, public.growth_offer_tasks,
  public.growth_offer_reminders, public.growth_milestones to service_role;

drop trigger if exists growth_offer_plans_updated_at on public.growth_offer_plans;
create trigger growth_offer_plans_updated_at before update on public.growth_offer_plans
for each row execute function public.set_growth_center_updated_at();

drop trigger if exists growth_offer_tasks_updated_at on public.growth_offer_tasks;
create trigger growth_offer_tasks_updated_at before update on public.growth_offer_tasks
for each row execute function public.set_growth_center_updated_at();

drop trigger if exists growth_offer_reminders_updated_at on public.growth_offer_reminders;
create trigger growth_offer_reminders_updated_at before update on public.growth_offer_reminders
for each row execute function public.set_growth_center_updated_at();
