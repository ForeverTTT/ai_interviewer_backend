import test from 'node:test'
import assert from 'node:assert/strict'

import {
  canonicalJobKey, normalizeCompanyName, normalizeJobUrl, splitJobTitles,
} from '../src/lib/jobIdentity.js'
import { mapJobRows } from '../src/lib/feishuImport.js'

test('normalizes tracking URLs and common Chinese company suffixes', () => {
  assert.equal(normalizeJobUrl('https://Jobs.Example.com/role/?utm_source=x&job=42#top'), 'https://jobs.example.com/role?job=42')
  assert.equal(normalizeCompanyName('示例科技有限公司'), '示例')
})

test('the same company-role-location deduplicates across Feishu and official sources', () => {
  const feishu = canonicalJobKey({ company: '示例科技有限公司', job_title: '后端开发', locations: ['北京市'] })
  const official = canonicalJobKey({ company: '示例', job_title: '后端 开发', locations: ['北京'] })
  assert.equal(feishu, official)
})

test('an explicit discriminator keeps separate official applications with the same title and city', () => {
  const graduate = canonicalJobKey({
    company: '腾讯', job_title: '后台开发', locations: ['深圳'], canonical_discriminator: 'tencent-campus:graduate-1',
  })
  const intern = canonicalJobKey({
    company: '腾讯', job_title: '后台开发', locations: ['深圳'], canonical_discriminator: 'tencent-campus:intern-1',
  })
  assert.notEqual(graduate, intern)
})

test('splits explicit role lists but keeps commas inside parentheses', () => {
  assert.deepEqual(splitJobTitles('算法工程师,产品经理\n用户研究员'), ['算法工程师', '产品经理', '用户研究员'])
  assert.deepEqual(splitJobTitles('产品经理（AIGC，电商）'), ['产品经理（AIGC，电商）'])
})

test('one Feishu company row becomes one record per role', () => {
  const jobs = mapJobRows({
    公司: '示例科技',
    招聘岗位: '算法工程师,产品经理',
    工作地点: '北京',
    投递链接: 'https://jobs.example.com/campus',
  }, { category: '秋招', source: '飞书求职汇总表' })
  assert.deepEqual(jobs.map(job => job.job_title), ['算法工程师', '产品经理'])
  assert.equal(new Set(jobs.map(job => job.external_key)).size, 2)
  assert.equal(new Set(jobs.map(job => job.source_key)).size, 2)
})
