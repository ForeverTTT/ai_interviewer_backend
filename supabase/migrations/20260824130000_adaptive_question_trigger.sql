-- Keep the persisted effective adaptive level aligned with every generated
-- question, including questions produced by the legacy LangGraph/live routes.

create or replace function public.sync_adaptive_difficulty_from_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interview public.interviews%rowtype;
begin
  select * into v_interview from public.interviews where id = new.interview_id for update;
  if v_interview.difficulty = 'adaptive' and v_interview.current_difficulty <> new.difficulty then
    update public.interviews
    set current_difficulty = new.difficulty,
        graph_state_json = graph_state_json || jsonb_build_object('currentDifficulty', new.difficulty)
    where id = new.interview_id;
    insert into public.interview_events (
      interview_id, user_id, event_type, event_source, stage, metadata
    ) values (
      new.interview_id, v_interview.user_id, 'difficulty_adjusted', 'backend', 'question_generation',
      jsonb_build_object('from', v_interview.current_difficulty, 'to', new.difficulty, 'questionId', new.id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists interview_questions_sync_adaptive_difficulty on public.interview_questions;
create trigger interview_questions_sync_adaptive_difficulty
after insert on public.interview_questions
for each row execute function public.sync_adaptive_difficulty_from_question();

