import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchPddCampusSnapshot, pddJobToRow } from '../src/lib/pddJobImport.js'

const activeDetail = id => ({
  id: String(id),
  name: `岗位${id}`,
  jobDuty: `职责${id}`,
  serveRequirement: `要求${id}`,
  bonus: `加分项${id}`,
  workLocationName: '上海',
  releaseTime: Date.parse('2026-10-24T18:30:00Z'),
  batchId: 'batch-2027',
  isVote: true,
  voteArrange: 'inTime',
  normal: true,
  shareUrl: `https://careers.pddglobalhr.com/campus/grad/detail?positionId=${id}`,
})

test('拼多多校招岗位保留完整 JD、上海发布时间和直达投递链接', () => {
  const row = pddJobToRow({
    ...activeDetail('job-1'),
    jobName: '研发',
    recruitTypeName: '研发专场',
    graduationYear: '2027',
    labelList: ['紧缺'],
  })
  assert.equal(row.发布时间, '2026-10-25')
  assert.match(row.职位描述, /岗位职责\n职责job-1/)
  assert.match(row.职位描述, /任职要求\n要求job-1/)
  assert.match(row.职位描述, /加分项\n加分项job-1/)
  assert.equal(row.职位详情链接, 'https://careers.pddglobalhr.com/campus/grad/detail?positionId=job-1')
  assert.equal(row.简历投递链接, 'https://careers.pddglobalhr.com/campus/resume-apply?positionId=job-1&batchId=batch-2027&pageType=grad')
  assert.equal(row.岗位身份标识, 'pdd:graduate:job-1')
})

test('拼多多官网接口完整分页并逐个读取详情', async () => {
  const requests = []
  const fetchImpl = async (input, options) => {
    const path = new URL(input).pathname
    const body = JSON.parse(options.body)
    requests.push({ path, body })
    if (path.endsWith('/position/detail')) return Response.json({ success: true, errorCode: 1000000, result: activeDetail(body.id) })
    const ids = body.page === 1 ? [1, 2] : [3]
    return Response.json({
      success: true,
      errorCode: 1000000,
      result: { total: '3', list: ids.map(id => ({ id: String(id), name: `岗位${id}` })) },
    })
  }
  const result = await fetchPddCampusSnapshot({ mode: 'graduate', pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.filter(item => item.path.endsWith('/position/list')).map(item => item.body.page), [1, 2])
  assert.deepEqual(requests.filter(item => item.path.endsWith('/position/detail')).map(item => item.body.id), ['1', '2', '3'])
})

test('拼多多实习接口跳过官网明确不可投递的岗位', async () => {
  const fetchImpl = async (input, options) => {
    const path = new URL(input).pathname
    const body = JSON.parse(options.body)
    if (path.endsWith('/position/detail')) {
      return Response.json({
        success: true,
        errorCode: 1000000,
        result: { ...activeDetail(body.id), normal: false },
      })
    }
    assert.match(path, /position\/train\/list$/)
    return Response.json({ success: true, errorCode: 1000000, result: { total: '1', list: [{ id: 'closed' }] } })
  }
  const result = await fetchPddCampusSnapshot({ mode: 'intern', fetchImpl })
  assert.equal(result.rows.length, 0)
  assert.equal(result.complete, true)
  assert.equal(result.authoritativeEmpty, true)
  assert.equal(result.diagnostics.unavailable, 1)
})

test('拼多多详情读取失败时快照不完整', async () => {
  const fetchImpl = async input => {
    const path = new URL(input).pathname
    if (path.endsWith('/position/detail')) return new Response('bad gateway', { status: 502 })
    return Response.json({ success: true, errorCode: 1000000, result: { total: '1', list: [{ id: 'broken' }] } })
  }
  const result = await fetchPddCampusSnapshot({ fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 0)
  assert.equal(result.diagnostics.failures.length, 1)
})

test('拼多多招聘抽样结果不会被标记为完整快照', async () => {
  const fetchImpl = async (input, options) => {
    const path = new URL(input).pathname
    const body = JSON.parse(options.body)
    if (path.endsWith('/position/detail')) return Response.json({ success: true, errorCode: 1000000, result: activeDetail(body.id) })
    return Response.json({
      success: true,
      errorCode: 1000000,
      result: { total: '3', list: [1, 2].map(id => ({ id: String(id) })) },
    })
  }
  const result = await fetchPddCampusSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.rows.length, 1)
  assert.equal(result.complete, false)
})
