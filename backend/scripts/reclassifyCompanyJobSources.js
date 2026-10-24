#!/usr/bin/env node
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import {
  chooseRegistryCompanyName,
  classifyRecruitmentUrl,
  discoveryIdentityUrl,
} from '../src/lib/companySourceDiscovery.js'
import { normalizeCompanyName } from '../src/lib/jobIdentity.js'
import { supabase } from '../src/lib/supabase.js'

const { values: opts } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
} })

const rows = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('company_job_sources')
    .select('id,source_key,company_name,platform,status,adapter,seed_url,options')
    .order('id')
    .range(from, from + 999)
  if (error) throw error
  rows.push(...data)
  if (data.length < 1000) break
}

const groups = new Map()
for (const row of rows) {
  const classified = classifyRecruitmentUrl(row.seed_url)
  if (!classified.adapter || classified.status !== 'active') continue
  if (!['feishu-career', 'zhiye'].includes(classified.platform)) continue
  const identity = discoveryIdentityUrl(classified)
  const key = `${classified.platform}|${identity}`
  const group = groups.get(key) || { classified, identity, rows: [] }
  group.rows.push(row)
  groups.set(key, group)
}

const plans = [...groups.values()].map(group => {
  const aliases = group.rows.flatMap(row => [
    row.company_name,
    ...(Array.isArray(row.options?.companyAliases) ? row.options.companyAliases : []),
  ]).filter(Boolean)
  const displayName = chooseRegistryCompanyName(aliases)
  const primary = [...group.rows].sort((a, b) => {
    const aExact = normalizeCompanyName(a.company_name) === normalizeCompanyName(displayName) ? 0 : 1
    const bExact = normalizeCompanyName(b.company_name) === normalizeCompanyName(displayName) ? 0 : 1
    return aExact - bExact
      || a.company_name.length - b.company_name.length
      || a.source_key.localeCompare(b.source_key)
  })[0]
  return {
    ...group,
    aliases: [...new Set(aliases)].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    displayName,
    primary,
    duplicateIds: group.rows.filter(row => row.id !== primary.id).map(row => row.id),
  }
})

const sourceCount = plans.reduce((sum, plan) => sum + plan.rows.length, 0)
const duplicateCount = plans.reduce((sum, plan) => sum + plan.duplicateIds.length, 0)
const platformCounts = new Map()
for (const plan of plans) platformCounts.set(plan.classified.platform, (platformCounts.get(plan.classified.platform) || 0) + 1)

console.log(`识别来源 ${sourceCount} 个，归并为 ${plans.length} 个 ATS 招聘入口，重复 ${duplicateCount} 个`)
for (const [platform, count] of platformCounts) console.log(`  ${platform}: ${count}`)

if (!opts['dry-run']) {
  const now = new Date().toISOString()
  for (const plan of plans) {
    const { error } = await supabase
      .from('company_job_sources')
      .update({
        company_name: plan.displayName,
        canonical_company_key: normalizeCompanyName(plan.displayName),
        platform: plan.classified.platform,
        adapter: plan.classified.adapter,
        seed_url: plan.classified.seedUrl,
        status: 'active',
        options: {
          ...(plan.primary.options || {}),
          ...(plan.classified.options || {}),
          companyAliases: plan.aliases,
        },
        updated_at: now,
      })
      .eq('id', plan.primary.id)
    if (error) throw error
  }
  const duplicateIds = plans.flatMap(plan => plan.duplicateIds)
  for (let index = 0; index < duplicateIds.length; index += 100) {
    const { error } = await supabase
      .from('company_job_sources')
      .update({ status: 'paused', updated_at: now })
      .in('id', duplicateIds.slice(index, index + 100))
    if (error) throw error
  }
  console.log(`来源目录已重新分类；保留 ${plans.length} 个入口，暂停 ${duplicateCount} 个重复入口`)
}
