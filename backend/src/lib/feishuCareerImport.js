import { createHash } from 'node:crypto'

const DEFAULT_PORTAL_TYPE = 6
const DEFAULT_PAGE_SIZE = 100
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 FlowLabJobsBot/1.0'

function sha1(value) {
  return createHash('sha1').update(String(value)).digest('hex')
}

function pathFromUrl(url) {
  const parts = url.pathname.split('/').filter(Boolean)
  if (!parts.length) return 'index'
  if (parts[0] === 'referral') {
    const candidate = parts[1]
    return candidate && !['position', 'share', 'detail'].includes(candidate) ? candidate : 'index'
  }
  if (parts[0] === 's') return null
  return parts[0]
}

export function parseFeishuCareerUrl(value, { portalType } = {}) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  const isSaasCareer = host.endsWith('.jobs.feishu.cn')
  const isByteDanceCareer = host === 'jobs.bytedance.com'
  if (!isSaasCareer && !isByteDanceCareer) return null
  const routePath = pathFromUrl(url)
  if (!routePath) return null
  const websitePath = isByteDanceCareer && routePath === 'experienced' ? 'society' : routePath
  const inferredPortalType = Number(portalType || (isByteDanceCareer
    ? routePath === 'experienced' ? 2 : routePath === 'campus' ? 3 : 3
    : DEFAULT_PORTAL_TYPE))
  const canonical = new URL(url.origin)
  canonical.pathname = `/${routePath}/position`
  return {
    origin: url.origin,
    routePath,
    websitePath,
    portalType: inferredPortalType,
    portalChannel: isByteDanceCareer ? 'office' : 'saas-career',
    startUrl: canonical.toString(),
  }
}

function displayName(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.i18n_name || value.name || value.zh_cn || value.en_name || ''
}

function parentRecruitmentName(job) {
  const type = job.recruit_type || job.job_post_info?.recruitment_type
  return displayName(type?.parent) || displayName(type)
}

function recruitmentName(job) {
  const type = job.recruit_type || job.job_post_info?.recruitment_type
  return displayName(type)
}

function recruitmentBatch(job, fallbackCategory) {
  const subject = displayName(job.job_subject)
  const parent = parentRecruitmentName(job)
  const child = recruitmentName(job)
  const text = [subject, parent, child, job.title, fallbackCategory].filter(Boolean).join(' ')
  if (/实习|intern/i.test(text)) return '实习'
  if (/社招|社会招聘|experienced|social/i.test(text)) return '社招'
  if (/春招|spring/i.test(text)) return '春招'
  if (/秋招|秋季|autumn|fall/i.test(text)) return '秋招'
  if (/校招|校园招聘|campus/i.test(text)) {
    const published = Number(job.publish_time)
    if (Number.isFinite(published) && published > 0) {
      const milliseconds = published < 10_000_000_000 ? published * 1000 : published
      const month = new Date(milliseconds).getUTCMonth() + 1
      return month >= 7 ? '秋招' : '春招'
    }
  }
  return fallbackCategory || (parent.includes('校招') ? '其他' : parent || child || '其他')
}

function timestampDate(value) {
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  return new Date(milliseconds).toISOString().slice(0, 10)
}

function detailUrl({ origin, routePath }, id) {
  return `${origin}/${encodeURIComponent(routePath)}/position/${encodeURIComponent(id)}/detail`
}

