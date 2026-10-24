import { htmlToText } from './officialJobImport.js'

export const CTRIP_CAREERS_ORIGIN = 'https://job.ctrip.com'

const API_URL = `${CTRIP_CAREERS_ORIGIN}/api/hrrecruit/getJobAd`
const MODE_CONFIG = {
  social: { category: 1, route: 'experienced' },
  campus: { category: 2, route: 'campus' },
}

function dateOnly(value) {
  return String(value || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || ''
}

function isInternJob(job) {
  return /实习|intern/i.test([
    job.jobTitle,
    job.kindName,
    job.requirements,
    job.duty,
  ].filter(Boolean).join(' '))
}

function campusBatch(job) {
  if (isInternJob(job)) return '实习'
  if (/春招/.test(job.jobTitle || '')) return '春招'
  return '秋招'
}

function applicationUrl(id) {
  const backUrl = `${CTRIP_CAREERS_ORIGIN}/#/personal-homepage?tabindex=2&jobId=${encodeURIComponent(id)}&empCode=null`
  return `https://passport.ctrip.com/user/login?backurl=${encodeURIComponent(backUrl)}`
}

export function ctripJobToRow(job, { mode = 'social' } = {}) {
  const config = MODE_CONFIG[mode]
  if (!config) throw new Error(`未知的携程招聘模式：${mode}`)
  const id = String(job.fromId || job.id || '').trim()
  const intern = mode === 'campus' && isInternJob(job)
  const detailUrl = `${CTRIP_CAREERS_ORIGIN}/#/${config.route}/job-detail/${encodeURIComponent(id)}`
  const duty = htmlToText(job.duty)
  const requirements = htmlToText(job.requirements)
  const description = duty && !requirements.includes(duty)
    ? `岗位职责\n${duty}\n\n任职要求\n${requirements}`
    : requirements || duty
  return {
    公司: '携程集团',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.jobTitle || '').trim(),
    职位描述: description,
    工作地点: String(job.cityName || '').trim(),
    工作类型: mode === 'social' ? '社会招聘' : intern ? '实习生招聘' : '应届生招聘',
    批次: mode === 'social' ? '社招' : campusBatch(job),
    部门: String(job.buName || '').trim(),
    备注: [job.jobFamilyGroupName, job.kindName].filter(Boolean).join(' / '),
    发布时间: dateOnly(job.publishDate),
    职位ID: id,
    岗位身份标识: `ctrip:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: applicationUrl(id),
  }
}

async function fetchPage({ mode, pageIndex, pageSize, fetchImpl, wait }) {
  const config = MODE_CONFIG[mode]
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json;charset=UTF-8',
          origin: CTRIP_CAREERS_ORIGIN,
          referer: `${CTRIP_CAREERS_ORIGIN}/`,
          'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
        },
        body: JSON.stringify({
          condition: {
            fromId: [],
            keyword: '',
            kind: [],
            country: [],
            city: [],
            bucode: [],
            jobFamilyCode: [],
            jobFamilyGroupCode: [],
            category: config.category,
          },
          pager: { index: String(pageIndex), size: String(pageSize) },
          head: { language: 'zh_CN', version: '1' },
        }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`携程招聘接口返回 HTTP ${response.status}`)
      const payload = await response.json()
      if (String(payload?.retCode) !== '201' || !payload?.retValue) {
        throw new Error(`携程招聘接口返回异常：${payload?.retMessage || payload?.retCode || '未知错误'}`)
      }
      return payload.retValue
    } catch (error) {
      lastError = error
      if (attempt < 3) await wait(attempt * 1_500)
    }
  }
  throw lastError
}

/** 抓取携程招聘官网社招或校园招聘的完整岗位快照。 */
export async function fetchCtripJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!MODE_CONFIG[mode]) throw new Error(`未知的携程招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let pageIndex = 1; ; pageIndex++) {
    const result = await fetchPage({ mode, pageIndex, pageSize: normalizedPageSize, fetchImpl, wait })
    const list = Array.isArray(result.recruitJobAdList) ? result.recruitJobAdList : []
    totalCount = Number(result.total || list.length)
    totalPages = Math.ceil(totalCount / normalizedPageSize) || 1
    traversedPages = pageIndex
    for (const job of list) {
      const id = String(job?.fromId || job?.id || '').trim()
      if (id) jobs.set(id, job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || pageIndex >= totalPages || !list.length) break
    await wait()
  }

  const rows = [...jobs.values()]
    .map(job => ctripJobToRow(job, { mode }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
