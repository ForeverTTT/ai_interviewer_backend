export const TENCENT_CAMPUS_ORIGIN = 'https://join.qq.com'
export const TENCENT_CAMPUS_API = `${TENCENT_CAMPUS_ORIGIN}/api/v1`

const headers = {
  accept: 'application/json',
  'content-type': 'application/json',
  referer: `${TENCENT_CAMPUS_ORIGIN}/post.html`,
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
}

async function requestJson(path, { method = 'GET', body, params } = {}, fetchImpl) {
  const url = new URL(`${TENCENT_CAMPUS_API}/${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) url.searchParams.set(key, String(value))
  }
  const response = await fetchImpl(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`腾讯校招接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 0 || payload.data == null) {
    const error = new Error(`腾讯校招接口返回异常：${payload.status ?? '未知状态'}`)
    error.apiStatus = payload.status
    throw error
  }
  return payload.data
}

function detailUrl(post) {
  return `${TENCENT_CAMPUS_ORIGIN}/post_detail.html?postid=${encodeURIComponent(post.postId)}`
}

export function tencentCampusJobToRow(post) {
  const bonus = Number(post.recruitType) === 2 ? post.internBonus : post.graduateBonus
  const description = [
    post.desc && `岗位职责\n${String(post.desc).trim()}`,
    post.request && `任职要求\n${String(post.request).trim()}`,
    bonus && `加分项\n${String(bonus).trim()}`,
    post.topicDetail && `课题详情\n${String(post.topicDetail).trim()}`,
    post.topicRequirement && `课题要求\n${String(post.topicRequirement).trim()}`,
  ].filter(Boolean).join('\n\n')
  const url = detailUrl(post)
  return {
    公司: '腾讯',
    企业类型: '民企',
    行业类别: '互联网/游戏',
    招聘岗位: String(post.title || post.positionTitle || '').trim(),
    职位描述: description,
    工作地点: Array.isArray(post.workCityList) ? post.workCityList.join('、') : String(post.workCities || '').trim(),
    工作类型: post.recruitLabelName || post.projectName || (Number(post.recruitType) === 2 ? '实习生' : '应届毕业生'),
    部门: String(post.bgs || '').trim(),
    职位ID: String(post.postId || ''),
    岗位身份标识: `tencent-campus:${post.postId}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

/**
 * 腾讯国内校招官网的完整公开职位快照。
 * projectMappingIds 来自官网 getProjectMapping：应届 [1, 14]，实习 [2, 104, 20]。
 */
export async function fetchTencentCampusJobsSnapshot({
  projectMappingIds,
  limit = Infinity,
  pageSize = 100,
  detailConcurrency = 6,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!Array.isArray(projectMappingIds) || !projectMappingIds.length) {
    throw new Error('腾讯校招来源必须配置 projectMappingIds')
  }
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 1000)
  const summariesById = new Map()
  let totalPosts = 0

  for (let pageIndex = 1; ; pageIndex++) {
    const page = await requestJson('position/searchPosition', {
      method: 'POST',
      body: {
        bgList: [],
        keyword: '',
        pageIndex,
        pageSize: normalizedPageSize,
        positionFidList: [],
        projectIdList: [],
        projectMappingIdList: projectMappingIds,
        recruitCityList: [],
        workCityList: [],
        workCountryType: 0,
      },
    }, fetchImpl)
    const pageRows = page.positionList || []
    totalPosts = Number(page.count || pageRows.length)
    for (const row of pageRows) {
      if (!summariesById.has(String(row.postId))) summariesById.set(String(row.postId), row)
      if (summariesById.size >= normalizedLimit) break
    }
    if (summariesById.size >= normalizedLimit || summariesById.size >= totalPosts || pageRows.length < normalizedPageSize || !pageRows.length) break
    await wait()
  }

  const summaries = [...summariesById.values()]
  const rows = []
  const failures = []
  const skippedNotFound = []
  const concurrency = Math.min(Math.max(Number(detailConcurrency) || 6, 1), 10)
  for (let index = 0; index < summaries.length; index += concurrency) {
    const batch = summaries.slice(index, index + concurrency)
    const settled = await Promise.allSettled(batch.map(summary => requestJson('jobDetails/getJobDetailsByPostId', {
      params: { postId: summary.postId },
    }, fetchImpl)))
    settled.forEach((result, offset) => {
      const summary = batch[offset]
      if (result.status === 'fulfilled') rows.push(tencentCampusJobToRow({
        ...summary,
        ...result.value,
        // 少数详情响应把 postId 置空；列表里的 postId 才是详情页稳定标识。
        postId: result.value.postId || summary.postId,
      }))
      else if (result.reason?.apiStatus === 404) skippedNotFound.push(summary.postId)
      else failures.push({ postId: summary.postId, reason: result.reason?.message || String(result.reason) })
    })
    if (index + concurrency < summaries.length) await wait()
  }

  return {
    rows: rows.filter(row => row.招聘岗位 && row.职位描述),
    totalPosts,
    fetchedPosts: summaries.length,
    complete: failures.length === 0 && summaries.length >= totalPosts,
    diagnostics: { failures, skippedNotFound },
  }
}
