import test from 'node:test'
import assert from 'node:assert/strict'
import { ctripJobToRow, fetchCtripJobsSnapshot } from '../src/lib/ctripJobImport.js'

const job = (id, overrides = {}) => ({
  id: String(id),
  fromId: `MJ${id}`,
  jobTitle: `岗位${id}`,
  publishDate: '2026-10-24',
  cityName: '上海',
  requirements: '<p>你将负责：</p><p>建设推荐系统</p><p>我们期望你：</p><p>熟悉 JavaScript &amp; SQL</p>',
  jobFamilyGroupName: '技术',
  buName: 'Trip.com Group',
  kindName: '社会招聘',
  ...overrides,
})

test('携程社招岗位保留完整 JD、发布时间及独立来源和投递链接', () => {
  const row = ctripJobToRow(job('100'))
  assert.equal(row.职位描述, '你将负责：\n建设推荐系统\n我们期望你：\n熟悉 JavaScript & SQL')
  assert.equal(row.发布时间, '2026-10-24')
  assert.equal(row.职位详情链接, 'https://job.ctrip.com/#/experienced/job-detail/MJ100')
  assert.match(row.简历投递链接, /^https:\/\/passport\.ctrip\.com\/user\/login\?backurl=/)
  assert.match(decodeURIComponent(new URL(row.简历投递链接).searchParams.get('backurl')), /jobId=MJ100/)
  assert.equal(row.岗位身份标识, 'ctrip:social:MJ100')
})

test('携程校园岗位区分秋招、春招和实习', () => {
  const autumn = ctripJobToRow(job('1', { jobTitle: '算法工程师（2027届秋招）', kindName: '应届校招生' }), { mode: 'campus' })
  const spring = ctripJobToRow(job('2', { jobTitle: '产品经理（2027届春招）', kindName: '应届校招生' }), { mode: 'campus' })
  const intern = ctripJobToRow(job('3', { jobTitle: '研发实习生', kindName: '实习生' }), { mode: 'campus' })
  assert.deepEqual([autumn.工作类型, autumn.批次], ['应届生招聘', '秋招'])
  assert.deepEqual([spring.工作类型, spring.批次], ['应届生招聘', '春招'])
  assert.deepEqual([intern.工作类型, intern.批次], ['实习生招聘', '实习'])
  assert.equal(intern.职位详情链接, 'https://job.ctrip.com/#/campus/job-detail/MJ3')
})

test('携程官网接口完整分页并去重', async () => {
  const requests = []
  const fetchImpl = async (_input, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    const ids = body.pager.index === '1' ? [1, 2] : [2, 3]
    return Response.json({
      retCode: '201',
      retMessage: '调用成功',
      retValue: { total: 3, recruitJobAdList: ids.map(id => job(id)) },
    })
  }
  const result = await fetchCtripJobsSnapshot({ pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.map(item => item.pager.index), ['1', '2'])
  assert.ok(requests.every(item => item.condition.category === 1))
})

test('携程校招使用官网校园招聘分类', async () => {
  let requestBody
  const fetchImpl = async (_input, options) => {
    requestBody = JSON.parse(options.body)
    return Response.json({ retCode: '201', retValue: { total: 1, recruitJobAdList: [job(1)] } })
  }
  const result = await fetchCtripJobsSnapshot({ mode: 'campus', fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(requestBody.condition.category, 2)
})

test('携程招聘抽样结果不会被标记为完整快照', async () => {
  const fetchImpl = async () => Response.json({
    retCode: '201',
    retValue: { total: 3, recruitJobAdList: [job(1), job(2)] },
  })
  const result = await fetchCtripJobsSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.rows.length, 1)
  assert.equal(result.complete, false)
})

test('携程接口异常会重试后停止快照', async () => {
  let requests = 0
  const fetchImpl = async () => {
    requests++
    return new Response('bad gateway', { status: 502 })
  }
  await assert.rejects(
    fetchCtripJobsSnapshot({ fetchImpl }),
    /HTTP 502/,
  )
  assert.equal(requests, 3)
})
