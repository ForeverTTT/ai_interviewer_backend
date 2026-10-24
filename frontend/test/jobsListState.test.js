import test from 'node:test'
import assert from 'node:assert/strict'
import { createJobsListSearch, parseJobsListState } from '../src/lib/jobsListState.js'

test('岗位列表状态可通过 URL 完整恢复', () => {
  const state = {
    search: '地平线',
    filters: {
      category: '实习',
      industry: ['互联网/科技'],
      fn: ['技术', '产品'],
      companyType: ['民企'],
      year: ['2027届'],
      city: ['北京市', '上海市'],
      open: false,
      sort: 'deadline_asc',
    },
    view: 'list',
    page: 3,
  }
  const query = createJobsListSearch(state)
  assert.deepEqual(parseJobsListState(query), state)
})

test('岗位列表 URL 对异常值使用安全默认值', () => {
  const state = parseJobsListState('?sort=unknown&view=table&page=9999', 'list')
  assert.equal(state.filters.sort, 'updated')
  assert.equal(state.filters.open, true)
  assert.equal(state.view, 'list')
  assert.equal(state.page, 50)
})
