import { htmlToText } from './officialJobImport.js'

export const LENOVO_JOBS_ORIGIN = 'https://jobs.lenovo.com'
const LIST_PATH = '/en_US/careers/SearchJobsChina/'

function decode(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim()
}

function fieldValue(html, label) {
  const pattern = new RegExp(`article__content__view__field__label[^>]*>\\s*${label}\\s*:?[\\s\\S]*?article__content__view__field__value[^>]*>([\\s\\S]*?)<\\/div>`, 'i')
  return htmlToText(pattern.exec(html)?.[1] || '')
}

function articleValue(html, heading) {
  const pattern = new RegExp(`<article\\b[^>]*>[\\s\\S]*?article__header[\\s\\S]*?<h3[^>]*>\\s*${heading}\\s*<\\/h3>[\\s\\S]*?article__content__view__field__value[^>]*>([\\s\\S]*?)<\\/div>\\s*<\\/div>\\s*<\\/div>\\s*<\\/article>`, 'i')
  return htmlToText(pattern.exec(html)?.[1] || '')
}

function isoDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLenovoJobDetail(html, pageUrl) {
  const title = htmlToText(/banner__text__title[^>]*>([\s\S]*?)<\/h2>/i.exec(html)?.[1] || '')
  const id = String(pageUrl).match(/\/(\d+)(?:[/?#]|$)/)?.[1] || ''
  const req = fieldValue(html, 'Req #')
  const careerArea = fieldValue(html, 'Career area')
  const city = fieldValue(html, 'City')
  const state = fieldValue(html, 'State')
  const date = fieldValue(html, 'Date')
  const description = articleValue(html, 'Description and Requirements')
  const applyUrl = /<a\b[^>]*class="button button--primary"[^>]*href="([^"]*Login\?jobId=[^"]+)"/i.exec(html)?.[1] || pageUrl
  return {
    公司: '联想',
    企业类型: '外企',
    行业类别: '电子/通信/半导体',
    招聘岗位: title,
    职位描述: description,
    工作地点: city || state,
    工作类型: '社会招聘',
    批次: '社招',
    部门: careerArea,
    发布时间: isoDate(date),
    职位ID: req || id,
    岗位身份标识: `lenovo:social:${id}`,
    职位详情链接: pageUrl,
    简历投递链接: new URL(decode(applyUrl), LENOVO_JOBS_ORIGIN).toString(),
  }
}

function detailLinks(html) {
  return [...new Set([...String(html || '').matchAll(/href="(https:\/\/jobs\.lenovo\.com\/en_US\/careers\/JobDetail\/[^"?#]+)"/gi)]
    .map(match => decode(match[1])))]
}

async function fetchHtml(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`联想招聘官网返回 HTTP ${response.status}`)
  return response.text()
}

/** 抓取联想中国官网社招完整快照。 */
export async function fetchLenovoSocialJobsSnapshot({
  limit = Infinity,
  detailConcurrency = 8,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(Number(limit), 1) : Infinity
  const normalizedConcurrency = Math.min(Math.max(Number(detailConcurrency) || 8, 1), 12)
  const listed = new Set()
  let exhausted = false
  for (let offset = 0; ; offset += 10) {
    const url = new URL(LIST_PATH, LENOVO_JOBS_ORIGIN)
    url.searchParams.set('jobRecordsPerPage', '10')
    url.searchParams.set('jobOffset', String(offset))
    const links = detailLinks(await fetchHtml(url, fetchImpl))
    const before = listed.size
    for (const link of links) {
      listed.add(link)
      if (listed.size >= normalizedLimit) break
    }
    if (listed.size >= normalizedLimit) break
    if (!links.length || listed.size === before) {
      exhausted = true
      break
    }
    await wait()
  }

  const rows = []
  const failures = []
  const urls = [...listed]
  for (let start = 0; start < urls.length; start += normalizedConcurrency) {
    const batch = urls.slice(start, start + normalizedConcurrency)
    const settled = await Promise.allSettled(batch.map(async url => parseLenovoJobDetail(await fetchHtml(url, fetchImpl), url)))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.招聘岗位 && result.value.职位描述) rows.push(result.value)
      else failures.push({ url: batch[index], reason: result.status === 'rejected' ? result.reason?.message : '岗位详情字段不完整' })
    })
    if (start + normalizedConcurrency < urls.length) await wait()
  }
  const reachedLimit = listed.size >= normalizedLimit && !exhausted
  return {
    rows,
    totalJobs: listed.size,
    fetchedJobs: rows.length,
    complete: exhausted && !reachedLimit && failures.length === 0 && rows.length === listed.size,
    diagnostics: { failures },
  }
}
