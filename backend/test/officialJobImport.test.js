import test from 'node:test'
import assert from 'node:assert/strict'

import { crawlJobPostingSource, htmlToText, parseJobPostingJsonLd, robotsAllows } from '../src/lib/officialJobImport.js'
import { mapJobRows } from '../src/lib/feishuImport.js'

test('extracts official JobPosting JSON-LD into the shared import shape', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: '后端开发工程师',
    description: '<p>负责 API 开发</p><p>要求 Node.js</p>',
    hiringOrganization: { name: '示例科技有限公司' },
    jobLocation: [{ address: { addressLocality: '北京', addressRegion: '北京' } }],
    identifier: { value: 'JOB-42' },
    datePosted: '2026-10-20T10:00:00+08:00',
    validThrough: '2026-11-30T23:59:59+08:00',
    url: 'https://careers.example.com/jobs/42?utm_source=feed',
  })}</script>`
  const [row] = parseJobPostingJsonLd(html, 'https://careers.example.com/jobs/42')
  assert.equal(row.公司, '示例科技有限公司')
  assert.equal(row.招聘岗位, '后端开发工程师')
  assert.equal(row.职位描述, '负责 API 开发\n要求 Node.js')
  assert.equal(row.工作地点, '北京')
  const [job] = mapJobRows(row, { category: '其他', source: '企业公开招聘网站', sourceType: 'official' })
  assert.equal(job.source_type, 'official')
  assert.equal(job.source_job_id, 'JOB-42')
  assert.match(job.job_description, /Node\.js/)
})

test('ignores broken JSON-LD and strips basic HTML safely', () => {
  assert.deepEqual(parseJobPostingJsonLd('<script type="application/ld+json">{bad}</script>', 'https://example.com/job'), [])
  assert.equal(htmlToText('<p>A &amp; B</p><ul><li>C</li></ul>'), 'A & B\nC')
})

test('robots rules use the longest matching path and allow by default', () => {
  const robots = 'User-agent: *\nDisallow: /jobs/private\nAllow: /jobs/private/public\n'
  assert.equal(robotsAllows(robots, 'https://example.com/jobs/open'), true)
  assert.equal(robotsAllows(robots, 'https://example.com/jobs/private/42'), false)
  assert.equal(robotsAllows(robots, 'https://example.com/jobs/private/public/42'), true)
})

test('crawls a constrained official listing and reports a complete snapshot', async () => {
  const job = {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: '产品经理',
    description: '负责产品规划和用户研究',
    hiringOrganization: { name: '示例公司' },
    identifier: { value: 'PM-1' },
    url: 'https://careers.example.com/jobs/pm-1',
  }
  const pages = new Map([
    ['https://careers.example.com/robots.txt', 'User-agent: *\nAllow: /'],
    ['https://careers.example.com/careers', '<a href="/jobs/pm-1">岗位</a>'],
    ['https://careers.example.com/jobs/pm-1', `<script type="application/ld+json">${JSON.stringify(job)}</script>`],
  ])
  const fetchImpl = async url => pages.has(String(url))
    ? new Response(pages.get(String(url)), { status: 200 })
    : new Response('missing', { status: 404 })

  const snapshot = await crawlJobPostingSource({
    startUrls: ['https://careers.example.com/careers'],
    followPattern: '/jobs/',
    fetchImpl,
  })
  assert.equal(snapshot.complete, true)
  assert.equal(snapshot.rows.length, 1)
  assert.equal(snapshot.rows[0].职位ID, 'PM-1')
})
