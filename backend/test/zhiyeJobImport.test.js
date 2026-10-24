import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractZhiyePortalId,
  fetchZhiyeJobsSnapshot,
  parseZhiyeRecruitmentUrl,
  zhiyeJobToRow,
} from '../src/lib/zhiyeJobImport.js'

test('识别智业社招和校招入口', () => {
  assert.deepEqual(parseZhiyeRecruitmentUrl('https://iflytek.zhiye.com/campus/jobs?x=1'), {
    origin: 'https://iflytek.zhiye.com', categoryId: '2',
    startUrl: 'https://iflytek.zhiye.com/campus/jobs', detailPath: '/campus/detail',
  })
  assert.equal(parseZhiyeRecruitmentUrl('https://smics.zhiye.com/social').categoryId, '1')
  assert.equal(parseZhiyeRecruitmentUrl('https://example.com/campus/jobs'), null)
})

test('从招聘首页内嵌配置提取 PortalId', () => {
  assert.equal(extractZhiyePortalId('<script>{"PortalId":"6e2235dc-4b88-4698-b96a-5a73c705d8db"}</script>'), '6e2235dc-4b88-4698-b96a-5a73c705d8db')
})

test('智业岗位保留完整 JD、日期与详情直链', () => {
  const row = zhiyeJobToRow({
    Id: 'abc-def', JobAdName: '算法工程师(J10001)', Duty: '<p>负责推荐系统</p>', Require: '<p>熟悉 Python</p>',
    LocNames: ['北京', '上海'], ClassificationOne: 'AI算法类', Kind: '全职',
    PostDate: '2026-09-15T09:40:05', ChangeDate: '2026-10-01T12:00:00', EndTime: '0001-01-01T00:00:00',
  }, {
    companyName: '示例科技', companyType: '民企', industryCategory: '互联网/科技',
    startUrl: 'https://example.zhiye.com/campus/jobs', detailPath: '/campus/detail', categoryId: '2',
  })
  assert.equal(row.批次, '秋招')
  assert.equal(row.职位描述, '岗位职责\n负责推荐系统\n\n任职要求\n熟悉 Python')
  assert.equal(row.发布时间, '2026-09-15')
  assert.equal(row.截止时间, '')
  assert.equal(row.企业类型, '民企')
  assert.equal(row.行业类别, '互联网/科技')
  assert.equal(row.投递链接, 'https://example.zhiye.com/campus/detail?jobAdId=abc-def')
})

test('智业适配器自举 PortalId 并完整分页', async () => {
  const calls = []
  const jobs = [1, 2, 3].map(id => ({ Id: String(id), JobAdName: `岗位${id}`, Duty: '职责', Require: '要求', Status: 1 }))
  const result = await fetchZhiyeJobsSnapshot({
    companyName: '示例科技', startUrl: 'https://example.zhiye.com/campus/jobs', pageSize: 2,
    wait: async () => {},
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options })
      if (!options.method) return { ok: true, text: async () => '{"PortalId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}' }
      const body = JSON.parse(options.body)
      return { ok: true, json: async () => ({ Code: 200, Count: jobs.length, Data: jobs.slice(body.PageIndex * 2, body.PageIndex * 2 + 2) }) }
    },
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 3)
  assert.deepEqual(calls.slice(1).map(call => JSON.parse(call.options.body).PageIndex), [0, 1])
  assert.deepEqual(JSON.parse(calls[1].options.body).Category, ['2'])
})

test('智业抽样限制不会触发岗位下架', async () => {
  const result = await fetchZhiyeJobsSnapshot({
    companyName: '示例', startUrl: 'https://example.zhiye.com/social/jobs', portalId: 'p', limit: 1,
    fetchImpl: async () => ({ ok: true, json: async () => ({ Code: 200, Count: 2, Data: [{ Id: '1', JobAdName: '岗位' }] }) }),
  })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.capped, true)
})
