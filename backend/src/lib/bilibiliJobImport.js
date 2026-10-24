export const BILIBILI_CAREER_ORIGIN = 'https://jobs.bilibili.com'

const CSRF_API = `${BILIBILI_CAREER_ORIGIN}/api/auth/v1/csrf/token`
const LIST_APIS = {
  social: `${BILIBILI_CAREER_ORIGIN}/api/srs/position/positionList`,
  campus: `${BILIBILI_CAREER_ORIGIN}/api/campus/position/positionList`,
}

function requestHeaders({ mode, csrf }) {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    origin: BILIBILI_CAREER_ORIGIN,
    referer: `${BILIBILI_CAREER_ORIGIN}/${mode}/positions`,
    'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    'x-appkey': 'ops.ehr-api.auth',
    'x-usertype': '2',
    'lunar-id': `lunar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ...(csrf ? { 'x-csrf': csrf, 'x-channel': mode } : {}),
  }
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

export function bilibiliJobToRow(job, { mode = 'social' } = {}) {
  const id = String(job.id || '').trim()
  const intern = mode === 'campus' && /实习/.test([
    job.positionName,
    job.positionTypeName,
    job.positionDescription,
  ].filter(Boolean).join(' '))
  const detailUrl = `${BILIBILI_CAREER_ORIGIN}/${mode}/positions/${encodeURIComponent(id)}`
  return {
    公司: '哔哩哔哩',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.positionName || '').trim(),
    职位描述: String(job.positionDescription || '').trim(),
    工作地点: String(job.workLocation || '').trim(),
    工作类型: mode === 'social' ? '社会招聘' : intern ? '实习生招聘' : '应届生招聘',
    批次: mode === 'social' ? '社招' : intern ? '实习' : '秋招',
    备注: String(job.postCodeName || job.positionTypeName || '').trim(),
    发布时间: dateOnly(job.pushTime),
    职位ID: id,
    岗位身份标识: `bilibili:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function fetchCsrf({ mode, fetchImpl }) {
  const response = await fetchImpl(CSRF_API, {
    headers: requestHeaders({ mode }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`哔哩哔哩招聘鉴权接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.data) {
    throw new Error(`哔哩哔哩招聘鉴权接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return String(payload.data)
}

async function fetchPage({ mode, pageNum, pageSize, csrf, fetchImpl }) {
  const response = await fetchImpl(LIST_APIS[mode], {
    method: 'POST',
    headers: requestHeaders({ mode, csrf }),
    body: JSON.stringify({
      pageSize,
      pageNum,
      positionName: '',
      postCode: [],
      postCodeList: [],
      workLocationList: [],
      workTypeList: ['3'],
      positionTypeList: ['3'],
      deptCodeList: [],
      recruitType: mode === 'social' ? 0 : null,
      practiceTypes: [],
      onlyHotRecruit: 0,
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`哔哩哔哩${mode === 'social' ? '社会' : '校园'}招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.data) {
    throw new Error(`哔哩哔哩招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.data
}

/** 抓取哔哩哔哩招聘官网的社招或校园招聘完整快照。 */
export async function fetchBilibiliJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 50,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!LIST_APIS[mode]) throw new Error(`不支持的哔哩哔哩招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 100)
  const csrf = await fetchCsrf({ mode, fetchImpl })
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let pageNum = 1; ; pageNum++) {
    const result = await fetchPage({ mode, pageNum, pageSize: normalizedPageSize, csrf, fetchImpl })
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
    .map(job => bilibiliJobToRow(job, { mode }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
