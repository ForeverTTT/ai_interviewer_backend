import { htmlToText } from './officialJobImport.js'

export const INTEL_ORIGIN = 'https://intel.wd1.myworkdayjobs.com'
export const INTEL_TENANT = 'intel'
export const INTEL_SITE = 'External'

function apiUrl(path = 'jobs') {
  return `${INTEL_ORIGIN}/wday/cxs/${INTEL_TENANT}/${INTEL_SITE}/${path}`
}

function extractJobType(text) {
  return String(text || '').match(/Job Type:\s*\n?([^\n]+)/i)?.[1]?.trim() || ''
}

function laneFor(info, description) {
  const text = `${info.title || ''} ${extractJobType(description)}`
  if (/student\s*\/\s*intern|\bintern(?:ship)?\b/i.test(text)) return { batch: '实习', type: '实习生招聘' }
  if (/college grad|new grad|graduate program|campus/i.test(text)) return { batch: '秋招', type: '应届生招聘' }
  return { batch: '社招', type: '社会招聘' }
}

export function intelJobToRow(info) {
  const description = htmlToText(info.jobDescription)
  const lane = laneFor(info, description)
  const id = String(info.jobReqId || info.id || info.jobPostingId || '')
  const url = info.externalUrl || `${INTEL_ORIGIN}/${INTEL_SITE}/job/${encodeURIComponent(info.jobPostingId || id)}`
  return {
    公司: '英特尔',
    企业类型: '外企/合资',
    行业类别: '电子/通信/半导体',
    招聘岗位: String(info.title || '').trim(),
    职位描述: description,
    工作地点: String(info.location || info.jobRequisitionLocation?.descriptor || '').trim(),
    工作类型: lane.type,
    批次: lane.batch,
    备注: String([extractJobType(description), info.timeType].filter(Boolean).join(' / ')),
    发布时间: String(info.startDate || '').slice(0, 10),
    职位ID: id,
    岗位身份标识: `workday:intel:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function requestJson(url, options, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${INTEL_ORIGIN}/${INTEL_SITE}`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
      ...options?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`英特尔 Workday 接口返回 HTTP ${response.status}`)
  return response.json()
}

async function postJobs(body, fetchImpl) {
  return requestJson(apiUrl('jobs'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, fetchImpl)
}

function chinaLocationIds(payload) {
  const locationGroup = (payload.facets || []).find(facet => facet.facetParameter === 'locationMainGroup')
  const locations = (locationGroup?.values || []).flatMap(group => group.values || [])
  return locations.filter(item => /^(PRC|China),/i.test(String(item.descriptor || ''))).map(item => item.id).filter(Boolean)
}

/** 抓取英特尔 Workday 官网的中国区社招、校招与实习完整快照。 */
export async function fetchIntelChinaJobsSnapshot({
  limit = Infinity,
  pageSize = 20,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 20)
  const discovery = await postJobs({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }, fetchImpl)
  const locations = chinaLocationIds(discovery)
  if (!locations.length) throw new Error('英特尔 Workday 未返回中国区工作地点筛选项')

  const summaries = new Map()
  let totalCount = 0
  for (let offset = 0; ; offset += normalizedPageSize) {
    const page = await postJobs({ appliedFacets: { locations }, limit: normalizedPageSize, offset, searchText: '' }, fetchImpl)
    const postings = Array.isArray(page.jobPostings) ? page.jobPostings : []
    totalCount = Number(page.total || postings.length)
    for (const job of postings) {
      if (job?.externalPath) summaries.set(job.externalPath, job)
      if (summaries.size >= normalizedLimit) break
    }
    if (summaries.size >= normalizedLimit || summaries.size >= totalCount || postings.length < normalizedPageSize || !postings.length) break
    await wait()
  }

  const rows = []
  const failures = []
  for (const summary of summaries.values()) {
    try {
      const detail = await requestJson(`${INTEL_ORIGIN}/wday/cxs/${INTEL_TENANT}/${INTEL_SITE}${summary.externalPath}`, {}, fetchImpl)
      const info = detail.jobPostingInfo || {}
      const row = intelJobToRow(info)
      if (row.招聘岗位 && row.职位描述 && row.职位ID) rows.push(row)
      else failures.push({ path: summary.externalPath, reason: '详情缺少岗位名、JD 或职位 ID' })
    } catch (error) {
      failures.push({ path: summary.externalPath, reason: error.message })
    }
    if (rows.length + failures.length < summaries.size) await wait()
  }

  const reachedLimit = summaries.size >= normalizedLimit && normalizedLimit < totalCount
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: rows.length,
    complete: !reachedLimit && summaries.size >= totalCount && failures.length === 0 && rows.length === summaries.size,
    diagnostics: { failures },
  }
}
