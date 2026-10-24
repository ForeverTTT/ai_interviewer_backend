export const NETEASE_CAMPUS_ORIGIN = 'https://campus.163.com'

function cleanText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function shanghaiDate(value) {
  if (value == null || value === '') return ''
  const numeric = Number(value)
  const date = new Date(Number.isFinite(numeric) ? numeric : value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = type => parts.find(item => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function jobDescription(job) {
  const description = cleanText(job.positionDescription)
  const requirement = cleanText(job.positionRequirement)
  return [
    description ? `岗位职责\n${description}` : '',
    requirement ? `任职要求\n${requirement}` : '',
  ].filter(Boolean).join('\n\n')
}

export function neteaseCampusJobToRow(job, {
  projectId,
  projectName = '网易校园招聘',
  origin = NETEASE_CAMPUS_ORIGIN,
} = {}) {
  const id = String(job.id || '').trim()
  const normalizedProjectId = String(projectId || job.projectId || '').trim()
  const projectUrl = `${origin}/app/job/position?id=${encodeURIComponent(normalizedProjectId)}`
  return {
    公司: '网易',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: cleanText(job.positionName),
    职位描述: jobDescription(job),
    工作地点: cleanText(job.workPlaceName),
    工作类型: '应届生招聘',
    批次: '秋招',
    备注: [projectName, cleanText(job.positionTypeName), cleanText(job.interviewCityName)].filter(Boolean).join(' / '),
    发布时间: shanghaiDate(job.updateTime),
    职位ID: id,
    岗位身份标识: `netease:campus:${normalizedProjectId}:${id}`,
    职位详情链接: projectUrl,
    简历投递链接: projectUrl,
  }
}

async function fetchPage({ origin, projectId, currentPage, pageSize, fetchImpl }) {
  const url = new URL('/api/campuspc/position/getJobList', origin)
  url.searchParams.set('pageSize', String(pageSize))
  url.searchParams.set('currentPage', String(currentPage))
  url.searchParams.set('projectId', String(projectId))
  url.searchParams.set('timeStamp', String(Date.now()))
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${origin}/app/job/position?id=${encodeURIComponent(projectId)}`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`网易校园招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 200 || !payload?.data) {
    throw new Error(`网易校园招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.data
}

/** 抓取网易校园招聘官网中一个明确招聘项目的完整岗位快照。 */
export async function fetchNeteaseCampusSnapshot({
  projectId,
  projectName = '网易校园招聘',
  origin = NETEASE_CAMPUS_ORIGIN,
  limit = Infinity,
  pageSize = 50,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!projectId) throw new Error('网易校园招聘来源缺少 projectId')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 50, 1), 100)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let currentPage = 1; ; currentPage++) {
    const data = await fetchPage({ origin, projectId, currentPage, pageSize: normalizedPageSize, fetchImpl })
    const list = data.list || []
    totalCount = Number(data.total || list.length)
    totalPages = Number(data.pages || Math.ceil(totalCount / normalizedPageSize) || 1)
    traversedPages = currentPage
    for (const job of list) {
      if (job?.id != null) jobs.set(String(job.id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || currentPage >= totalPages || data.lastPage === true || !list.length) break
    await wait()
  }

  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const rows = [...jobs.values()]
    .map(job => neteaseCampusJobToRow(job, { projectId, projectName, origin }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
