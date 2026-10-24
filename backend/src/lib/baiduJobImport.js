export const BAIDU_CAREER_ORIGIN = 'https://talent.baidu.com'
export const BAIDU_JOB_API = `${BAIDU_CAREER_ORIGIN}/httservice/getPostListNew`

const headers = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
  referer: `${BAIDU_CAREER_ORIGIN}/jobs/list`,
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
}

const recruitLabels = { SOCIAL: '社会招聘', GRADUATE: '校园招聘', INTERN: '实习生招聘' }

function detailUrl(job, recruitType) {
  return `${BAIDU_CAREER_ORIGIN}/jobs/detail/${encodeURIComponent(recruitType)}/${encodeURIComponent(job.postId)}`
}

function batchFor(job, recruitType) {
  if (recruitType === 'SOCIAL') return '社招'
  if (recruitType === 'INTERN') return '实习'
  const text = `${job.projectType || ''} ${job.name || ''}`
  if (/实习|intern/i.test(text)) return '实习'
  if (/春招/.test(text)) return '春招'
  if (/秋招/.test(text)) return '秋招'
  const month = Number(String(job.publishDate || job.updateDate || '').slice(5, 7))
  return month >= 1 && month <= 6 ? '春招' : month >= 7 ? '秋招' : '校园招聘'
}

export function baiduJobToRow(job, recruitType) {
  const description = [
    job.workContent && `工作职责\n${String(job.workContent).trim()}`,
    job.serviceCondition && `职位要求\n${String(job.serviceCondition).trim()}`,
  ].filter(Boolean).join('\n\n')
  const url = detailUrl(job, recruitType)
  return {
    公司: '百度',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: description,
    工作地点: String(job.workPlace || '').replace(/,/g, '、'),
    工作类型: recruitLabels[recruitType] || job.projectType || '',
    批次: batchFor(job, recruitType),
    部门: [job.bgShortName, job.orgName].filter(Boolean).join(' / '),
    发布时间: String(job.publishDate || '').slice(0, 10),
    更新时间: String(job.updateDate || '').slice(0, 10),
    职位ID: String(job.postId || ''),
    岗位身份标识: `baidu:${job.postId}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function fetchPage({ recruitType, pageNo, pageSize, fetchImpl }) {
  const body = new URLSearchParams({
    recruitType,
    pageSize: String(pageSize),
    keyWord: '',
    curPage: String(pageNo),
    projectType: '',
  })
  const response = await fetchImpl(BAIDU_JOB_API, {
    method: 'POST',
    headers: { ...headers, referer: `${BAIDU_CAREER_ORIGIN}/jobs/${recruitType === 'SOCIAL' ? 'social-list' : 'list'}?recruitType=${recruitType}` },
    body,
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`百度招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 'ok' || !payload.data) throw new Error(`百度招聘接口返回异常：${payload.message || payload.status || '未知错误'}`)
  return payload.data
}

export async function fetchBaiduJobsSnapshot({
  recruitType,
  limit = Infinity,
  pageSize = 10,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['SOCIAL', 'GRADUATE', 'INTERN'].includes(recruitType)) throw new Error('百度招聘来源必须配置 SOCIAL、GRADUATE 或 INTERN')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 官网接口会拒绝大于 10 的 pageSize。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 10)
  const jobs = new Map()
  let totalCount = 0

  for (let pageNo = 1; ; pageNo++) {
    const page = await fetchPage({ recruitType, pageNo, pageSize: normalizedPageSize, fetchImpl })
    const pageRows = page.list || []
    totalCount = Number(page.total || pageRows.length)
    for (const job of pageRows) {
      if (job?.postId) jobs.set(String(job.postId), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || jobs.size >= totalCount || pageRows.length < normalizedPageSize || !pageRows.length) break
    await wait()
  }

  return {
    rows: [...jobs.values()].map(job => baiduJobToRow(job, recruitType)).filter(row => row.招聘岗位 && row.职位描述),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
