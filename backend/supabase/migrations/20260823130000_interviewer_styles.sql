alter table public.interviews
  add column if not exists interviewer_style text not null default 'balanced';

alter table public.interviews
  drop constraint if exists interviews_interviewer_style_check;

alter table public.interviews
  add constraint interviews_interviewer_style_check
  check (interviewer_style in ('balanced', 'supportive', 'demanding', 'analytical'));

alter table public.interviews_backup
  add column if not exists interviewer_style text not null default 'balanced';

alter table public.interviews_backup
  drop constraint if exists interviews_backup_interviewer_style_check;

alter table public.interviews_backup
  add constraint interviews_backup_interviewer_style_check
  check (interviewer_style in ('balanced', 'supportive', 'demanding', 'analytical'));
