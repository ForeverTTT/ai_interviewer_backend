export const JD_SOCIAL_ORIGIN = 'https://zhaopin.jd.com'
export const JD_CAMPUS_ORIGIN = 'https://campus.jd.com'

function dateFromTimestamp(value) {
  if (!value) return ''
  const date = new Date(Number(value))
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function jobDescription(job) {
  return [
    job.workContent ? `岗位职责\n${String(job.workContent).trim()}` : '',
    job.qualification ? `任职要求\n${String(job.qualification).trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

function campusLocations(job) {
  const locations = (job.requirementVoList || []).map(item => item?.workCity).filter(Boolean)
  if (job.workCity) locations.unshift(job.workCity)
  return [...new Set(locations)].join('、')
}

export function jdJobToRow(job, { mode = 'social' } = {}) {
  const campus = mode !== 'social'
  const id = String(campus ? job.publishId : (job.requirementId || job.id || job.positionId || ''))
  const type = mode === 'intern' ? '实习生招聘' : mode === 'graduate' ? '应届生招聘' : '社会招聘'
  const batch = mode === 'intern' ? '实习' : mode === 'graduate' ? '秋招' : '社招'
  const detailUrl = campus
    ? `${JD_CAMPUS_ORIGIN}/#/details?type=${mode === 'intern' ? 'internship' : 'present'}&id=${encodeURIComponent(id)}`
    : `${JD_SOCIAL_ORIGIN}/web/job/job_info_list/3`
  const businessUnits = campus
    ? [...new Set((job.requirementVoList || []).map(item => item?.positionBg).filter(Boolean))].join('、')
    : String(job.positionDeptName || '').trim()

  return {
    公司: '京东',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.positionNameOpen || job.positionName || '').trim(),
    职位描述: jobDescription(job),
    工作地点: campus ? campusLocations(job) : String(job.workCity || '').trim(),
    工作类型: type,
    批次: batch,
    部门: businessUnits,
    备注: String(campus ? [job.jobDirection, job.jobCategory].filter(Boolean).join(' / ') : job.jobType || '').trim(),
    发布时间: String(job.formatPublishTime || dateFromTimestamp(job.publishTime)).trim(),
    职位ID: String(campus ? (job.publishId || job.reqId) : (job.reqNumber || job.requirementId || job.id)),
    岗位身份标识: `jd:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function requestJson(url, options, fetchImpl) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        ...options,
        headers: {
          accept: 'application/json, text/plain, */*',
          referer: url.startsWith(JD_CAMPUS_ORIGIN) ? `${JD_CAMPUS_ORIGIN}/` : `${JD_SOCIAL_ORIGIN}/web/job/job_info_list/3`,
          'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
          ...options?.headers,
        },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`京东招聘接口返回 HTTP ${response.status}`)
      const text = await response.text()
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('京东招聘接口没有返回有效 JSON')
      }
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 400))
    }
  }
  throw lastError
}

function socialForm(values = {}) {
  return new URLSearchParams({
    workCityJson: '[]',
    jobTypeJson: '[]',
    jobSearch: '',
    depTypeJson: '[]',
    ...values,
  })
}

async function fetchSocial({ fetchImpl, limit, pageSize, wait }) {
  const countResponse = await fetchImpl(`${JD_SOCIAL_ORIGIN}/web/job/job_count`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    body: socialForm(),
    signal: AbortSignal.timeout(20_000),
  })
  if (!countResponse.ok) throw new Error(`京东社招总数接口返回 HTTP ${countResponse.status}`)
  const totalCount = Number((await countResponse.text()).trim())
  if (!Number.isFinite(totalCount)) throw new Error('京东社招总数接口返回异常')
  const jobs = new Map()
  const totalPages = Math.ceil(totalCount / pageSize)
  let traversedPages = 0
  for (let pageIndex = 1; pageIndex <= totalPages; pageIndex++) {
    const list = await requestJson(`${JD_SOCIAL_ORIGIN}/web/job/job_list`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: socialForm({ pageIndex: String(pageIndex), pageSize: String(pageSize) }),
    }, fetchImpl)
    traversedPages = pageIndex
    for (const job of list || []) {
      const id = job.requirementId || job.id || job.positionId
      if (id != null) jobs.set(String(id), job)
      if (jobs.size >= limit) break
    }
    if (jobs.size >= limit || pageIndex >= totalPages || !list?.length) break
    await wait()
  }
  return { jobs: [...jobs.values()], totalCount, totalPages, traversedPages }
}

async function fetchCampus({ mode, fetchImpl, limit, pageSize, wait }) {
  const type = mode === 'intern' ? 'internship' : 'present'
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0
  for (let pageIndex = 1; ; pageIndex++) {
    const payload = await requestJson(`${JD_CAMPUS_ORIGIN}/api/wx/position/page?type=${type}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pageSize,
        pageIndex,
        parameter: { positionName: '', planIdList: [], jobDirectionCodeList: [], workCityCodeList: [], positionDeptList: [] },
      }),
    }, fetchImpl)
    if (payload?.success !== true) throw new Error(`京东校园招聘接口返回异常：${payload?.message || '未知错误'}`)
    const body = payload.body || {}
    const items = body.items || []
    totalCount = Number(body.totalNumber || items.length)
    totalPages = Math.ceil(totalCount / pageSize)
    traversedPages = pageIndex
    for (const job of items) {
      if (job?.publishId != null) jobs.set(String(job.publishId), job)
      if (jobs.size >= limit) break
    }
    if (jobs.size >= limit || pageIndex >= totalPages || !items.length) break
    await wait()
  }
  return { jobs: [...jobs.values()], totalCount, totalPages, traversedPages }
}

/** 抓取京东社招、正式校招或实习官网的一岗一公司完整快照。 */
export async function fetchJdJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['social', 'graduate', 'intern'].includes(mode)) throw new Error(`未知的京东招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 校园接口虽然接受更大的 pageSize，但超过 10 后会静默漏掉岗位。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), mode === 'social' ? 100 : 10)
  const snapshot = mode === 'social'
    ? await fetchSocial({ fetchImpl, limit: normalizedLimit, pageSize: normalizedPageSize, wait })
    : await fetchCampus({ mode, fetchImpl, limit: normalizedLimit, pageSize: normalizedPageSize, wait })
  const reachedLimit = snapshot.jobs.length >= normalizedLimit && normalizedLimit < snapshot.totalCount
  const rows = snapshot.jobs.map(job => jdJobToRow(job, { mode }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: snapshot.totalCount,
    fetchedJobs: snapshot.jobs.length,
    complete: !reachedLimit && snapshot.traversedPages >= snapshot.totalPages && rows.length === snapshot.jobs.length,
    diagnostics: { failures: [] },
  }
}
