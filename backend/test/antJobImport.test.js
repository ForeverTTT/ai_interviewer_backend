import test from 'node:test'
import assert from 'node:assert/strict'
import { antJobToRow, fetchAntJobsSnapshot } from '../src/lib/antJobImport.js'

test('蚂蚁社招岗位保留完整 JD、发布时间和直达链接', () => {
  const row = antJobToRow({
    id: 260918012114924,
    name: '蚂蚁集团-招聘专家-产研方向',
    categories: ['综合类-人力资源'],
    publishTime: '2026-10-23T15:08:12.000+00:00',
    workLocations: ['杭州'],
    description: '负责招聘交付',
    requirement: '具备技术招聘经验',
    department: 'Ant Group',
  })
  assert.equal(row.发布时间, '2026-10-23')
  assert.match(row.职位描述, /岗位职责\n负责招聘交付/)
  assert.match(row.职位描述, /任职要求\n具备技术招聘经验/)
  assert.equal(row.职位详情链接, 'https://talent.antgroup.com/off-campus-position?positionId=260918012114924')
  assert.equal(row.岗位身份标识, 'ant:social:260918012114924')
})

test('蚂蚁社招接口使用官网要求的参数并完整分页', async () => {
  const bodies = []
  const fetchImpl = async (input, options) => {
    assert.match(String(input), /\/api\/social\/position\/search$/)
    const body = JSON.parse(options.body)
    bodies.push(body)
    const ids = body.pageIndex === 1 ? [1, 2] : [3]
    return Response.json({ success: true, totalCount: 3, content: ids.map(id => ({ id, name: `岗位${id}`, description: `职责${id}` })) })
  }
  const result = await fetchAntJobsSnapshot({ mode: 'social', pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(bodies.map(body => body.pageIndex), [1, 2])
  assert.equal(bodies[0].channel, 'group_official_site')
  assert.equal(bodies[0].regions, '')
})

test('蚂蚁当前校招会自动发现批次并排除已过毕业窗口的旧岗位', async () => {
  const requests = []
  const fetchImpl = async (input, options) => {
    const path = new URL(input).pathname
    const body = JSON.parse(options.body)
    requests.push({ path, body })
    if (path.endsWith('/queryBatchConfig')) {
      return Response.json({ success: true, content: { graduateBatchId: '23080700035818' } })
    }
    return Response.json({
      success: true,
      totalCount: 1,
      content: [{
        id: 1,
        name: '旧校招岗位',
        description: '职责',
        graduationTime: { to: '2024-10-31T00:00:00.000+00:00' },
      }],
    })
  }
  const result = await fetchAntJobsSnapshot({ mode: 'graduate', fetchImpl, now: new Date('2026-10-25T00:00:00Z') })
  assert.equal(requests[1].body.batchId, '23080700035818')
  assert.equal(requests[1].body.categoryType, 'freshman')
  assert.equal(result.rows.length, 0)
  assert.equal(result.complete, true)
  assert.equal(result.authoritativeEmpty, true)
  assert.equal(result.diagnostics.unavailable, 1)
})

test('蚂蚁招聘抽样结果不会被标记为完整快照', async () => {
  const fetchImpl = async () => Response.json({
    success: true,
    totalCount: 3,
    content: [1, 2].map(id => ({ id, name: `岗位${id}`, description: `职责${id}` })),
  })
  const result = await fetchAntJobsSnapshot({ mode: 'social', limit: 1, fetchImpl })
  assert.equal(result.rows.length, 1)
  assert.equal(result.complete, false)
})
