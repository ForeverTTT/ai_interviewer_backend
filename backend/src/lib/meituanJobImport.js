export const MEITUAN_CAREER_ORIGIN = 'https://zhaopin.meituan.com'
export const MEITUAN_JOB_API = `${MEITUAN_CAREER_ORIGIN}/api/official/job/getJobList`

const headers = {
  accept: 'application/json',
  'content-type': 'application/json',
  origin: MEITUAN_CAREER_ORIGIN,
  referer: `${MEITUAN_CAREER_ORIGIN}/web/home`,
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
}

const jobTypeLabels = { 1: '应届招聘', 2: '实习招聘', 3: '社会招聘' }

function timestampDate(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return ''
  const date = new Date(numeric)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function batchFor(job) {
  if (String(job.jobType) === '3') return '社招'
  if (String(job.jobType) === '2') return '实习'
  const month = Number(timestampDate(job.refreshTime).slice(5, 7))
  return month >= 1 && month <= 6 ? '春招' : month >= 7 ? '秋招' : '校园招聘'
}

function detailUrl(job) {
  const highlightType = String(job.jobType) === '3' ? 'social' : 'campus'
  return `${MEITUAN_CAREER_ORIGIN}/web/position/detail?highlightType=${highlightType}&jobUnionId=${encodeURIComponent(job.jobUnionId)}`
}

export function meituanJobToRow(job) {
  const description = [
    job.departmentIntro && `部门介绍\n${String(job.departmentIntro).trim()}`,
    job.jobDuty && `岗位职责\n${String(job.jobDuty).trim()}`,
    job.jobRequirement && `岗位要求\n${String(job.jobRequirement).trim()}`,
    job.highLight && `岗位亮点\n${String(job.highLight).trim()}`,
    job.otherInfo && `其他信息\n${String(job.otherInfo).trim()}`,
  ].filter(Boolean).join('\n\n')
  const url = detailUrl(job)
  const type = String(job.jobType || '')
  return {
    公司: '美团',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: description,
    工作地点: (job.cityList || []).map(item => item?.name || item).filter(Boolean).join('、'),
    工作类型: jobTypeLabels[type] || '',
    批次: batchFor(job),
    部门: (job.department || []).map(item => item?.name || item).filter(Boolean).join('、'),
    职位类别: [job.jobFamily, job.jobFamilyGroup].filter(Boolean).join(' / '),
    发布时间: timestampDate(job.firstPostTime || job.refreshTime),
    更新时间: timestampDate(job.refreshTime),
    职位ID: String(job.jobUnionId || ''),
    岗位身份标识: `meituan:${job.jobUnionId}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function fetchPage({ jobTypes, pageNo, pageSize, fetchImpl }) {
  const response = await fetchImpl(MEITUAN_JOB_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      page: { pageNo, pageSize },
      jobShareType: '1',
      keywords: '',
      cityList: [],
      department: [],
      jfJgList: [],
      jobType: jobTypes.map(code => ({ code: String(code), subCode: [] })),
      typeCode: [],
      specialCode: [],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`美团招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 1 || !payload.data) throw new Error(`美团招聘接口返回异常：${payload.message || payload.status || '未知错误'}`)
  return payload.data
}

export async function fetchMeituanJobsSnapshot({
  jobTypes,
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!Array.isArray(jobTypes) || !jobTypes.length) throw new Error('美团招聘来源必须配置 jobTypes')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const jobs = new Map()
  let totalCount = 0

  for (let pageNo = 1; ; pageNo++) {
    const page = await fetchPage({ jobTypes, pageNo, pageSize: normalizedPageSize, fetchImpl })
    const pageRows = page.list || []
    totalCount = Number(page.page?.totalCount || pageRows.length)
    for (const job of pageRows) {
      if (job?.jobUnionId != null) jobs.set(String(job.jobUnionId), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || jobs.size >= totalCount || pageRows.length < normalizedPageSize || !pageRows.length) break
    await wait()
  }

  return {
    rows: [...jobs.values()].map(meituanJobToRow).filter(row => row.招聘岗位 && row.职位描述),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
