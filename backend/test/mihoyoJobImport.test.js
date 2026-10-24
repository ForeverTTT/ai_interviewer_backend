import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchMihoyoJobsSnapshot, mihoyoJobToRow } from '../src/lib/mihoyoJobImport.js'

test('米哈游社招岗位保留完整 JD 和官网投递页', () => {
  const row = mihoyoJobToRow({
    id: '6352',
    title: '3D动画-3D风格化MOBA预研',
    addressDetailList: [{ addressDetail: '上海' }],
    competencyType: '美术&表现类',
    jobNatureId: 1,
    jobNature: '全职',
    projectName: '社会招聘',
    description: '制作角色动画',
    jobRequire: '五年以上经验',
  })
  assert.equal(row.批次, '社招')
  assert.match(row.职位描述, /岗位职责\n制作角色动画/)
  assert.match(row.职位描述, /任职要求\n五年以上经验/)
  assert.equal(row.职位详情链接, 'https://jobs.mihoyo.com/#/position/6352')
  assert.equal(row.简历投递链接, row.职位详情链接)
})

test('米哈游校园渠道按岗位性质区分秋招和实习', () => {
  const intern = mihoyoJobToRow({ id: 1, title: '算法实习生', jobNatureId: 3, description: 'JD' }, { mode: 'campus' })
  const graduate = mihoyoJobToRow({ id: 2, title: '算法工程师', projectName: '2027届秋招', description: 'JD' }, { mode: 'campus' })
  assert.equal(intern.批次, '实习')
  assert.equal(intern.工作类型, '实习生招聘')
  assert.equal(graduate.批次, '秋招')
  assert.equal(graduate.工作类型, '应届生招聘')
  assert.equal(graduate.职位详情链接, 'https://jobs.mihoyo.com/#/campus/position/2')
})

test('米哈游接口完整分页并补齐岗位详情', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    if ('pageNo' in body) {
      const ids = body.pageNo === 1 ? [1, 2] : [3]
      return Response.json({ code: 0, success: true, data: { total: 3, list: ids.map(id => ({ id })) } })
    }
    return Response.json({ code: 0, success: true, data: { id: body.id, title: `岗位${body.id}`, description: `完整 JD ${body.id}` } })
  }
  const result = await fetchMihoyoJobsSnapshot({ mode: 'campus', pageSize: 2, detailConcurrency: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.filter(body => 'pageNo' in body).map(body => body.pageNo), [1, 2])
  assert.equal(requests.filter(body => 'id' in body).length, 3)
  assert.ok(requests.every(body => body.hireType === 1))
})

test('米哈游详情失败时快照不完整', async () => {
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    if ('pageNo' in body) return Response.json({ code: 0, success: true, data: { total: 1, list: [{ id: 1 }] } })
    return new Response('error', { status: 500 })
  }
  const result = await fetchMihoyoJobsSnapshot({ fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 0)
  assert.equal(result.diagnostics.failures.length, 1)
})
