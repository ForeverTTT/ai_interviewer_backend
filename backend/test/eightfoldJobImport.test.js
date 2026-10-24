import test from 'node:test'
import assert from 'node:assert/strict'
import { eightfoldJobToRow, fetchEightfoldJobsSnapshot } from '../src/lib/eightfoldJobImport.js'

test('Eightfold 岗位保留完整 JD、发布时间和最终投递地址', () => {
  const row = eightfoldJobToRow({
    id: 893397572374,
    displayJobId: 'JR2024860',
    name: 'ASIC Design and Verification Intern, SOC - 2027',
    locations: ['China, Shanghai'],
    postedTs: 1788480000,
    jobDescription: '<p>Build chips &amp; systems</p><ul><li>Know RTL</li></ul>',
    publicUrl: 'https://jobs.nvidia.com/careers/job/893397572374',
    positionUserActions: { applyAction: { applyUrl: 'https://nvidia.wd5.myworkdayjobs.com/apply/JR2024860' } },
    efcustomTextJobFmailyGroup: ['Univ Employment'],
  }, { companyName: '英伟达', domain: 'nvidia.com' })
  assert.equal(row.批次, '实习')
  assert.equal(row.发布时间, '2026-09-04')
  assert.match(row.职位描述, /Build chips & systems/)
  assert.equal(row.职位详情链接, 'https://jobs.nvidia.com/careers/job/893397572374')
  assert.equal(row.简历投递链接, 'https://nvidia.wd5.myworkdayjobs.com/apply/JR2024860')
})

test('Eightfold New College Graduate 岗位归入校招', () => {
  const row = eightfoldJobToRow({ id: 1, name: 'Physical Design - New College Grad 2027', jobDescription: 'JD' }, {
    companyName: '英伟达',
    domain: 'nvidia.com',
  })
  assert.equal(row.工作类型, '应届生招聘')
  assert.equal(row.批次, '秋招')
})

test('Eightfold 逐页抓取列表并补齐每条岗位详情', async () => {
  const requests = []
  const fetchImpl = async url => {
    const parsed = new URL(url)
    requests.push(parsed)
    if (parsed.pathname.endsWith('/search')) {
      const start = Number(parsed.searchParams.get('start'))
      const ids = start === 0 ? [1, 2] : [3]
      return Response.json({ status: 200, data: { count: 3, positions: ids.map(id => ({ id })) } })
    }
    const id = Number(parsed.searchParams.get('position_id'))
    return Response.json({ status: 200, data: { id, name: `岗位${id}`, jobDescription: `完整 JD ${id}`, locations: ['China, Shanghai'] } })
  }
  const result = await fetchEightfoldJobsSnapshot({
    companyName: '英伟达', domain: 'nvidia.com', location: 'China', pageSize: 2, fetchImpl,
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.equal(requests.filter(url => url.pathname.endsWith('/position_details')).length, 3)
  assert.equal(requests[0].searchParams.get('location'), 'China')
})

test('Eightfold 详情失败时快照不完整', async () => {
  const fetchImpl = async url => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/search')) {
      return Response.json({ status: 200, data: { count: 1, positions: [{ id: 1 }] } })
    }
    return new Response('error', { status: 500 })
  }
  const result = await fetchEightfoldJobsSnapshot({ companyName: '英伟达', domain: 'nvidia.com', fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 0)
  assert.equal(result.diagnostics.failures.length, 1)
})
