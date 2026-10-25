import test from 'node:test'
import assert from 'node:assert/strict'
import { syncCompanyJobSources } from '../src/lib/companyJobSync.js'

const source = { id: 'example', name: '示例招聘官网', adapter: 'jsonld-crawl', enabled: true }

test('完整企业快照才会触发 replace 下架逻辑', async () => {
  const calls = []
  const results = await syncCompanyJobSources([source], {
    adapters: { 'jsonld-crawl': async () => ({ rows: [{ 公司: '示例', 招聘岗位: '工程师' }], complete: true }) },
    importer: async (_tables, options) => {
      calls.push(options)
      return { written: 1, deleted: 0 }
    },
    log: () => {},
  })
  assert.equal(results[0].ok, true)
  assert.equal(calls[0].replace, true)
  assert.equal(calls[0].requiredMissingRuns, 2)
})

test('不完整快照不写库，且不影响其他企业来源', async () => {
  let writes = 0
  const results = await syncCompanyJobSources([
    source,
    { ...source, id: 'healthy', name: '正常招聘官网', adapter: 'moka-public' },
  ], {
    adapters: {
      'jsonld-crawl': async () => ({ rows: [{ 公司: '示例', 招聘岗位: '工程师' }], complete: false }),
      'moka-public': async () => ({ rows: [{ 公司: '正常', 招聘岗位: '设计师' }], complete: true }),
    },
    importer: async () => {
      writes++
      return { written: 1, deleted: 0 }
    },
    log: () => {},
  })
  assert.deepEqual(results.map(result => result.ok), [false, true])
  assert.equal(writes, 1)
})

test('官网明确标记不可投递时允许空快照并立即下架', async () => {
  const calls = []
  const results = await syncCompanyJobSources([source], {
    adapters: { 'jsonld-crawl': async () => ({
      rows: [],
      complete: true,
      authoritativeEmpty: true,
      deactivateMissingImmediately: true,
      diagnostics: { unavailable: 28 },
    }) },
    importer: async (_tables, options) => {
      calls.push(options)
      return { written: 0, deleted: 28 }
    },
    log: () => {},
  })
  assert.equal(results[0].ok, true)
  assert.equal(calls[0].replace, true)
  assert.equal(calls[0].minKeepRatio, 0)
  assert.equal(calls[0].requiredMissingRuns, 1)
})

test('合规门禁在网络请求前阻止受限适配器', async () => {
  let requested = false
  const results = await syncCompanyJobSources([{
    id: 'kuaishou-experienced',
    name: '快手招聘官网 · 社招',
    adapter: 'kuaishou-social',
    enabled: true,
  }], {
    adapters: { 'kuaishou-social': async () => {
      requested = true
      return { rows: [], complete: true }
    } },
    importer: async () => ({ written: 0, deleted: 0 }),
    log: () => {},
  })
  assert.equal(requested, false)
  assert.equal(results[0].ok, false)
  assert.match(results[0].error, /合规策略已禁止自动访问/)
})

test('新适配器默认等待审核，不能直接进入自动任务', async () => {
  let requested = false
  const results = await syncCompanyJobSources([{
    id: 'new-source',
    name: '尚未审核的招聘来源',
    adapter: 'new-adapter',
    enabled: true,
  }], {
    adapters: { 'new-adapter': async () => {
      requested = true
      return { rows: [], complete: true }
    } },
    importer: async () => ({ written: 0, deleted: 0 }),
    log: () => {},
  })
  assert.equal(requested, false)
  assert.equal(results[0].ok, false)
  assert.match(results[0].error, /新适配器 new-adapter 尚未完成自动访问审核/)
})
