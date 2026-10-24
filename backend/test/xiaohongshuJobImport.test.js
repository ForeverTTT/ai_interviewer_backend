import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchXiaohongshuJobsSnapshot, xiaohongshuJobToRow } from '../src/lib/xiaohongshuJobImport.js'

test('小红书岗位按社招、校招和实习生成官方详情链接', () => {
  const job = {
    positionId: 42,
    positionName: '算法工程师',
    duty: '负责推荐算法',
    qualification: '本科及以上',
    workplace: '北京市，上海市',
    publishTime: '2026-10-24',
  }
  const social = xiaohongshuJobToRow(job, { mode: 'social' })
  const campus = xiaohongshuJobToRow(job, { mode: 'campus' })
  const intern = xiaohongshuJobToRow(job, { mode: 'intern' })
  assert.equal(social.批次, '社招')
  assert.equal(social.职位详情链接, 'https://job.xiaohongshu.com/social/position/42')
  assert.equal(campus.批次, '秋招')
  assert.equal(campus.职位详情链接, 'https://job.xiaohongshu.com/campus/position/42')
  assert.equal(intern.批次, '实习')
  assert.equal(intern.职位详情链接, 'https://job.xiaohongshu.com/campus/intern/position/42')
  assert.match(social.职位描述, /岗位职责\n负责推荐算法/)
  assert.match(social.职位描述, /任职要求\n本科及以上/)
})

test('小红书公开接口完整分页并固定使用安全页长', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    const ids = body.pageNum === 1 ? [1, 2] : [3]
    return Response.json({
      success: true,
      statusCode: 200,
      data: {
        pageSize: 2,
        total: 3,
        totalPage: 2,
        list: ids.map(id => ({ positionId: id, positionName: `岗位${id}`, duty: `职责${id}` })),
      },
    })
  }
  const result = await fetchXiaohongshuJobsSnapshot({ mode: 'campus', pageSize: 100, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.map(request => request.pageNum), [1, 2])
  assert.equal(requests[0].pageSize, 10)
  assert.equal(requests[0].recruitType, 'campus')
})

test('小红书抽样结果不会被标记为完整快照', async () => {
  const fetchImpl = async () => Response.json({
    success: true,
    statusCode: 200,
    data: { pageSize: 10, total: 2, totalPage: 1, list: [1, 2].map(id => ({ positionId: id, positionName: `岗位${id}`, duty: 'JD' })) },
  })
  const result = await fetchXiaohongshuJobsSnapshot({ mode: 'intern', limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
