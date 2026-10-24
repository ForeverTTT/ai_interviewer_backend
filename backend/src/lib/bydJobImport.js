export const BYD_CAREER_ORIGIN = 'https://job.byd.com'
export const BYD_API_ORIGIN = `${BYD_CAREER_ORIGIN}/portal/api`

function compactDate(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

function uniqueText(values, separator = '、') {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].join(separator)
}

function extractEducation(text) {
  return String(text || '').match(/学历要求[：:]\s*([^\n；;]+)/)?.[1]?.trim() || ''
}

function officialUrl(id, mode) {
  const path = mode === 'social' ? '/social/socialPositionDetails' : '/school/schoolPositionDetail'
  return `${BYD_CAREER_ORIGIN}/portal/pc/index.html#${path}?id=${encodeURIComponent(id)}`
}

export function bydSocialJobToRow(job, summary = {}) {
  const id = String(job.id || summary.id || '')
  const sections = (job.tagDetailList || [])
    .map(item => [item?.name, item?.detail].filter(Boolean).join('\n').trim())
    .filter(Boolean)
  const requirements = (job.tagDetailList || []).find(item => /任职|要求/.test(item?.name || ''))?.detail || ''
  const url = officialUrl(id, 'social')
  return {
    公司: '比亚迪',
    企业类型: '民企',
    行业类别: '汽车/制造',
    招聘岗位: String(job.positionName || summary.positionName || '').trim(),
    职位描述: sections.join('\n\n'),
    工作地点: uniqueText([job.province || summary.province, job.city || summary.city]),
    工作类型: '社会招聘',
    批次: '社招',
    部门: uniqueText([job.fatherOrgName || summary.fatherOrgAliasName, job.orgName || summary.orgAliasName], ' / '),
    学历要求: extractEducation(requirements),
    发布时间: compactDate(job.publishTime || summary.publishTime || summary.createTime),
    职位ID: String(summary.relatedCode || summary.positionCode || id),
    岗位身份标识: `byd:social:${id}`,
    职位详情链接: url,
    简历投递链接: url,
  }
}

export function bydCampusJobToRows(job, { lane = 'graduate' } = {}) {
  const id = String(job.id || '')
  const url = officialUrl(id, 'campus')
  const isIntern = lane === 'intern' || String(job.campusNature) === '008502'
  const infoList = job.positionInfoList?.length ? job.positionInfoList : [{}]
  return infoList.map((info, index) => {
    const description = [
      info.jobDuty ? `岗位职责\n${String(info.jobDuty).trim()}` : '',
      info.jobRequirements ? `任职要求\n${String(info.jobRequirements).trim()}` : '',
      info.researchDirection ? `研究/岗位方向\n${String(info.researchDirection).trim()}` : '',
    ].filter(Boolean).join('\n\n')
    return {
      公司: '比亚迪',
      企业类型: '民企',
      行业类别: '汽车/制造',
      招聘岗位: String(job.jobName || '').trim(),
      职位描述: description,
      工作地点: uniqueText(String(info.workPlace || job.workPlace || '').split(/[,，/]/)),
      工作类型: isIntern ? '实习生招聘' : '应届生招聘',
      批次: isIntern ? '实习' : '秋招',
      部门: String(info.division || '').trim(),
      学历要求: extractEducation(info.jobRequirements),
      发布时间: compactDate(job.updateTime),
      职位ID: `${id}-${info.id || index + 1}`,
      岗位身份标识: `byd:campus:${id}:${info.id || index + 1}`,
      职位详情链接: url,
      简历投递链接: url,
    }
  })
}

function headers() {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    lang: 'zh_CN',
    origin: BYD_CAREER_ORIGIN,
    referer: `${BYD_CAREER_ORIGIN}/portal/pc/index.html`,
    'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
  }
}

