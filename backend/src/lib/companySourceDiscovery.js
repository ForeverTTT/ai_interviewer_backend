import { createHash } from 'node:crypto'
import { normalizeCompanyName, normalizeJobUrl } from './jobIdentity.js'
import { parseMokaRecruitmentUrl } from './mokaJobImport.js'
import { parseHotjobRecruitmentUrl } from './hotjobImport.js'
import { parseFeishuCareerUrl } from './feishuCareerImport.js'
import { parseZhiyeRecruitmentUrl } from './zhiyeJobImport.js'

const sha1 = value => createHash('sha1').update(value).digest('hex')

export function repairRecruitmentUrl(value) {
  return String(value || '').replace(/¤tPage/g, '&currentPage').trim()
}

export function classifyRecruitmentUrl(value) {
  const repaired = repairRecruitmentUrl(value)
  const normalizedUrl = normalizeJobUrl(repaired)
  if (!normalizedUrl) return { platform: 'invalid', adapter: null, status: 'unsupported', seedUrl: repaired }
  let url
  try {
    url = new URL(normalizedUrl)
  } catch {
    return { platform: 'invalid', adapter: null, status: 'unsupported', seedUrl: repaired }
  }
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || /xn--$/.test(host)) return { platform: 'invalid', adapter: null, status: 'unsupported', seedUrl: repaired }
  const moka = parseMokaRecruitmentUrl(repaired)
  if (moka) return { platform: 'moka', adapter: 'moka-public', status: 'active', seedUrl: moka.startUrl, options: moka }
  const feishu = parseFeishuCareerUrl(repaired)
  if (feishu) return { platform: 'feishu-career', adapter: 'feishu-career', status: 'active', seedUrl: feishu.startUrl, options: feishu }
  const zhiye = parseZhiyeRecruitmentUrl(repaired)
  if (zhiye) return { platform: 'zhiye', adapter: 'zhiye-auto', status: 'active', seedUrl: zhiye.startUrl, options: zhiye }
  if (host === 'mp.weixin.qq.com') return { platform: 'wechat', adapter: null, status: 'fallback', seedUrl: normalizedUrl }
  if (host.endsWith('hotjob.cn')) {
    const hotjob = parseHotjobRecruitmentUrl(repaired)
    return hotjob
      ? { platform: 'hotjob', adapter: 'hotjob-wecruit', status: 'active', seedUrl: hotjob.seedUrl, options: hotjob }
      : { platform: 'hotjob', adapter: null, status: 'pending', seedUrl: normalizedUrl }
  }
  if (host.endsWith('51job.com')) return { platform: '51job', adapter: null, status: 'pending', seedUrl: normalizedUrl }
  if (host.endsWith('zhaopin.com')) return { platform: 'zhaopin', adapter: null, status: 'pending', seedUrl: normalizedUrl }
  if (host.includes('zhiye.com') || host.endsWith('career.zhaopin.com')) return { platform: 'zhiye', adapter: null, status: 'pending', seedUrl: normalizedUrl }
  if (host.includes('beisen.com')) return { platform: 'beisen', adapter: null, status: 'pending', seedUrl: normalizedUrl }
  return { platform: 'official_candidate', adapter: null, status: 'pending', seedUrl: normalizedUrl }
}

export function discoveryIdentityUrl(classified) {
  if (classified.platform === 'moka') return classified.seedUrl
  let url
  try {
    url = new URL(classified.seedUrl)
  } catch {
    return classified.seedUrl
  }
  if (classified.platform === 'hotjob') {
    const parts = url.pathname.split('/').filter(Boolean)
    const tenantIndex = parts.findIndex(part => /^SU[a-z0-9]+$/i.test(part))
    if (tenantIndex >= 0) return `${url.origin}/${parts[tenantIndex]}`
    const wtIndex = parts.indexOf('wt')
    if (wtIndex >= 0 && parts[wtIndex + 1]) return `${url.origin}/wt/${parts[wtIndex + 1]}`
  }
  if (classified.platform === 'feishu-career' || classified.platform === 'zhiye') {
    const section = url.pathname.split('/').filter(Boolean)[0]
    return `${url.origin}/${section || ''}`
  }
  // 官网候选、公众号和聚合平台先按公司 + 域名归并；专用适配器接入后再细分租户。
  return url.origin
}

