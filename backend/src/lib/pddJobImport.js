export const PDD_CAREERS_ORIGIN = 'https://careers.pddglobalhr.com'

const PDD_API_ORIGIN = `${PDD_CAREERS_ORIGIN}/api/careers`
const MODE_CONFIG = {
  graduate: {
    listPath: '/api/recruit/position/list',
    detailRoute: '/campus/grad/detail',
    pageType: 'grad',
    workType: '应届生招聘',
    batch: '秋招',
  },
  intern: {
    listPath: '/api/recruit/position/train/list',
    detailRoute: '/campus/intern/detail',
    pageType: 'intern',
    workType: '实习生招聘',
    batch: '实习',
  },
}

function shanghaiDate(value) {
  if (value == null || value === '') return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function jobDescription(job) {
  return [
    job.jobDuty ? `岗位职责\n${String(job.jobDuty).trim()}` : '',
    job.serveRequirement ? `任职要求\n${String(job.serveRequirement).trim()}` : '',
    job.bonus ? `加分项\n${String(job.bonus).trim()}` : '',
  ].filter(Boolean).join('\n\n')
}

function isActiveJob(job) {
  return job?.normal === true && job?.isVote === true && job?.voteArrange === 'inTime'
}

export function pddJobToRow(job, { mode = 'graduate' } = {}) {
  const config = MODE_CONFIG[mode]
  if (!config) throw new Error(`未知的拼多多招聘模式：${mode}`)
  const id = String(job.id || '').trim()
  const detailUrl = job.shareUrl || `${PDD_CAREERS_ORIGIN}${config.detailRoute}?positionId=${encodeURIComponent(id)}`
  const applyUrl = `${PDD_CAREERS_ORIGIN}/campus/resume-apply?positionId=${encodeURIComponent(id)}&batchId=${encodeURIComponent(job.batchId || '')}&pageType=${config.pageType}`
  const notes = [
    job.jobName,
    job.recruitTypeName,
    job.graduationYear ? `${job.graduationYear}届` : '',
    ...(Array.isArray(job.labelList) ? job.labelList : []),
  ].filter(Boolean)
  return {
    公司: '拼多多',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: jobDescription(job),
    工作地点: String(job.workLocationName || job.workLocation || '').trim(),
    工作类型: config.workType,
    批次: config.batch,
    部门: String(job.recruitTypeName || '').trim(),
    备注: [...new Set(notes)].join(' / '),
    发布时间: shanghaiDate(job.releaseTime),
    职位ID: id,
    岗位身份标识: `pdd:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: applyUrl,
  }
}

async function requestJson(path, body, { fetchImpl, wait, referer }) {
  let lastError
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetchImpl(`${PDD_API_ORIGIN}${path}`, {
        method: 'POST',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/json',
          origin: PDD_CAREERS_ORIGIN,
          referer,
          'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`拼多多招聘接口返回 HTTP ${response.status}`)
      const payload = await response.json()
      if (payload?.success !== true || Number(payload?.errorCode) !== 1000000) {
        throw new Error(`拼多多招聘接口返回异常：${payload?.errorMsg || payload?.errorCode || '未知错误'}`)
      }
      return payload.result
    } catch (error) {
      lastError = error
      if (attempt < 3) await wait(attempt * 1_500)
    }
  }
  throw lastError
}

/** 抓取拼多多招聘官网当前校招或实习岗位，并用详情接口确认岗位仍可投递。 */
export async function fetchPddCampusSnapshot({
  mode = 'graduate',
  limit = Infinity,
  pageSize = 10,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const config = MODE_CONFIG[mode]
  if (!config) throw new Error(`未知的拼多多招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 官网会把更大的 pageSize 静默限制为 10，保持和服务端一致才能正确计算页数。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 10)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let page = 1; ; page++) {
    const result = await requestJson(config.listPath, { page, pageSize: normalizedPageSize }, {
      fetchImpl,
      wait,
      referer: `${PDD_CAREERS_ORIGIN}/campus/${config.pageType}`,
    })
    const list = result?.list || []
    totalCount = Number(result?.total || list.length)
    totalPages = Math.ceil(totalCount / normalizedPageSize) || 1
    traversedPages = page
    for (const job of list) {
      if (job?.id != null) jobs.set(String(job.id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || page >= totalPages || !list.length) break
    await wait()
  }

  const failures = []
  const rows = []
  let unavailable = 0
  const listJobs = [...jobs.values()]
  for (let index = 0; index < listJobs.length; index++) {
    const listedJob = listJobs[index]
    try {
      const detail = await requestJson('/api/recruit/position/detail', { id: String(listedJob.id) }, {
        fetchImpl,
        wait,
        referer: `${PDD_CAREERS_ORIGIN}${config.detailRoute}?positionId=${encodeURIComponent(listedJob.id)}`,
      })
      const job = { ...listedJob, ...detail }
      if (!isActiveJob(job)) {
        unavailable++
      } else {
        const row = pddJobToRow(job, { mode })
        if (row.招聘岗位 && row.职位描述 && row.职位ID) rows.push(row)
        else failures.push({ id: String(listedJob.id), reason: '岗位详情缺少名称、JD 或职位 ID' })
      }
    } catch (error) {
      failures.push({ id: String(listedJob.id), reason: error.message })
    }
    if (index < listJobs.length - 1) await wait()
  }

  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const complete = !reachedLimit
    && traversedPages >= totalPages
    && failures.length === 0
    && rows.length + unavailable === jobs.size
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete,
    authoritativeEmpty: complete && jobs.size > 0 && rows.length === 0,
    diagnostics: { failures, unavailable },
  }
}