async function requestApi(path, { data, params, fetchImpl }) {
  const endpoint = new URL(`${BYD_API_ORIGIN}${path}`)
  for (const [key, value] of Object.entries(params || {})) endpoint.searchParams.set(key, value)
  const response = await fetchImpl(endpoint, {
    method: data ? 'POST' : 'GET',
    headers: headers(),
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`比亚迪招聘接口返回 HTTP ${response.status}`)
  const payload = await response.json()
  if (Number(payload?.code) !== 0) throw new Error(`比亚迪招聘接口返回异常：${payload?.msg || payload?.code || '未知错误'}`)
  return payload
}

async function fetchDetails(summaries, { mode, lane, fetchImpl, detailConcurrency, wait }) {
  const rows = []
  const failures = []
  for (let start = 0; start < summaries.length; start += detailConcurrency) {
    const batch = summaries.slice(start, start + detailConcurrency)
    const settled = await Promise.allSettled(batch.map(summary => mode === 'social'
      ? requestApi('/portal-api/position/queryDetail', {
        data: { id: String(summary.id), pageSize: 4 }, fetchImpl,
      })
      : requestApi('/portal-api/schoolPortal/queryPosition', {
        params: { id: String(summary.id) }, fetchImpl,
      })))
    settled.forEach((result, index) => {
      const summary = batch[index]
      if (result.status === 'fulfilled' && result.value?.data) {
        if (mode === 'social') rows.push(bydSocialJobToRow(result.value.data, summary))
        else rows.push(...bydCampusJobToRows(result.value.data, { lane }))
      } else {
        failures.push({
          id: String(summary?.id || ''),
          reason: result.status === 'rejected' ? result.reason?.message : '岗位详情为空',
        })
      }
    })
    if (start + detailConcurrency < summaries.length) await wait()
  }
  return { rows, failures }
}

async function fetchSocialList({ limit, pageSize, fetchImpl, wait }) {
  const summaries = new Map()
  let totalCount = 0
  let complete = false
  for (let offset = 0; ; offset += pageSize) {
    const payload = await requestApi('/portal-api/position/queryList', {
      data: {
        positionTypeArr: [],
        positionProvinceArr: [],
        positionCityArr: [],
        positionOrgArr: [],
        vagueCondition: '',
        searchType: 1,
        zpType: '00251',
        pageNum: offset,
        pageSize,
      },
      fetchImpl,
    })
    const list = payload.data?.data || []
    totalCount = Number(payload.data?.total || list.length)
    for (const job of list) {
      if (job?.id != null) summaries.set(String(job.id), job)
      if (summaries.size >= limit) break
    }
    if (summaries.size >= limit) break
    if (summaries.size >= totalCount || (list.length > 0 && list.length < pageSize)) {
      complete = true
      break
    }
    if (!list.length) break
    await wait()
  }
  return { summaries: [...summaries.values()], totalCount, complete }
}

async function fetchCampusList({ lane, limit, pageSize, fetchImpl, wait }) {
  const summaries = new Map()
  let totalCount = 0
  let totalPages = 0
  let complete = false
  for (let pageIndex = 1; ; pageIndex++) {
    const payload = await requestApi('/portal-api/schoolPortal/queryPositionList', {
      data: {
        topicCode: '',
        batch: '2027',
        campusNature: lane === 'intern' ? '008502' : '008501',
        abroad: '',
        degree: '',
        jobType: [],
        researchDirection: [],
        workPlace: [],
        keywords: '',
        pageSize,
        pageIndex,
      },
      fetchImpl,
    })
    const list = payload.data || []
    totalCount = Number(payload.page?.totalCount || list.length)
    totalPages = Number(payload.page?.totalPage || totalPages)
    for (const job of list) {
      if (job?.id != null) summaries.set(String(job.id), job)
      if (summaries.size >= limit) break
    }
    if (summaries.size >= limit) break
    if (summaries.size >= totalCount || (totalPages && pageIndex >= totalPages)) {
      complete = true
      break
    }
    if (!list.length) break
    await wait()
  }
  return { summaries: [...summaries.values()], totalCount, complete }
}

/** 抓取比亚迪招聘官网社招、校招或实习岗位；全部列表和详情成功后才是完整快照。 */
export async function fetchBydJobsSnapshot({
  mode = 'social',
  lane = 'graduate',
  limit = Infinity,
  pageSize,
  detailConcurrency = 8,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  if (!['social', 'campus'].includes(mode)) throw new Error(`未知的比亚迪招聘模式：${mode}`)
  if (mode === 'campus' && !['graduate', 'intern'].includes(lane)) throw new Error(`未知的比亚迪校园招聘类别：${lane}`)
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  // 校招接口即使回显更大的 pageSize，也只返回 10 条；主动按 10 条分页，避免漏页。
  const maxPageSize = mode === 'social' ? 1000 : 10
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || (mode === 'social' ? 500 : 10), 1), maxPageSize)
  const normalizedConcurrency = Math.min(Math.max(Number(detailConcurrency) || 8, 1), 12)
  const listResult = mode === 'social'
    ? await fetchSocialList({ limit: normalizedLimit, pageSize: normalizedPageSize, fetchImpl, wait })
    : await fetchCampusList({ lane, limit: normalizedLimit, pageSize: normalizedPageSize, fetchImpl, wait })
  const detailResult = await fetchDetails(listResult.summaries, {
    mode, lane, fetchImpl, detailConcurrency: normalizedConcurrency, wait,
  })
  const reachedLimit = listResult.summaries.length >= normalizedLimit && normalizedLimit < listResult.totalCount
  return {
    rows: detailResult.rows.filter(row => row.招聘岗位 && row.职位描述 && row.职位ID),
    totalJobs: listResult.totalCount,
    fetchedJobs: listResult.summaries.length - detailResult.failures.length,
    complete: !reachedLimit && listResult.complete && detailResult.failures.length === 0,
    diagnostics: { failures: detailResult.failures },
  }
}
