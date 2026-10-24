import test from 'node:test'
import assert from 'node:assert/strict'
import { syncCompanyJobSources } from '../src/lib/companyJobSync.js'

const source = { id: 'example', name: '示例招聘官网', adapter: 'fake', enabled: true }

test('完整企业快照才会触发 replace 下架逻辑', async () => {
  const calls = []
  const results = await syncCompanyJobSources([source], {
    adapters: { fake: async () => ({ rows: [{ 公司: '示例', 招聘岗位: '工程师' }], complete: true }) },
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
    { ...source, id: 'healthy', name: '正常招聘官网', adapter: 'healthy' },
  ], {
    adapters: {
      fake: async () => ({ rows: [{ 公司: '示例', 招聘岗位: '工程师' }], complete: false }),
      healthy: async () => ({ rows: [{ 公司: '正常', 招聘岗位: '设计师' }], complete: true }),
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
    adapters: { fake: async () => ({
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
