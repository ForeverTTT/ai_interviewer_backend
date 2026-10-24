import test from 'node:test'
import assert from 'node:assert/strict'
import { legacyOnlyJobIds, orphanJobIds } from '../src/lib/legacyFeishuCleanup.js'

test('只删除没有官网或 ATS 活跃来源的飞书岗位', () => {
  assert.deepEqual(
    legacyOnlyJobIds(['a', 'b', 'b', 'c'], ['b', 'd']),
    ['a', 'c'],
  )
})

test('删除没有任何活跃来源的开放岗位', () => {
  assert.deepEqual(
    orphanJobIds(['a', 'b', 'b', 'c'], ['b', 'd']),
    ['a', 'c'],
  )
})
