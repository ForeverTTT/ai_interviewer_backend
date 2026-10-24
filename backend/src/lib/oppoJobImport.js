export const OPPO_SOCIAL_ORIGIN = 'https://career.oppo.com'
export const OPPO_CAMPUS_ORIGIN = 'https://careers.oppo.com'
export const OPPO_SOCIAL_API = `${OPPO_SOCIAL_ORIGIN}/ats-candidate-api/open-api/position/queryPositionList`
export const OPPO_CAMPUS_API = `${OPPO_CAMPUS_ORIGIN}/openapi/position/pageNew`

const requestHeaders = origin => ({
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json',
  origin,
  referer: `${origin}/`,
  'tenant-id': '1000',
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
})

function normalizedDate(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

function campusBatch(job) {
  const text = `${job.recruitmentTypeName || ''} ${job.recruitmentType || ''} ${job.projectName || ''} ${job.positionName || ''}`
  if (/实习|intern/i.test(text)) return '实习'
  if (/春招/.test(text)) return '春招'
  if (/秋招/.test(text)) return '秋招'
  const month = Number(normalizedDate(job.releaseTime).slice(5, 7))
  return month >= 1 && month <= 6 ? '春招' : month >= 7 ? '秋招' : '校园招聘'
}

export function oppoSocialJobToRow(job) {
  const id = String(job.positionId || '')
  const url = `${OPPO_SOCIAL_ORIGIN}/recruitment/post/${encodeURIComponent(id)}`
  const description = [
    job.jobDuty && `岗位职责\n${String(job.jobDuty).trim()}`,
    job.workRequire && `任职要求\n${String(job.workRequire).trim()}`,
  ].filter(Boolean).join('\n\n')
  return {
    公司: 'OPPO',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.publishName || job.jobName || '').trim(),
    职位描述: description,
    工作地点: String(job.workCityName || '').trim(),
    工作类型: String(job.recruitTypeName || '社会招聘').trim(),
    批次: '社招',
    职位类别: String(job.jobType || '').trim(),
    学历要求: String(job.educationRequire || '').trim(),
    发布时间: normalizedDate(job.publishDate),
    职位ID: id,
    岗位身份标识: `oppo:social:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

export function oppoCampusJobToRow(job) {
  const id = String(job.idProjPosition || job.projectPositionId || job.idRecruitPosition || '')
  const url = `${OPPO_CAMPUS_ORIGIN}/university/oppo/campus/post/${encodeURIComponent(id)}`
  const requirement = job.positionRequire || job.projectPositionRequire || job.knowledgeSkill
  const description = [
    (job.positionDesc || job.projectPositionDesc) && `岗位职责\n${String(job.positionDesc || job.projectPositionDesc).trim()}`,
    requirement && `任职要求\n${String(requirement).trim()}`,
    job.bonusItem && `加分项\n${String(job.bonusItem).trim()}`,
  ].filter(Boolean).join('\n\n')
  return {
    公司: 'OPPO',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.positionName || job.projectPositionName || '').trim(),
    职位描述: description,
    工作地点: String(job.workCityName || '').trim(),
    工作类型: String(job.recruitmentTypeName || job.projectName || '校园招聘').trim(),
    批次: campusBatch(job),
    职位类别: String(job.positionTypeName || job.positionType || '').trim(),
    发布时间: normalizedDate(job.releaseTime),
    职位ID: id,
    岗位身份标识: `oppo:campus:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function fetchPage({ mode, pageNum, pageSize, fetchImpl }) {
  const social = mode === 'social'
  const endpoint = social ? OPPO_SOCIAL_API : OPPO_CAMPUS_API
  const origin = social ? OPPO_SOCIAL_ORIGIN : OPPO_CAMPUS_ORIGIN
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: requestHeaders(origin),
    body: JSON.stringify({
      pageNum,
      pageSize,
      positionName: '',
      publishName: '',
      projectList: [],
      foreignRecruitmentTypeList: [],
      positionTypeList: [],
      workCityCodeList: [],
      jobTypeList: [],
      recruitTypeList: [],
      shareId: '',
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`OPPO ${social ? '社招' : '校招'}接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !payload?.data) {
    throw new Error(`OPPO 招聘接口返回异常：${payload?.msg || payload?.code || '未知错误'}`)
  }
  return {
    rows: social ? (payload.data.list || []) : (payload.data.records || []),
    total: Number(payload.data.total || 0),
  }
}

/** 抓取 OPPO 官方招聘站公开展示的社招或校招/实习完整快照。 */
export async function fetchOppoJobsSnapshot({
  mode,
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['social', 'campus'].includes(mode)) throw new Error('OPPO 招聘来源必须配置 mode 为 social 或 campus')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const jobs = new Map()
  let totalCount = 0

  for (let pageNum = 1; ; pageNum++) {
    const page = await fetchPage({ mode, pageNum, pageSize: normalizedPageSize, fetchImpl })
    totalCount = page.total
    for (const job of page.rows) {
      const id = mode === 'social' ? job?.positionId : (job?.idProjPosition || job?.projectPositionId || job?.idRecruitPosition)
      if (id != null) jobs.set(String(id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || jobs.size >= totalCount || page.rows.length < normalizedPageSize || !page.rows.length) break
    await wait()
  }

  const mapper = mode === 'social' ? oppoSocialJobToRow : oppoCampusJobToRow
  return {
    rows: [...jobs.values()].map(mapper).filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
