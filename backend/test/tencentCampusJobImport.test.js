import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchTencentCampusJobsSnapshot, tencentCampusJobToRow } from '../src/lib/tencentCampusJobImport.js'

test('腾讯校招岗位保留完整 JD、类型和官方投递页', () => {
  const row = tencentCampusJobToRow({
    postId: '123',
    title: '后台开发',
    desc: '负责服务端开发',
    request: '熟悉一门后端语言',
    internBonus: '有项目经验',
    recruitType: 2,
    recruitLabelName: '应届实习',
    workCityList: ['深圳总部', '北京'],
    bgs: 'CSIG TEG',
  })
  assert.match(row.职位描述, /岗位职责\n负责服务端开发/)
  assert.match(row.职位描述, /任职要求\n熟悉一门后端语言/)
  assert.match(row.职位描述, /加分项\n有项目经验/)
  assert.equal(row.工作类型, '应届实习')
  assert.equal(row.工作地点, '深圳总部、北京')
  assert.equal(row.岗位身份标识, 'tencent-campus:123')
  assert.equal(row.简历投递链接, 'https://join.qq.com/post_detail.html?postid=123')
})

test('腾讯校招按 projectMappingIds 抓取列表并补齐详情', async () => {
  const requests = []
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('position/searchPosition')) {
      return Response.json({
        status: 0,
        data: {
          count: 1,
          positionList: [{ postId: '123', positionTitle: '后台开发', workCities: '深圳总部', bgs: 'TEG' }],
        },
      })
    }
    return Response.json({
      status: 0,
      data: { postId: null, title: '后台开发', desc: '职责', request: '要求', recruitType: 2 },
    })
  }

  const result = await fetchTencentCampusJobsSnapshot({ projectMappingIds: [2, 104, 20], fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 1)
  assert.deepEqual(JSON.parse(requests[0].options.body).projectMappingIdList, [2, 104, 20])
  assert.match(requests[1].url, /postId=123/)
  assert.equal(result.rows[0].简历投递链接, 'https://join.qq.com/post_detail.html?postid=123')
})

test('腾讯校招列表残留的 404 详情按已下架跳过，不把快照误判为失败', async () => {
  const fetchImpl = async url => {
    if (String(url).includes('position/searchPosition')) {
      return Response.json({
        status: 0,
        data: {
          count: 2,
          positionList: [
            { postId: 'active', positionTitle: '后台开发' },
            { postId: 'removed', positionTitle: '已下架岗位' },
          ],
        },
      })
    }
    if (String(url).includes('postId=removed')) return Response.json({ status: 404, data: null })
    return Response.json({ status: 0, data: { postId: 'active', title: '后台开发', desc: '职责', request: '要求' } })
  }

  const result = await fetchTencentCampusJobsSnapshot({ projectMappingIds: [1, 14], fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 1)
  assert.deepEqual(result.diagnostics.skippedNotFound, ['removed'])
  assert.deepEqual(result.diagnostics.failures, [])
})