function registrySourceKey(companyName, classified) {
  const identityUrl = discoveryIdentityUrl(classified)
  // 一个公开 ATS 租户经常被飞书中的品牌、子公司和招聘活动重复引用。
  // 抓取单位应该是租户，而不是飞书里的公司显示名，否则同一批岗位会被重复同步。
  if (classified.adapter) return sha1(`ats-source-v2|${classified.platform}|${identityUrl}`)
  return sha1(`${normalizeCompanyName(companyName)}|${classified.platform}|${identityUrl}`)
}

const CAMPAIGN_SUFFIX = /(?:[-—–|｜]\s*)?(?:补录|补招|专场|专项|校园大使|校招|招聘启动|岗位合集|训练营|人才计划|实习计划|智能驾驶|基础研究部|车身开发部).*$/i

function cleanCompanyAlias(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const pipeBase = raw.split(/[|｜]/)[0].trim()
  const cleaned = pipeBase.replace(CAMPAIGN_SUFFIX, '').trim()
  return cleaned.length >= 2 ? cleaned : raw
}

/** 为集团共用招聘站点选一个稳定的展示名；所有原始名称仍保存在 options.companyAliases。 */
export function chooseRegistryCompanyName(aliasCounts) {
  const counts = aliasCounts instanceof Map ? aliasCounts : new Map((aliasCounts || []).map(name => [name, 1]))
  const candidateCounts = new Map()
  for (const [alias, count] of counts) {
    for (const candidate of new Set([String(alias).trim(), cleanCompanyAlias(alias)].filter(Boolean))) {
      candidateCounts.set(candidate, (candidateCounts.get(candidate) || 0) + count)
    }
  }
  const aliases = [...counts.keys()].filter(Boolean)
  const scored = [...candidateCounts].map(([name, count]) => {
    const key = normalizeCompanyName(name)
    const coverage = aliases.filter(alias => {
      const aliasKey = normalizeCompanyName(cleanCompanyAlias(alias))
      return key && (aliasKey.includes(key) || key.includes(aliasKey))
    }).length
    const campaignPenalty = CAMPAIGN_SUFFIX.test(name) ? 500 : 0
    const groupBonus = /集团/.test(name) ? 35 : 0
    return { name, score: count * 20 + coverage * 25 + groupBonus - campaignPenalty - Math.min(name.length, 30) }
  })
  return scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'zh-CN'))[0]?.name || aliases[0] || ''
}

export function companySourceDisplayName(row) {
  const platform = row.platform === 'moka' ? 'Moka'
    : row.platform === 'hotjob' ? 'Hotjob'
      : row.platform === 'feishu-career' ? '飞书招聘'
        : row.platform === 'zhiye' ? '智业' : '官网'
  return `${row.company_name} ${platform} 招聘页 · ${row.source_key.slice(0, 8)}`
}

export function sourceRegistryRow({ companyName, sourceUrl, discoverySource = '飞书求职汇总表' }) {
  const classified = classifyRecruitmentUrl(sourceUrl)
  const companyKey = normalizeCompanyName(companyName)
  const sourceKey = registrySourceKey(companyName, classified)
  return {
    source_key: sourceKey,
    canonical_company_key: companyKey,
    company_name: companyName,
    platform: classified.platform,
    adapter: classified.adapter,
    seed_url: classified.seedUrl,
    status: classified.status,
    discovery_source: discoverySource,
    options: { ...(classified.options || {}), companyAliases: [companyName] },
    last_discovered_at: new Date().toISOString(),
  }
}

async function allFeishuSources(supabase, sourceName) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('job_posting_sources')
      .select('source_url,apply_url,job_postings!inner(company)')
      .eq('source_name', sourceName)
      .eq('is_active', true)
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

