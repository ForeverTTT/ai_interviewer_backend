import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseRegistryCompanyName, classifyRecruitmentUrl, repairRecruitmentUrl, sourceRegistryRow } from '../src/lib/companySourceDiscovery.js'

test('classifies public recruitment platforms without treating discovery links as crawlable', () => {
  assert.equal(classifyRecruitmentUrl('https://app.mokahr.com/campus-recruitment/acme/123#/jobs').adapter, 'moka-public')
  assert.equal(classifyRecruitmentUrl('https://wecruit.hotjob.cn/SU123/pb/school.html').platform, 'hotjob')
  assert.equal(classifyRecruitmentUrl('https://wecruit.hotjob.cn/SU123/pb/school.html').status, 'active')
  assert.equal(classifyRecruitmentUrl('https://legacy.hotjob.cn/').status, 'pending')
  assert.equal(classifyRecruitmentUrl('https://sensetime.jobs.feishu.cn/exp/position').adapter, 'feishu-career')
  assert.equal(classifyRecruitmentUrl('https://iflytek.zhiye.com/campus/jobs').adapter, 'zhiye-auto')
  assert.equal(classifyRecruitmentUrl('https://mp.weixin.qq.com/s/x').status, 'fallback')
  assert.equal(classifyRecruitmentUrl('https://jobs.example.com/careers').platform, 'official_candidate')
})

test('keeps campus and social snapshots separate on shared ATS domains', () => {
  const campus = sourceRegistryRow({ companyName: '示例科技', sourceUrl: 'https://example.jobs.feishu.cn/campus/position' })
  const social = sourceRegistryRow({ companyName: '示例科技', sourceUrl: 'https://example.jobs.feishu.cn/exp/position' })
  assert.notEqual(campus.source_key, social.source_key)

  const zhiyeCampus = sourceRegistryRow({ companyName: '示例科技', sourceUrl: 'https://example.zhiye.com/campus/jobs' })
  const zhiyeSocial = sourceRegistryRow({ companyName: '示例科技', sourceUrl: 'https://example.zhiye.com/social/jobs' })
  assert.notEqual(zhiyeCampus.source_key, zhiyeSocial.source_key)
})

test('repairs malformed currentPage links and creates stable registry identities', () => {
  assert.equal(repairRecruitmentUrl('https://x.test/jobs?project=1¤tPage=2'), 'https://x.test/jobs?project=1&currentPage=2')
  const first = sourceRegistryRow({ companyName: '示例科技有限公司', sourceUrl: 'https://jobs.example.com/?utm_source=x' })
  const second = sourceRegistryRow({ companyName: '示例科技', sourceUrl: 'https://jobs.example.com/' })
  assert.equal(first.source_key, second.source_key)
})

test('deduplicates public ATS tenants across company aliases and keeps a clean group name', () => {
  const first = sourceRegistryRow({ companyName: 'FILA', sourceUrl: 'https://app.mokahr.com/campus-recruitment/antahr/142914#/jobs' })
  const second = sourceRegistryRow({ companyName: '安踏集团', sourceUrl: 'https://app.mokahr.com/campus-recruitment/antahr/142914#/job/123' })
  assert.equal(first.source_key, second.source_key)
  assert.equal(chooseRegistryCompanyName(['德州仪器-补录', '德州仪器', '德州仪器-补招专场']), '德州仪器')
  assert.equal(chooseRegistryCompanyName(['安踏集团', '安踏零售', 'FILA', '可隆(KOLON SPORT)']), '安踏集团')
})
