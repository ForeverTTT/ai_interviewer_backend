import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchKuaishouSocialSnapshot,
  kuaishouSocialJobToRow,
} from '../src/lib/kuaishouSocialJobImport.js'

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

test('快手社招签名接口在取得授权前禁止自动访问', async () => {
  await assert.rejects(
    fetchKuaishouSocialSnapshot(),
    /合规策略已禁止快手社招自动同步/,
  )
})
