import { createHash } from 'node:crypto'
import { classifyPositions, classifyIndustry } from './jobTaxonomy.js'

/**
 * 飞书多维表格导出 CSV → 数据库行。
 *
 * 飞书导出的 CSV 带 BOM，多选字段是「北京,上海」这样用逗号拼在一个格子里，
 * 超链接字段可能是「文字 + URL」混在一起，所以这里统一做清洗。
 * 表头允许有多种叫法（不同 tab 的列名不完全一致），见 JOB_FIELD_ALIASES。
 */

export function parseCsv(text) {
  const src = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') inQuotes = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }

  const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''))
  if (!nonEmpty.length) return []
  const headers = nonEmpty[0].map(h => h.trim())
  return nonEmpty.slice(1).map(r => Object.fromEntries(headers.map((h, idx) => [h, (r[idx] ?? '').trim()])))
}

export function splitMulti(value) {
  if (!value) return []
  return [...new Set(
    String(value)
      .split(/[,，、;；\n]/)
      .map(s => s.trim())
      .filter(s => s && s !== '/')
  )]
}

/**
 * '2026/10/08'、'2026-10-08 12:00'、'2026年10月8日' → '2026-10-08'；'尽快投递' 之类返回 null。
 * Excel 导出的日期是序列号（1900 日期系统，46000 ≈ 2025-12），也认。
 */
export function parseDate(value) {
  const text = String(value || '').trim()
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const serial = Math.floor(Number(text))
    if (serial < 30000 || serial > 80000) return null
    // Excel 序列号 1 = 1900-01-01，且把 1900 年当闰年，所以从 1899-12-30 起算
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
  }
  const m = text.match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/)
  if (!m) return null
  const [y, mo, d] = m.slice(1).map(Number)
  // 表里有「2026/4/31」这种不存在的日期；JS 会顺延成 5 月 1 日，数据库会直接报错，所以严格校验
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

