const DEFAULT_ORIGIN = 'https://jobs.nvidia.com'

function plainText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isoDateFromEpoch(value) {
  const epoch = Number(value)
  if (!Number.isFinite(epoch) || epoch <= 0) return ''
  return new Date(epoch * 1000).toISOString().slice(0, 10)
}

function recruitmentLane(job) {
  const title = String(job.name || '')
  if (/\bintern(?:ship)?\b|实习/i.test(title)) return { batch: '实习', type: '实习生招聘' }
  if (/new college grad|new grad|graduate program|campus|应届|校招/i.test(title)) {
    return { batch: '秋招', type: '应届生招聘' }
  }
  return { batch: '社招', type: '社会招聘' }
}

function requestHeaders(origin) {
  return {
    accept: 'application/json, text/plain, */*',
    referer: `${origin}/careers`,
    'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
  }
}

async function fetchPayload(url, { origin, fetchImpl }) {
  const response = await fetchImpl(url, {
    headers: requestHeaders(origin),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`Eightfold 招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.status) !== 200 || !payload?.data) {
    throw new Error(`Eightfold 招聘接口返回异常：${payload?.error?.message || payload?.status || '未知错误'}`)
  }
  return payload.data
}

export function eightfoldJobToRow(job, {
  companyName,
  companyType = '外企',
  industryCategory = '电子/通信/半导体',
  origin = DEFAULT_ORIGIN,
  domain,
} = {}) {
  const id = String(job.id || '')
  const lane = recruitmentLane(job)
  const sourceUrl = job.publicUrl || `${origin}/careers/job/${encodeURIComponent(id)}?domain=${encodeURIComponent(domain || '')}`
  const applyUrl = job.positionUserActions?.applyAction?.applyUrl || sourceUrl
  const family = Array.isArray(job.efcustomTextJobFmailyGroup)
    ? job.efcustomTextJobFmailyGroup.join('、')
    : String(job.efcustomTextJobFmailyGroup || job.department || '')

  return {
    公司: companyName,
    企业类型: companyType,
    行业类别: industryCategory,
    招聘岗位: String(job.name || '').trim(),
    职位描述: plainText(job.jobDescription),
    工作地点: [...new Set(job.locations || [job.location])].filter(Boolean).join('、'),
    工作类型: lane.type,
    批次: lane.batch,
    职位类别: family,
    发布时间: isoDateFromEpoch(job.postedTs || job.creationTs),
    职位ID: String(job.displayJobId || job.atsJobId || id),
    岗位身份标识: `eightfold:${domain || new URL(origin).hostname}:${id}`,
    职位详情链接: sourceUrl,
    简历投递链接: applyUrl,
  }
}

/** 抓取 Eightfold PCSX 招聘站的公开岗位；仅完整列表及全部详情成功时返回完整快照。 */
export async function fetchEightfoldJobsSnapshot({
  companyName,
  origin = DEFAULT_ORIGIN,
  domain,
  location,
  locale = 'en',
  companyType,
  industryCategory,
  limit = Infinity,
  pageSize = 10,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!companyName || !domain) throw new Error('Eightfold 来源必须配置 companyName 和 domain')
  const normalizedOrigin = String(origin).replace(/\/$/, '')
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // PCSX 当前无论 num 多大都最多返回 10 条，固定上限避免遗漏。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 10)
  const listedJobs = new Map()
  let totalCount = 0

  for (let start = 0; ; start += normalizedPageSize) {
    const endpoint = new URL('/api/pcsx/search', normalizedOrigin)
    endpoint.searchParams.set('domain', domain)
    endpoint.searchParams.set('hl', locale)
    endpoint.searchParams.set('start', String(start))
    endpoint.searchParams.set('num', String(normalizedPageSize))
    endpoint.searchParams.set('sort_by', 'timestamp')
    if (location) endpoint.searchParams.set('location', location)
    const page = await fetchPayload(endpoint, { origin: normalizedOrigin, fetchImpl })
    const positions = page.positions || []
    totalCount = Number(page.count || positions.length)
    for (const position of positions) {
      if (position?.id != null) listedJobs.set(String(position.id), position)
      if (listedJobs.size >= normalizedLimit) break
    }
    if (listedJobs.size >= normalizedLimit || listedJobs.size >= totalCount || positions.length < normalizedPageSize || !positions.length) break
    await wait()
  }

  const jobs = []
  const failures = []
  for (const summary of listedJobs.values()) {
    try {
      const endpoint = new URL('/api/pcsx/position_details', normalizedOrigin)
      endpoint.searchParams.set('domain', domain)
      endpoint.searchParams.set('hl', locale)
      endpoint.searchParams.set('position_id', String(summary.id))
      const detail = await fetchPayload(endpoint, { origin: normalizedOrigin, fetchImpl })
      jobs.push(detail)
    } catch (error) {
      failures.push({ id: String(summary.id), reason: error.message })
    }
    if (jobs.length + failures.length < listedJobs.size) await wait()
  }

  const reachedLimit = listedJobs.size >= normalizedLimit && normalizedLimit < totalCount
  return {
    rows: jobs.map(job => eightfoldJobToRow(job, {
      companyName,
      companyType,
      industryCategory,
      origin: normalizedOrigin,
      domain,
    })).filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.length,
    complete: !reachedLimit && listedJobs.size >= totalCount && failures.length === 0 && jobs.length === listedJobs.size,
    diagnostics: { failures },
  }
}
