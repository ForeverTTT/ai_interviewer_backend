import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchHuaweiCampusSnapshot, huaweiJobToRows } from '../src/lib/huaweiJobImport.js'
import { mapJobRows } from '../src/lib/feishuImport.js'

test('华为职位详情转换为一岗一公司，并保留完整职责和要求', () => {
  const rows = huaweiJobToRows({
    advertisementId: 36390,
    jobname: 'AI应用工程师',
    scenarioName: '应届生',
    jobCity: '深圳/上海',
    lastUpdateDate: '2026-08-17',
  }, [{
    externalPostCode: 'JT1',
    positionIntention: 'AI技术应用',
    jobPlaceName: '北京/深圳',
    jobResponsibilities: '1、开发大模型应用；<br>2、完成效果评估。',
    jobDemand: '1、计算机相关专业；<br>2、熟悉 Python。',
  }])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].招聘岗位, 'AI应用工程师')
  assert.equal(rows[0].批次, '秋招')
  assert.match(rows[0].职位描述, /岗位职责\n1、开发大模型应用；\n2、完成效果评估。/)
  assert.match(rows[0].职位描述, /任职要求\n1、计算机相关专业；\n2、熟悉 Python。/)

  const jobs = mapJobRows(rows[0], { category: '秋招', source: '华为招聘官网', sourceType: 'official' })
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].company, '华为')
  assert.equal(jobs[0].job_title, 'AI应用工程师')
  assert.match(jobs[0].job_description, /任职要求/)
  assert.equal(jobs[0].source_priority, 100)
})

test('同一招聘条目含多个岗位方向时拆成独立岗位', () => {
  const rows = huaweiJobToRows({ advertisementId: 1, jobname: '算法工程师' }, [
    { externalPostCode: 'A', positionIntention: '视觉算法', jobResponsibilities: '职责 A', jobDemand: '要求 A' },
    { externalPostCode: 'B', positionIntention: '推荐算法', jobResponsibilities: '职责 B', jobDemand: '要求 B' },
  ])
  assert.deepEqual(rows.map(row => row.招聘岗位), ['算法工程师（视觉算法）', '算法工程师（推荐算法）'])
  assert.notEqual(rows[0].职位ID, rows[1].职位ID)
})

test('岗位方向已包含基础岗位名时不重复嵌套标题', () => {
  const rows = huaweiJobToRows({ advertisementId: 2, jobname: '客户经理（小语种）' }, [
    { externalPostCode: 'P', positionIntention: '客户经理（葡萄牙语）', jobResponsibilities: '职责', jobDemand: '要求' },
    { externalPostCode: 'D', positionIntention: '客户经理（德语）', jobResponsibilities: '职责', jobDemand: '要求' },
  ])
  assert.deepEqual(rows.map(row => row.招聘岗位), ['客户经理（葡萄牙语）', '客户经理（德语）'])
})

test('全量同步会翻完所有列表页后才标记为完整快照', async () => {
  let listCalls = 0
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    if (String(url).includes('getJobPage')) {
      listCalls++
      return new Response(JSON.stringify({ status: 'SUCCESS', data: {
        pageVO: { totalRows: 2, totalPages: 2 },
        result: [{ advertisementId: body.curPage, jobname: `岗位${body.curPage}` }],
      } }), { status: 200 })
    }
    return new Response(JSON.stringify({ status: 'SUCCESS', data: {
      advertisementId: body.advertisementId,
      jobname: `岗位${body.advertisementId}`,
      mainBusiness: '完整岗位职责',
      jobRequire: '完整任职要求',
    } }), { status: 200 })
  }

  const snapshot = await fetchHuaweiCampusSnapshot({ pageSize: 1, fetchImpl })
  assert.equal(listCalls, 2)
  assert.equal(snapshot.fetchedAdvertisements, 2)
  assert.equal(snapshot.rows.length, 2)
  assert.equal(snapshot.complete, true)
})

test('华为社招同步向公开接口传递 SR 类型', async () => {
  const listBodies = []
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body)
    if (String(url).includes('getJobPage')) {
      listBodies.push(body)
      return Response.json({ status: 'SUCCESS', data: {
        pageVO: { totalRows: 1 },
        result: [{ advertisementId: 1, jobname: '高级工程师' }],
      } })
    }
    return Response.json({ status: 'SUCCESS', data: {
      advertisementId: 1,
      jobname: '高级工程师',
      scenarioName: '社会招聘',
      mainBusiness: '负责系统研发',
      jobRequire: '五年以上经验',
    } })
  }
  const result = await fetchHuaweiCampusSnapshot({ jobType: 'SR', fetchImpl })
  assert.equal(listBodies[0].jobType, 'SR')
  assert.equal(result.rows[0].批次, '社招')
  assert.equal(result.rows[0].工作类型, '社会招聘')
})
