import { htmlToText } from './officialJobImport.js'

const API_ROOT = 'https://api.mokahr.com/api-platform/v1/jobs'

export function parseMokaRecruitmentUrl(value) {
  let url
  try {
    url = new URL(String(value || '').replace(/¤tPage/g, '&currentPage'))
  } catch {
    return null
  }
  const parts = url.pathname.split('/').filter(Boolean)
  const recruitmentIndex = parts.findIndex(part => /^(campus-recruitment|social-recruitment|campus_apply|apply)$/i.test(part))
  if (recruitmentIndex < 0 || !parts[recruitmentIndex + 1]) return null
  const route = parts[recruitmentIndex].toLowerCase()
  const isMokaHost = /(^|\.)mokahr\.com$/i.test(url.hostname)
  // 企业可把 Moka 招聘门户绑定到自有域名；自有域名只接受特征更明确的 recruitment 路由。
  // 自有域名必须同时提供官网 ID；Moka 官方域名允许使用官网 ID 可选的公开 apply 地址。
  if (!isMokaHost && (!/^(campus-recruitment|social-recruitment)$/.test(route) || !parts[recruitmentIndex + 2])) return null
  const siteId = parts[recruitmentIndex + 2] || ''
  const canonical = new URL(url.origin)
  canonical.pathname = `/${route}/${parts[recruitmentIndex + 1]}${siteId ? `/${siteId}` : ''}`
  canonical.hash = '/jobs'
  return {
    orgId: parts[recruitmentIndex + 1],
    siteId,
    mode: /campus/.test(route) ? 'campus' : 'social',
    startUrl: canonical.toString(),
  }
}

function jobsPayload(payload) {
  const data = payload?.data ?? payload
  const rows = data?.jobs || data?.jobList || data?.list || data?.results || []
  const total = Number(data?.total ?? data?.totalCount ?? data?.count ?? payload?.total ?? rows.length)
  return { rows: Array.isArray(rows) ? rows : [], total: Number.isFinite(total) ? total : rows.length }
}

function listText(value) {
  if (!value) return ''
  if (Array.isArray(value)) return value.map(item => typeof item === 'string'
    ? item
    : item?.name || item?.label || item?.address || [item?.country, item?.city].filter(Boolean).join(' · ') || '')
    .filter(Boolean).join(',')
  return typeof value === 'string' ? value : value.name || value.label || value.address || ''
}

function mokaJobUrl(startUrl, jobId) {
  const url = new URL(startUrl)
  url.hash = `/job/${encodeURIComponent(jobId)}`
  return url.toString()
}

function campusBatch(job, startUrl) {
  if (!/campus[-_]/.test(startUrl)) return '社招'
  const text = [job.title, job.name, job.commitment?.name, job.employmentType?.name]
    .filter(Boolean).join(' ')
  if (/实习|intern/i.test(text)) return '实习'
  const published = String(job.publishedAt || job.openedAt || job.createdAt || '')
  const month = Number(published.match(/^\d{4}[-/]?(\d{1,2})/)?.[1])
  if (month >= 1 && month <= 6) return '春招'
  if (month >= 7 && month <= 12) return '秋招'
  return '校园招聘'
}

async function fetchMokaPage(url, { fetchImpl, wait, retries = 3 }) {
  let lastFailure
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)' },
      signal: AbortSignal.timeout(20_000),
    }).catch(error => ({ ok: false, status: 0, error }))
    if (response?.ok) return response.json()
    const status = Number(response?.status || 0)
    lastFailure = status ? `HTTP ${status}` : response?.error?.message || '连接失败'
    const retryable = status === 0 || status === 408 || status === 429 || status >= 500
    if (!retryable || attempt >= retries) break
    const retryAfter = Number(response?.headers?.get?.('retry-after'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1200 * (2 ** attempt)
    await wait(delay)
  }
  throw new Error(lastFailure)
}