export function extractUrl(value) {
  const m = String(value || '').match(/https?:\/\/[^\s"'<>，,]+/)
  return m ? m[0] : null
}

function clean(value) {
  const v = String(value ?? '').trim()
  return v && v !== '/' ? v : null
}

function stableKey(...parts) {
  return createHash('sha1').update(parts.map(p => p ?? '').join('|')).digest('hex')
}

// 没写截止日期（招满为止 / 尽快投递）的岗位，超过这么多天没更新就当作已经结束（「只看未截止」）
export const STALE_AFTER_DAYS = 180

export const JOB_FIELD_ALIASES = {
  company: ['公司', '公司名称', '企业名称', '企业'],
  company_type: ['企业类型', '公司类型', '企业性质'],
  graduation_years: ['招聘届次', '届次', '面向届别'],
  industries: ['行业类别', '行业', '所属行业'],
  positions: ['招聘岗位', '岗位', '岗位名称', '职位'],
  locations: ['工作地点', '地点', '城市', '工作城市'],
  deadline: ['截止时间', '截止日期', '投递截止'],
  education: ['学历要求', '学历'],
  major_requirement: ['专业要求', '专业'],
  written_test: ['是否笔试', '笔试'],
  apply_url: ['简历投递链接', '投递链接', '网申链接', '投递方式', '投递入口', '网申地址', '官网链接', '链接'],
  announcement_url: ['公告链接', '公告'],
  batch: ['批次', '招聘批次', '招聘类型'],
  notes: ['备注', '说明'],
  start_date: ['开始时间', '开始日期', '发布时间'],
  source_updated_at: ['更新时间', '更新日期'],
}

/** 按别名取列；同名列（飞书会导出「是否笔试 (1)」这种）取第一个非空的 */
function pick(row, aliases) {
  for (const alias of aliases) {
    for (const key of Object.keys(row)) {
      if (key === alias || key.replace(/\s*\(\d+\)$/, '') === alias) {
        const v = clean(row[key])
        if (v) return v
      }
    }
  }
  return null
}

/**
 * 「批次」归并成页面顶部的分类：秋招提前批 / 秋招补录 → 秋招，寒假实习 → 实习 …
 * 一格里有多个批次时取第一个能认出的；认不出的（夏招、校园招聘 …）归「其他」。
 */
export function normalizeBatch(value) {
  const text = String(value || '')
  for (const part of text.split(/[/,，、]/)) {
    if (/实习/.test(part)) return '实习'
    if (/社招/.test(part)) return '社招'
    if (/秋招/.test(part)) return '秋招'
    if (/春招/.test(part)) return '春招'
  }
  return clean(text) ? '其他' : null
}

const COMPANY_TYPE_ALIASES = [
  [/^(国企|央企|央国企)$/, '央国企'],
  [/^(私企|民营|民企)$/, '民企'],
  [/^(外企|外资|合资|中外合资|外企\/合资)$/, '外企/合资'],
  [/^(事业单位|政府机关|机关)$/, '事业单位'],
  [/^(社会组织|社会机构|非营利)$/, '社会组织'],
  [/^(银行)$/, '银行'],
  [/^(其他)$/, '其他'],
]

/** 企业类型统一写法；认不出的（偶尔有人把公司名填进了这一列）归「其他」 */
export function normalizeCompanyType(value) {
  const parts = splitMulti(value)
  if (!parts.length) return null
  for (const part of parts) {
    const hit = COMPANY_TYPE_ALIASES.find(([re]) => re.test(part))
    if (hit) return hit[1]
  }
  return '其他'
}

/** '2026' → '2026届'，其他（海外往届、不限届 …）原样 */
export function normalizeGraduationYears(value) {
  return [...new Set(splitMulti(value).map(y => (/^\d{4}$/.test(y) ? `${y}届` : y)))]
}

/**
 * 企业分类先只看「行业类别」；行业列为空或认不出（国企、外企、其他 …）时，
 * 再用公司名和分类名猜。两者一起看会让「某某电子科技」之类同时挂好几个分类。
 */
function industryKeysFor(industries, company, category) {
  const fromIndustry = classifyIndustry(industries)
  if (fromIndustry.length && !(fromIndustry.length === 1 && fromIndustry[0] === 'other')) return fromIndustry
  return classifyIndustry(company, category)
}

/**
 * 原表作者写给飞书读者的套话（「按照岗位筛选，不清楚专业对应岗位的看必看文档的第八点哦 宝宝~」之类），
 * 指向我们站里没有的文档，导入时去掉。整格都是套话就返回 null。
 */
// 从套话开头一直删到句末（。！或换行），中间的逗号、「宝宝~」一起去掉
const BOILERPLATE = [/按照岗位筛选[^。！!\n]*[。！!~～]*/g, /[^，,。；;\n]*必看文档[^。！!\n]*[。！!~～]*/g]

export function withoutBoilerplate(value) {
  if (!value) return null
  let text = String(value)
  for (const re of BOILERPLATE) text = text.replace(re, '')
  return clean(text.replace(/^[\s,，;；、·]+|[\s,，;；、·]+$/g, ''))
}

/** 表格里的使用说明行（「👈先看使用说明」之类）不是招聘 */
function isInstructionRow(row) {
  return Object.values(row).some(v => /使用说明|使用指南/.test(String(v || '')))
}

export function mapJobRow(row, { category: fallbackCategory, source }) {
  const company = pick(row, JOB_FIELD_ALIASES.company)
  if (!company || isInstructionRow(row)) return null

  const positions = pick(row, JOB_FIELD_ALIASES.positions)
  const applyText = pick(row, JOB_FIELD_ALIASES.apply_url)
  // 投递链接没有网址（邮箱投递、见公告 …）时用公告链接，再不行找第一个像网址的格子
  let applyUrl = extractUrl(applyText) || extractUrl(pick(row, JOB_FIELD_ALIASES.announcement_url))
  if (!applyUrl) {
    for (const v of Object.values(row)) {
      applyUrl = extractUrl(v)
      if (applyUrl) break
    }
  }
  // 投递一栏没网址时，只有写了邮箱 / 微信这类具体方式才值得放进备注；
  // 单个「投递」是飞书里的链接文字，导出成 Excel 后网址丢了，留着没意义
  const applyNote = applyText && !extractUrl(applyText) && /@|邮箱|邮件|微信|电话|现场|线下/.test(applyText)
    ? `投递方式：${applyText}`
    : null
  const deadline = pick(row, JOB_FIELD_ALIASES.deadline)
  const industries = splitMulti(pick(row, JOB_FIELD_ALIASES.industries))
  // 有「批次」列（飞书总表）就按批次分类，批次为空归「其他」；没有这一列才用文件名 / 工作表名 / --category
  const hasBatchColumn = Object.keys(row).some(h => JOB_FIELD_ALIASES.batch.includes(h.replace(/\s*\(\d+\)$/, '')))
  const category = hasBatchColumn ? normalizeBatch(pick(row, JOB_FIELD_ALIASES.batch)) || '其他' : fallbackCategory
  const graduationYears = normalizeGraduationYears(pick(row, JOB_FIELD_ALIASES.graduation_years))
  const startDate = parseDate(pick(row, JOB_FIELD_ALIASES.start_date))

  return {
    // 同一家公司常用同一个网申入口发好几条（不同届、不同批），只用链接做 key 会把它们合并掉
    external_key: stableKey('job', category, company, applyUrl, positions, graduationYears.join(','), startDate),
    category,
    company,
    company_type: normalizeCompanyType(pick(row, JOB_FIELD_ALIASES.company_type)),
    graduation_years: graduationYears,
    industries,
    industry_keys: industryKeysFor(industries, company, category),
    positions,
    job_functions: classifyPositions(positions),
    locations: splitMulti(pick(row, JOB_FIELD_ALIASES.locations)),
    deadline,
    deadline_date: parseDate(deadline),
    education: pick(row, JOB_FIELD_ALIASES.education),
    major_requirement: withoutBoilerplate(pick(row, JOB_FIELD_ALIASES.major_requirement)),
    written_test: pick(row, JOB_FIELD_ALIASES.written_test),
    apply_url: applyUrl,
    notes: [withoutBoilerplate(pick(row, JOB_FIELD_ALIASES.notes)), applyNote].filter(Boolean).join(' · ') || null,
    start_date: startDate,
    source,
    source_updated_at: parseDate(pick(row, JOB_FIELD_ALIASES.source_updated_at)),
  }
}

/** 返回 CSV 中没被任何别名认领的列，方便导入前核对 */
export function unmappedHeaders(row, aliases = JOB_FIELD_ALIASES) {
  const known = new Set(Object.values(aliases).flat())
  return Object.keys(row).filter(h => !known.has(h.replace(/\s*\(\d+\)$/, '')))
}

export const EXPERIENCE_FIELD_ALIASES = {
  company: ['公司', '公司名称', '企业', '学校'],
  position: ['岗位', '职位', '招聘岗位', '项目'],
  type: ['类型'],
  department: ['部门', '事业群'],
  location: ['地点', '城市', '工作地点'],
  date: ['日期', '面试时间', '时间'],
  language: ['语言', '面试语言'],
  result: ['结果', '面试结果'],
  salary: ['薪资'],
  round: ['轮次', '第几轮'],
  format: ['面试形式', '形式', '轮次名称'],
  duration_min: ['时长', '时长(分钟)', '时长（分钟）'],
  questions: ['面试题', '面试真题', '问题', '题目'],
  reflection: ['心得', '感想', '心得体会', '总结'],
}

const cap = (v, n) => (v == null ? null : String(v).slice(0, n))

function toMonth(value, fallback) {
  const iso = parseDate(value)
  if (iso) return iso.slice(0, 7)
  const m = String(value || '').match(/(\d{4})\s*[-/.年]\s*(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : fallback
}

/** 实习 / 校招 / 社招，对应站内 EXPERIENCE_TYPES；汇总表是校招表，认不出时按校招 */
export function experienceType(value) {
  const v = String(value || '').toLowerCase()
  if (/实习|intern/.test(v)) return 'internship'
  if (/社招|experienced|社会招聘/.test(v)) return 'experienced'
  return 'campus'
}

/** 去掉空题目，答案（可选）跟着题目一起过滤，保持下标对应 */
function pairQuestions(questions = [], answers) {
  const pairs = questions
    .map((q, i) => [cap(String(q ?? '').trim(), 2000), cap(String(answers?.[i] ?? '').trim(), 5000)])
    .filter(([q]) => q)
  const out = { questions: pairs.map(([q]) => q) }
  if (pairs.some(([, a]) => a)) out.answers = pairs.map(([, a]) => a)
  return out
}

function normalizeExperience(exp, source) {
  const rounds = (exp.rounds || [])
    .map((r, i) => {
      const minutes = parseInt(r.duration_min, 10)
      return {
        round: i + 1,
        format: cap(r.format, 200),
        duration_min: Number.isFinite(minutes) ? minutes : null,
        ...pairQuestions(r.questions, r.answers),
      }
    })
    .filter(r => r.format || r.questions.length)
  return {
    type: experienceType(exp.type),
    company: cap(exp.company, 100),
    position: cap(exp.position || '未注明岗位', 100),
    department: cap(clean(exp.department), 100),
    location: cap(clean(exp.location), 100),
    date: toMonth(exp.date, new Date().toISOString().slice(0, 7)),
    language: cap(clean(exp.language) || 'Chinese', 50),
    result: cap(clean(exp.result), 50),
    salary: cap(clean(exp.salary), 100),
    reflection: cap(clean(exp.reflection), 5000),
    rounds,
    // 导入的面经没有站内作者，直接进公开面经库，不走审核、不发奖励
    user_id: null,
    visibility: 'public',
    review_status: 'approved',
    reward_granted: true,
    publisher: source,
    source,
    external_key: stableKey('exp', source, exp.company, exp.position, exp.date, rounds[0]?.questions[0] || exp.reflection),
  }
}

/**
 * 面经 CSV：一行一轮，同公司 + 岗位 + 日期的行合并成一篇面经。
 * 「面试题」一格里多道题用换行或「;」分隔。
 */
export function mapExperienceCsvRows(rows, { source }) {
  const groups = new Map()
  for (const row of rows) {
    const company = pick(row, EXPERIENCE_FIELD_ALIASES.company)
    if (!company) continue
    const position = pick(row, EXPERIENCE_FIELD_ALIASES.position)
    const date = pick(row, EXPERIENCE_FIELD_ALIASES.date)
    const key = [company, position, date].join('|')
    if (!groups.has(key)) {
      groups.set(key, {
        company,
        position,
        date,
        type: pick(row, EXPERIENCE_FIELD_ALIASES.type),
        department: pick(row, EXPERIENCE_FIELD_ALIASES.department),
        location: pick(row, EXPERIENCE_FIELD_ALIASES.location),
        language: pick(row, EXPERIENCE_FIELD_ALIASES.language),
        result: pick(row, EXPERIENCE_FIELD_ALIASES.result),
        salary: pick(row, EXPERIENCE_FIELD_ALIASES.salary),
        reflection: pick(row, EXPERIENCE_FIELD_ALIASES.reflection),
        rounds: [],
      })
    }
    const exp = groups.get(key)
    exp.reflection ||= pick(row, EXPERIENCE_FIELD_ALIASES.reflection)
    const questions = String(pick(row, EXPERIENCE_FIELD_ALIASES.questions) || '')
      .split(/\n|;|；/)
      .map(q => q.replace(/^\s*\d+[.、)）]\s*/, '').trim())
      .filter(Boolean)
    exp.rounds.push({
      order: Number(pick(row, EXPERIENCE_FIELD_ALIASES.round)) || exp.rounds.length + 1,
      format: pick(row, EXPERIENCE_FIELD_ALIASES.format),
      duration_min: pick(row, EXPERIENCE_FIELD_ALIASES.duration_min),
      questions,
    })
  }
  return [...groups.values()].map(exp => {
    exp.rounds.sort((a, b) => a.order - b.order)
    return normalizeExperience(exp, source)
  })
}

/** 面经 JSON：数组，字段与站内发布面经一致（company / position / type / rounds[{format, questions, answers}] / reflection …） */
export function mapExperienceJson(items, { source }) {
  if (!Array.isArray(items)) throw new Error('JSON 文件顶层必须是数组')
  return items.filter(e => e && clean(e.company)).map(e => normalizeExperience(e, source))
}
