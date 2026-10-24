export const KUAISHOU_CAMPUS_ORIGIN = 'https://campus.kuaishou.cn/recruit/campus/e'
export const KUAISHOU_CAMPUS_API = `${KUAISHOU_CAMPUS_ORIGIN}/api/v1/open/positions/simple`

export function kuaishouJobToRow(job) {
  const id = String(job.id || '')
  const intern = String(job.positionNatureCode) === 'intern' || /实习/.test(String(job.name || ''))
  const detailUrl = `${KUAISHOU_CAMPUS_ORIGIN}/#/campus/job-info/${encodeURIComponent(id)}`
  return {
    公司: '快手',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: [
      job.description ? `岗位职责\n${String(job.description).trim()}` : '',
      job.positionDemand ? `任职要求\n${String(job.positionDemand).trim()}` : '',
    ].filter(Boolean).join('\n\n'),
    工作地点: [...new Set((job.workLocationDicts || []).map(item => item?.name).filter(Boolean))].join('、'),
    工作类型: intern ? '实习生招聘' : '应届生招聘',
    批次: intern ? '实习' : '秋招',
    部门: String(job.departmentName || '').trim(),
    备注: String(job.positionLabel || '').trim(),
    发布时间: String(job.releaseTime || '').slice(0, 10),
    职位ID: String(job.code || id),
    岗位身份标识: `kuaishou:campus:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

async function postList(data, fetchImpl) {
  const response = await fetchImpl(KUAISHOU_CAMPUS_API, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: 'https://campus.kuaishou.cn',
      referer: `${KUAISHOU_CAMPUS_ORIGIN}/`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`快手校园招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0) throw new Error(`快手校园招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  return payload.result
}

/** 抓取快手校园招聘官网的正式校招与实习完整快照。 */
export async function fetchKuaishouCampusSnapshot({
  limit = Infinity,
  pageSize = 1000,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 1000, 1), 1000)
  const jobs = new Map()
  let totalCount = 0
  let totalPages = 0
  let traversedPages = 0
  for (let pageNum = 1; ; pageNum++) {
    const result = await postList({ pageSize: normalizedPageSize, pageNum }, fetchImpl)
    const list = result?.list || []
    totalCount = Number(result?.total || list.length)
    totalPages = Number(result?.pages || Math.ceil(totalCount / normalizedPageSize) || 1)
    traversedPages = pageNum
    for (const job of list) {
      if (job?.id != null) jobs.set(String(job.id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || pageNum >= totalPages || !list.length) break
    await wait()
  }
  const reachedLimit = jobs.size >= normalizedLimit && normalizedLimit < totalCount
  const rows = [...jobs.values()].map(kuaishouJobToRow)
    .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID)
  return {
    rows,
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: !reachedLimit && traversedPages >= totalPages && rows.length === jobs.size,
    diagnostics: { failures: [] },
  }
}
