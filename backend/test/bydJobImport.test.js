import test from 'node:test'
import assert from 'node:assert/strict'
import { bydCampusJobToRows, bydSocialJobToRow, fetchBydJobsSnapshot } from '../src/lib/bydJobImport.js'

test('比亚迪社招岗位保留完整 JD、发布时间和官网投递页', () => {
  const row = bydSocialJobToRow({
    id: '1',
    positionName: '算法工程师',
    province: '广东省',
    city: '深圳市',
    fatherOrgName: '汽车事业群',
    orgName: '智能驾驶部',
    tagDetailList: [
      { name: '工作职责', detail: '负责算法研发' },
      { name: '任职要求', detail: '学历要求：硕士\n专业要求：计算机' },
    ],
  }, { createTime: '2026-10-22 17:01:53', relatedCode: 'S001' })
  assert.equal(row.发布时间, '2026-10-22')
  assert.equal(row.学历要求, '硕士')
  assert.match(row.职位描述, /工作职责\n负责算法研发/)
  assert.equal(row.职位详情链接, 'https://job.byd.com/portal/pc/index.html#/social/socialPositionDetails?id=1')
  assert.equal(row.简历投递链接, row.职位详情链接)
})

test('比亚迪校园岗位按具体部门和地点展开', () => {
  const rows = bydCampusJobToRows({
    id: '2',
    jobName: '活动营销专员',
    campusNature: '008501',
    updateTime: '2026-10-22',
    positionInfoList: [
      { id: 'a', division: '品牌公关', workPlace: '深圳市', jobDuty: '策划活动', jobRequirements: '学历要求：本科' },
      { id: 'b', division: '海外营销', workPlace: '深圳市,上海市', jobDuty: '海外活动', jobRequirements: '学历要求：本科' },
    ],
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].批次, '秋招')
  assert.equal(rows[1].工作地点, '深圳市、上海市')
  assert.notEqual(rows[0].岗位身份标识, rows[1].岗位身份标识)
})

test('比亚迪社招接口分页并补齐详情', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname
    const body = options.body ? JSON.parse(options.body) : null
    requests.push({ path, body })
    if (path.endsWith('/position/queryList')) {
      const ids = body.pageNum === 0 ? [1, 2] : [3]
      return Response.json({ code: 0, data: { total: 3, data: ids.map(id => ({ id, positionName: `岗位${id}` })) } })
    }
    return Response.json({ code: 0, data: { id: body.id, positionName: `岗位${body.id}`, tagDetailList: [{ name: '职责', detail: '完整 JD' }] } })
  }
  const result = await fetchBydJobsSnapshot({ mode: 'social', pageSize: 2, detailConcurrency: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(requests.filter(item => item.path.endsWith('/queryList')).map(item => item.body.pageNum), [0, 2])
  assert.ok(requests.filter(item => item.path.endsWith('/queryDetail')).every(item => item.body.pageSize === 4))
})

test('比亚迪校园岗位详情失败时快照不完整', async () => {
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname
    if (path.endsWith('/queryPositionList')) {
      return Response.json({ code: 0, data: [{ id: '1' }], page: { totalCount: 1 } })
    }
    return new Response('error', { status: 500 })
  }
  const result = await fetchBydJobsSnapshot({ mode: 'campus', lane: 'intern', fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 0)
  assert.equal(result.diagnostics.failures.length, 1)
})

test('比亚迪校园接口按官网返回的总页数翻页', async () => {
  const listPages = []
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname
    if (path.endsWith('/queryPositionList')) {
      const body = JSON.parse(options.body)
      listPages.push(body.pageIndex)
      return Response.json({
        code: 0,
        data: [{ id: String(body.pageIndex) }],
        page: { totalCount: 2, totalPage: 2, pageIndex: body.pageIndex, pageSize: 1 },
      })
    }
    const id = new URL(url).searchParams.get('id')
    return Response.json({ code: 0, data: { id, jobName: `岗位${id}`, positionInfoList: [{ id: `d${id}`, jobDuty: 'JD' }] } })
  }
  const result = await fetchBydJobsSnapshot({ mode: 'campus', pageSize: 100, fetchImpl })
  assert.equal(result.complete, true)
  assert.deepEqual(listPages, [1, 2])
})

test('比亚迪校园官网跨页重复岗位仍可形成完整去重快照', async () => {
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname
    if (path.endsWith('/queryPositionList')) {
      const body = JSON.parse(options.body)
      return Response.json({
        code: 0,
        data: [{ id: 'same' }],
        page: { totalCount: 2, totalPage: 2, pageIndex: body.pageIndex, pageSize: 1 },
      })
    }
    return Response.json({ code: 0, data: { id: 'same', jobName: '岗位', positionInfoList: [{ id: 'detail', jobDuty: 'JD' }] } })
  }
  const result = await fetchBydJobsSnapshot({ mode: 'campus', fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.fetchedJobs, 1)
  assert.equal(result.rows.length, 1)
})

test('比亚迪岗位详情临时请求失败后会重试', async () => {
  let detailCalls = 0
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname
    if (path.endsWith('/queryPositionList')) {
      return Response.json({ code: 0, data: [{ id: '1' }], page: { totalCount: 1, totalPage: 1 } })
    }
    detailCalls++
    if (detailCalls === 1) throw new TypeError('fetch failed')
    return Response.json({ code: 0, data: { id: '1', jobName: '岗位', positionInfoList: [{ id: 'd1', jobDuty: 'JD' }] } })
  }
  const result = await fetchBydJobsSnapshot({ mode: 'campus', fetchImpl })
  assert.equal(detailCalls, 2)
  assert.equal(result.complete, true)
})
