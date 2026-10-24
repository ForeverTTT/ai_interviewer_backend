import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchMeituanJobsSnapshot, meituanJobToRow } from '../src/lib/meituanJobImport.js'

test('美团岗位保留完整 JD、发布时间和官方投递页', () => {
  const row = meituanJobToRow({
    jobUnionId: '4759250945',
    name: '招聘 HR 实习生',
    jobType: '2',
    jobFamily: '职能类',
    jobFamilyGroup: '人力资源',
    cityList: [{ name: '北京市' }],
    department: [{ name: '人力资源平台' }],
    jobDuty: '负责招聘运营',
    jobRequirement: '每周实习五天',
    refreshTime: Date.UTC(2026, 8, 21),
  })
  assert.equal(row.批次, '实习')
  assert.equal(row.工作类型, '实习招聘')
  assert.equal(row.发布时间, '2026-09-21')
  assert.match(row.职位描述, /岗位职责\n负责招聘运营/)
  assert.match(row.职位描述, /岗位要求\n每周实习五天/)
  assert.equal(row.简历投递链接, 'https://zhaopin.meituan.com/web/position/detail?highlightType=campus&jobUnionId=4759250945')
})

test('美团公开接口按岗位类型完整分页', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push(body)
    const id = String(body.page.pageNo)
    return Response.json({
      status: 1,
      data: {
        list: [{ jobUnionId: id, name: `岗位${id}`, jobType: '3', jobDuty: '职责' }],
        page: { totalCount: 2 },
      },
    })
  }
  const result = await fetchMeituanJobsSnapshot({ jobTypes: ['3'], pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.deepEqual(requests[0].jobType, [{ code: '3', subCode: [] }])
  assert.equal(requests[1].page.pageNo, 2)
})

test('美团抽样限制不会触发岗位下架', async () => {
  const fetchImpl = async () => Response.json({
    status: 1,
    data: {
      list: [
        { jobUnionId: '1', name: '岗位1', jobType: '1', jobDuty: '职责' },
        { jobUnionId: '2', name: '岗位2', jobType: '2', jobDuty: '职责' },
      ],
      page: { totalCount: 500 },
    },
  })
  const result = await fetchMeituanJobsSnapshot({ jobTypes: ['1', '2'], limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
