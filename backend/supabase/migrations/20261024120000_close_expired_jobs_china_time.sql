-- 中国大陆岗位以北京时间的自然日判断是否截止。
-- 截止日当天仍可展示；从次日 00:00（Asia/Shanghai）起关闭，定时清理任务再物理删除。

update public.job_postings
set status = 'closed'
where status <> 'closed'
  and deadline_date is not null
  and deadline_date < (now() at time zone 'Asia/Shanghai')::date;
