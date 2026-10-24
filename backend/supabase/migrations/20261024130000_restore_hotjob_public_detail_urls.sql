-- Hotjob 的公开详情页要求 campus/social/intern/overseas 作为 postType。
-- 数字 1/2/12/13 只用于后端接口的 recruitType；放进网页 URL 会一直停在“正在加载中”。

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