export function feishuCareerJobToRow(job, {
  companyName,
  origin,
  websitePath,
  routePath = websitePath,
  fallbackCategory,
} = {}) {
  const id = String(job.id || job.job_post_info?.id || '')
  const type = [parentRecruitmentName(job), recruitmentName(job)].filter(Boolean).join(' · ')
  const description = [
    job.description && `岗位职责\n${String(job.description).trim()}`,
    job.requirement && `任职要求\n${String(job.requirement).trim()}`,
  ].filter(Boolean).join('\n\n')
  const addressList = job.job_post_info?.address_list || []
  const cityList = job.city_list || []
  const locations = [...new Set([
    ...cityList.map(item => displayName(item)),
    ...addressList.map(item => displayName(item.city) || displayName(item)),
  ].filter(Boolean))]
  const url = detailUrl({ origin, routePath }, id)
  return {
    公司: companyName,
    招聘岗位: String(job.title || '').trim(),
    职位描述: description,
    工作地点: locations.join('、'),
    工作类型: type,
    部门: displayName(job.job_function) || displayName(job.job_category),
    批次: recruitmentBatch(job, fallbackCategory),
    发布时间: timestampDate(job.publish_time),
    职位ID: id,
    岗位身份标识: `feishu-career:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

function anonymousCookie(origin, websitePath, portalChannel) {
  const seed = sha1(`${origin}|${websitePath}|flowlab-public-career`)
  const numeric = BigInt(`0x${seed.slice(0, 15)}`).toString().slice(0, 19).padEnd(19, '0')
  return `locale=zh-CN; channel=${portalChannel}; platform=pc; s_v_web_id=verify_${seed.slice(0, 24)}; device-id=${numeric}`
}

async function fetchPage({ origin, websitePath, routePath, portalChannel, portalType, limit, offset, fetchImpl }) {
  const endpoint = new URL('/api/v1/search/job/posts', origin)
  const body = {
    keyword: '',
    limit,
    offset,
    job_category_id_list: [],
    tag_id_list: [],
    location_code_list: [],
    subject_id_list: [],
    recruitment_id_list: [],
    portal_type: portalType,
    job_function_id_list: [],
    storefront_id_list: [],
    portal_entrance: 1,
  }
  for (const [key, value] of Object.entries(body)) {
    endpoint.searchParams.set(key, Array.isArray(value) ? '' : String(value))
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      'accept-language': 'zh-CN',
      'portal-channel': portalChannel,
      'portal-platform': 'pc',
      'website-path': websitePath,
      referer: `${origin}/${routePath}/position`,
      cookie: anonymousCookie(origin, websitePath, portalChannel),
      'user-agent': BROWSER_USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`飞书招聘公开接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.code !== 0 || !payload?.data) {
    throw new Error(`飞书招聘公开接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  const rows = payload.data.job_post_list || []
  return { rows: Array.isArray(rows) ? rows : [], total: Number(payload.data.count || rows.length) }
}

/** 抓取飞书招聘公开求职页的完整职位快照，不访问企业后台或候选人数据。 */
export async function fetchFeishuCareerJobsSnapshot({
  companyName,
  startUrl,
  origin,
  websitePath,
  routePath,
  portalChannel,
  portalType,
  fallbackCategory,
  pageSize = DEFAULT_PAGE_SIZE,
  limit = Infinity,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const parsed = parseFeishuCareerUrl(startUrl, { portalType })
  origin ||= parsed?.origin
  websitePath ||= parsed?.websitePath
  routePath ||= parsed?.routePath || websitePath
  portalChannel ||= parsed?.portalChannel || 'saas-career'
  portalType = Number(portalType || parsed?.portalType || DEFAULT_PORTAL_TYPE)
  if (!companyName || !origin || !websitePath || !portalType) {
    throw new Error('飞书招聘来源需要 companyName、startUrl/ origin、websitePath 和 portalType')
  }
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || DEFAULT_PAGE_SIZE, 1), 100)
  const rows = []
  const failures = []
  let total = Infinity
  let offset = 0
  let capped = false
  while (offset < total && rows.length < normalizedLimit) {
    const take = Math.min(normalizedPageSize, normalizedLimit - rows.length)
    try {
      const page = await fetchPage({ origin, websitePath, routePath, portalChannel, portalType, limit: take, offset, fetchImpl })
      total = page.total
      rows.push(...page.rows.map(job => feishuCareerJobToRow(job, {
        companyName,
        origin,
        websitePath,
        routePath,
        fallbackCategory,
      })).filter(row => row.招聘岗位 && row.职位描述 && row.职位ID))
      offset += page.rows.length
      if (!page.rows.length) break
      if (offset < total && rows.length < normalizedLimit) await wait()
    } catch (error) {
      failures.push({ offset, reason: error.message })
      break
    }
  }
  if (Number.isFinite(normalizedLimit) && offset < total) capped = true
  return {
    rows,
    complete: failures.length === 0 && !capped && offset >= total,
    diagnostics: { total: Number.isFinite(total) ? total : rows.length, fetched: offset, failures, capped },
  }
}
