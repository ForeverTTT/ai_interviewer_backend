import test from 'node:test'
import assert from 'node:assert/strict'
import { bilibiliJobToRow, fetchBilibiliJobsSnapshot } from '../src/lib/bilibiliJobImport.js'

test('哔哩哔哩岗位按来源区分社招、校招和实习', () => {
  const social = bilibiliJobToRow({ id: 1, positionName: '资深产品经理', positionDescription: '负责产品', pushTime: '2026-10-23 12:00:00' })
  const graduate = bilibiliJobToRow({ id: 2, positionName: '算法工程师', positionDescription: '负责算法' }, { mode: 'campus' })
  const intern = bilibiliJobToRow({ id: 3, positionName: '内容运营实习生', positionDescription: '负责内容' }, { mode: 'campus' })
  assert.equal(social.批次, '社招')
  assert.equal(social.发布时间, '2026-10-23')
  assert.equal(graduate.批次, '秋招')
  assert.equal(intern.批次, '实习')
  assert.equal(intern.简历投递链接, 'https://jobs.bilibili.com/campus/positions/3')
})

test('哔哩哔哩公开接口先获取 CSRF 再完整分页', async () => {
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.endsWith('/csrf/token')) return Response.json({ code: 0, data: 'csrf-token' })
    const body = JSON.parse(options.body)
    const ids = body.pageNum === 1 ? [1, 2] : [3]
    return Response.json({
      code: 0,
      data: { total: 3, pages: 2, list: ids.map(id => ({ id, positionName: `岗位${id}`, positionDescription: `JD${id}` })) },
    })
  }
  const result = await fetchBilibiliJobsSnapshot({ mode: 'social', pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.equal(requests.length, 3)
  assert.equal(requests[1].options.headers['x-csrf'], 'csrf-token')
  assert.deepEqual(requests.slice(1).map(request => JSON.parse(request.options.body).pageNum), [1, 2])
})

test('哔哩哔哩接口抽样时快照不完整', async () => {
  const fetchImpl = async (url) => url.endsWith('/csrf/token')
    ? Response.json({ code: 0, data: 'csrf-token' })
    : Response.json({ code: 0, data: { total: 3, pages: 1, list: [1, 2, 3].map(id => ({ id, positionName: `岗位${id}`, positionDescription: 'JD' })) } })
  const result = await fetchBilibiliJobsSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
