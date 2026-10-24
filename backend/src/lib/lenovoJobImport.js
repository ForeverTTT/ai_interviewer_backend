export const LENOVO_CAREER_ORIGIN = 'https://talent.lenovo.com.cn'
export const LENOVO_JOB_API = `${LENOVO_CAREER_ORIGIN}/gateway/jobBase/list`
export const LENOVO_DICT_API = `${LENOVO_CAREER_ORIGIN}/gateway/sysDict/all`

const projectLabels = { 1: '应届生招聘', 2: '实习生招聘', 3: '人才项目' }

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function dictionaryMap(rows, code) {
  const item = rows.find(row => row?.dictCode === code)
  return new Map((item?.children || []).map(child => [String(child.dictValue), child.dictName]))
}

function jobBatch(job) {
  if (Number(job.projectType) === 2) return '实习'
  const text = `${projectLabels[job.projectType] || ''} ${job.jobName || ''}`
  if (/实习|intern/i.test(text)) return '实习'
  if (/春招/.test(text)) return '春招'
  if (/秋招/.test(text)) return '秋招'
  // 官网当前开放的 projectType=1/3 都是当届正式批与人才项目；导入层使用春招/秋招标识校园岗位。
  return '秋招'
}

export function lenovoJobToRow(job, { cities = new Map() } = {}) {
  const id = String(job.id || '')
  const url = `${LENOVO_CAREER_ORIGIN}/position/detail?id=${encodeURIComponent(id)}`
  const description = [
    job.jobDuties && `岗位职责\n${plainText(job.jobDuties)}`,
    job.jobRequirement && `任职要求\n${plainText(job.jobRequirement)}`,
  ].filter(Boolean).join('\n\n')
  const cityNames = String(job.workPlace || '').split(',')
    .map(value => cities.get(value.trim()) || value.trim())
    .filter(Boolean)
  return {
    公司: '联想',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.jobName || '').trim(),
    职位描述: description,
    工作地点: [...new Set(cityNames)].join('、'),
    工作类型: projectLabels[job.projectType] || '',
    批次: jobBatch(job),
    部门: String(job.firstDeptId || '').trim(),
    学历要求: String(job.educationRequired || '').trim(),
    职位ID: id,
    岗位身份标识: `lenovo:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${LENOVO_CAREER_ORIGIN}/position`,
      'portal-type': 'PC',
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`联想招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.result) {
    throw new Error(`联想招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.result
}

/** 抓取联想校园招聘官网当前公开的应届、人才项目和实习岗位。 */
export async function fetchLenovoJobsSnapshot({
  projectTypes = [1, 2, 3],
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedTypes = [...new Set(projectTypes.map(Number))].filter(value => [1, 2, 3].includes(value))
  if (!normalizedTypes.length) throw new Error('联想招聘来源必须配置 projectTypes 1、2 或 3')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const dictRows = await fetchJson(LENOVO_DICT_API, fetchImpl)
  const cities = dictionaryMap(dictRows, 'city_portal')
  const jobs = new Map()
  let totalCount = 0

  for (const projectType of normalizedTypes) {
    let typeTotal = 0
    for (let pageNum = 1; ; pageNum++) {
      const endpoint = new URL(LENOVO_JOB_API)
      endpoint.searchParams.set('pageNum', String(pageNum))
      endpoint.searchParams.set('pageSize', String(normalizedPageSize))
      endpoint.searchParams.set('projectType', String(projectType))
      const page = await fetchJson(endpoint, fetchImpl)
      const rows = page.rows || []
      typeTotal = Number(page.total || rows.length)
      for (const job of rows) {
        if (job?.id != null) jobs.set(String(job.id), job)
        if (jobs.size >= normalizedLimit) break
      }
      if (jobs.size >= normalizedLimit || pageNum * normalizedPageSize >= typeTotal || rows.length < normalizedPageSize || !rows.length) break
      await wait()
    }
    totalCount += typeTotal
    if (jobs.size >= normalizedLimit) break
    await wait()
  }

  return {
    rows: [...jobs.values()].map(job => lenovoJobToRow(job, { cities }))
      .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
