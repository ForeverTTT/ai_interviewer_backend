import { createHmac } from 'node:crypto'

export const KUAISHOU_SOCIAL_ORIGIN = 'https://zhaopin.kuaishou.cn'
export const KUAISHOU_SOCIAL_API = `${KUAISHOU_SOCIAL_ORIGIN}/recruit/e/api/v1/open/positions/simple`
export const KUAISHOU_DICTIONARY_API = `${KUAISHOU_SOCIAL_ORIGIN}/recruit/e/api/v1/dictionary/batch`
const SIGNING_SECRET = '652f962a-0575-4575-98d2-f04e2291bee2'

export function serializeKuaishouQuery(query = {}) {
  const params = new URLSearchParams()
  for (const key of Object.keys(query).sort()) {
    const raw = query[key]
    if (raw == null || raw === '') continue
    const value = Array.isArray(raw) ? [...raw].sort().join(',') : String(raw)
    params.append(key, value)
  }
  return params.toString()
}

export function signKuaishouRequest({ timestamp, query = {}, body = '' }) {
  const message = `${timestamp}${serializeKuaishouQuery(query)}${body}${SIGNING_SECRET}`
  return createHmac('sha256', SIGNING_SECRET).update(message).digest('hex')
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

function dictionaryMap(items = []) {
  return new Map(items.map(item => [String(item?.code || ''), String(item?.name || '')]).filter(([key]) => key))
}

export function kuaishouSocialJobToRow(job, { workLocations = new Map(), categories = new Map() } = {}) {
  const id = String(job.id || '').trim()
  const locationCodes = [...new Set([
    ...(Array.isArray(job.workLocationsCode) ? job.workLocationsCode : []),
    job.workLocationCode,
  ].filter(Boolean).map(String))]
  const locationNames = locationCodes.map(code => workLocations.get(code) || code)
  const detailUrl = `${KUAISHOU_SOCIAL_ORIGIN}/#/official/social/job-info/${encodeURIComponent(id)}`
  return {
    公司: '快手',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: [
      job.description ? `岗位职责\n${String(job.description).trim()}` : '',
      job.positionDemand ? `任职要求\n${String(job.positionDemand).trim()}` : '',
    ].filter(Boolean).join('\n\n'),
    工作地点: [...new Set(locationNames.filter(Boolean))].join('、'),
    工作类型: '社会招聘',
    批次: '社招',
    部门: String(job.departmentName || '').trim(),
    备注: categories.get(String(job.positionCategoryCode || '')) || '',
    发布时间: dateOnly(job.releaseTime || job.updateTime),
    截止时间: dateOnly(job.closeTime),
    职位ID: id,
    岗位身份标识: `kuaishou:social:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function fetchDictionaries(fetchImpl) {
  const query = serializeKuaishouQuery({ types: ['workLocation', 'positionCategory', 'positionExperience'] })
  const response = await fetchImpl(`${KUAISHOU_DICTIONARY_API}?${query}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${KUAISHOU_SOCIAL_ORIGIN}/`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`快手招聘字典接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.result) {
    throw new Error(`快手招聘字典接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return {
    workLocations: dictionaryMap(payload.result.workLocation),
    categories: dictionaryMap(payload.result.positionCategory),
  }
}

async function fetchPage({ pageNum, pageSize, fetchImpl }) {
  const query = { pageNum, pageSize, positionNatureCode: 'C001', recruitProject: 'socialr' }
  const serialized = serializeKuaishouQuery(query)
  const timestamp = String(Date.now())
  const response = await fetchImpl(`${KUAISHOU_SOCIAL_API}?${serialized}`, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${KUAISHOU_SOCIAL_ORIGIN}/`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
      signTimestamp: timestamp,
      sign: signKuaishouRequest({ timestamp, query }),
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`快手社会招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.result) {
    throw new Error(`快手社会招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.result
}

/** 抓取快手社会招聘官网的完整岗位快照。 */
export async function fetchKuaishouSocialSnapshot({
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 1000)
  const dictionaries = await fetchDictionaries(fetchImpl)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let pageNum = 1; ; pageNum++) {
    const result = await fetchPage({ pageNum, pageSize: normalizedPageSize, fetchImpl })
    const list = result.list || []
    totalCount = Number(result.total || list.length)
    totalPages = Number(result.pages || Math.ceil(totalCount / normalizedPageSize) || 1)
    traversedPages = pageNum
    for (const job of list) {
      if (job?.id != null) jobs.set(String(job.id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || pageNum >= totalPages || !list.length) break
    await wait()
  }

  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const rows = [...jobs.values()]
    .map(job => kuaishouSocialJobToRow(job, dictionaries))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
