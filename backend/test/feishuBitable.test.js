import test from 'node:test'
import assert from 'node:assert/strict'

import { createBitableClient, parseBitableUrl, recordToRow } from '../src/lib/feishuBitable.js'
import { mapJobRow } from '../src/lib/feishuImport.js'
import { importJobTables } from '../src/lib/jobImport.js'

test('parses app token and table id from a base link', () => {
  assert.deepEqual(
    parseBitableUrl('https://abc.feishu.cn/base/E8Dabn61Fa5sH2s6DvVc550invb?table=tblUaXkclzw09CXi&view=vewya0hLK0'),
    { appToken: 'E8Dabn61Fa5sH2s6DvVc550invb', tableId: 'tblUaXkclzw09CXi' },
  )
  assert.deepEqual(parseBitableUrl('https://abc.feishu.cn/base/E8Dab'), { appToken: 'E8Dab', tableId: null })
  assert.throws(() => parseBitableUrl('https://abc.feishu.cn/docx/xyz'))
})

// 编的示例记录，字段值形状照飞书 records/search 的返回
const fields = [
  { field_name: '公司', type: 1 },
  { field_name: '企业类型', type: 3 },
  { field_name: '工作地点', type: 4 },
  { field_name: '招聘岗位', type: 1 },
  { field_name: '批次', type: 3 },
  { field_name: '招聘届次', type: 4 },
  { field_name: '截止时间', type: 5 },
  { field_name: '更新时间', type: 1002 },
  { field_name: '简历投递链接', type: 15 },
  { field_name: '备注', type: 1 },
  { field_name: '行业类别', type: 20 },
  { field_name: '是否笔试', type: 7 },
  { field_name: '父记录', type: 18 },
]
const record = {
  record_id: 'rec1',
  fields: {
    公司: [{ type: 'text', text: '示例科技' }],
    企业类型: '私企',
    工作地点: ['北京', '上海'],
    招聘岗位: [{ type: 'text', text: '后端开发' }],
    批次: '秋招提前批',
    招聘届次: ['2027'],
    // 2026-11-30 00:00 北京时间
    截止时间: Date.UTC(2026, 10, 29, 16),
    // 2026-10-09 09:30 北京时间
    更新时间: Date.UTC(2026, 9, 9, 1, 30),
    简历投递链接: { text: '投递', link: 'https://jobs.example.com/apply' },
    备注: [{ type: 'text', text: '详见 ' }, { type: 'url', text: '公告', link: 'https://example.com/notice' }],
    行业类别: { type: 1, value: [{ type: 'text', text: '互联网' }] },
    是否笔试: true,
    父记录: { link_record_ids: ['recX'] },
  },
}

test('turns bitable field values into the same text cells as an export', () => {
  assert.deepEqual(recordToRow(record, fields), {
    公司: '示例科技',
    企业类型: '私企',
    工作地点: '北京,上海',
    招聘岗位: '后端开发',
    批次: '秋招提前批',
    招聘届次: '2027',
    截止时间: '2026-11-30',
    更新时间: '2026-10-09 09:30',
    简历投递链接: '投递 https://jobs.example.com/apply',
    备注: '详见 公告 https://example.com/notice',
    行业类别: '互联网',
    是否笔试: '是',
  })
  assert.deepEqual(recordToRow({ fields: {} }, fields.slice(0, 2)), { 公司: '', 企业类型: '' }, 'empty cells are kept as columns')
})

test('rows from the API map to jobs, keeping the link the Excel export drops', () => {
  const job = mapJobRow(recordToRow(record, fields), { category: '表名', source: 'S' })
  assert.equal(job.category, '秋招')
  assert.equal(job.company_type, '民企')
  assert.deepEqual(job.locations, ['北京', '上海'])
  assert.deepEqual(job.graduation_years, ['2027届'])
  assert.equal(job.deadline_date, '2026-11-30')
  assert.equal(job.source_updated_at, '2026-10-09')
  assert.equal(job.apply_url, 'https://jobs.example.com/apply')

  const instructions = recordToRow({ fields: { 公司: '⬆️如何筛选看上面教程', 备注: '👈编制招聘汇总表' } }, fields)
  assert.equal(mapJobRow(instructions, { category: '表名', source: 'S' }), null, 'how-to rows are skipped')
})

function fakeFetch(handlers) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    const handler = handlers.find(([re]) => re.test(url.pathname))
    const [status, body] = handler[1](url, calls.length)
    return { ok: status < 400, status, json: async () => body }
  }
  return { impl, calls }
}

