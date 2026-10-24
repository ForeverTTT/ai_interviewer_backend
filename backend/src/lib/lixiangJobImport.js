export const LIXIANG_CAREER_ORIGIN = 'https://www.lixiang.com'
export const LIXIANG_API_ORIGIN = `${LIXIANG_CAREER_ORIGIN}/osd-hr-recruitment-website/v1/recruit`

function htmlToText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function recruitmentLane(job, mode) {
  const text = `${job.job_mode || ''} ${job.job_mode_name || ''} ${job.title || ''}`
  if (mode === 'intern' || String(job.job_mode) === '202' || /实习/.test(text)) {
    return { batch: '实习', type: '实习生招聘' }
  }
  if (mode === 'graduate' || Number(job.hire_mode) === 2) {
    return { batch: /春招/.test(text) ? '春招' : '秋招', type: '应届生招聘' }
  }
  return { batch: '社招', type: '社会招聘' }
}

function jobUrl(id) {
  return `${LIXIANG_CAREER_ORIGIN}/employ/detail/${encodeURIComponent(id)}.html`
}

export function lixiangJobToRow(job, { mode = 'social' } = {}) {
  const id = String(job.id || '')
  const lane = recruitmentLane(job, mode)
  const responsibilities = htmlToText(job.description)
  const requirements = htmlToText(job.requirements)
  const description = [
    responsibilities ? `岗位职责\n${responsibilities}` : '',
    requirements ? `任职要求\n${requirements}` : '',
  ].filter(Boolean).join('\n\n')
  const detailUrl = jobUrl(id)
  const functions = [...new Set([
    job.first_job_function_title,
    job.second_job_function_title,
  ].filter(Boolean))].join(' / ')

  return {
    公司: '理想汽车',
    企业类型: '民企',
    行业类别: '汽车/制造',
    招聘岗位: String(job.title || '').trim(),
    职位描述: description,
    工作地点: String(job.location_title || '').trim(),
    工作类型: lane.type,
    批次: lane.batch,
    部门: String(job.department_title || functions).trim(),
    备注: functions,
    职位ID: String(job.code || id),
    岗位身份标识: `lixiang:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function getApi(path, params, { fetchImpl }) {
  const url = new URL(`${LIXIANG_API_ORIGIN}${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
  }
  const response = await fetchImpl(url, {
    headers: {
      accept: 'application/json, text/plain, */*',
      referer: `${LIXIANG_CAREER_ORIGIN}/employ/`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`理想汽车招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0) {
    throw new Error(`理想汽车招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.data
}

async function fetchDetails(summaries, { mode, fetchImpl, detailConcurrency, wait }) {
  const jobs = []
  const failures = []
  for (let start = 0; start < summaries.length; start += detailConcurrency) {
    const batch = summaries.slice(start, start + detailConcurrency)
    const settled = await Promise.allSettled(batch.map(summary => getApi('/job/detail', {
      job_id: summary.id,
    }, { fetchImpl })))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value?.id) {
        jobs.push({ ...batch[index], ...result.value })
      } else {
        failures.push({
          id: String(batch[index]?.id || ''),
          reason: result.status === 'rejected' ? result.reason?.message : '岗位详情为空',
        })
      }
    })
    if (start + detailConcurrency < summaries.length) await wait()
  }
  return { jobs, failures }
}

/** 抓取理想汽车官网社招、校招或实习岗位的一岗一公司完整快照。 */
export async function fetchLixiangJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 100,
  detailConcurrency = 8,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['social', 'graduate', 'intern'].includes(mode)) throw new Error(`未知的理想汽车招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const normalizedConcurrency = Math.min(Math.max(Number(detailConcurrency) || 8, 1), 12)
  const listPath = mode === 'social' ? '/social/job-page' : '/school/job-page'
  const listParams = mode === 'graduate' ? { job_mode: 1 } : mode === 'intern' ? { job_mode: 2 } : {}
  const summaries = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0

  for (let page = 1; ; page++) {
    const data = await getApi(listPath, {
      page,
      page_size: normalizedPageSize,
      ...listParams,
    }, { fetchImpl })
    const items = data?.items || []
    totalCount = Number(data?.total_count || items.length)
    totalPages = Number(data?.total_pages || Math.ceil(totalCount / normalizedPageSize) || 1)
    traversedPages = page
    for (const job of items) {
      if (job?.id != null) summaries.set(String(job.id), job)
      if (summaries.size >= normalizedLimit) break
    }
    if (summaries.size >= normalizedLimit || page >= totalPages || !items.length) break
    await wait()
  }

  const { jobs, failures } = await fetchDetails([...summaries.values()], {
    mode,
    fetchImpl,
    detailConcurrency: normalizedConcurrency,
    wait,
  })
  const reachedLimit = summaries.size >= normalizedLimit && normalizedLimit < totalCount
  return {
    rows: jobs.map(job => lixiangJobToRow(job, { mode }))
      .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.length,
    complete: !reachedLimit && traversedPages >= totalPages && failures.length === 0 && jobs.length === summaries.size,
    diagnostics: { failures },
  }
}
