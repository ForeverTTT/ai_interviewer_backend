-- Hotjob API 使用数字 recruitType，但公开详情页要求语义化 postType。
-- 修复历史数字链接，同时关闭已经明确过截止日的职位。

update public.job_postings
set apply_url = replace(replace(replace(replace(apply_url,
      'postType=13', 'postType=overseas'),
      'postType=12', 'postType=intern'),
      'postType=2', 'postType=social'),
      'postType=1', 'postType=campus')
where apply_url like 'https://wecruit.hotjob.cn/%'
  and apply_url ~ 'postType=(1|2|12|13)(&|$)';

update public.job_postings
set jd_url = replace(replace(replace(replace(jd_url,
      'postType=13', 'postType=overseas'),
      'postType=12', 'postType=intern'),
      'postType=2', 'postType=social'),
      'postType=1', 'postType=campus')
where jd_url like 'https://wecruit.hotjob.cn/%'
  and jd_url ~ 'postType=(1|2|12|13)(&|$)';

update public.job_posting_sources
set apply_url = replace(replace(replace(replace(apply_url,
      'postType=13', 'postType=overseas'),
      'postType=12', 'postType=intern'),
      'postType=2', 'postType=social'),
      'postType=1', 'postType=campus'),
    source_url = replace(replace(replace(replace(source_url,
      'postType=13', 'postType=overseas'),
      'postType=12', 'postType=intern'),
      'postType=2', 'postType=social'),
      'postType=1', 'postType=campus')
where (apply_url like 'https://wecruit.hotjob.cn/%' and apply_url ~ 'postType=(1|2|12|13)(&|$)')
   or (source_url like 'https://wecruit.hotjob.cn/%' and source_url ~ 'postType=(1|2|12|13)(&|$)');

update public.job_postings
set status = 'closed'
where status = 'open'
  and deadline_date is not null
  and deadline_date < (now() at time zone 'Asia/Shanghai')::date;
