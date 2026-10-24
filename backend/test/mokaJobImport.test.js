import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchMokaJobsSnapshot, mokaJobToRow, parseMokaRecruitmentUrl } from '../src/lib/mokaJobImport.js'

test('parses public Moka campus and social recruitment URLs', () => {
  assert.deepEqual(parseMokaRecruitmentUrl('https://app.mokahr.com/campus-recruitment/cecw/148627?locale=zh-CN#/jobs'), {
    orgId: 'cecw', siteId: '148627', mode: 'campus',
    startUrl: 'https://app.mokahr.com/campus-recruitment/cecw/148627#/jobs',
  })
  assert.equal(parseMokaRecruitmentUrl('https://app.mokahr.com/campus_apply/acme/88#/job/1').mode, 'campus')
  assert.equal(parseMokaRecruitmentUrl('https://app.mokahr.com/apply/acme/88#/job/1').startUrl, 'https://app.mokahr.com/apply/acme/88#/jobs')
  assert.deepEqual(parseMokaRecruitmentUrl('https://app.mokahr.com/apply/acme#/jobs'), {
    orgId: 'acme', siteId: '', mode: 'social',
    startUrl: 'https://app.mokahr.com/apply/acme#/jobs',
  })
  assert.equal(parseMokaRecruitmentUrl('https://example.com/jobs'), null)
})

test('recognizes Moka portals bound to an official company domain', () => {
  assert.deepEqual(parseMokaRecruitmentUrl('https://apply.careers.dji.com/social-recruitment/dji/170070#/jobs'), {
    orgId: 'dji', siteId: '170070', mode: 'social',
    startUrl: 'https://apply.careers.dji.com/social-recruitment/dji/170070#/jobs',
  })
  assert.equal(parseMokaRecruitmentUrl('https://example.com/apply/company/123'), null)
})

test('reads every Moka page and maps full JD fields', async () => {
  const offsets = []
  const jobs = [
    { id: '1', title: '算法工程师', description: '<p>负责推荐系统</p><p>要求熟悉 Python</p>', locations: [{ address: '北京成大中心' }], department: { name: 'AI' }, status: 'open' },
    { id: '2', title: '产品经理', description: '<p>负责产品规划</p>', locations: [{ name: '上海' }], status: 'open' },
    { id: '3', title: '设计师', description: '<p>负责体验设计</p>', locations: [{ name: '深圳' }], status: 'open' },
  ]
  const result = await fetchMokaJobsSnapshot({
    companyName: '示例科技',
    startUrl: 'https://app.mokahr.com/campus-recruitment/example/123#/jobs',
    pageSize: 2,
    wait: async () => {},
    fetchImpl: async url => {
      const offset = Number(url.searchParams.get('offset'))
      offsets.push(offset)
      return { ok: true, json: async () => ({ data: { jobs: jobs.slice(offset, offset + 2), total: jobs.length } }) }
    },
  })
  assert.equal(result.complete, true)
  assert.deepEqual(offsets, [0, 2])
  assert.equal(result.rows.length, 3)
  assert.equal(result.rows[0].公司, '示例科技')
  assert.equal(result.rows[0].职位描述, '负责推荐系统\n要求熟悉 Python')
  assert.equal(result.rows[0].工作地点, '北京成大中心')
  assert.match(result.rows[0].投递链接, /#\/job\/1$/)
})

test('supports public social snapshots without a website id and skips paused jobs', async () => {
  let requestedUrl
  const result = await fetchMokaJobsSnapshot({
    companyName: '示例科技',
    startUrl: 'https://app.mokahr.com/apply/example#/jobs',
    fetchImpl: async url => {
      requestedUrl = url
      return { ok: true, json: async () => ({ jobs: [
        { id: '1', title: '开放岗位', description: '职责', status: 'open' },
        { id: '2', title: '暂停岗位', description: '职责', status: 'pause' },
      ], total: 2 }) }
    },
  })
  assert.equal(requestedUrl.searchParams.has('siteId'), false)
  assert.equal(result.complete, true)
  assert.deepEqual(result.rows.map(row => row.招聘岗位), ['开放岗位'])
})

test('uses a matching brand alias for jobs from a shared group tenant', () => {
  const row = mokaJobToRow({
    id: '1',
    title: 'FILA 鞋设计岗',
    description: '<p>负责产品设计</p>',
  }, {
    companyName: '安踏集团',
    companyAliases: ['安踏集团', 'FILA', '可隆'],
    startUrl: 'https://app.mokahr.com/campus-recruitment/antahr/142914#/jobs',
  })
  assert.equal(row.公司, 'FILA')
})

test('Moka 校招岗位根据标题和发布时间区分实习、春招和秋招', () => {
  const options = { companyName: '示例', startUrl: 'https://app.mokahr.com/campus-recruitment/example/123#/jobs' }
  assert.equal(mokaJobToRow({ id: '1', title: '算法实习生' }, options).批次, '实习')
  assert.equal(mokaJobToRow({ id: '2', title: '算法工程师', publishedAt: '2026-03-01' }, options).批次, '春招')
  assert.equal(mokaJobToRow({ id: '3', title: '算法工程师', publishedAt: '2026-09-01' }, options).批次, '秋招')
})

test('marks limited or failed Moka snapshots incomplete', async () => {
  const limited = await fetchMokaJobsSnapshot({
    companyName: '示例', startUrl: 'https://app.mokahr.com/campus-recruitment/example/123#/jobs', limit: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ data: { jobs: [{ id: '1', title: '岗位' }], total: 2 } }) }),
  })
  assert.equal(limited.complete, false)
  assert.equal(limited.diagnostics.capped, true)

  const failed = await fetchMokaJobsSnapshot({
    companyName: '示例', startUrl: 'https://app.mokahr.com/campus-recruitment/example/123#/jobs',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  })
  assert.equal(failed.complete, false)
  assert.equal(failed.diagnostics.failures.length, 1)
})

test('retries a transient Moka failure before accepting the page', async () => {
  let calls = 0
  const waits = []
  const result = await fetchMokaJobsSnapshot({
    companyName: '示例',
    startUrl: 'https://app.mokahr.com/campus-recruitment/example/123#/jobs',
    wait: async ms => waits.push(ms),
    fetchImpl: async () => {
      calls++
      if (calls === 1) return { ok: false, status: 429, headers: { get: () => null } }
      return { ok: true, json: async () => ({ jobs: [{ id: '1', title: '岗位' }], total: 1 }) }
    },
  })
  assert.equal(result.complete, true)
  assert.equal(calls, 2)
  assert.deepEqual(waits, [1200])
})
