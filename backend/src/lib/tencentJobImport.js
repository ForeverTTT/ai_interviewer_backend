export const TENCENT_CAREER_ORIGIN = 'https://careers.tencent.com'
export const TENCENT_CAREER_API = `${TENCENT_CAREER_ORIGIN}/tencentcareer/api/post`

const headers = {
  accept: 'application/json',
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
}

async function getJson(path, params, fetchImpl) {
  const url = new URL(`${TENCENT_CAREER_API}/${path}`)
  for (const [key, value] of Object.entries(params || {})) {
    if (value != null) url.searchParams.set(key, String(value))
  }
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`腾讯招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.Code !== 200 || !payload.Data) throw new Error(`腾讯招聘接口返回异常：${payload.Code}`)
  return payload.Data
}

function directUrl(post) {
  const postId = post.PostId
  if (postId) return `${TENCENT_CAREER_ORIGIN}/jobdesc.html?postId=${encodeURIComponent(postId)}`
  return String(post.PostURL || '').replace(/^http:/, 'https:')
}

export function tencentJobToRow(post) {
  const description = [
    post.Responsibility && `岗位职责\n${String(post.Responsibility).trim()}`,
    post.Requirement && `任职要求\n${String(post.Requirement).trim()}`,
    post.PostLightItem && `岗位亮点\n${String(post.PostLightItem).trim()}`,
  ].filter(Boolean).join('\n\n')
  const url = directUrl(post)
  return {
    公司: '腾讯',
    企业类型: '民企',
    行业类别: '互联网/游戏',
    招聘岗位: String(post.RecruitPostName || '').trim(),
    职位描述: description,
    工作地点: post.LocationName || '',
    工作类型: post.RequireWorkYearsName || '社招',
    部门: [post.BGName, post.ProductName].filter(Boolean).join(' / '),
    更新时间: post.LastUpdateTime || '',
    职位ID: String(post.PostId || post.RecruitPostId || ''),
    职位详情链接: url,
    简历投递链接: url,
  }
}

/** 腾讯社会招聘官网的完整公开职位快照。国内校招由 join.qq.com adapter 单独同步。 */
export async function fetchTencentJobsSnapshot({
  limit = Infinity,
  pageSize = 100,
  detailConcurrency = 4,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const summaries = []
  let totalPosts = 0

  for (let pageIndex = 1; ; pageIndex++) {
    const page = await getJson('Query', {
      timestamp: Date.now(),
      countryId: '', cityId: '', bgIds: '', productId: '', categoryId: '', parentCategoryId: '', attrId: 1, keyword: '',
      pageIndex,
      pageSize: normalizedPageSize,
      language: 'zh-cn',
      area: 'cn',
    }, fetchImpl)
    const pageRows = page.Posts || []
    totalPosts = Number(page.Count || pageRows.length)
    summaries.push(...pageRows.slice(0, normalizedLimit - summaries.length))
    if (summaries.length >= normalizedLimit || summaries.length >= totalPosts || pageRows.length < normalizedPageSize || !pageRows.length) break
    await wait()
  }

  const details = []
  const failures = []
  const concurrency = Math.min(Math.max(Number(detailConcurrency) || 4, 1), 8)
  for (let index = 0; index < summaries.length; index += concurrency) {
    const batch = summaries.slice(index, index + concurrency)
    const settled = await Promise.allSettled(batch.map(summary => getJson('ByPostId', {
      postId: summary.PostId,
      language: 'zh-cn',
    }, fetchImpl)))
    settled.forEach((result, offset) => {
      if (result.status === 'fulfilled') details.push(result.value)
      else failures.push({ postId: batch[offset].PostId, reason: result.reason?.message || String(result.reason) })
    })
    if (index + concurrency < summaries.length) await wait()
  }

  return {
    rows: details.map(tencentJobToRow).filter(row => row.招聘岗位 && row.职位描述),
    totalPosts,
    fetchedPosts: summaries.length,
    complete: failures.length === 0 && summaries.length >= totalPosts,
    diagnostics: { failures },
  }
}
