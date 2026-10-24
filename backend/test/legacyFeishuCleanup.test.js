import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanupLegacyFeishuJobs, legacyOnlyJobIds } from '../src/lib/legacyFeishuCleanup.js'

test('只删除没有官网或 ATS 活跃来源的飞书岗位', () => {
  assert.deepEqual(
    legacyOnlyJobIds(['a', 'b', 'b', 'c'], ['b', 'd']),
    ['a', 'c'],
  )
})

test('飞书主记录已经清空时立即退出，不再扫描全部来源', async () => {
  const tables = []
  const emptyQuery = {
    select() { return this },
    order() { return this },
    range() { return this },
    eq() { return this },
    then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve) },
  }
  const result = await cleanupLegacyFeishuJobs({
    supabase: { from(table) { tables.push(table); return emptyQuery } },
    log() {},
  })
  assert.deepEqual(tables, ['job_postings'])
  assert.deepEqual(result, { deleted: 0, candidates: 0, preserved: 0, deactivated: 0 })
})
