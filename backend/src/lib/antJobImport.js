export const ANT_TALENT_ORIGIN = 'https://talent.antgroup.com'
export const ANT_API_ORIGIN = 'https://hrcareersweb.antgroup.com'

const CAMPUS_MODE = {
  graduate: { batchKey: 'graduateBatchId', categoryType: 'freshman', type: '应届生招聘', batch: '秋招' },
  intern: { batchKey: 'traineeBatchId', categoryType: 'internship', type: '实习生招聘', batch: '实习' },
}

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

function jobDescription(job) {
  return [
    job.description ? `岗位职责\n${String(job.description).trim()}` : '',
    job.requirement ? `任职要求\n${String(job.requirement).trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

function expiredCampusJob(job, today = new Date()) {
  const end = job?.graduationTime?.to
  if (!end) return false
  const endDate = new Date(end)
  if (Number.isNaN(endDate.getTime())) return false
  const todayInShanghai = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(today)
  return dateOnly(endDate.toISOString()) < todayInShanghai
}

export function antJobToRow(job, { mode = 'social' } = {}) {
  const id = String(job.id || '').trim()
  const campus = mode !== 'social'
  const modeConfig = CAMPUS_MODE[mode]
  const detailUrl = campus
    ? `${ANT_TALENT_ORIGIN}/campus-position?positionId=${encodeURIComponent(id)}&extType=${modeConfig.categoryType}`
    : `${ANT_TALENT_ORIGIN}/off-campus-position?positionId=${encodeURIComponent(id)}`
  return {
    公司: '蚂蚁集团',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: jobDescription(job),
    工作地点: (job.workLocations || []).filter(Boolean).join('、'),
    工作类型: campus ? modeConfig.type : '社会招聘',
    批次: campus ? modeConfig.batch : '社招',
    部门: String(job.department || '').trim(),
    备注: (job.categories || [job.categoryName]).filter(Boolean).join(' / '),
    发布时间: dateOnly(job.publishTime),
    职位ID: id,
    岗位身份标识: `ant:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function requestJson(path, body, { fetchImpl, referer }) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(`${ANT_API_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json',
          origin: ANT_TALENT_ORIGIN,
          referer,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`蚂蚁招聘接口返回 HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.success !== true) {
        throw new Error(`蚂蚁招聘接口返回异常：${payload?.errorMsg || payload?.errorCode || '未知错误'}`)
      }
      return payload
    } catch (error) {
      lastError = error
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1_500))
    }
  }
  throw lastError
}

async function currentCampusBatch(mode, fetchImpl) {
  const config = CAMPUS_MODE[mode]
  const payload = await requestJson('/api/campus/positionGroup/queryBatchConfig', {
    channel: 'campus_group_official_site',
    language: 'zh-CN',
    site: 'China',
  }, { fetchImpl, referer: `${ANT_TALENT_ORIGIN}/campus-list` })
  const batchId = payload?.content?.[config.batchKey]
  if (!batchId) throw new Error(`蚂蚁招聘官网没有返回当前${mode === 'graduate' ? '校招' : '实习'}批次`)
  return String(batchId)
}

async function fetchPage({ mode, batchId, pageIndex, pageSize, fetchImpl }) {
  if (mode === 'social') {
    return requestJson('/api/social/position/search', {
      key: '',
      regions: '',
      categories: '',
      subCategories: '',
      bgCode: '',
      socialQrCode: '',
      pageIndex,
      pageSize,
      channel: 'group_official_site',
      language: 'zh-CN',
    }, { fetchImpl, referer: `${ANT_TALENT_ORIGIN}/off-campus` })
  }
  const config = CAMPUS_MODE[mode]
  return requestJson('/api/campus/position/search', {
    regions: '',
    subCategories: '',
    bgCode: '',
    key: '',
    pageIndex,
    pageSize,
    batchId,
    categoryType: config.categoryType,
    channel: 'campus_group_official_site',
    language: 'zh-CN',
  }, { fetchImpl, referer: `${ANT_TALENT_ORIGIN}/campus-list` })
}

/** 抓取蚂蚁集团官网社招、当前校招或当前实习的完整岗位快照。 */
export async function fetchAntJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
  now = new Date(),
} = {}) {
  if (mode !== 'social' && !CAMPUS_MODE[mode]) throw new Error(`未知的蚂蚁招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 官网当前只稳定支持列表默认的 10 条；更大的值会返回“系统繁忙”。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 10)
  const batchId = mode === 'social' ? '' : await currentCampusBatch(mode, fetchImpl)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let pageIndex = 1; ; pageIndex++) {
    const payload = await fetchPage({ mode, batchId, pageIndex, pageSize: normalizedPageSize, fetchImpl })
    const list = payload.content || []
    totalCount = Number(payload.totalCount || list.length)
    totalPages = Math.ceil(totalCount / normalizedPageSize) || 1
    traversedPages = pageIndex
    for (const job of list) {
      if (job?.id != null) jobs.set(String(job.id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || pageIndex >= totalPages || !list.length) break
    await wait()
  }

  const allJobs = [...jobs.values()]
  const expired = allJobs.filter(job => job.isExpired === 'Y' || (mode !== 'social' && expiredCampusJob(job, now)))
  const expiredIds = new Set(expired.map(job => String(job.id)))
  const activeJobs = allJobs.filter(job => !expiredIds.has(String(job.id)))
  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const rows = activeJobs
    .map(job => antJobToRow(job, { mode }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  const complete = !reachedLimit && traversedPages >= totalPages && rows.length === activeJobs.length
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete,
    authoritativeEmpty: complete && jobs.size > 0 && rows.length === 0,
    diagnostics: { failures: [], unavailable: expired.length },
  }
}
