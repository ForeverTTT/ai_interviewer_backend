import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchFeishuCareerJobsSnapshot,
  feishuCareerJobToRow,
  parseFeishuCareerUrl,
} from '../src/lib/feishuCareerImport.js'

test('识别飞书招聘 SaaS 与字节跳动招聘入口', () => {
  assert.deepEqual(parseFeishuCareerUrl('https://nio.jobs.feishu.cn/campus?project=1'), {
    origin: 'https://nio.jobs.feishu.cn',
    routePath: 'campus',
    websitePath: 'campus',
    portalType: 6,
    portalChannel: 'saas-career',
    startUrl: 'https://nio.jobs.feishu.cn/campus/position',
  })
  assert.equal(parseFeishuCareerUrl('https://poizon.jobs.feishu.cn/578078/position/list').websitePath, '578078')
  assert.equal(parseFeishuCareerUrl('https://jobs.bytedance.com/experienced/position').portalType, 2)
  assert.equal(parseFeishuCareerUrl('https://jobs.bytedance.com/experienced/position').websitePath, 'society')
  assert.equal(parseFeishuCareerUrl('https://jobs.bytedance.com/experienced/position').routePath, 'experienced')
  assert.equal(parseFeishuCareerUrl('https://jobs.bytedance.com/experienced/position').portalChannel, 'office')
  assert.equal(parseFeishuCareerUrl('https://jobs.bytedance.com/campus/position').portalType, 3)
  assert.equal(parseFeishuCareerUrl('https://example.com/jobs'), null)
})

test('飞书招聘岗位保留完整 JD、发布时间和官方投递页', () => {
  const row = feishuCareerJobToRow({
    id: '123',
    title: '算法工程师',
    description: '负责推荐算法研发',
    requirement: '熟悉机器学习',
    publish_time: Date.UTC(2026, 9, 24),
    recruit_type: { name: '实习', parent: { name: '校招' } },
    job_subject: { name: { zh_cn: '2027 届暑期实习' } },
    city_list: [{ name: '上海' }, { name: '北京' }],
    job_function: { name: '研发' },
  }, {
    companyName: '示例公司',
    origin: 'https://example.jobs.feishu.cn',
    websitePath: 'campus',
  })
  assert.equal(row.公司, '示例公司')
  assert.equal(row.批次, '实习')
  assert.equal(row.发布时间, '2026-10-24')
  assert.equal(row.工作地点, '上海、北京')
  assert.match(row.职位描述, /岗位职责\n负责推荐算法研发/)
  assert.match(row.职位描述, /任职要求\n熟悉机器学习/)
  assert.equal(row.岗位身份标识, 'feishu-career:123')
  assert.equal(row.简历投递链接, 'https://example.jobs.feishu.cn/campus/position/123/detail')
})

test('没有写春秋批次的正式校招按发布时间归入春招或秋招', () => {
  const row = feishuCareerJobToRow({
    id: 'campus-1',
    title: '校招工程师',
    description: '职责',
    requirement: '要求',
    publish_time: Date.UTC(2026, 9, 10),
    recruit_type: { name: '正式', parent: { name: '校招' } },
  }, {
    companyName: '示例公司',
    origin: 'https://example.jobs.feishu.cn',
    websitePath: 'campus',
  })
  assert.equal(row.批次, '秋招')
})

test('飞书招聘全量分页完成后才返回完整快照', async () => {
  const requests = []
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body)
    requests.push({ body, headers: options.headers })
    const id = String(body.offset + 1)
    return Response.json({ code: 0, data: {
      count: 2,
      job_post_list: [{ id, title: `岗位${id}`, description: '职责', requirement: '要求' }],
    } })
  }
  const result = await fetchFeishuCareerJobsSnapshot({
    companyName: '示例公司',
    startUrl: 'https://example.jobs.feishu.cn/campus',
    pageSize: 1,
    fetchImpl,
  })
  assert.equal(result.complete, true)
  assert.equal(result.rows.length, 2)
  assert.deepEqual(requests.map(item => item.body.offset), [0, 1])
  assert.equal(requests[0].headers['website-path'], 'campus')
  assert.match(requests[0].headers.cookie, /s_v_web_id=/)
})

test('抽样限制不会被误判成完整快照', async () => {
  const fetchImpl = async () => Response.json({ code: 0, data: {
    count: 20,
    job_post_list: [{ id: '1', title: '岗位', description: '职责', requirement: '要求' }],
  } })
  const result = await fetchFeishuCareerJobsSnapshot({
    companyName: '示例公司',
    startUrl: 'https://example.jobs.feishu.cn/campus',
    limit: 1,
    fetchImpl,
  })
  assert.equal(result.complete, false)
  assert.equal(result.diagnostics.capped, true)
})
