-- 昵称 + 匿名发布面经。
--
-- profiles.nickname：用户自己设置的公开昵称，全站唯一（不区分大小写），2–20 个字。
-- 只由后端（service role）写入：PUT /api/profile/nickname 负责格式校验和占用提示。
--
-- interview_experiences.anonymous：发布时选「匿名」为 true，面经库显示「匿名荷包蛋」。
-- 非匿名的面经在读取时显示作者当前的昵称，所以改昵称后旧面经跟着变；
-- 已有的面经 anonymous 默认 false，作者没设昵称时继续显示当时存下的 publisher（保持原样）。

alter table public.profiles add column nickname text;
alter table public.profiles
  add constraint profiles_nickname_length check (nickname is null or char_length(nickname) between 2 and 20);
create unique index profiles_nickname_unique on public.profiles (lower(nickname)) where nickname is not null;

alter table public.interview_experiences add column anonymous boolean not null default false;
