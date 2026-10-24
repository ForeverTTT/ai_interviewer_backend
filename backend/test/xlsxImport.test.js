import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { readXlsx } from '../src/lib/xlsx.js'
import {
  mapJobRow, parseDate, normalizeBatch, normalizeCompanyType, normalizeGraduationYears, withoutBoilerplate,
} from '../src/lib/feishuImport.js'
import { statusForDeadline } from '../src/lib/jobImport.js'
import { isJobExpired, openFilter } from '../src/routes/jobs.js'

// 编的示例数据，生成方式见 fixture 里的说明（共享字符串、内联富文本、日期序列号、重名表头、说明行 …）
const sheets = readXlsx(readFileSync(new URL('./fixtures/jobs-sample.xlsx', import.meta.url)))
const [jobsSheet, otherSheet] = sheets
const jobs = jobsSheet.rows.map(row => mapJobRow(row, { category: jobsSheet.name, source: 'S' }))

test('reads every sheet with headers, shared / inline / rich strings and escapes', () => {
  assert.deepEqual(sheets.map(s => s.name), ['校招汇总表', '内推码 & 其他'])
  assert.equal(jobsSheet.rows.length, 5)
  assert.equal(jobsSheet.rows[0]['公司'], '示例科技')
  assert.equal(jobsSheet.rows[0]['更新时间'], '46000')
  assert.equal(jobsSheet.rows[0]['是否笔试 (2)'], '有笔试', 'repeated headers get a suffix')
  assert.equal(jobsSheet.rows[1]['公告链接'], '', 'missing cells read as empty')
  assert.equal(jobsSheet.rows[2]['公司'], '样例电网', 'rich text runs are joined')
  assert.equal(jobsSheet.rows[4]['公司'], 'A&B Consulting <GmbH>')
  assert.deepEqual(otherSheet.rows, [{ 企业名称: '示例科技', 内推码: 'ABC123' }], 'stored (uncompressed) entries work')
})

test('maps Feishu workbook rows: batches, dates, links, normalised types and years', () => {
  const [a, b, c, instructions, d] = jobs
  assert.equal(instructions, null, 'instruction rows are skipped')

  assert.equal(a.category, '秋招')
  assert.equal(a.source_updated_at, '2025-12-09')
  assert.deepEqual(a.graduation_years, ['2027届'])
  assert.equal(a.apply_url, 'https://example.com/apply')
  assert.equal(a.written_test, '有笔试')
  assert.deepEqual(a.industry_keys, ['internet'])
  assert.notEqual(a.external_key, b.external_key, 'same portal, different class year stays two postings')

  assert.equal(c.category, '实习')
  assert.equal(c.company_type, '其他', 'a company name in the company type column becomes 其他')
  assert.equal(c.apply_url, 'https://example.com/grid', 'falls back to the announcement link')
  assert.equal(c.notes, '投递方式：邮箱投递 hr@example.com')
  assert.deepEqual(c.industry_keys, ['energy'])

  assert.equal(d.category, '其他', 'an empty batch in a sheet with a batch column is 其他')
  assert.equal(d.company_type, '外企/合资')
  assert.deepEqual(d.industry_keys, ['consulting'])
  assert.equal(d.apply_url, 'https://example.com/ab?x=1&y=2')
})

test('normalisers', () => {
  assert.equal(parseDate('46000'), '2025-12-09')
  assert.equal(parseDate('12'), null)
  assert.equal(parseDate('99999'), null, 'serials outside a sane range are ignored')
  assert.equal(parseDate('2026/4/31'), null, 'impossible calendar dates are rejected, not rolled over')
  assert.equal(parseDate('2027/2/29'), null)
  assert.equal(parseDate('2028/2/29'), '2028-02-29')
  assert.deepEqual(['秋招补录', '春招专场', '暑期实习', '社招', '春招补录/秋招提前批', '夏招', ''].map(normalizeBatch),
    ['秋招', '春招', '实习', '社招', '春招', '其他', null])
  assert.deepEqual(['国企', '私企', '中外合资', '政府机关', '社会机构', '银行', ''].map(normalizeCompanyType),
    ['央国企', '民企', '外企/合资', '事业单位', '社会组织', '银行', null])
  assert.deepEqual(normalizeGraduationYears('2026,2026届,不限届'), ['2026届', '不限届'])
  assert.deepEqual(normalizeGraduationYears('25届-26届-27届'), ['2025届', '2026届', '2027届'])
  assert.deepEqual(normalizeGraduationYears('26届（留）-27届,28届优先'), ['2026届', '2027届', '2028届'])
  assert.deepEqual(normalizeGraduationYears('2届-29届'), ['2029届'])
  assert.deepEqual(normalizeGraduationYears('海外往届,部分往届'), ['往届'])
  assert.deepEqual(normalizeGraduationYears('4,本科在读'), [])
})

test('drops the source author boilerplate and placeholder apply text', () => {
  assert.equal(withoutBoilerplate('按照岗位筛选，不清楚专业对应岗位的看必看文档的第八点哦 宝宝~'), null)
  assert.equal(withoutBoilerplate('计算机、电子信息类；按照岗位筛选，不清楚专业对应岗位的看必看文档的第八点哦 宝宝~'), '计算机、电子信息类')
  assert.equal(withoutBoilerplate('金融学、会计学'), '金融学、会计学')

  const base = { 公司: '示例科技', 招聘岗位: '产品经理', 公告链接: 'https://example.com/n' }
  assert.equal(mapJobRow({ ...base, 简历投递链接: '投递' }, { category: 'x', source: 'S' }).notes, null)
  assert.equal(mapJobRow({ ...base, 简历投递链接: '投递邮箱：hr@example.com' }, { category: 'x', source: 'S' }).notes, '投递方式：投递邮箱：hr@example.com')
  assert.equal(mapJobRow({ ...base, 专业要求: '按照岗位筛选，不清楚专业对应岗位的看必看文档的第八点哦 宝宝~' }, { category: 'x', source: 'S' }).major_requirement, null)
})

test('open filter treats undated postings as closed after six months without updates', () => {
  const now = Date.UTC(2026, 9, 10)
  assert.equal(
    openFilter(now),
    'deadline_date.gte.2026-10-10,and(deadline_date.is.null,or(source_updated_at.is.null,source_updated_at.gte.2026-04-13))',
  )
})

test('expired jobs use the parsed deadline date', () => {
  const now = Date.UTC(2026, 9, 24, 12)
  assert.equal(isJobExpired({ deadline_date: '2026-10-23' }, now), true)
  assert.equal(isJobExpired({ deadline_date: '2026-10-24' }, now), false)
  assert.equal(isJobExpired({ deadline_date: null }, now), false)
  assert.equal(statusForDeadline('2026-10-23', now), 'closed')
  assert.equal(statusForDeadline('2026-10-24', now), 'open')
})

test('expiry switches at midnight in mainland China', () => {
  const afterChinaMidnight = Date.UTC(2026, 9, 23, 16, 30)
  assert.equal(isJobExpired({ deadline_date: '2026-10-23' }, afterChinaMidnight), true)
  assert.equal(isJobExpired({ deadline_date: '2026-10-24' }, afterChinaMidnight), false)
  assert.match(openFilter(afterChinaMidnight), /^deadline_date\.gte\.2026-10-24,/)
})
