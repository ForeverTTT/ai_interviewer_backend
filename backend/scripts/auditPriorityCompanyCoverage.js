#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import '../src/config/env.js'
import { normalizeCompanyName } from '../src/lib/jobIdentity.js'
import { supabase } from '../src/lib/supabase.js'

const root = new URL('../', import.meta.url)
const priority = JSON.parse(await readFile(new URL('config/priority-companies.json', root), 'utf8')).companies
const staticSources = JSON.parse(await readFile(new URL('config/company-job-sources.json', root), 'utf8')).sources

const registry = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('company_job_sources')
    .select('company_name,platform,adapter,seed_url,status,options')
    .eq('status', 'active')
    .not('adapter', 'is', null)
    .order('company_name')
    .range(from, from + 999)
  if (error) throw error
  registry.push(...data)
  if (data.length < 1000) break
}

function sourceLane(source) {
  const text = `${source.seedUrl || ''} ${source.name || ''} ${source.fallbackCategory || ''} ${source.options?.mode || ''}`.toLowerCase()
  const lanes = new Set()
  if (/social|experienced|社招|\bsr\b/.test(text)) lanes.add('社招')
  if (/campus|graduate|校招|应届|春招|秋招|\bedu\b/.test(text)) lanes.add('校招')
  if (/intern|实习/.test(text)) lanes.add('实习')
  // 校园招聘 API 通常在同一入口同时返回正式校招和实习岗位。
  if (lanes.has('校招')) lanes.add('实习')
  if (!lanes.size) lanes.add('未标明')
  return [...lanes]
}

function matches(source, company) {
  const sourceNames = [source.companyName, source.company_name, source.name, source.id, ...(source.options?.companyAliases || [])]
    .filter(Boolean)
    .map(normalizeCompanyName)
  const targets = [company.name, ...(company.aliases || [])].map(normalizeCompanyName)
  return sourceNames.some(name => targets.some(target => name.includes(target) || target.includes(name)))
}

const allSources = [
  ...staticSources.filter(source => source.enabled !== false),
  ...registry.map(source => ({ ...source, companyName: source.company_name, seedUrl: source.seed_url })),
]

let complete = 0
for (const company of priority) {
  const sources = allSources.filter(source => matches(source, company))
  const lanes = new Set(sources.flatMap(sourceLane))
  const missing = ['社招', '校招', '实习'].filter(lane => !lanes.has(lane))
  if (!missing.length) complete += 1
  console.log(`${missing.length ? '△' : '✓'} ${company.name}: ${[...lanes].join('/') || '无'}${missing.length ? `；缺 ${missing.join('/')}` : ''}`)
  for (const source of sources) console.log(`    ${source.adapter} ${source.seedUrl || source.id}`)
}
console.log(`\n三类齐全 ${complete}/${priority.length}`)
