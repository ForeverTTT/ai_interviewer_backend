import { htmlToText } from './officialJobImport.js'

const DISPLAY_FIELDS = [
  'Category', 'Kind', 'LocId', 'PostDate', 'ClassificationOne',
  'ClassificationTwo', 'WorkWeChatQrCode',
]

function validDate(value) {
  const text = String(value || '')
  return /^\d{4}-\d{2}-\d{2}/.test(text) && !text.startsWith('0001-') ? text.slice(0, 10) : ''
}

export function parseZhiyeRecruitmentUrl(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    return null
  }
  if (!/(^|\.)zhiye\.com$/i.test(url.hostname)) return null
  const section = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase()
  const categoryId = section === 'social' ? '1' : section === 'campus' ? '2' : section === 'intern' ? '3' : null
  if (!categoryId) return null
  return {
    origin: url.origin,
    categoryId,
    startUrl: `${url.origin}/${section}/jobs`,
    detailPath: `/${section}/detail`,
  }
}

export function extractZhiyePortalId(html) {
  return String(html || '').match(/["']PortalId["']\s*:\s*["']([0-9a-f-]{20,})["']/i)?.[1] || null
}

function batchFor(job, categoryId) {
  const text = [job.JobAdName, job.Kind, job.Category].filter(Boolean).join(' ')
  if (/实习|intern/i.test(text) || categoryId === '3') return '实习'
  if (categoryId === '1') return '社招'
  const month = Number(validDate(job.PostDate || job.ChangeDate).slice(5, 7))
  if (month >= 1 && month <= 6) return '春招'
  if (month >= 7 && month <= 12) return '秋招'
  return '校园招聘'
}

function detailUrl(startUrl, detailPath, id) {
  const url = new URL(startUrl)
  url.pathname = detailPath
  url.search = ''
  url.searchParams.set('jobAdId', id)
  return url.toString()
}

export function zhiyeJobToRow(job, { companyName, companyType, industryCategory, startUrl, detailPath, categoryId }) {
  const id = String(job.Id || job.id || '')
  const sourceUrl = detailUrl(startUrl, detailPath, id)
  const duty = htmlToText(job.Duty || job.JobDuty || '')
  const requirement = htmlToText(job.Require || job.Qualification || '')
  const description = [duty && `岗位职责\n${duty}`, requirement && `任职要求\n${requirement}`]
    .filter(Boolean).join('\n\n')
  return {
    公司: companyName,
    ...(companyType ? { 企业类型: companyType } : {}),
    ...(industryCategory ? { 行业类别: industryCategory } : {}),
    招聘岗位: String(job.JobAdName || job.Name || ''),
    职位描述: description,
    工作地点: Array.isArray(job.LocNames) ? job.LocNames.join(',') : String(job.LocNames || job.LocName || ''),
    部门: [job.ClassificationOne, job.ClassificationTwo, job.Org].filter(Boolean).join(' · '),
    工作类型: String(job.Kind || job.Category || ''),
    学历要求: String(job.Degree || ''),
    发布时间: validDate(job.PostDate),
    更新时间: validDate(job.ChangeDate),
    截止时间: validDate(job.EndTime),
    职位ID: id,
    岗位身份标识: `zhiye:${id}`,
    职位详情链接: sourceUrl,
    投递链接: sourceUrl,
    批次: batchFor(job, categoryId),
  }
}

async function fetchResponse(url, options, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'application/json, text/plain, */*',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36 FlowLabJobsBot/1.0',
      ...options?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response
}

/** 读取北森智业公开招聘页的只读职位接口，不使用企业端或候选人账号。 */
export async function fetchZhiyeJobsSnapshot({
  companyName,
  companyType,
  industryCategory,
  startUrl,
  portalId,
  categoryId,
  detailPath,
  pageSize = 100,
  limit,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const parsed = parseZhiyeRecruitmentUrl(startUrl)
  if (!parsed && (!startUrl || !categoryId || !detailPath)) {
    throw new Error('智业来源需要 social/campus/intern 的完整 startUrl，或显式配置分类和详情路径')
  }
  startUrl ||= parsed?.startUrl
  categoryId = String(categoryId || parsed?.categoryId || '')
  detailPath ||= parsed?.detailPath
  if (!companyName || !startUrl || !categoryId || !detailPath) throw new Error('智业来源缺少公司名、入口或招聘分类')

  if (!portalId) {
    const page = await fetchResponse(startUrl, { headers: { accept: 'text/html' } }, fetchImpl)
    portalId = extractZhiyePortalId(await page.text())
    if (!portalId) throw new Error('未能从智业招聘页读取 PortalId')
  }

  const apiUrl = `${new URL(startUrl).origin}/api/Jobad/GetJobAdPageList`
  const rows = []
  const failures = []
  let total = Infinity
  let pageIndex = 0
  let fetched = 0
  let capped = false

  while (fetched < total) {
    const take = Math.min(Number(pageSize) || 100, limit ? Math.max(limit - rows.length, 1) : Number(pageSize) || 100)
    try {
      const response = await fetchResponse(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', referer: startUrl },
        body: JSON.stringify({
          PageIndex: pageIndex,
          PageSize: take,
          ClassificationOne: [],
          Category: [categoryId],
          KeyWords: '',
          SpecialType: 0,
          PortalId: portalId,
          DisplayFields: DISPLAY_FIELDS,
        }),
      }, fetchImpl)
      const payload = await response.json()
      if (Number(payload?.Code) !== 200) throw new Error(payload?.Message || `接口返回 ${payload?.Code}`)
      const pageRows = Array.isArray(payload?.Data) ? payload.Data : []
      total = Number(payload?.Count ?? pageRows.length)
      rows.push(...pageRows
        .filter(job => Number(job.Status ?? 1) === 1)
        .map(job => zhiyeJobToRow(job, { companyName, companyType, industryCategory, startUrl, detailPath, categoryId })))
      fetched += pageRows.length
      pageIndex += 1
      if (!pageRows.length || (limit && rows.length >= limit)) {
        capped = Boolean(limit && total > fetched)
        break
      }
      if (fetched < total) await wait()
    } catch (error) {
      failures.push({ pageIndex, reason: error.message })
      break
    }
  }

  return {
    rows: limit ? rows.slice(0, limit) : rows,
    complete: failures.length === 0 && !capped && fetched >= total,
    diagnostics: { portalId, categoryId, total: Number.isFinite(total) ? total : rows.length, fetched, failures, capped },
  }
}
