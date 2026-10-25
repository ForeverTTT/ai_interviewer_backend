#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import '../src/config/env.js'
import { restrictedStaticSourceNames } from '../src/lib/companyJobCompliance.js'

const { values: opts } = parseArgs({ options: {
  config: { type: 'string', default: fileURLToPath(new URL('../config/company-job-sources.json', import.meta.url)) },
  'dry-run': { type: 'boolean', default: false },
} })

const config = JSON.parse(await readFile(opts.config, 'utf8'))
const sourceNames = restrictedStaticSourceNames(config.sources || [])

const PAGE_SIZE = 1_000
const WRITE_BATCH_SIZE = 100

function chunks(values, size) {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function readRestrictedSourceRows(supabase, names) {
  const rows = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('job_posting_sources')
      .select('id,job_posting_id,is_active')
      .in('source_name', names)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...(data || []))
    if ((data || []).length < PAGE_SIZE) return rows
  }
}

async function retireRestrictedSourcesInBatches(supabase, names) {
  // The original single SQL RPC can exceed Supabase's statement timeout on a large
  // job board. Read first, then use small id-based writes so every operation stays
  // bounded and a retry can safely continue after a partial run.
  const sourceRows = await readRestrictedSourceRows(supabase, names)
  const activeSourceIds = sourceRows.filter(row => row.is_active).map(row => row.id)
  const affectedJobIds = [...new Set(sourceRows.map(row => row.job_posting_id).filter(Boolean))]
  const retiredAt = new Date().toISOString()

  for (const ids of chunks(activeSourceIds, WRITE_BATCH_SIZE)) {
    const { error } = await supabase
      .from('job_posting_sources')
      .update({ is_active: false, last_missing_at: retiredAt })
      .in('id', ids)
    if (error) throw error
  }

  let closedCount = 0
  for (const jobIds of chunks(affectedJobIds, WRITE_BATCH_SIZE)) {
    const { data: activeRows, error: activeError } = await supabase
      .from('job_posting_sources')
      .select('job_posting_id')
      .in('job_posting_id', jobIds)
      .eq('is_active', true)
    if (activeError) throw activeError

    const stillActive = new Set((activeRows || []).map(row => row.job_posting_id))
    const orphanedJobIds = jobIds.filter(id => !stillActive.has(id))
    if (!orphanedJobIds.length) continue

    const { data: closedRows, error: closeError } = await supabase
      .from('job_postings')
      .update({ status: 'closed' })
      .in('id', orphanedJobIds)
      .neq('status', 'closed')
      .select('id')
    if (closeError) throw closeError
    closedCount += (closedRows || []).length
  }

  return { sourceRows: sourceRows.length, retiredSources: activeSourceIds.length, closedJobs: closedCount }
}

if (!sourceNames.length) {
  console.log('没有需要停用的受限岗位来源')
  process.exit(0)
}

console.log(`受限来源 ${sourceNames.length} 个：${sourceNames.join('、')}`)
if (opts['dry-run']) process.exit(0)

const { supabase } = await import('../src/lib/supabase.js')
const result = await retireRestrictedSourcesInBatches(supabase, sourceNames)
console.log(
  `已检查 ${result.sourceRows} 条受限来源记录，停用 ${result.retiredSources} 条有效来源；` +
  `关闭 ${result.closedJobs} 个没有其他有效来源的岗位`,
)

