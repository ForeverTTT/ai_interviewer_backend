export const XIAOMI_CAREER_ORIGIN = 'https://hr.xiaomi.com'
export const XIAOMI_JOB_API = `${XIAOMI_CAREER_ORIGIN}/website/api/agent/searchJobPage`

const projectLabels = {
  1: '社会招聘',
  2: '校园招聘',
  3: '实习生招聘',
  4: '顶尖人才',
}

function batchFor(job, projectType) {
  if (Number(projectType) === 1) return '社招'
  if (Number(projectType) === 3) return '实习'
  const text = `${job.title || ''} ${projectLabels[projectType] || ''}`
  if (/实习|intern/i.test(text)) return '实习'
  if (/春招/.test(text)) return '春招'
  if (/秋招/.test(text)) return '秋招'
  const month = Number(String(job.publishTime || '').slice(5, 7))
  return month >= 1 && month <= 6 ? '春招' : month >= 7 ? '秋招' : '校园招聘'
}

export function xiaomiJobToRow(job, projectType = job.type) {
  const id = String(job.jobPostId || job.jobId || job.id || '')
  const url = String(job.url || '').trim()
  const description = [
    job.description && `工作职责\n${String(job.description).trim()}`,
    job.requirement && `职位要求\n${String(job.requirement).trim()}`,
  ].filter(Boolean).join('\n\n')
  return {
    公司: '小米',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.title || '').trim(),
    职位描述: description,
    工作地点: [...new Set(job.cityZhNames || [])].filter(Boolean).join('、'),
    工作类型: projectLabels[projectType] || projectLabels[job.type] || '',
    批次: batchFor(job, projectType),
    部门: String(job.levelOneDeptName || '').trim(),
    发布时间: String(job.publishTime || '').slice(0, 10),
    职位ID: id,
    岗位身份标识: `xiaomi:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function fetchPage({ projectType, pageNum, pageSize, fetchImpl }) {
  const endpoint = new URL(XIAOMI_JOB_API)
  endpoint.searchParams.set('keyword', '')
  endpoint.searchParams.set('cityZhNames', '')
  endpoint.searchParams.set('pageSize', String(pageSize))
  endpoint.searchParams.set('pageNum', String(pageNum))
  endpoint.searchParams.set('type', String(projectType))
  const response = await fetchImpl(endpoint, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${XIAOMI_CAREER_ORIGIN}/website/opportunities.html`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`小米招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.code !== 0 || !payload?.data) {
    throw new Error(`小米招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.data
}

/** 抓取小米官方“加入我们”页面公开展示的完整岗位快照。 */
export async function fetchXiaomiJobsSnapshot({
  projectType,
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedProjectType = Number(projectType)
  if (![1, 2, 3, 4].includes(normalizedProjectType)) throw new Error('小米招聘来源必须配置 projectType 1、2、3 或 4')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const jobs = new Map()
  let totalCount = 0

  for (let pageNum = 1; ; pageNum++) {
    const page = await fetchPage({ projectType: normalizedProjectType, pageNum, pageSize: normalizedPageSize, fetchImpl })
    const pageRows = Array.isArray(page.list) ? page.list : []
    totalCount = Number(page.total || pageRows.length)
    for (const job of pageRows) {
      const id = job?.jobPostId || job?.jobId || job?.id
      if (id) jobs.set(String(id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || jobs.size >= totalCount || pageRows.length < normalizedPageSize || !pageRows.length) break
    await wait()
  }

  return {
    rows: [...jobs.values()].map(job => xiaomiJobToRow(job, normalizedProjectType))
      .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID && row.简历投递链接),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
