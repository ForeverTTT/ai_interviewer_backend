import { htmlToText } from './officialJobImport.js'

export const HUAWEI_CAREER_ORIGIN = 'https://career.huawei.com'
export const HUAWEI_CAREER_API = 'https://apigw-dgg-b0.huawei.com/api/apig/channelhw'
export const HUAWEI_CAREER_APP_ID = 'app_000000035886'

const apiHeaders = {
  'content-type': 'application/json',
  origin: HUAWEI_CAREER_ORIGIN,
  referer: `${HUAWEI_CAREER_ORIGIN}/cn/campus-recruitment-job-list`,
  'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
  'x-jalor-tenantAlias': 'hcm',
  'x-language': 'zh_CN',
  'x-Referer': `${HUAWEI_CAREER_ORIGIN}/cn`,
  'X-HW-ID': HUAWEI_CAREER_APP_ID,
}

function endpoint(path) {
  return `${HUAWEI_CAREER_API}${path}?X-HW-ID=${HUAWEI_CAREER_APP_ID}`
}

async function postJson(path, body, fetchImpl = fetch) {
  const response = await fetchImpl(endpoint(path), {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`华为招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (payload.status !== 'SUCCESS') {
    const message = payload.errors?.[0]?.errorMsg || payload.message || payload.code || '未知错误'
    throw new Error(`华为招聘接口失败：${message}`)
  }
  return payload.data
}

export async function fetchHuaweiCampusSnapshot({
  keyword = '',
  jobType = 'CR',
  limit = Infinity,
  pageSize = 100,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 100, 1), 100)
  const summaries = []
  let totalAdvertisements = 0

  for (let curPage = 1; ; curPage++) {
    const page = await postJson('/recruitmentPosition/pub/getJobPage', {
      curPage,
      pageSize: normalizedPageSize,
      jobType,
      ...(keyword ? { keyWord: keyword } : {}),
    }, fetchImpl)
    const pageRows = page?.result || []
    totalAdvertisements = Number(page?.pageVO?.totalRows || pageRows.length)
    summaries.push(...pageRows.slice(0, normalizedLimit - summaries.length))

    const reachedRequestedLimit = summaries.length >= normalizedLimit
    const reachedLastPage = summaries.length >= totalAdvertisements || pageRows.length < normalizedPageSize
    if (reachedRequestedLimit || reachedLastPage || pageRows.length === 0) break
    await wait()
  }

  const rows = []

  for (const [index, summary] of summaries.entries()) {
    if (index) await wait()
    const detail = await postJson('/recruitmentPosition/pub/getRecruitmentPositionDetail', {
      advertisementId: String(summary.advertisementId),
    }, fetchImpl)
    const intentions = detail?.jobId
      ? await postJson('/recruitmentPosition/pub/getPositionIntentionList', { jobId: detail.jobId }, fetchImpl)
      : []
    rows.push(...huaweiJobToRows(detail || summary, intentions || [], { jobType }))
  }
  return {
    rows,
    totalAdvertisements,
    fetchedAdvertisements: summaries.length,
    // 带关键词或限制条数的结果不是整个来源的快照，绝不能据此下架其他岗位。
    complete: !keyword && summaries.length >= totalAdvertisements,
  }
}

export async function fetchHuaweiCampusJobs(options = {}) {
  return (await fetchHuaweiCampusSnapshot(options)).rows
}

function fullDescription(responsibilities, requirements) {
  return [
    responsibilities && `岗位职责\n${htmlToText(responsibilities)}`,
    requirements && `任职要求\n${htmlToText(requirements)}`,
  ].filter(Boolean).join('\n\n')
}

function titleFor(jobName, intention, total) {
  const direction = String(intention?.positionIntention || '').trim()
  if (!direction || total <= 1 || jobName.includes(direction)) return jobName
  const baseTitle = jobName.replace(/[（(].*$/, '').trim()
  const directionBase = direction.replace(/[（(].*$/, '').trim()
  if (baseTitle && directionBase === baseTitle) return direction
  return `${jobName}（${direction}）`
}

export function huaweiJobToRows(detail, intentions = [], { jobType = 'CR' } = {}) {
  const variants = intentions.length ? intentions : [null]
  const detailUrl = `${HUAWEI_CAREER_ORIGIN}/cn/job-details?advertisementId=${detail.advertisementId}`
  return variants.map((intention, index) => {
    const title = titleFor(String(detail.jobname || detail.jobName || '').trim(), intention, variants.length)
    const description = fullDescription(
      intention?.jobResponsibilities || detail.mainBusiness,
      intention?.jobDemand || detail.jobRequire,
    )
    const recruitmentText = [detail.scenarioName, detail.jobTypeName, detail.jobname, detail.jobName]
      .filter(Boolean).join(' ')
    const dateText = String(detail.lastUpdateDate || intention?.lastUpdateDate || '')
    const month = Number(dateText.match(/^\d{4}[-/]?(\d{1,2})/)?.[1])
    const batch = jobType === 'SR'
      ? '社招'
      : /实习|intern/i.test(recruitmentText)
      ? '实习'
      : /社招|社会招聘|social/i.test(recruitmentText)
        ? '社招'
        : month >= 1 && month <= 6 ? '春招' : month >= 7 && month <= 12 ? '秋招' : '校园招聘'
    return {
      公司: '华为',
      企业类型: '民企',
      行业类别: '电子/通信/半导体',
      招聘岗位: title,
      职位描述: description,
      工作地点: intention?.jobPlaceName || detail.jobCity || detail.workPlace || '',
      工作类型: jobType === 'SR' ? '社会招聘' : detail.scenarioName || '应届生',
      批次: batch,
      部门: detail.firstDeptName || detail.deptName || '',
      更新时间: detail.lastUpdateDate || intention?.lastUpdateDate || '',
      职位ID: `${detail.advertisementId}:${intention?.externalPostCode || index}`,
      职位详情链接: detailUrl,
      简历投递链接: detailUrl,
    }
  }).filter(row => row.招聘岗位 && row.职位描述)
}
