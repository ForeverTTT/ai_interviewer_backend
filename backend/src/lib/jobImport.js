import { mapJobRow, unmappedHeaders, STALE_AFTER_DAYS } from './feishuImport.js'

/**
 * 把若干张「表」（[{ label, rows, fallback }]，rows 是表头 → 文本的行对象）写进 job_postings。
 * scripts/importJobs.js（Excel / CSV）和 scripts/syncFeishuJobs.js（飞书 API）共用。
 *
 * - 按 external_key upsert，重复导入不会产生重复行。
 * - replace：同一来源下，这次所有表合计里已经没有的旧岗位删掉。
 * - minKeepRatio：replace 前的保险，这次的岗位数不到库里现有数量的这个比例就不删、直接报错
 *   （接口半路出错只拉到一部分时，不至于把整个求职页清空）。
 */
const BATCH = 500

function tally(list, pickValues, top = 12) {
  const counts = new Map()
  for (const item of list) for (const v of pickValues(item)) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, n]) => `${k} ${n}`).join('，')
}

async function existingKeys(supabase, source) {
  const keys = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_postings')
      .select('external_key')
      .eq('source', source)
      // 分页必须有固定顺序，否则各页之间会重复 / 漏行
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    keys.push(...data.map(r => r.external_key))
    if (data.length < 1000) return keys
  }
}

export async function importJobTables(tables, { supabase, source, replace = false, dryRun = false, sample = false, minKeepRatio = 0, log = console.log }) {
  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 86400000).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const prepared = []

  for (const table of tables) {
    const byKey = new Map()
    let skipped = 0
    for (const row of table.rows) {
      const job = mapJobRow(row, { category: table.fallback, source })
      if (job) byKey.set(job.external_key, job)
      else skipped++
    }
    const jobs = [...byKey.values()]
    const open = jobs.filter(j => (j.deadline_date ? j.deadline_date >= today : !j.source_updated_at || j.source_updated_at >= staleCutoff))

    log(`\n[${table.label}]`)
    log(`  行数 ${table.rows.length}，有效岗位 ${jobs.length}，跳过 ${skipped}（缺公司名或说明行），重复合并 ${table.rows.length - skipped - jobs.length}`)
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

  const imported = new Set(prepared.flatMap(p => p.jobs.map(j => j.external_key)))
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

  for (let i = 0; i < stale.length; i += 100) {
    const { error } = await supabase.from('job_postings').delete().in('external_key', stale.slice(i, i + 100))
    if (error) throw error
  }
  if (replace) log(`\n来源「${source}」下已删除这次导入里没有的旧岗位 ${stale.length} 条`)
  return { written, deleted: stale.length }
}