function mokaCompanyName(job, companyName, companyAliases = []) {
  const explicit = String(job.companyName || job.organizationName || '').trim()
  if (explicit) return explicit
  const context = [
    job.title,
    job.department?.name,
    ...(job.customFields || []).map(field => field?.value),
  ].filter(Boolean).join(' ').toLowerCase()
  const aliases = [...new Set(companyAliases.map(String).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
  return aliases.find(alias => {
    const needles = [alias, alias.split(/[|｜]/).pop(), alias.replace(/(?:集团|股份有限公司|有限责任公司|有限公司)$/, '')]
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => value.length >= 2)
    return needles.some(value => context.includes(value))
  }) || companyName || ''
}

export function mokaJobToRow(job, { companyName, companyAliases, startUrl }) {
  const id = job.id || job.jobId || job._id
  const sourceUrl = mokaJobUrl(startUrl, id)
  const locations = job.locations || job.location || job.workLocations
  const department = listText(job.department || job.departments)
  const functionName = listText(job.zhineng || job.jobFunction || job.function)
  const description = [job.description, job.responsibility, job.requirement, job.qualifications]
    .map(htmlToText)
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .join('\n\n')
  return {
    公司: mokaCompanyName(job, companyName, companyAliases),
    招聘岗位: String(job.title || job.name || ''),
    职位描述: description,
    工作地点: listText(locations),
    部门: [department, functionName].filter(Boolean).join(' · '),
    工作类型: listText(job.commitment || job.employmentType),
    学历要求: listText(job.education || job.educationRequirement),
    发布时间: String(job.publishedAt || job.openedAt || job.createdAt || '').slice(0, 10),
    更新时间: String(job.updatedAt || job.modifiedAt || '').slice(0, 10),
    截止时间: String(job.closedAt || job.deadline || '').slice(0, 10),
    职位ID: String(id || ''),
    职位详情链接: sourceUrl,
    投递链接: sourceUrl,
    批次: campusBatch(job, startUrl),
  }
}

/** 读取 Moka 对公开招聘页提供的只读职位列表接口，不使用企业管理 API。 */
export async function fetchMokaJobsSnapshot({
  companyName,
  companyAliases,
  startUrl,
  orgId,
  siteId,
  mode,
  pageSize = 100,
  limit,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const parsed = parseMokaRecruitmentUrl(startUrl)
  orgId ||= parsed?.orgId
  siteId ||= parsed?.siteId
  mode ||= parsed?.mode
  startUrl ||= parsed?.startUrl
  if (!orgId || !startUrl) throw new Error('Moka 来源需要 startUrl，或配置 orgId 和 startUrl')

  const rows = []
  const failures = []
  let total = Infinity
  let offset = 0
  let capped = false
  while (offset < total) {
    const take = Math.min(pageSize, limit ? Math.max(limit - rows.length, 1) : pageSize)
    const url = new URL(`${API_ROOT}/${encodeURIComponent(orgId)}`)
    url.searchParams.set('mode', mode || 'campus')
    url.searchParams.set('limit', String(take))
    url.searchParams.set('offset', String(offset))
    if (siteId) url.searchParams.set('siteId', String(siteId))
    let payload
    try {
      payload = await fetchMokaPage(url, { fetchImpl, wait })
    } catch (error) {
      failures.push({ url: url.toString(), reason: error.message })
      break
    }
    const page = jobsPayload(payload)
    total = page.total
    rows.push(...page.rows
      .filter(job => !job.status || !/closed|offline|disabled|pause/i.test(String(job.status)))
      .map(job => mokaJobToRow(job, { companyName, companyAliases, startUrl })))
    offset += page.rows.length
    if (!page.rows.length || (limit && rows.length >= limit)) {
      capped = Boolean(limit && total > offset)
      break
    }
    if (offset < total) await wait()
  }

  return {
    rows: limit ? rows.slice(0, limit) : rows,
    complete: failures.length === 0 && !capped && offset >= total,
    diagnostics: { total: Number.isFinite(total) ? total : rows.length, fetched: offset, failures, capped },
  }
}
