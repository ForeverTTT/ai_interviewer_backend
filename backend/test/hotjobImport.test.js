import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchHotjobJobFromUrl, fetchHotjobJobsSnapshot, parseHotjobRecruitmentUrl } from '../src/lib/hotjobImport.js'

test('parses Hotjob wecruit tenant and recruitment type', () => {
  const campus = parseHotjobRecruitmentUrl('https://wecruit.hotjob.cn/SU123/pb/school.html?projectCode=88')
  assert.equal(campus.tenant, 'SU123')
  assert.deepEqual(campus.recruitTypes, [1])
  assert.equal(parseHotjobRecruitmentUrl('https://wecruit.hotjob.cn/SU123/mc/position/intern').recruitTypes[0], 12)
  assert.deepEqual(parseHotjobRecruitmentUrl('https://wecruit.hotjob.cn/SU123/pb/posDetail.html?postId=p-1&postType=campus').recruitTypes, [1])
  assert.deepEqual(parseHotjobRecruitmentUrl('https://wecruit.hotjob.cn/SU123/pb/posDetail.html?postId=p-1&postType=12').recruitTypes, [12])
  assert.equal(parseHotjobRecruitmentUrl('https://example.com/SU123/pb/school.html'), null)
})

test('loads Hotjob list pages and complete JD details', async () => {
  const requests = []
  const result = await fetchHotjobJobsSnapshot({
    companyName: '示例公司',
    startUrl: 'https://wecruit.hotjob.cn/SU123/pb/school.html',
    pageSize: 2,
    wait: async () => {},
    fetchImpl: async (url, options) => {
      const body = Object.fromEntries(options.body)
      requests.push({ url, body })
      if (url.includes('listPositionDetail')) return {
        ok: true,
        json: async () => ({ state: '200', data: {
          postId: body.postId,
          postName: body.postId === 'a' ? '算法工程师' : '产品经理',
          workContent: '负责业务建设',
          serviceCondition: '本科及以上，沟通良好',
          workPlaceStr: '上海市',
          education: '本科及以上',
          projectName: '2027届校园招聘',
        } }),
      }
      const page = Number(body.currentPage)
      return {
        ok: true,
        json: async () => ({ state: '200', data: { pageForm: {
          totalPage: 2,
          pageSize: page === 1 ? 1 : 2,
          dataCount: 2,
          pageData: page === 1 ? [{ postId: 'a' }] : [{ postId: 'b' }],
        } } }),
      }
    },
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].公司, '示例公司')
  assert.match(result.rows[0].职位描述, /岗位职责：\n负责业务建设/)
  assert.match(result.rows[0].职位描述, /任职要求：\n本科及以上/)
  assert.equal(result.rows[0].工作地点, '上海市')
  assert.equal(result.rows[0].工作类型, '应届生招聘')
  assert.equal(result.rows[0].批次, '秋招')
  assert.match(result.rows[0].投递链接, /postType=campus$/)
  assert.equal(requests.filter(request => request.url.includes('listPositionDetail')).length, 2)
  assert.equal(requests.filter(request => request.url.includes('listPosition/'))[1].body.pageSize, '1', 'uses the server page size so offsets do not skip jobs')
})

test('maps Hotjob recruitment channels to user-facing categories', async () => {
  for (const [recruitType, expectedType, expectedBatch] of [
    [2, '社会招聘', '社招'],
    [12, '实习生招聘', '实习'],
    [13, '社会招聘', '社招'],
  ]) {
    const result = await fetchHotjobJobsSnapshot({
      companyName: '示例公司',
      startUrl: 'https://wecruit.hotjob.cn/SU123/pb/index.html',
      recruitTypes: [recruitType],
      wait: async () => {},
      fetchImpl: async (url, options) => {
        const body = Object.fromEntries(options.body)
        if (url.includes('listPositionDetail')) return {
          ok: true,
          json: async () => ({ state: '200', data: { postId: body.postId, postName: '算法工程师' } }),
        }
        return {
          ok: true,
          json: async () => ({ state: '200', data: { pageForm: {
            pageSize: 15,
            dataCount: 1,
            pageData: [{ postId: `p-${recruitType}` }],
          } } }),
        }
      },
    })
    assert.equal(result.rows[0].工作类型, expectedType)
    assert.equal(result.rows[0].批次, expectedBatch)
    assert.match(result.rows[0].投递链接, new RegExp(`postType=${{ 2: 'social', 12: 'intern', 13: 'overseas' }[recruitType]}$`))
  }
})

test('does not call a partial Hotjob snapshot complete', async () => {
  const result = await fetchHotjobJobsSnapshot({
    companyName: '示例', startUrl: 'https://wecruit.hotjob.cn/SU123/pb/school.html',
    fetchImpl: async () => ({ ok: false, status: 503 }),
  })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.failures.length, 1)
})

test('keeps public Hotjob positions when anonymous canDelivery is false', async () => {
  let detailCalls = 0
  const result = await fetchHotjobJobsSnapshot({
    companyName: '已关闭招聘的公司',
    startUrl: 'https://wecruit.hotjob.cn/SU123/pb/index.html',
    recruitTypes: [1],
    wait: async () => {},
    fetchImpl: async url => {
      if (url.includes('listPositionDetail')) {
        detailCalls++
        return {
          ok: true,
          json: async () => ({ state: '200', data: {
            postId: 'still-public-1',
            postName: '仍在官网公开的岗位',
            canDelivery: false,
          } }),
        }
      }
      return {
        ok: true,
        json: async () => ({ state: '200', data: { pageForm: {
          pageSize: 15,
          dataCount: 1,
          pageData: [{ postId: 'still-public-1', canDelivery: false }],
        } } }),
      }
    },
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].招聘岗位, '仍在官网公开的岗位')
  assert.equal(detailCalls, 1)
})

test('repairs one Hotjob detail directly from its official URL', async () => {
  const row = await fetchHotjobJobFromUrl({
    companyName: '集团名',
    sourceUrl: 'https://wecruit.hotjob.cn/SU123/pb/posDetail.html?postId=p-1&postType=campus',
    wait: async () => {},
    fetchImpl: async (_url, init) => {
      const form = new URLSearchParams(init.body)
      assert.equal(form.get('postId'), 'p-1')
      return { ok: true, json: async () => ({ state: 200, data: { postId: 'p-1', postName: '算法工程师,大模型方向', orgName: '实际公司' } }) }
    },
  })
  assert.equal(row.公司, '实际公司')
  assert.equal(row.招聘岗位, '算法工程师,大模型方向')
})
