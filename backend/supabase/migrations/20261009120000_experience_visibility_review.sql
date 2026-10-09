-- Experience visibility and review.
--
-- A shared experience is either private (only the author sees it) or submitted
-- to the public library. Library submissions start as 'pending' and only become
-- visible to others (and to RAG) once a reviewer sets review_status = 'approved'.
-- Approval grants the author +200 tokens exactly once (reward_granted).
-- Rejected posts can be edited by the author and resubmitted (back to 'pending').
--
-- Review happens on /admin/experiences (or by editing review_status in the
-- Supabase dashboard). The trigger below pays the reward and notifies the
-- author through user_notifications, whichever path made the change.

-- 1. Columns. Existing rows were published and rewarded under the old flow, so
-- they are backfilled as public / approved / rewarded; new rows get the new
-- defaults afterwards.
alter table public.interview_experiences
  add column visibility text not null default 'public',
  add column review_status text not null default 'approved',
  add column reward_granted boolean not null default true,
  add column reviewed_at timestamptz,
  -- Optional reason shown to the author when a post is rejected.
  add column review_note text;

alter table public.interview_experiences
  alter column visibility set default 'private',
  alter column review_status set default 'none',
  alter column reward_granted set default false;

alter table public.interview_experiences
  add constraint interview_experiences_visibility_check
    check (visibility in ('private', 'public')),
  add constraint interview_experiences_review_status_check
    check (review_status in ('none', 'pending', 'approved', 'rejected'));

-- Experience types are now internship / campus / experienced. Old 'work'
-- posts (internships and student jobs) become 'internship'; old 'school'
-- posts (university admission) keep their type and are shown as a legacy label.
update public.interview_experiences set type = 'internship' where type = 'work';

create index interview_experiences_library_idx
  on public.interview_experiences(created_at desc)
  where visibility = 'public' and review_status = 'approved';

create index interview_experiences_pending_idx
  on public.interview_experiences(created_at)
  where review_status = 'pending';

-- 2. In-app notifications. Written only by the backend / triggers; users read
-- their own rows and mark them read through the backend.
create table public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index user_notifications_user_created_idx
  on public.user_notifications(user_id, created_at desc);

alter table public.user_notifications enable row level security;
create policy "users read own notifications" on public.user_notifications
  for select to authenticated using (auth.uid() = user_id);
grant select on public.user_notifications to authenticated;
grant all on public.user_notifications to service_role;

-- 3. Reward and notify on review.
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

  return new;
end;
$$;

revoke all on function public.handle_experience_review() from public, anon, authenticated;

create trigger interview_experiences_review
before update on public.interview_experiences
for each row execute function public.handle_experience_review();

-- 4. RLS. Others only see approved library posts; authors see all of their own.
-- Inserts go through the backend (service role), so direct client inserts that
-- could skip review are no longer allowed.
drop policy "anyone reads experiences" on public.interview_experiences;
create policy "read approved or own experiences" on public.interview_experiences
  for select to anon, authenticated
  using (
    (visibility = 'public' and review_status = 'approved')
    or auth.uid() = user_id
  );

drop policy "users insert own experiences" on public.interview_experiences;
revoke insert on public.interview_experiences from authenticated;

-- Authors may delete only posts that are not published; published posts are
-- removed by an admin through the backend (service role).
drop policy "users delete own experiences" on public.interview_experiences;
create policy "users delete own unpublished experiences" on public.interview_experiences
  for delete to authenticated
  using (auth.uid() = user_id and review_status <> 'approved');
