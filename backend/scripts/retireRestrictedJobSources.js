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

if (!sourceNames.length) {
  console.log('没有需要停用的受限岗位来源')
  process.exit(0)
}

console.log(`受限来源 ${sourceNames.length} 个：${sourceNames.join('、')}`)
if (opts['dry-run']) process.exit(0)

const { supabase } = await import('../src/lib/supabase.js')
const { data, error } = await supabase.rpc('retire_job_source_snapshots', {
  p_source_names: sourceNames,
})
if (error) throw error
console.log(`已停用受限来源；关闭 ${Number(data || 0)} 个没有其他有效来源的岗位`)

