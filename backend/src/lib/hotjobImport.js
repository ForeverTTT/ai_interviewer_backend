import { htmlToText } from './officialJobImport.js'

const TYPE_CODE = { social: 2, society: 2, campus: 1, school: 1, intern: 12, interns: 12, overseas: 13 }
const TYPE_NAME = { 1: 'campus', 2: 'social', 12: 'intern', 13: 'overseas' }
const EMPLOYMENT_TYPE = { 1: '应届生招聘', 2: '社会招聘', 12: '实习生招聘', 13: '社会招聘' }

function categoryFor(detail, recruitType) {
  if (recruitType === 12) return '实习'
  if (recruitType === 2 || recruitType === 13) return '社招'
  const text = `${detail.projectName || ''} ${detail.postName || ''}`
  if (/实习/.test(text)) return '实习'
  if (/春招/.test(text)) return '春招'
  if (/秋招/.test(text)) return '秋招'
  const published = String(detail.publishDate || detail.publishFirstDate || '')
  const month = Number(published.slice(5, 7))
  return month >= 1 && month <= 6 ? '春招' : '秋招'
}

export function parseHotjobRecruitmentUrl(value) {
  let url
  try {
    url = new URL(String(value || '').replace(/¤tPage/g, '&currentPage'))
  } catch {
    return null
  }
  if (!/(^|\.)hotjob\.cn$/i.test(url.hostname)) return null
  const tenant = url.pathname.split('/').filter(Boolean).find(part => /^SU[a-z0-9]+$/i.test(part))
  if (!tenant) return null
  const explicit = String(url.searchParams.get('postType') || url.searchParams.get('recruitType') || url.pathname).toLowerCase()
  const numericType = Number(explicit)
  const type = Number.isInteger(numericType) && TYPE_NAME[numericType]
    ? numericType
    : TYPE_CODE[Object.keys(TYPE_CODE).find(name => explicit.includes(name))]
  return {
    tenant,
    origin: url.origin,
    recruitTypes: type ? [type] : [1, 2, 12, 13],
    seedUrl: `${url.origin}/${tenant}/pb/index.html`,
  }
}

function apiUrl(origin, endpoint, tenant) {
  return `${origin}/wecruit/positionInfo/${endpoint}/${tenant}?iSaJAx=isAjax&request_locale=zh-CN`
}

async function postForm(url, data, { fetchImpl, wait, beforeRequest, retries = 4 }) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    await beforeRequest()
    // Hotjob CDN 会错误缓存相同 URL 的 POST，忽略 currentPage/postId；每次请求必须带唯一查询参数。
    const requestUrl = new URL(url)
    requestUrl.searchParams.set('flowlab_req', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const response = await fetchImpl(requestUrl.toString(), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
        'cache-control': 'no-cache',
      },
      body: new URLSearchParams(Object.entries(data).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])),
      signal: AbortSignal.timeout(20_000),
    }).catch(error => ({ ok: false, status: 0, error }))
    if (response?.ok) {
      const payload = await response.json()
      if (String(payload?.state) === '200') return payload.data || {}
      lastError = new Error(payload?.msg || `Hotjob 状态 ${payload?.state || '未知'}`)
      if (!/busy|频繁|限流|429|503/i.test(lastError.message) || attempt >= retries) throw lastError
    } else {
      const status = Number(response?.status || 0)
      lastError = new Error(status ? `HTTP ${status}` : response?.error?.message || '连接失败')
      const retryable = status === 0 || status === 408 || status === 429 || status >= 500
      if (!retryable || attempt >= retries) throw lastError
    }
    const retryAfter = Number(response?.headers?.get?.('retry-after'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * (2 ** attempt)
    await wait(delay)
  }
  throw lastError || new Error('Hotjob 请求失败')
}

function requestPacer(wait, intervalMs) {
  let queue = Promise.resolve()
  let nextAt = 0
  return () => {
    const turn = queue.then(async () => {
      const delay = Math.max(nextAt - Date.now(), 0)
      if (delay) await wait(delay)
      nextAt = Date.now() + intervalMs
    })
    queue = turn.catch(() => {})
    return turn
  }
}

function detailUrl(origin, tenant, postId, recruitType) {
  const url = new URL(`/${tenant}/pb/posDetail.html`, origin)
  url.searchParams.set('postId', postId)
  // 公开网页使用语义化渠道名；详情页脚本再把它转换成接口需要的数字 recruitType。
  // 直接把数字放进 postType 会让页面一直停在“正在加载中”。
  url.searchParams.set('postType', TYPE_NAME[recruitType] || String(recruitType))
  return url.toString()
}

export function hotjobDetailToRow(detail, { companyName, origin, tenant, recruitType }) {
  const postId = String(detail.postId || detail.externalPostId || detail.postCode || '')
  const sourceUrl = detailUrl(origin, tenant, postId, recruitType)
  const description = [
    detail.workContent && `岗位职责：\n${htmlToText(detail.workContent)}`,
    detail.serviceCondition && `任职要求：\n${htmlToText(detail.serviceCondition)}`,
  ].filter(Boolean).join('\n\n')
  return {
    // 集团级 Hotjob 租户会同时返回多个子公司，详情中的实际组织名优先。
    公司: detail.company || detail.orgName || companyName || '',
    招聘岗位: String(detail.postName || ''),
    职位描述: description,
    工作地点: String(detail.workPlaceStr || (detail.workPlaceList || []).map(item => item.name).filter(Boolean).join(',')),
    工作类型: EMPLOYMENT_TYPE[recruitType] || String(detail.postTypeName || ''),
    学历要求: String(detail.education || detail.educationStr || ''),
    发布时间: String(detail.publishDate || detail.publishFirstDate || '').slice(0, 10),
    更新时间: String(detail.publishDate || detail.publishFirstDate || '').slice(0, 10),
    截止时间: String(detail.endDate || '').slice(0, 10),
    部门: String(detail.orgName || ''),
    批次: categoryFor(detail, recruitType),
    职位ID: postId,
    职位详情链接: sourceUrl,
    投递链接: sourceUrl,
  }
}

