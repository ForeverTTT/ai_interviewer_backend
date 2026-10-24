import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchKuaishouSocialSnapshot,
  kuaishouSocialJobToRow,
  serializeKuaishouQuery,
  signKuaishouRequest,
} from '../src/lib/kuaishouSocialJobImport.js'

test('快手社招签名与官网前端算法一致', () => {
  const query = { pageNum: 1, pageSize: 10, positionNatureCode: 'C001', recruitProject: 'socialr' }
  assert.equal(serializeKuaishouQuery(query), 'pageNum=1&pageSize=10&positionNatureCode=C001&recruitProject=socialr')
  assert.equal(
    signKuaishouRequest({ timestamp: '1792878299880', query }),
    'e46b8534dbd53099a40419116505928c35bee9f89fb59f132d2fa6ef64168e94',
  )
})

test('快手社招岗位保留完整 JD、地点、类别、日期和官网投递页', () => {
  const row = kuaishouSocialJobToRow({
    id: 12,
    name: '算法工程师',
    description: '负责推荐算法',
    positionDemand: '熟悉机器学习',
    workLocationsCode: ['beijing'],
    positionCategoryCode: 'tech',
    updateTime: '2026-10-22 13:00:00',
    closeTime: '2026-12-31 23:59:59',
  }, {
    workLocations: new Map([['beijing', '北京']]),
    categories: new Map([['tech', '技术']]),
  })
  assert.equal(row.工作地点, '北京')
  assert.equal(row.备注, '技术')
  assert.equal(row.发布时间, '2026-10-22')
  assert.equal(row.截止时间, '2026-12-31')
  assert.match(row.职位描述, /岗位职责\n负责推荐算法/)
  assert.match(row.职位描述, /任职要求\n熟悉机器学习/)
  assert.equal(row.简历投递链接, 'https://zhaopin.kuaishou.cn/#/official/social/job-info/12')
})

test('快手社招公开接口加载字典并完整分页', async () => {
  const requests = []
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options })
    if (url.includes('/dictionary/batch')) return Response.json({
      code: 0,
      result: { workLocation: [{ code: 'bj', name: '北京' }], positionCategory: [{ code: 't', name: '技术' }] },
    })
    const pageNum = Number(new URL(url).searchParams.get('pageNum'))
    const ids = pageNum === 1 ? [1, 2] : [3]
    return Response.json({ code: 0, result: {
      total: 3,
      pages: 2,
      list: ids.map(id => ({ id, name: `岗位${id}`, description: `JD${id}`, workLocationCode: 'bj', positionCategoryCode: 't' })),
    } })
  }
  const result = await fetchKuaishouSocialSnapshot({ pageSize: 2, fetchImpl })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.equal(result.rows[0].工作地点, '北京')
  assert.equal(requests.length, 3)
  assert.ok(requests[1].options.headers.sign)
  assert.ok(requests[1].options.headers.signTimestamp)
})

test('快手社招接口抽样时快照不完整', async () => {
  const fetchImpl = async url => url.includes('/dictionary/batch')
    ? Response.json({ code: 0, result: {} })
    : Response.json({ code: 0, result: { total: 3, pages: 1, list: [1, 2, 3].map(id => ({ id, name: `岗位${id}`, description: 'JD' })) } })
  const result = await fetchKuaishouSocialSnapshot({ limit: 1, fetchImpl })
  assert.equal(result.complete, false)
  assert.equal(result.rows.length, 1)
})
