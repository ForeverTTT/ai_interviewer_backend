import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchJdJobsSnapshot, jdJobToRow } from '../src/lib/jdJobImport.js'

test('京东社招保留完整 JD、发布时间和官网入口', () => {
  const row = jdJobToRow({
    requirementId: 226953,
    reqNumber: 'JDZP268278',
    positionNameOpen: '内容运营岗',
    positionDeptName: '国际事业部',
    jobType: '运营类',
    workCity: '北京市',
    formatPublishTime: '2026-10-23',
    workContent: '负责内容运营',
    qualification: '五年以上经验',
  })
  assert.equal(row.发布时间, '2026-10-23')
  assert.match(row.职位描述, /岗位职责\n负责内容运营/)
  assert.match(row.职位描述, /任职要求\n五年以上经验/)
  assert.equal(row.职位详情链接, 'https://zhaopin.jd.com/web/job/job_info_list/3')
})

test('京东校园岗位聚合官网提供的工作地点并直达岗位页', () => {
  const row = jdJobToRow({
    publishId: 9107,
    positionName: '物流运营',
    publishTime: Date.UTC(2026, 6, 23),
    workContent: '职责',
    qualification: '要求',
    requirementVoList: [
      { workCity: '北京市-北京市', positionBg: '京东物流' },
      { workCity: '北京市-北京市', positionBg: '京东零售' },
      { workCity: '上海市-上海市', positionBg: '京东物流' },
    ],
  }, { mode: 'graduate' })
  assert.equal(row.工作地点, '北京市-北京市、上海市-上海市')
  assert.equal(row.部门, '京东物流、京东零售')
  assert.equal(row.批次, '秋招')
  assert.equal(row.职位详情链接, 'https://campus.jd.com/#/details?type=present&id=9107')
})

test('京东校园招聘接口完整分页', async () => {
  const requests = []
  const wrappedFetch = async (input, options) => {
    requests.push(JSON.parse(options.body))
    const page = requests.at(-1).pageIndex
    const ids = page === 1 ? [1, 2] : [3]
    return Response.json({ success: true, body: { totalNumber: 3, items: ids.map(id => ({ publishId: id, positionName: `岗位${id}`, workContent: `JD${id}` })) } })
  }
  const result = await fetchJdJobsSnapshot({ mode: 'intern', pageSize: 2, fetchImpl: wrappedFetch })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.map(request => request.pageIndex), [1, 2])
})

test('京东社招抽样时不会被标记为完整快照', async () => {
  const fetchImpl = async (input, options) => {
    const url = String(input)
    if (url.endsWith('/job_count')) return new Response('3')
    const form = new URLSearchParams(options.body)
    const page = Number(form.get('pageIndex'))
    return Response.json((page === 1 ? [1, 2] : [3]).map(id => ({ requirementId: id, positionName: `岗位${id}`, workContent: `JD${id}` })))
  }
  const result = await fetchJdJobsSnapshot({ mode: 'social', pageSize: 2, limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})

test('京东校园接口把分页大小限制为官网真实支持的 10 条', async () => {
  let requestedPageSize
  const fetchImpl = async (_input, options) => {
    const body = JSON.parse(options.body)
    requestedPageSize = body.pageSize
    return Response.json({ success: true, body: { totalNumber: 1, items: [{ publishId: 1, positionName: '岗位', workContent: 'JD' }] } })
  }
  const result = await fetchJdJobsSnapshot({ mode: 'graduate', pageSize: 100, fetchImpl })
  assert.equal(requestedPageSize, 10)
  assert.equal(result.complete, true)
})
