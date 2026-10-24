export const MIHOYO_CAREER_ORIGIN = 'https://jobs.mihoyo.com'
export const MIHOYO_API_ORIGIN = 'https://ats.openout.mihoyo.com/ats-portal'

const DEFAULT_RELEASE_TAG = 'v26.9.0-260805'

function recruitmentLane(job, mode) {
  const text = `${job.projectName || ''} ${job.jobNature || ''} ${job.title || ''}`
  if (Number(job.jobNatureId) === 3 || /实习/.test(text)) {
    return { batch: '实习', type: '实习生招聘' }
  }
  if (/春招/.test(text)) return { batch: '春招', type: '应届生招聘' }
  if (mode === 'campus' || /校招|应届|毕业/.test(text)) {
    return { batch: '秋招', type: '应届生招聘' }
  }
  return { batch: '社招', type: '社会招聘' }
}

function jobUrl(id, mode) {
  const prefix = mode === 'campus' ? '/campus/position/' : '/position/'
  return `${MIHOYO_CAREER_ORIGIN}/#${prefix}${encodeURIComponent(id)}`
}

export function mihoyoJobToRow(job, { mode = 'social' } = {}) {
  const id = String(job.id || '')
  const lane = recruitmentLane(job, mode)
  const description = [
    job.description ? `岗位职责\n${String(job.description).trim()}` : '',
    job.jobRequire ? `任职要求\n${String(job.jobRequire).trim()}` : '',
    job.addition ? `加分项/补充说明\n${String(job.addition).trim()}` : '',
    job.deliveryInstructions ? `投递说明\n${String(job.deliveryInstructions).trim()}` : '',
  ].filter(Boolean).join('\n\n')
  const detailUrl = jobUrl(id, mode)

  return {
    公司: '米哈游',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.title || '').trim(),
    职位描述: description,
    工作地点: [...new Set((job.addressDetailList || []).map(item => item?.addressDetail).filter(Boolean))].join('、'),
    工作类型: lane.type,
    批次: lane.batch,
    部门: String(job.competencyType || '').trim(),
    备注: String(job.projectName || '').trim(),
    职位ID: String(job.code || id),
    岗位身份标识: `mihoyo:${mode}:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

function requestHeaders(releaseTag) {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    origin: MIHOYO_CAREER_ORIGIN,
    referer: `${MIHOYO_CAREER_ORIGIN}/`,
    'release-tag': releaseTag,
    'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
  }
}

async function postApi(path, data, { fetchImpl, releaseTag }) {
  const response = await fetchImpl(`${MIHOYO_API_ORIGIN}${path}`, {
    method: 'POST',
    headers: requestHeaders(releaseTag),
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`米哈游招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0 || payload?.success !== true) {
    throw new Error(`米哈游招聘接口返回异常：${payload?.message || payload?.code || '未知错误'}`)
  }
  return payload.data
}

async function fetchDetails(summaries, {
  mode,
  fetchImpl,
  releaseTag,
  detailConcurrency,
  wait,
}) {
  const jobs = []
  const failures = []
  for (let start = 0; start < summaries.length; start += detailConcurrency) {
    const batch = summaries.slice(start, start + detailConcurrency)
    const settled = await Promise.allSettled(batch.map(summary => postApi('/v1/job/info', {
      id: String(summary.id),
      channelDetailIds: [1],
      hireType: mode === 'campus' ? 1 : 0,
    }, { fetchImpl, releaseTag })))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value?.id) jobs.push(result.value)
      else failures.push({
        id: String(batch[index]?.id || ''),
        reason: result.status === 'rejected' ? result.reason?.message : '岗位详情为空',
      })
    })
    if (start + detailConcurrency < summaries.length) await wait()
  }
  return { jobs, failures }
}

/** 抓取米哈游招聘官网社招或校园渠道的一岗一公司完整快照。 */
export async function fetchMihoyoJobsSnapshot({
  mode = 'social',
  limit = Infinity,
  pageSize = 100,
  detailConcurrency = 6,
  releaseTag = DEFAULT_RELEASE_TAG,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['social', 'campus'].includes(mode)) throw new Error(`未知的米哈游招聘模式：${mode}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const normalizedConcurrency = Math.min(Math.max(Number(detailConcurrency) || 6, 1), 12)
  const summaries = new Map()
  let totalCount = 0

  for (let pageNo = 1; ; pageNo++) {
    const data = await postApi('/v1/job/list', {
      pageNo,
      pageSize: normalizedPageSize,
      channelDetailIds: [1],
      hireType: mode === 'campus' ? 1 : 0,
    }, { fetchImpl, releaseTag })
    const list = data?.list || []
    totalCount = Number(data?.total || list.length)
    for (const job of list) {
      if (job?.id != null) summaries.set(String(job.id), job)
      if (summaries.size >= normalizedLimit) break
    }
    if (summaries.size >= normalizedLimit || summaries.size >= totalCount || list.length < normalizedPageSize || !list.length) break
    await wait()
  }

  const { jobs, failures } = await fetchDetails([...summaries.values()], {
    mode,
    fetchImpl,
    releaseTag,
    detailConcurrency: normalizedConcurrency,
    wait,
  })
  const reachedLimit = summaries.size >= normalizedLimit && normalizedLimit < totalCount
  return {
    rows: jobs.map(job => mihoyoJobToRow(job, { mode }))
      .filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: totalCount,
    fetchedJobs: jobs.length,
    complete: !reachedLimit && summaries.size >= totalCount && failures.length === 0 && jobs.length === summaries.size,
    diagnostics: { failures },
  }
}
