import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyPositions, classifyIndustry, tagExperience, normalizeCompany, taxonomyOrder, INDUSTRIES,
} from '../src/lib/jobTaxonomy.js'

test('classifies positions into job functions by keyword', () => {
  assert.deepEqual(classifyPositions('算法工程师,产品经理,数据分析师'), ['tech', 'product', 'data'])
  assert.deepEqual(classifyPositions('游戏策划,发行运营,美术'), ['product', 'design', 'operations'])
  assert.deepEqual(classifyPositions('管培生,金融科技岗'), ['finance', 'trainee'])
  assert.deepEqual(classifyPositions('机器人算法研究员'), ['tech'], 'a research scientist is not a finance role')
  assert.deepEqual(classifyPositions('IC设计,版图设计'), ['tech'], 'chip design is not visual design')
  assert.deepEqual(classifyPositions('电子商务运营'), ['operations'], 'e-commerce is not electronics')
  assert.deepEqual(classifyPositions('产品实习'), ['product'])
  assert.deepEqual(classifyPositions('产品运营'), ['operations'])
  assert.deepEqual(classifyPositions('HR 招聘专员'), ['functions'])
  assert.deepEqual(classifyPositions('Clinical Logistics'), ['functions'], 'short keywords only match whole words')
  assert.deepEqual(classifyPositions('未告知岗位名'), ['other'])
  assert.deepEqual(classifyPositions(''), [])
})

test('classifies English and German position titles', () => {
  assert.deepEqual(classifyPositions('Werkstudent Software Engineering'), ['tech'])
  assert.deepEqual(classifyPositions('Product Owner Intern'), ['product'])
  assert.deepEqual(classifyPositions('Praktikum Vertrieb'), ['marketing'])
  assert.deepEqual(classifyPositions('Werkstudent Controlling'), ['finance'])
})

test('classifies industries from industry text and company names', () => {
  assert.deepEqual(classifyIndustry(['IT/互联网/游戏'], '示例科技', '互联网'), ['internet'])
  assert.deepEqual(classifyIndustry(['电子/通信/半导体', 'IT/互联网/游戏']), ['internet', 'semiconductor'])
  assert.deepEqual(classifyIndustry([], '比亚迪', '央国企'), ['auto'])
  assert.deepEqual(classifyIndustry('BMW Group'), ['auto'])
  assert.deepEqual(classifyIndustry('Robert Bosch GmbH'), ['auto'])
  assert.deepEqual(classifyIndustry('Siemens AG'), ['manufacturing'])
  assert.deepEqual(classifyIndustry('字节跳动'), ['internet'])
  assert.deepEqual(classifyIndustry('McKinsey & Company'), ['consulting'])
  assert.deepEqual(classifyIndustry('Sapporo Brewery'), ['other'], 'SAP only matches as a whole word')
  assert.deepEqual(classifyIndustry('无名公司'), ['other'])
  assert.deepEqual(classifyIndustry(''), [])
})

test('tags experiences, preferring the job board industry for a known company', () => {
  const known = new Map([[normalizeCompany('示例 科技'), ['auto']]])
  const tagged = tagExperience({ company: '示例科技', position: 'Werkstudent Data Analytics' }, known)
  assert.deepEqual(tagged.industry_keys, ['auto'])
  assert.deepEqual(tagged.job_functions, ['data'])
  assert.deepEqual(tagExperience({ company: 'Mercedes-Benz', position: 'PM' }).industry_keys, ['auto'])
})

test('orders facets by rule order with other last', () => {
  const sorted = [{ value: 'other' }, { value: 'finance' }, { value: 'internet' }].sort(taxonomyOrder(INDUSTRIES))
  assert.deepEqual(sorted.map(x => x.value), ['internet', 'finance', 'other'])
})