test('client gets a token once, follows page tokens and retries rate limits', async () => {
  let searches = 0
  const { impl, calls } = fakeFetch([
    [/tenant_access_token/, () => [200, { code: 0, tenant_access_token: 't-123' }]],
    [/records\/search/, url => {
      searches++
      if (searches === 1) return [429, { code: 99991400, msg: 'too many requests' }]
      return url.searchParams.get('page_token')
        ? [200, { code: 0, data: { items: [{ record_id: 'r2' }], has_more: false } }]
        : [200, { code: 0, data: { items: [{ record_id: 'r1' }], has_more: true, page_token: 'p2' } }]
    }],
  ])
  const client = createBitableClient({ appId: 'a', appSecret: 's', fetchImpl: impl })
  // 重试等待 1s，测试里把 setTimeout 换成立即执行
  const realTimeout = globalThis.setTimeout
  globalThis.setTimeout = fn => realTimeout(fn, 0)
  try {
    const items = await client.listRecords('app', 'tbl')
    assert.deepEqual(items.map(i => i.record_id), ['r1', 'r2'])
  } finally {
    globalThis.setTimeout = realTimeout
  }
  assert.equal(calls.filter(c => /tenant_access_token/.test(c.url)).length, 1)
  const search = calls.filter(c => /records\/search/.test(c.url))
  assert.equal(search.length, 3)
  assert.equal(search[0].init.headers.Authorization, 'Bearer t-123')
  assert.equal(new URL(search[0].url).searchParams.get('page_size'), '500')
})

test('client surfaces Feishu error codes', async () => {
  const { impl } = fakeFetch([
    [/tenant_access_token/, () => [200, { code: 0, tenant_access_token: 't' }]],
    [/tables/, () => [403, { code: 91403, msg: 'Forbidden' }]],
  ])
  const client = createBitableClient({ appId: 'a', appSecret: 's', fetchImpl: impl })
  await assert.rejects(client.listTables('app'), /code 91403 Forbidden/)
})

/** 只实现 importJobTables 用到的那几个 supabase 链式调用 */
function fakeSupabase(existingKeys) {
  const writes = { upserted: [], deleted: [], deactivated: [] }
  const supabase = {
    from: table => ({
      delete: () => ({
        lt: async () => ({ count: 0, error: null }),
      }),
      select: () => {
        const chain = {
          eq: () => chain,
          order: () => chain,
          range: async () => ({ data: table === 'job_posting_sources' ? existingKeys.map(k => ({ source_key: k })) : [], error: null }),
        }
        return chain
      },
      upsert: async rows => { writes.upserted.push(...rows); return { error: null } },
    }),
    rpc: async (_name, args) => {
      const missing = existingKeys.filter(key => !args.p_source_keys.includes(key))
      writes.deactivated.push(...missing)
      return { data: missing.length, error: null }
    },
  }
  return { supabase, writes }
}

const quiet = () => {}

test('replace deactivates missing sources and closes orphaned jobs', async () => {
  const row = recordToRow(record, fields)
  const key = mapJobRow(row, { category: 'x', source: 'S' }).source_key
  const { supabase, writes } = fakeSupabase([key, 'old-1'])
  const result = await importJobTables([{ label: 't', rows: [row], fallback: 'x' }], { supabase, source: 'S', replace: true, minKeepRatio: 0.5, log: quiet })
  assert.deepEqual(result, { written: 1, deleted: 1 })
  assert.deepEqual(writes.deactivated, ['old-1'])
})

test('a suspiciously small sync writes nothing', async () => {
  const row = recordToRow(record, fields)
  const { supabase, writes } = fakeSupabase(['a', 'b', 'c', 'd'])
  await assert.rejects(
    importJobTables([{ label: 't', rows: [row], fallback: 'x' }], { supabase, source: 'S', replace: true, minKeepRatio: 0.5, log: quiet }),
    /少得不正常/,
  )
  assert.equal(writes.upserted.length, 0)
  assert.equal(writes.deleted.length, 0)
})

test('ATS API rows stay one job even when the title contains a comma', async () => {
  const { supabase, writes } = fakeSupabase([])
  const result = await importJobTables([{
    label: 'ATS',
    fallback: '其他',
    rows: [{
      公司: '示例科技',
      招聘岗位: '算法工程师,大模型方向',
      职位描述: '负责完整的算法研发与产品落地工作。',
      职位ID: 'ats-1',
      职位详情链接: 'https://jobs.example.com/job/ats-1',
    }],
  }], { supabase, source: 'ATS 公开招聘页', sourceType: 'ats', log: quiet })
  assert.equal(result.written, 1)
  assert.equal(writes.upserted.length, 1)
  assert.equal(writes.upserted[0].job_title, '算法工程师,大模型方向')
})

test('expired rows are not written back during a company sync', async () => {
  const { supabase, writes } = fakeSupabase([])
  const result = await importJobTables([{
    label: 'ATS',
    fallback: '其他',
    rows: [{
      公司: '示例科技',
      招聘岗位: '已截止工程师',
      截止时间: '2026-10-23',
      职位ID: 'expired-1',
      职位详情链接: 'https://jobs.example.com/job/expired-1',
    }],
  }], {
    supabase,
    source: 'ATS 公开招聘页',
    sourceType: 'ats',
    now: Date.UTC(2026, 9, 23, 16, 30),
    log: quiet,
  })
  assert.equal(result.written, 0)
  assert.equal(writes.upserted.length, 0)
})
