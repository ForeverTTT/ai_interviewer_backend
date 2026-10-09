import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCsv, splitMulti, parseDate, mapJobRow, unmappedHeaders,
  mapExperienceCsvRows, mapExperienceJson, experienceType, classifyPositions,
} from '../src/lib/feishuImport.js'
import { jobQuerySchema, sanitizeSearch } from '../src/routes/jobs.js'

const JOB_CSV = '﻿更新时间,公司,企业类型,招聘届次,行业类别,招聘岗位,工作地点,截止时间,学历要求,投递链接,备注,是否笔试,是否笔试 (1),神秘列\r\n'
  + '2026/10/08,示例科技,民企,"2027届,2026届",IT/互联网/游戏,"算法工程师,产品经理","北京,上海,北京",2026/11/15,"本科,硕士",官网 https://jobs.example.com/a?x=1,/,,有笔试,x\r\n'
  + '2026/10/05,,民企,2027届,,,,尽快投递,,,,,,\r\n'
  + '2026/10/05,另一家,"央国企",2027届,,"岗位A\n岗位B",深圳,尽快投递,,,,含免笔试,,\r\n'

test('parses Feishu CSV with BOM, quoted commas and embedded newlines', () => {
  const rows = parseCsv(JOB_CSV)
  assert.equal(rows.length, 3)
  assert.equal(rows[0]['公司'], '示例科技')
  assert.equal(rows[0]['招聘届次'], '2027届,2026届')
  assert.equal(rows[2]['招聘岗位'], '岗位A\n岗位B')
})

test('splits multi-select cells and drops placeholders and duplicates', () => {
  assert.deepEqual(splitMulti('北京,上海，北京、 深圳'), ['北京', '上海', '深圳'])
  assert.deepEqual(splitMulti('/'), [])
  assert.deepEqual(splitMulti(''), [])
})

test('parses dates in Feishu formats and ignores free text', () => {
  assert.equal(parseDate('2026/10/08'), '2026-10-08')
  assert.equal(parseDate('2026-1-5 12:00'), '2026-01-05')
  assert.equal(parseDate('2026年11月30日'), '2026-11-30')
  assert.equal(parseDate('尽快投递'), null)
  assert.equal(parseDate('招满为止'), null)
})

test('maps a job row to a stable record and skips rows without a company', () => {
  const rows = parseCsv(JOB_CSV)
  const job = mapJobRow(rows[0], { category: '互联网', source: 'S' })
  assert.equal(job.company, '示例科技')
  assert.deepEqual(job.graduation_years, ['2027届', '2026届'])
  assert.deepEqual(job.locations, ['北京', '上海'])
  assert.deepEqual(job.job_functions, ['tech', 'product'])
  assert.equal(job.deadline_date, '2026-11-15')
  assert.equal(job.apply_url, 'https://jobs.example.com/a?x=1')
  assert.equal(job.notes, null, '"/" means empty')
  assert.equal(job.written_test, '有笔试', 'falls through to the duplicated column')
  assert.equal(job.source_updated_at, '2026-10-08')
  assert.equal(job.external_key, mapJobRow(rows[0], { category: '互联网', source: 'S' }).external_key)
  assert.notEqual(job.external_key, mapJobRow(rows[0], { category: '外企', source: 'S' }).external_key)

  assert.equal(mapJobRow(rows[1], { category: '互联网', source: 'S' }), null)
  assert.equal(mapJobRow(rows[2], { category: '互联网', source: 'S' }).deadline_date, null)
  assert.deepEqual(unmappedHeaders(rows[0]), ['神秘列'])
})

test('groups experience CSV rounds by company, position and date', () => {
  const csv = '公司,岗位,日期,轮次,面试形式,时长,面试题,心得\n'
    + '甲公司,后端,2026-09,2,技术二面,45,"1. 讲讲项目\n2. 手写 LRU",\n'
    + '甲公司,后端,2026-09,1,技术一面,30,自我介绍;为什么选我们,准备充分\n'
    + '乙公司,产品,2026/08/03,1,群面,,,\n'
  const [a, b] = mapExperienceCsvRows(parseCsv(csv), { source: '来源' })
  assert.equal(a.company, '甲公司')
  assert.equal(a.date, '2026-09')
  assert.equal(a.user_id, null)
  assert.equal(a.type, 'campus')
  assert.equal(a.visibility, 'public')
  assert.equal(a.review_status, 'approved')
  assert.equal(a.reward_granted, true)
  assert.equal(a.rounds[0].answers, undefined, 'no answers column means no answers array')
  assert.equal(a.publisher, '来源')
  assert.equal(a.reflection, '准备充分')
  assert.deepEqual(a.rounds.map(r => r.format), ['技术一面', '技术二面'])
  assert.deepEqual(a.rounds[0].questions, ['自我介绍', '为什么选我们'])
  assert.deepEqual(a.rounds[1].questions, ['讲讲项目', '手写 LRU'])
  assert.equal(a.rounds[1].duration_min, 45)
  assert.equal(b.date, '2026-08')
  assert.equal(b.rounds[0].duration_min, null)
})

test('normalizes experience JSON and truncates to schema limits', () => {
  const [exp] = mapExperienceJson([
    { company: 'X'.repeat(150), position: 'PM', date: '2026-07', type: '暑期实习', rounds: [{ format: 'HR', questions: ['Q1', '', 'Q3'], answers: ['A1', 'orphan', ''] }] },
    { position: 'no company' },
  ], { source: 'S' })
  assert.equal(exp.company.length, 100)
  assert.equal(exp.type, 'internship')
  assert.deepEqual(exp.rounds[0].questions, ['Q1', 'Q3'])
  assert.deepEqual(exp.rounds[0].answers, ['A1', ''], 'answers stay aligned with kept questions')
  assert.throws(() => mapExperienceJson({}, { source: 'S' }))
})

test('job query schema applies defaults and bounds', () => {
  const q = jobQuerySchema.parse({})
  assert.equal(q.page, 1)
  assert.equal(q.open, 'true')
  assert.equal(jobQuerySchema.safeParse({ pageSize: '500' }).success, false)
  assert.equal(sanitizeSearch('a,b(c)*%'), 'a b c')
})

test('maps free-text experience types onto internship / campus / experienced', () => {
  assert.equal(experienceType('日常实习'), 'internship')
  assert.equal(experienceType('社招'), 'experienced')
  assert.equal(experienceType('秋招'), 'campus')
  assert.equal(experienceType(undefined), 'campus')
})

test('classifies positions into job functions by keyword', () => {
  assert.deepEqual(classifyPositions('算法工程师,产品经理,数据分析师'), ['tech', 'product', 'data'])
  assert.deepEqual(classifyPositions('游戏策划,发行运营,美术'), ['product', 'design', 'operations'])
  assert.deepEqual(classifyPositions('管培生,金融科技岗'), ['finance', 'trainee'])
  assert.deepEqual(classifyPositions('机器人算法研究员'), ['tech'], 'a research scientist is not a finance role')
  assert.deepEqual(classifyPositions('IC设计,版图设计'), ['tech'], 'chip design is not visual design')
  assert.deepEqual(classifyPositions('HR 招聘专员'), ['functions'])
  assert.deepEqual(classifyPositions('Clinical Logistics'), ['other'], 'short keywords only match whole words')
  assert.deepEqual(classifyPositions('未告知岗位名'), ['other'])
  assert.deepEqual(classifyPositions(''), [])
})
