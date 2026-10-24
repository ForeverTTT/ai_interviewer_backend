export const XIAOHONGSHU_ORIGIN = 'https://job.xiaohongshu.com'
export const XIAOHONGSHU_POSITION_API = `${XIAOHONGSHU_ORIGIN}/websiterecruit/position/pageQueryPosition`

const LANE = {
  social: { type: '社会招聘', batch: '社招', path: '/social/position' },
  campus: { type: '应届生招聘', batch: '秋招', path: '/campus/position' },
  intern: { type: '实习生招聘', batch: '实习', path: '/campus/intern/position' },
}

function detailUrl(mode, id) {
  const prefix = mode === 'social' ? '/social/position/' : mode === 'intern' ? '/campus/intern/position/' : '/campus/position/'
  return `${XIAOHONGSHU_ORIGIN}${prefix}${encodeURIComponent(id)}`
}

export function xiaohongshuJobToRow(job, { mode = 'social' } = {}) {
  const lane = LANE[mode] || LANE.social
  const id = String(job.positionId || '')
  const url = detailUrl(mode, id)
  return {
    公司: '小红书',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.positionName || '').trim(),
    职位描述: [
      job.duty ? `岗位职责\n${String(job.duty).trim()}` : '',
      job.qualification ? `任职要求\n${String(job.qualification).trim()}` : '',
    ].filter(Boolean).join('\n\n'),
    工作地点: String(job.workplace || '').trim(),
    工作类型: lane.type,
    批次: lane.batch,
    部门: String(job.subDirectionName || job.directionName || '').trim(),
    备注: String([job.jobType, job.jobProjectName].filter(Boolean).join(' / ')).trim(),
    发布时间: String(job.publishTime || '').slice(0, 10),
    职位ID: id,
    岗位身份标识: `xiaohongshu:${mode}:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

async function requestPage({ mode, pageNum, pageSize, fetchImpl }) {
  const lane = LANE[mode]
  if (!lane) throw new Error(`未知的小红书招聘类别：${mode}`)
  const response = await fetchImpl(XIAOHONGSHU_POSITION_API, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: XIAOHONGSHU_ORIGIN,
      referer: `${XIAOHONGSHU_ORIGIN}${lane.path}`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    body: JSON.stringify({ positionName: '', pageNum, pageSize, recruitType: mode }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`小红书招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload?.success !== true || Number(payload?.statusCode) !== 200) {
    throw new Error(`小红书招聘接口返回异常：${payload?.errorMsg || payload?.alertMsg || payload?.statusCode || '未知错误'}`)
  }
  return payload.data || {}
}

/** 抓取小红书官网公开的社招、校招或实习完整快照；列表已包含完整 JD。 */
export async function fetchXiaohongshuJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 10,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!LANE[mode]) throw new Error(`未知的小红书招聘类别：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 官网当前固定返回每页 10 条；显式限制避免按较大的请求值跳页。
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 10)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0
  for (let pageNum = 1; ; pageNum++) {
    const page = await requestPage({ mode, pageNum, pageSize: normalizedPageSize, fetchImpl })
    const list = Array.isArray(page.list) ? page.list : []
    const effectivePageSize = Number(page.pageSize) || normalizedPageSize
    totalCount = Number(page.total || list.length)
    totalPages = Number(page.totalPage || Math.ceil(totalCount / effectivePageSize) || 1)
    traversedPages = pageNum
    for (const job of list) {
      if (job?.positionId != null) jobs.set(String(job.positionId), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || pageNum >= totalPages || !list.length) break
    await wait()
  }
  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const rows = [...jobs.values()].map(job => xiaohongshuJobToRow(job, { mode }))
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
