import test from 'node:test'
import assert from 'node:assert/strict'

import { buildJobFacets } from '../src/lib/jobFacets.js'

function pagedDatabase(pages) {
  const cursors = []
  let pageIndex = 0

  return {
    cursors,
    from(table) {
      assert.equal(table, 'job_postings')
      const query = {
        select() { return this },
        eq() { return this },
        not() { return this },
        or() { return this },
        order() { return this },
        limit() { return this },
        gt(column, value) {
          assert.equal(column, 'id')
          cursors.push(value)
          return this
        },
        then(resolve, reject) {
          return Promise.resolve({ data: pages[pageIndex++] || [], error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

test('buildJobFacets scans large job sets with an id cursor instead of growing offsets', async () => {
  const db = pagedDatabase([
    [
      { id: 'a', category: '校招', company_type: '民企', job_functions: ['技术'], industry_keys: ['互联网/科技'], graduation_years: ['2027届'], locations: ['北京'], sort_date: '2026-10-20' },
      { id: 'b', category: '实习', company_type: '外企', job_functions: ['产品'], industry_keys: ['互联网/科技'], graduation_years: ['不限届'], locations: ['上海'], sort_date: '2026-10-22' },
    ],
    [
      { id: 'c', category: '校招', company_type: '民企', job_functions: ['技术'], industry_keys: ['人工智能'], graduation_years: ['2027届'], locations: ['北京'], sort_date: '2026-10-21' },
    ],
  ])

  const result = await buildJobFacets(db, {
    now: Date.UTC(2026, 9, 25),
    pageSize: 2,
  })

  assert.deepEqual(db.cursors, ['b'])
  assert.equal(result.total, 3)
  assert.equal(result.lastUpdated, '2026-10-22')
  assert.deepEqual(result.categories, [
    { value: '校招', count: 2 },
    { value: '实习', count: 1 },
  ])
  assert.deepEqual(result.cities, [
    { value: '北京', count: 2 },
    { value: '上海', count: 1 },
  ])
})
