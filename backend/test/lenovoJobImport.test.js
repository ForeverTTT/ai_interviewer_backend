import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchLenovoJobsSnapshot, lenovoJobToRow } from '../src/lib/lenovoJobImport.js'

test('联想岗位清理 HTML、翻译城市并保留官方投递页', () => {
  const row = lenovoJobToRow({
    id: 2387,
    jobName: '人力资源-人力分析方向',
    projectType: 1,
    workPlace: '1,2',
    firstDeptId: 'Human Resources',
    jobDuties: '<p>分析数据&amp;建设看板</p>',
    jobRequirement: '<p>本科及以上<br>熟悉 Python</p>',
  }, { cities: new Map([['1', '北京'], ['2', '上海']]) })
  assert.equal(row.工作地点, '北京、上海')
  assert.equal(row.批次, '秋招')
  assert.match(row.职位描述, /岗位职责\n分析数据&建设看板/)
  assert.match(row.职位描述, /任职要求\n本科及以上\n熟悉 Python/)
  assert.equal(row.简历投递链接, 'https://talent.lenovo.com.cn/position/detail?id=2387')
})

test('联想实习项目映射成实习批次', () => {
  const row = lenovoJobToRow({ id: 2, jobName: '算法实习生', projectType: 2, jobDuties: '职责' })
  assert.equal(row.工作类型, '实习生招聘')
  assert.equal(row.批次, '实习')
})

test('联想公开接口按项目和页码抓取完整快照', async () => {
  const requests = []
  const fetchImpl = async url => {
    const parsed = new URL(url)
    requests.push(parsed)
    if (parsed.pathname.endsWith('/sysDict/all')) {
      return Response.json({ code: 0, result: [{ dictCode: 'city_portal', children: [{ dictValue: 1, dictName: '北京' }] }] })
    }
    const pageNum = Number(parsed.searchParams.get('pageNum'))
    return Response.json({ code: 0, result: { total: 2, rows: [{ id: pageNum, jobName: `岗位${pageNum}`, jobDuties: '职责', projectType: 1, workPlace: '1' }] } })
  }
  const result = await fetchLenovoJobsSnapshot({ projectTypes: [1], pageSize: 1, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].工作地点, '北京')
  assert.equal(requests[2].searchParams.get('pageNum'), '2')
})

test('联想抽样限制返回不完整快照', async () => {
  const fetchImpl = async url => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/sysDict/all')) return Response.json({ code: 0, result: [] })
    return Response.json({ code: 0, result: { total: 20, rows: [{ id: 1, jobName: '岗位1', jobDuties: '职责' }] } })
  }
  const result = await fetchLenovoJobsSnapshot({ projectTypes: [1], limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
