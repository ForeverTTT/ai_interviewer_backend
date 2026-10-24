function decodeHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
}

export function htmlToText(value) {
  return decodeHtml(String(value || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|li|div|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function flattenJsonLd(value) {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd)
  if (!value || typeof value !== 'object') return []
  return [value, ...flattenJsonLd(value['@graph'])]
}

export function parseJobPostingJsonLd(html, pageUrl) {
  const scripts = [...String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  const postings = []
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(match[1].trim())
      for (const item of flattenJsonLd(parsed)) {
        const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']]
        if (types.includes('JobPosting')) postings.push(item)
      }
    } catch {
      // 单个损坏的 JSON-LD 块不影响页面里其余结构化数据。
    }
  }
  return postings.map((job, index) => jobPostingToRow(job, pageUrl, index))
}

function locationsOf(job) {
  const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation]
  return [...new Set(locations.flatMap(location => {
    const address = location?.address || location
    return [address?.addressLocality, address?.addressRegion].filter(Boolean)
  }).map(String))]
}

function identifierOf(identifier) {
  if (typeof identifier === 'string') return identifier
  if (Array.isArray(identifier)) return identifier.map(identifierOf).find(Boolean) || ''
  return identifier?.value || identifier?.name || ''
}

export function jobPostingToRow(job, pageUrl, index = 0) {
  const company = job.hiringOrganization?.name || job.organization?.name || ''
  const title = job.title || job.name || ''
  const sourceUrl = job.url || pageUrl
  return {
    公司: String(company),
    招聘岗位: String(title),
    职位描述: htmlToText(job.description || job.responsibilities || ''),
    工作地点: locationsOf(job).join(','),
    工作类型: Array.isArray(job.employmentType) ? job.employmentType.join(',') : String(job.employmentType || ''),
    发布时间: String(job.datePosted || '').slice(0, 10),
    截止时间: String(job.validThrough || '').slice(0, 10),
    行业类别: String(job.industry || ''),
    学历要求: htmlToText(job.educationRequirements || ''),
    任职要求: htmlToText(job.qualifications || job.skills || ''),
    职位ID: identifierOf(job.identifier) || `${new URL(pageUrl).hostname}-${index}`,
    职位详情链接: sourceUrl,
    投递链接: job.directApply === false ? pageUrl : sourceUrl,
  }
}

function matchingRules(text, userAgent) {
  const groups = String(text || '').split(/\n\s*\n/)
  return groups.filter(group => {
    const agents = [...group.matchAll(/^\s*user-agent\s*:\s*(.+)$/gim)].map(match => match[1].trim().toLowerCase())
    return agents.includes('*') || agents.some(agent => userAgent.toLowerCase().includes(agent))
  })
}

/** 最小 robots.txt 判定：只处理本工具会用到的 Allow / Disallow 路径前缀。 */
export function robotsAllows(text, targetUrl, userAgent = 'FlowLabJobsBot') {
  const path = new URL(targetUrl).pathname
  const rules = matchingRules(text, userAgent).flatMap(group => [...group.matchAll(/^\s*(allow|disallow)\s*:\s*(.*)$/gim)]
    .map(match => ({ allow: match[1].toLowerCase() === 'allow', path: match[2].trim() }))
    .filter(rule => rule.path))
    .filter(rule => path.startsWith(rule.path))
    .sort((a, b) => b.path.length - a.path.length)
  return rules[0]?.allow ?? true
}

const CRAWLER_USER_AGENT = 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)'

function linkTargets(markup, baseUrl) {
  const htmlLinks = [...String(markup || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)].map(match => match[1])
  const sitemapLinks = [...String(markup || '').matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(match => decodeHtml(match[1]))
  return [...new Set([...htmlLinks, ...sitemapLinks].flatMap(value => {
    try {
      const url = new URL(value, baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return []
      url.hash = ''
      return [url.toString()]
    } catch {
      return []
    }
  }))]
}

function pattern(value, label) {
  if (!value) return null
  try {
    return new RegExp(value, 'i')
  } catch (error) {
    throw new Error(`${label} 不是有效的正则表达式：${error.message}`)
  }
}

async function readRobots(url, cache, fetchImpl) {
  const origin = new URL(url).origin
  if (cache.has(origin)) return cache.get(origin)
  const robotsUrl = new URL('/robots.txt', origin)
  const response = await fetchImpl(robotsUrl, {
    headers: { 'user-agent': CRAWLER_USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  const text = response?.ok ? await response.text() : ''
  cache.set(origin, text)
  return text
}

/**
 * 抓取公开企业招聘页里的 schema.org JobPosting。
 *
 * startUrls 可以是职位列表、详情页或 sitemap。followPattern 严格限制会继续访问的链接；
 * allowedHosts 再限制域名。只要任一已入队页面读取失败，快照就标记为不完整，调用方不得下架旧岗位。
 */
export async function crawlJobPostingSource({
  startUrls,
  allowedHosts = [],
  followPattern,
  maxPages = 1000,
  maxJobs = 5000,
  fetchImpl = fetch,
  wait = async () => {},
} = {}) {
  const seeds = [...new Set((startUrls || []).map(String).filter(Boolean))]
  if (!seeds.length) throw new Error('JSON-LD 来源至少需要一个 startUrl')
  const allowed = new Set((allowedHosts.length ? allowedHosts : seeds.map(url => new URL(url).hostname)).map(host => host.toLowerCase()))
  const follow = pattern(followPattern, 'followPattern')
  if (!follow) throw new Error('JSON-LD 来源必须配置 followPattern，避免爬虫离开招聘页面')

  const queue = [...seeds]
  const queued = new Set(queue)
  const visited = new Set()
  const robotsCache = new Map()
  const rows = []
  const failures = []
  let capped = false

  while (queue.length && visited.size < maxPages && rows.length < maxJobs) {
    const url = queue.shift()
    if (visited.has(url)) continue
    visited.add(url)

    const robots = await readRobots(url, robotsCache, fetchImpl)
    if (!robotsAllows(robots, url)) {
      failures.push({ url, reason: 'robots.txt 禁止访问' })
      continue
    }

    const response = await fetchImpl(url, {
      headers: { 'user-agent': CRAWLER_USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml' },
      signal: AbortSignal.timeout(15_000),
    }).catch(error => ({ ok: false, status: 0, error }))
    if (!response?.ok) {
      failures.push({ url, reason: response?.status ? `HTTP ${response.status}` : response?.error?.message || '连接失败' })
      continue
    }

    const markup = await response.text()
    rows.push(...parseJobPostingJsonLd(markup, url).slice(0, maxJobs - rows.length))
    for (const target of linkTargets(markup, url)) {
      const parsed = new URL(target)
      if (!allowed.has(parsed.hostname.toLowerCase()) || !follow.test(target) || queued.has(target)) continue
      queued.add(target)
      queue.push(target)
    }
    if (queue.length) await wait()
  }

  if (queue.length || rows.length >= maxJobs) capped = true
  return {
    rows,
    complete: failures.length === 0 && !capped,
    diagnostics: { visitedPages: visited.size, queuedPages: queued.size, failures, capped },
  }
}
