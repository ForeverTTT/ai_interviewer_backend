import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchVivoSocialJobsSnapshot, vivoSocialJobToRow } from '../src/lib/vivoJobImport.js'

test('vivo 社招岗位保留完整 JD、发布时间和官网投递页', () => {
  const row = vivoSocialJobToRow({
    job_id: 'M2110269060022702082',
    job_code: 'G3810Y',
    job_title: '板级可靠性工程师/专家',
    job_desc: '岗位职责\n负责可靠性研究\n任职要求\n本科及以上',
    job_category_id: 'M1718986166464483330',
    requirement_org_name: '开发三部',
    degree_range_name: '本科',
    job_location_list: [{ city: '东莞' }, { city: '东莞' }, { city: '深圳' }],
    publish_timestamp: 1792638745596,
  })
  assert.equal(row.工作地点, '东莞、深圳')
  assert.equal(row.批次, '社招')
  assert.equal(row.发布时间, '2026-10-22')
  assert.match(row.职位详情链接, /career\.vivo\.com\/job-detail/)
  assert.match(row.职位详情链接, /_irjid=M2110269060022702082/)
  assert.equal(row.简历投递链接, row.职位详情链接)
})

test('vivo 社招接口完整分页', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    return Response.json({
      code: 0,
      data: [{ job_id: String(body.page), job_code: `V${body.page}`, job_title: `岗位${body.page}`, job_desc: '完整 JD' }],
      meta: { total: 2 },
    })
  }
  const result = await fetchVivoSocialJobsSnapshot({ pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.deepEqual(requests.map(row => row.page), [1, 2])
})

test('vivo 抽样限制返回不完整快照', async () => {
  const fetchImpl = async () => Response.json({
    code: 0,
    data: [{ job_id: '1', job_code: 'V1', job_title: '岗位', job_desc: 'JD' }],
    meta: { total: 115 },
  })
  const result = await fetchVivoSocialJobsSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
