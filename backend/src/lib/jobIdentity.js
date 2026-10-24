import { createHash } from 'node:crypto'

const TRACKING_PARAMS = /^(utm_|spm$|from$|source$|campaign$|ref$|referer$|tracking)/i
const COMPANY_SUFFIXES = /(股份有限公司|有限责任公司|有限公司|集团|公司|科技|网络科技)$/g

export function normalizeJobUrl(value) {
  if (!value) return null
  try {
    const url = new URL(String(value).trim())
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key)
    }
    url.hostname = url.hostname.toLowerCase()
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    return url.toString()
  } catch {
    return null
  }
}

export function normalizeCompanyName(value) {
  let normalized = String(value || '')
    .toLowerCase()
    .replace(/[（(][^）)]{1,12}[）)]/g, '')
    .replace(/[\s·•・,，.。()（）\-_]/g, '')
  let previous
  do {
    previous = normalized
    normalized = normalized.replace(COMPANY_SUFFIXES, '')
  } while (normalized !== previous)
  return normalized
}

export function normalizeJobTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(?:job\s*id|req(?:uisition)?\s*id)\s*[:：#]?\s*[a-z0-9_-]+\b/gi, '')
    .replace(/[\s·•・,，.。()（）\-_\/]/g, '')
}

export function normalizeLocation(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .flatMap(item => String(item || '').split(/[,，、;；/]/))
    .map(item => item.trim().replace(/市$/, ''))
    .filter(Boolean))]
    .sort()
    .join(',')
}

function sha1(value) {
  return createHash('sha1').update(value).digest('hex')
}

/**
 * 跨来源岗位主键。来源名称不参与计算，因此飞书和企业官网的同一岗位会落到同一条记录。
 * 地点保留在指纹中，避免同公司同名岗位在不同城市被误合并。
 */
export function canonicalJobKey({ company, job_title, positions, locations, canonical_discriminator }) {
  const identityParts = [
    normalizeCompanyName(company),
    normalizeJobTitle(job_title || positions),
    normalizeLocation(locations),
  ]
  const discriminator = normalizeJobTitle(canonical_discriminator)
  if (discriminator) identityParts.push(discriminator)
  const identity = identityParts.join('|')
  return sha1(`job-v2|${identity}`)
}

export function jobSourceKey({ source_type, source, source_job_id, jd_url, apply_url, external_key }) {
  const directId = String(source_job_id || '').trim()
  const sourceUrl = normalizeJobUrl(jd_url) || normalizeJobUrl(apply_url)
  // 一条飞书记录可能列出多个岗位；canonical key 能让这些拆分后的岗位各有一个来源记录。
  const identity = `${directId || sourceUrl || 'row'}|${external_key || ''}`
  return sha1(['job-source-v1', source_type || 'feishu', source || '', identity || ''].join('|'))
}

/**
 * 只在顶层分隔符处拆岗位，括号里的逗号不会误拆。
 * 过长文本或疑似完整 JD 保持原样，并标为聚合记录。
 */
export function splitJobTitles(value) {
  const text = String(value || '').trim()
  if (!text) return []
  const parts = []
  let current = ''
  let depth = 0
  for (const char of text) {
    if ('（([{【'.includes(char)) depth++
    if ('）)]}】'.includes(char)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /[\n,，、;；|]/.test(char)) {
      if (current.trim()) parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  const unique = [...new Set(parts)]
  const looksLikeTitles = unique.length > 1
    && unique.length <= 30
    && unique.every(part => part.length >= 2 && part.length <= 80 && !/[。！？!?]{1}/.test(part))
  return looksLikeTitles ? unique : [text]
}
