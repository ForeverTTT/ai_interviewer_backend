#!/usr/bin/env node
/**
 * 从企业公开招聘页面的 schema.org JobPosting JSON-LD 导入岗位。
 *
 * node scripts/importOfficialJobs.js urls.txt [--source 企业公开招聘网站] [--dry-run] [--sample]
 * urls.txt 每行一个公开岗位详情页；空行和 # 注释会忽略。工具会检查 robots.txt，
 * 不处理登录墙、验证码或绕过访问限制。
 */
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { parseJobPostingJsonLd, robotsAllows } from '../src/lib/officialJobImport.js'
import { importJobTables } from '../src/lib/jobImport.js'

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string', default: '企业公开招聘网站' },
    'dry-run': { type: 'boolean', default: false },
    sample: { type: 'boolean', default: false },
  },
})

if (!positionals[0]) {
  console.error('用法: node scripts/importOfficialJobs.js urls.txt [--source 来源名] [--dry-run] [--sample]')
  process.exit(1)
}

const urls = [...new Set((await readFile(positionals[0], 'utf8'))
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#')))]

const robotsCache = new Map()
const rows = []
const FETCH_TIMEOUT_MS = 15_000
for (const urlText of urls) {
  const url = new URL(urlText)
  const origin = url.origin
  if (!robotsCache.has(origin)) {
    const robotsUrl = new URL('/robots.txt', origin)
    const response = await fetch(robotsUrl, { headers: { 'User-Agent': 'FlowLabJobsBot/1.0' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null)
    robotsCache.set(origin, response?.ok ? await response.text() : '')
  }
  if (!robotsAllows(robotsCache.get(origin), url)) {
    console.log(`跳过（robots.txt 禁止）: ${url}`)
    continue
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'FlowLabJobsBot/1.0 (+https://flowlab-career.com)' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }).catch(() => null)
  if (!response) {
    console.log(`跳过（连接失败或超时）: ${url}`)
    continue
  }
  if (!response.ok) {
    console.log(`跳过（HTTP ${response.status}）: ${url}`)
    continue
  }
  const found = parseJobPostingJsonLd(await response.text(), url)
  if (!found.length) console.log(`跳过（没有 JobPosting 结构化数据）: ${url}`)
  rows.push(...found)
}

const { supabase } = opts['dry-run'] ? {} : await import('../src/lib/supabase.js')
await importJobTables([{ label: opts.source, rows, fallback: '其他' }], {
  supabase,
  source: opts.source,
  sourceType: 'official',
  dryRun: opts['dry-run'],
  sample: opts.sample,
})
