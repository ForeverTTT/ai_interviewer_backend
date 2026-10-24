export const VIVO_CAREER_ORIGIN = 'https://career.vivo.com'
export const VIVO_SOCIAL_API = `${VIVO_CAREER_ORIGIN}/api/social/webSite/portal/page`

function publishedDate(value) {
  const epoch = Number(value)
  if (!Number.isFinite(epoch) || epoch <= 0) return ''
  return new Date(epoch > 10_000_000_000 ? epoch : epoch * 1000).toISOString().slice(0, 10)
}

export function vivoSocialJobToRow(job) {
  const id = String(job.job_id || '')
  const categoryId = String(job.job_category_id || '')
  const detail = new URL('/job-detail', VIVO_CAREER_ORIGIN)
  detail.searchParams.set('_collect', 'false')
  if (categoryId) detail.searchParams.set('_irjc', categoryId)
  detail.searchParams.set('_irjid', id)
  return {
    公司: 'vivo',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.job_title || '').trim(),
    职位描述: String(job.job_desc || '').trim(),
    工作地点: [...new Set((job.job_location_list || []).map(item => item?.city || item?.location).filter(Boolean))].join('、'),
    工作类型: '社会招聘',
    批次: '社招',
    部门: String(job.requirement_org_name || '').trim(),
    学历要求: String(job.degree_range_name || '').trim(),
    发布时间: publishedDate(job.publish_timestamp),
    职位ID: String(job.job_code || id),
    岗位身份标识: `vivo:social:${id}`,
    职位详情链接: detail.href,
    简历投递链接: detail.href,
  }
}

async function fetchPage({ page, pageSize, fetchImpl }) {
  const response = await fetchImpl(VIVO_SOCIAL_API, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'content-type': 'application/json',
      origin: VIVO_CAREER_ORIGIN,
      referer: `${VIVO_CAREER_ORIGIN}/jobs`,
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    body: JSON.stringify({
      city_code_list: [],
      company_id: 1,
      group_id: 1,
      user_id: null,
      job_category_id_list: [],
      keyword: '',
      max_results: pageSize,
      page,
      yoe_list: [],
    }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`vivo 社招接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || !Array.isArray(payload?.data)) {
    throw new Error(`vivo 社招接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return { rows: payload.data, total: Number(payload.meta?.total || payload.data.length) }
}

/** 抓取 vivo 社会招聘官网公开展示的一岗一公司完整快照。 */
export async function fetchVivoSocialJobsSnapshot({
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const jobs = new Map()
  let totalCount = 0

  for (let page = 1; ; page++) {
    const result = await fetchPage({ page, pageSize: normalizedPageSize, fetchImpl })
    totalCount = result.total
    for (const job of result.rows) {
      if (job?.job_id) jobs.set(String(job.job_id), job)
      if (jobs.size >= normalizedLimit) break
    }
    if (jobs.size >= normalizedLimit || jobs.size >= totalCount || result.rows.length < normalizedPageSize || !result.rows.length) break
    await wait()
  }

  return {
    rows: [...jobs.values()].map(vivoSocialJobToRow)
      .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.size,
    complete: jobs.size >= totalCount,
  }
}