export async function discoverCompanySources({
  supabase,
  sourceName = '飞书求职汇总表',
  dryRun = false,
  limit,
  pruneStale = false,
  log = console.log,
} = {}) {
  const sourceRows = await allFeishuSources(supabase, sourceName)
  const registry = new Map()
  const aliasCounts = new Map()
  for (const row of sourceRows) {
    const companyName = Array.isArray(row.job_postings) ? row.job_postings[0]?.company : row.job_postings?.company
    if (!companyName) continue
    for (const sourceUrl of new Set([row.source_url, row.apply_url].filter(Boolean))) {
      const item = sourceRegistryRow({ companyName, sourceUrl, discoverySource: sourceName })
      if (!registry.has(item.source_key)) registry.set(item.source_key, item)
      const counts = aliasCounts.get(item.source_key) || new Map()
      counts.set(companyName, (counts.get(companyName) || 0) + 1)
      aliasCounts.set(item.source_key, counts)
      const current = registry.get(item.source_key)
      if (current.platform === 'hotjob') {
        current.options.recruitTypes = [...new Set([
          ...(current.options.recruitTypes || []),
          ...(item.options.recruitTypes || []),
        ])].sort((a, b) => a - b)
      }
    }
  }
  for (const [sourceKey, item] of registry) {
    const counts = aliasCounts.get(sourceKey) || new Map([[item.company_name, 1]])
    item.company_name = chooseRegistryCompanyName(counts)
    item.canonical_company_key = normalizeCompanyName(item.company_name)
    item.options.companyAliases = [...counts.keys()].sort((a, b) => a.localeCompare(b, 'zh-CN'))
  }
  const allDiscovered = [...registry.values()]
    .sort((a, b) => a.company_name.localeCompare(b.company_name, 'zh-CN'))
  const discovered = allDiscovered
    .slice(0, limit || undefined)
  const counts = Object.fromEntries([...new Set(discovered.map(row => row.platform))]
    .map(platform => [platform, discovered.filter(row => row.platform === platform).length]))
  log(`从 ${sourceRows.length} 条有效飞书来源中发现 ${discovered.length} 个企业来源入口`)
  log(`平台分布: ${Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, count]) => `${key} ${count}`).join('，')}`)
  if (!dryRun) {
    // v1 目录把公司名写进 ATS source_key，同一租户因此会有多个 active 来源。
    // 完整发现时把旧键暂停；新来源首次成功同步后再停用旧快照，避免抓取失败造成数据空窗。
    let existing = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('company_job_sources')
        .select('*')
        .eq('discovery_source', sourceName)
        .eq('status', 'active')
        .not('adapter', 'is', null)
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      existing.push(...data)
      if (data.length < 1000) break
    }
    const currentByIdentity = new Map(allDiscovered.map(item => [
      `${item.platform}|${discoveryIdentityUrl({ platform: item.platform, seedUrl: item.seed_url })}`,
      item,
    ]))
    const currentKeys = new Set(allDiscovered.map(item => item.source_key))
    const stale = existing.filter(item => !currentKeys.has(item.source_key))
    for (const old of stale) {
      const replacement = currentByIdentity.get(`${old.platform}|${discoveryIdentityUrl({ platform: old.platform, seedUrl: old.seed_url })}`)
      if (!replacement) continue
      replacement.options.previousSourceNames = [...new Set([
        ...(replacement.options.previousSourceNames || []),
        companySourceDisplayName(old),
      ])]
    }
    for (let i = 0; i < discovered.length; i += 500) {
      const { error } = await supabase.from('company_job_sources').upsert(discovered.slice(i, i + 500), { onConflict: 'source_key' })
      if (error) throw error
    }
    // --limit 只用于抽样，不应据此暂停未包含在抽样中的来源。
    // 飞书聚合岗位会在官网来源目录建立后被删除；默认保留已经发现的公司入口。
    // 只有显式执行 --prune-stale，才把本轮没有再次出现的入口暂停。
    if (!limit && pruneStale) {
      // UUID 的 in(...) 会出现在 PostgREST URL 中，批次过大会超过代理 URL 上限。
      for (let i = 0; i < stale.length; i += 100) {
        const ids = stale.slice(i, i + 100).map(item => item.id)
        const { error } = await supabase
          .from('company_job_sources')
          .update({ status: 'paused', updated_at: new Date().toISOString() })
          .in('id', ids)
        if (error) throw error
      }
    }
  }
  return { discovered, counts, sourceRows: sourceRows.length, written: dryRun ? 0 : discovered.length }
}
