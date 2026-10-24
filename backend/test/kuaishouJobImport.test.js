import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchKuaishouCampusSnapshot, kuaishouJobToRow } from '../src/lib/kuaishouJobImport.js'

test('快手校园岗位区分正式校招和实习', () => {
  const graduate = kuaishouJobToRow({ id: 1, name: '算法工程师', positionNatureCode: 'fulltime', description: '职责', releaseTime: '2026-09-14 13:09:38' })
  const intern = kuaishouJobToRow({ id: 2, name: '产品实习生', positionNatureCode: 'intern', description: '职责' })
  assert.equal(graduate.批次, '秋招')
  assert.equal(graduate.发布时间, '2026-09-14')
  assert.equal(intern.批次, '实习')
  assert.equal(intern.职位详情链接, 'https://campus.kuaishou.cn/recruit/campus/e/#/campus/job-info/2')
})

test('快手校园接口完整分页', async () => {
  const requests = []
  const fetchImpl = async (_input, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    const ids = body.pageNum === 1 ? [1, 2] : [3]
    return Response.json({ code: 0, result: { total: 3, pages: 2, list: ids.map(id => ({ id, code: `K${id}`, name: `岗位${id}`, description: `JD${id}` })) } })
  }
  const result = await fetchKuaishouCampusSnapshot({ pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.map(request => request.pageNum), [1, 2])
})

test('快手校园接口抽样时快照不完整', async () => {
  const fetchImpl = async () => Response.json({ code: 0, result: { total: 3, pages: 1, list: [1, 2, 3].map(id => ({ id, name: `岗位${id}`, description: 'JD' })) } })
  const result = await fetchKuaishouCampusSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
