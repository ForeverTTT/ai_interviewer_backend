import { htmlToText } from './officialJobImport.js'

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

export function parseLegacyZhiyeList(html, origin) {
  const rows = []
  const pattern = /<li>\s*<a\s+href=["']([^"']*(?:social|campus)xq\?[^"']*jobId=[^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi
  for (const match of String(html || '').matchAll(pattern)) {
    const cells = [...match[2].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
      .map(cell => htmlToText(cell[1]))
    const url = new URL(decodeEntities(match[1]), origin).toString()
    const id = new URL(url).searchParams.get('jobId')
    if (!id || cells.length < 4) continue
    rows.push({ id, url, functionName: cells[0], title: cells[1], education: cells[2], location: cells[3] })
  }
  const pages = [...String(html || '').matchAll(/PageIndex=(\d+)/gi)].map(match => Number(match[1]))
  return { rows, pageCount: Math.max(1, ...pages) }
}

function field(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(html || '').match(new RegExp(`<span[^>]*>\\s*${escaped}\\s*[：:]?\\s*<\\/span>\\s*<b[^>]*>([\\s\\S]*?)<\\/b>`, 'i'))
  return match ? htmlToText(match[1]) : ''
}

export function parseLegacyZhiyeDetail(html, summary, { companyName, category }) {
  const title = htmlToText(String(html || '').match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || summary.title)
  const duty = htmlToText(String(html || '').match(/职位描述\s*<\/h3>\s*<div[^>]*class=["'][^"']*xqm[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
  const requirement = htmlToText(String(html || '').match(/职位要求\s*<\/h3>\s*<div[^>]*class=["'][^"']*xqm[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '')
  const updated = field(html, '更新时间').replace(/\./g, '-')
  const workType = field(html, '工作类型')
  const employmentText = [title, workType, category].join(' ')
  let batch = category === '社招' ? '社招' : /实习|intern/i.test(employmentText) ? '实习' : null
  if (!batch) {
    const month = Number(updated.slice(5, 7))
    batch = month >= 1 && month <= 6 ? '春招' : month >= 7 && month <= 12 ? '秋招' : '校园招聘'
  }
  return {
    公司: companyName,
    招聘岗位: title,
    职位描述: [duty && `岗位职责\n${duty}`, requirement && `任职要求\n${requirement}`].filter(Boolean).join('\n\n'),
    工作地点: field(html, '工作地点') || summary.location,
    部门: field(html, '职位类别') || summary.functionName,
    工作类型: workType || category,
    学历要求: field(html, '职位学历') || summary.education,
    更新时间: /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : '',
    职位ID: summary.id,
    岗位身份标识: `zhiye-legacy:${summary.id}`,
    职位详情链接: summary.url,
    投递链接: summary.url,
    批次: batch,
  }
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36 FlowLabJobsBot/1.0',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

/** 兼容仍使用北森旧版服务端渲染模板的官方招聘站。 */
export async function fetchLegacyZhiyeJobsSnapshot({
  companyName,
  startUrl,
  category,
  limit,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const parsed = new URL(startUrl)
  const section = parsed.pathname.split('/').filter(Boolean)[0]
  category ||= section === 'social' ? '社招' : '校园招聘'
  if (!companyName || !section || !['social', 'campus'].includes(section)) throw new Error('旧版智业来源需要公司名及 social/campus 入口')

  const summaries = []
  const failures = []
  let pageCount = 1
  for (let page = 1; page <= pageCount; page++) {
    const pageUrl = page === 1 ? startUrl : `${parsed.origin}/${section}/?PageIndex=${page}`
    try {
      const result = parseLegacyZhiyeList(await fetchText(pageUrl, fetchImpl), parsed.origin)
      pageCount = Math.max(pageCount, result.pageCount)
      summaries.push(...result.rows)
      if (limit && summaries.length >= limit) break
      if (page < pageCount) await wait()
    } catch (error) {
      failures.push({ url: pageUrl, reason: error.message })
      break
    }
  }

  const unique = [...new Map(summaries.map(row => [row.id, row])).values()]
  const selected = limit ? unique.slice(0, limit) : unique
  const rows = []
  for (const summary of selected) {
    try {
      rows.push(parseLegacyZhiyeDetail(await fetchText(summary.url, fetchImpl), summary, { companyName, category }))
    } catch (error) {
      failures.push({ url: summary.url, reason: error.message })
    }
    await wait()
  }
  const capped = Boolean(limit && unique.length >= limit)
  return {
    rows,
    complete: failures.length === 0 && !capped && summaries.length === unique.length && pageCount > 0,
    diagnostics: { pageCount, listed: unique.length, fetched: rows.length, failures, capped },
  }
}
