import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchOppoJobsSnapshot, oppoCampusJobToRow, oppoSocialJobToRow } from '../src/lib/oppoJobImport.js'

test('OPPO 社招岗位保留完整 JD、发布日期和官网投递页', () => {
  const row = oppoSocialJobToRow({
    positionId: 'social-1',
    publishName: '高级热设计工程师',
    jobDuty: '负责热技术研究',
    workRequire: '本科及以上学历',
    workCityName: '东莞市',
    publishDate: '2026-10-22',
    recruitTypeName: '社招',
  })
  assert.equal(row.批次, '社招')
  assert.equal(row.发布时间, '2026-10-22')
  assert.match(row.职位描述, /岗位职责\n负责热技术研究/)
  assert.match(row.职位描述, /任职要求\n本科及以上学历/)
  assert.equal(row.简历投递链接, 'https://career.oppo.com/recruitment/post/social-1')
})

test('OPPO 校招接口把实习生岗位归到实习，并使用知识技能补足要求', () => {
  const row = oppoCampusJobToRow({
    idProjPosition: 42,
    positionName: '算法实习生',
    positionDesc: '参与算法研发',
    knowledgeSkill: '熟悉 Python',
    recruitmentTypeName: '实习生',
    projectName: '日常实习生招聘',
    workCityName: '深圳市',
    releaseTime: '2026-10-19',
  })
  assert.equal(row.批次, '实习')
  assert.match(row.职位描述, /任职要求\n熟悉 Python/)
  assert.equal(row.岗位身份标识, 'oppo:campus:42')
  assert.equal(row.简历投递链接, 'https://careers.oppo.com/university/oppo/campus/post/42')
})

test('OPPO 招聘快照完整分页并按线路解析返回结构', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    const pageNum = requests.length
    return Response.json({ code: 0, data: {
      total: 2,
      records: [{ idProjPosition: pageNum, positionName: `岗位${pageNum}`, positionDesc: '职责' }],
    } })
  }
  const result = await fetchOppoJobsSnapshot({ mode: 'campus', pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.match(requests[0].url, /careers\.oppo\.com/)
  assert.equal(requests[1].body.pageNum, 2)
})

test('OPPO 抽样限制返回不完整快照', async () => {
  const fetchImpl = async () => Response.json({ code: '0', data: {
    total: '20',
    list: [{ positionId: '1', publishName: '岗位1', jobDuty: '职责' }],
  } })
  const result = await fetchOppoJobsSnapshot({ mode: 'social', limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
