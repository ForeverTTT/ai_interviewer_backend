import { mapJobRow, mapJobRows, unmappedHeaders, STALE_AFTER_DAYS } from './feishuImport.js'
import { chinaCalendarDate, chinaCalendarDateDaysAgo } from './chinaDate.js'

/**
 * 把若干张「表」（[{ label, rows, fallback }]，rows 是表头 → 文本的行对象）写进 job_postings。
 * scripts/importJobs.js（Excel / CSV）和 scripts/syncFeishuJobs.js（飞书 API）共用。
 *
 * - 按 external_key upsert，重复导入不会产生重复行。
 * - replace：同一来源下，这次所有表合计里已经没有的来源记录会停用；没有其他有效来源的岗位关闭。
 * - minKeepRatio：replace 前的保险，这次的岗位数不到库里现有数量的这个比例就不删、直接报错
 *   （接口半路出错只拉到一部分时，不至于把整个求职页清空）。
 */
const BATCH = 500

export function statusForDeadline(deadlineDate, now = Date.now()) {
  const today = chinaCalendarDate(now)
  return deadlineDate && deadlineDate < today ? 'closed' : 'open'
}

async function deleteExpiredJobPostings(supabase, today) {
  const { count, error } = await supabase
    .from('job_postings')
    .delete({ count: 'exact' })
    .lt('deadline_date', today)
  if (error) throw error
  return Number(count || 0)
}

function tally(list, pickValues, top = 12) {
  const counts = new Map()
  for (const item of list) for (const v of pickValues(item)) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, n]) => `${k} ${n}`).join('，')
}

async function existingKeys(supabase, source) {
  const keys = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_posting_sources')
      .select('source_key')
      .eq('source_name', source)
      .eq('is_active', true)
      // 分页必须有固定顺序，否则各页之间会重复 / 漏行
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    keys.push(...data.map(r => r.source_key))
    if (data.length < 1000) return keys
  }
}

export async function importJobTables(tables, { supabase, source, sourceType = 'feishu', replace = false, dryRun = false, sample = false, minKeepRatio = 0, requiredMissingRuns = 1, now = Date.now(), log = console.log }) {
  const staleCutoff = chinaCalendarDateDaysAgo(STALE_AFTER_DAYS, now)
  const today = chinaCalendarDate(now)
  const prepared = []

  for (const table of tables) {
    const byKey = new Map()
    let skipped = 0
    let mapped = 0
    for (const row of table.rows) {
      // ATS / 官网 API 的每条记录已经是一个独立职位，标题里的逗号或斜杠不能再按飞书汇总表规则拆开。
      const jobs = sourceType === 'feishu'
        ? mapJobRows(row, { category: table.fallback, source, sourceType })
        : [mapJobRow(row, { category: table.fallback, source, sourceType })].filter(Boolean)
      if (!jobs.length) skipped++
      mapped += jobs.length
      for (const job of jobs) byKey.set(job.external_key, job)
    }
    // 官网仍可能返回已经过截止日的历史职位。按中国大陆日期直接丢弃，
    // 避免过期岗位在下一次同步时又被写回数据库。
    const mappedJobs = [...byKey.values()]
    const expired = mappedJobs.filter(job => statusForDeadline(job.deadline_date, now) === 'closed')
    const jobs = mappedJobs.filter(job => statusForDeadline(job.deadline_date, now) === 'open')
    const open = jobs.filter(j => (j.deadline_date ? j.deadline_date >= today : !j.source_updated_at || j.source_updated_at >= staleCutoff))

    log(`\n[${table.label}]`)
    log(`  行数 ${table.rows.length}，拆分后有效岗位 ${jobs.length}，跳过 ${skipped}（缺公司名、岗位名或说明行），过期 ${expired.length}，重复合并 ${mapped - mappedJobs.length}`)
    if (table.rows[0]) {
      const extra = unmappedHeaders(table.rows[0])
      if (extra.length) log(`  未识别的列（不会导入）: ${extra.join('、')}`)
    }
    log(`  有投递链接 ${jobs.filter(j => j.apply_url).length}，有截止日期 ${jobs.filter(j => j.deadline_date).length}，按「只看未截止」能看到 ${open.length}`)
    log(`  分类: ${tally(jobs, j => [j.category])}`)
    log(`  企业类型: ${tally(jobs, j => [j.company_type || '(空)'])}`)
    log(`  企业分类: ${tally(jobs, j => j.industry_keys, 20)}`)
    log(`  岗位类别: ${tally(jobs, j => j.job_functions, 20)}`)
    log(`  届次: ${tally(jobs, j => j.graduation_years, 10)}`)
    if (dryRun && sample && jobs[0]) log('  示例:', JSON.stringify(jobs[0], null, 2).replace(/\n/g, '\n  '))
    prepared.push({ table, jobs })
  }
  if (dryRun) return { written: 0, deleted: 0 }

  // 每次真实同步都顺便清理已经跨过北京时间截止日的历史岗位。
  const expiredDeleted = await deleteExpiredJobPostings(supabase, today)
  if (expiredDeleted) log(`\n已按北京时间清理过期岗位 ${expiredDeleted} 条`)

  const imported = new Set(prepared.flatMap(p => p.jobs.map(j => j.source_key)))
  // 先检查再写库：数量对不上时一行都不动
  let stale = []
  if (replace) {
    const existing = await existingKeys(supabase, source)
    if (existing.length && imported.size < existing.length * minKeepRatio) {
      throw new Error(`这次只有 ${imported.size} 条岗位，库里来源「${source}」现有 ${existing.length} 条，少得不正常，没有写库。确认无误可加 --force 再跑一次`)
    }
    stale = existing.filter(k => !imported.has(k))
  }

  let written = 0
  for (const { table, jobs } of prepared) {
    for (let i = 0; i < jobs.length; i += BATCH) {
      const { error } = await supabase
        .from('job_postings')
        .upsert(jobs.slice(i, i + BATCH), { onConflict: 'external_key' })
      if (error) throw error
    }
    written += jobs.length
    log(`  [${table.label}] 已写入 ${jobs.length} 条`)
  }

  let closed = 0
  if (replace && stale.length) {
    const { data, error } = await supabase.rpc('deactivate_missing_job_sources', {
      p_source_name: source,
      p_source_keys: [...imported],
      p_required_misses: requiredMissingRuns,
    })
    if (error) throw error
    closed = Number(data || 0)
  }
  if (replace) log(`\n来源「${source}」本次缺失 ${stale.length} 条；连续缺失 ${requiredMissingRuns} 次才停用，其中 ${closed} 个没有其他有效来源的岗位已关闭`)
  return { written, deleted: closed + expiredDeleted }
}
