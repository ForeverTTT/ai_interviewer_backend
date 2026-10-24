const PAGE_SIZE = 1000
const WRITE_BATCH = 100

async function readIds(table, column, configure = query => query) {
  const ids = []
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = table.select(column).order('id').range(from, from + PAGE_SIZE - 1)
    query = configure(query)
    const { data, error } = await query
    if (error) throw error
    ids.push(...data.map(row => row[column]).filter(Boolean))
    if (data.length < PAGE_SIZE) return ids
  }
}

export function legacyOnlyJobIds(feishuJobIds, activeNonFeishuJobIds) {
  const protectedIds = new Set(activeNonFeishuJobIds)
  return [...new Set(feishuJobIds)].filter(id => !protectedIds.has(id))
}

async function deleteJobs(supabase, ids) {
  let deleted = 0
  for (let start = 0; start < ids.length; start += WRITE_BATCH) {
    const { count, error } = await supabase
      .from('job_postings')
      .delete({ count: 'exact' })
      .in('id', ids.slice(start, start + WRITE_BATCH))
    if (error) throw error
    deleted += Number(count || 0)
  }
  return deleted
}

/**
 * 删除只由历史飞书汇总表提供的岗位；已经拥有官网或公开 ATS 来源的同一岗位会保留。
 * 公司来源目录在执行本清理前已经持久化，因此不会丢失用于后续官网适配的公司清单。
 */
export async function cleanupLegacyFeishuJobs({ supabase, dryRun = false, log = console.log } = {}) {
  const feishuJobIds = await readIds(
    supabase.from('job_postings'),
    'id',
    query => query.eq('source_type', 'feishu'),
  )
  if (!feishuJobIds.length) {
    log('没有需要清理的飞书汇总岗位')
    return { deleted: 0, candidates: 0, preserved: 0, deactivated: 0 }
  }
  const activeNonFeishuJobIds = await readIds(
    supabase.from('job_posting_sources'),
    'job_posting_id',
    query => query.eq('is_active', true).neq('source_type', 'feishu').not('source_url', 'is', null),
  )
  const deleteIds = legacyOnlyJobIds(feishuJobIds, activeNonFeishuJobIds)
  const sharedCount = feishuJobIds.length - deleteIds.length

  if (dryRun) {
    log(`将删除 ${deleteIds.length} 个仅有飞书汇总来源的岗位；保留 ${sharedCount} 个已有官网/ATS 来源的岗位`)
    return { deleted: 0, candidates: deleteIds.length, preserved: sharedCount, deactivated: 0 }
  }

  const deleted = await deleteJobs(supabase, deleteIds)

  const { count: deactivated, error: deactivateError } = await supabase
    .from('job_posting_sources')
    .update({ is_active: false, last_missing_at: new Date().toISOString() }, { count: 'exact' })
    .eq('source_type', 'feishu')
    .eq('is_active', true)
  if (deactivateError) throw deactivateError

  log(`已删除 ${deleted} 个仅有飞书汇总来源的岗位；保留 ${sharedCount} 个已有官网/ATS 来源的岗位；停用剩余飞书来源 ${Number(deactivated || 0)} 个`)
  return { deleted, candidates: deleteIds.length, preserved: sharedCount, deactivated: Number(deactivated || 0) }
}