/** 定向重读一个 Hotjob 官方职位详情，用于修复历史标题误拆数据。 */
export async function fetchHotjobJobFromUrl({
  companyName,
  sourceUrl,
  fetchImpl = fetch,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  requestIntervalMs = 450,
} = {}) {
  const parsed = parseHotjobRecruitmentUrl(sourceUrl)
  const url = new URL(sourceUrl)
  const postId = url.searchParams.get('postId')
  const recruitType = parsed?.recruitTypes?.[0]
  if (!parsed?.tenant || !parsed?.origin || !postId || !recruitType) throw new Error(`无法解析 Hotjob 职位链接：${sourceUrl}`)
  const request = {
    fetchImpl,
    wait,
    beforeRequest: requestPacer(wait, Math.max(Number(requestIntervalMs) || 0, 0)),
  }
  const detail = await postForm(apiUrl(parsed.origin, 'listPositionDetail', parsed.tenant), {
    postId,
    recruitType,
  }, request)
  return hotjobDetailToRow(detail, {
    companyName,
    origin: parsed.origin,
    tenant: parsed.tenant,
    recruitType,
  })
}

/** 抓取 Hotjob 新版 wecruit 公开招聘页的列表与完整职位详情。 */
export async function fetchHotjobJobsSnapshot({
  companyName,
  startUrl,
  tenant,
  origin,
  recruitTypes,
  pageSize = 15,
  detailConcurrency = 3,
  requestIntervalMs = 450,
  limit,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const parsed = parseHotjobRecruitmentUrl(startUrl)
  tenant ||= parsed?.tenant
  origin ||= parsed?.origin
  recruitTypes ||= parsed?.recruitTypes
  if (!tenant || !origin) throw new Error('Hotjob wecruit 来源需要包含 SU 租户编号的公开招聘链接')
  recruitTypes = recruitTypes?.length ? recruitTypes : [1, 2, 12, 13]
  // 接口响应虽然会把 pageSize 截到 15，但 offset 仍按请求值计算；传大于 15 会跳过岗位。
  pageSize = Math.min(Math.max(Number(pageSize) || 15, 1), 15)
  const request = {
    fetchImpl,
    wait,
    beforeRequest: requestPacer(wait, Math.max(Number(requestIntervalMs) || 0, 0)),
  }

  const listings = []
  const failures = []
  let capped = false
  for (const recruitType of recruitTypes) {
    let currentPage = 1
    let totalPage = 1
    let effectivePageSize = pageSize
    while (currentPage <= totalPage) {
      try {
        const data = await postForm(apiUrl(origin, 'listPosition', tenant), {
          isFrompb: true, recruitType, pageSize: effectivePageSize, currentPage,
        }, request)
        const page = data.pageForm || {}
        effectivePageSize = Number(page.pageSize) || effectivePageSize
        totalPage = Number(page.dataCount) > 0
          ? Math.ceil(Number(page.dataCount) / effectivePageSize)
          : Number(page.totalPage || 1)
        const pageData = Array.isArray(page.pageData) ? page.pageData : []
        listings.push(...pageData.map(job => ({ job, recruitType })))
        if (limit && listings.length >= limit) {
          capped = currentPage < totalPage || recruitTypes.indexOf(recruitType) < recruitTypes.length - 1
          break
        }
        currentPage++
        if (currentPage <= totalPage) await wait()
      } catch (error) {
        failures.push({ recruitType, currentPage, reason: error.message })
        break
      }
    }
    if (limit && listings.length >= limit) break
  }

  const unique = [...new Map(listings.map(item => [String(item.job.postId), item])).values()]
  // canDelivery 取决于当前访客的登录/投递状态。公开且仍在列表中的岗位也可能返回 false，
  // 因此不能用它判断岗位已经下架；岗位是否失效以完整列表快照是否仍包含 postId 为准。
  const chosen = limit ? unique.slice(0, limit) : unique
  const rows = Array(chosen.length)
  let nextDetail = 0
  const worker = async () => {
    while (nextDetail < chosen.length) {
      const index = nextDetail++
      const item = chosen[index]
      try {
        const detail = await postForm(apiUrl(origin, 'listPositionDetail', tenant), {
          postId: item.job.postId,
          recruitType: item.recruitType,
        }, request)
        rows[index] = hotjobDetailToRow({ ...item.job, ...detail }, { companyName, origin, tenant, recruitType: item.recruitType })
      } catch (error) {
        failures.push({ postId: item.job.postId, reason: error.message })
      }
      if (chosen.length > 1) await wait()
    }
  }
  const workers = Math.min(Math.max(Number(detailConcurrency) || 1, 1), 4, chosen.length || 1)
  await Promise.all(Array.from({ length: workers }, worker))
  const completeRows = rows.filter(Boolean)
  const complete = failures.length === 0 && !capped
  return {
    rows: completeRows,
    complete,
    diagnostics: {
      listed: unique.length,
      detailed: completeRows.length,
      failures,
      capped,
    },
  }
}
