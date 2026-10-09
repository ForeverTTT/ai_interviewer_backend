import { createHash } from 'node:crypto'

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

/** '2026/10/08'、'2026-10-08 12:00'、'2026年10月8日' → '2026-10-08'；'尽快投递' 之类返回 null */
export function parseDate(value) {
  const m = String(value || '').match(/(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/)
  if (!m) return null
  const [, y, mo, d] = m
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  return Number.isNaN(Date.parse(iso)) ? null : iso
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
  apply_url: ['投递链接', '网申链接', '投递方式', '投递入口', '网申地址', '官网链接', '链接'],
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
 * 岗位类别：按「招聘岗位」里的关键词归类，一条招聘可以同时属于多个类别。
 * 存的是 key，前端按 jobs.fn.<key> 翻译。顺序就是前端筛选按钮的顺序。
 * 设计类不用裸「设计」，免得把「IC 设计」「版图设计」归进来。
 */
export const JOB_FUNCTIONS = [
  ['tech', /算法|开发|研发|测试|运维|架构|前端|后端|客户端|全栈|软件|硬件|芯片|嵌入式|程序|工程师|java|c\+\+|python|golang|大模型|机器学习|深度学习|数据挖掘|安全|电气|电子|通信|机械|自动化|半导体|\bic\b|电路|技术/i],
  ['product', /产品经理|产品策划|产品助理|产品专员|产品岗|产品管培|策划|\bpm\b/i],
  ['design', /设计师|\bui\b|\bux\b|交互设计|视觉设计|美术|原画|动画|插画|平面设计|建筑设计|工业设计/i],
  ['data', /数据分析|商业分析|分析师|数据科学|\bbi\b/i],
  ['operations', /运营|社群|内容|新媒体|增长|电商|电子商务|编辑/i],
  ['marketing', /市场|销售|营销|品牌|公关|商务|\bbd\b|客户经理|渠道|广告|大客户/i],
  ['finance', /投资|投行|行业研究|投研|证券|基金|风控|精算|审计|会计|财务|金融|银行|信贷|理财|税务/i],
  ['consulting', /咨询|顾问/i],
  ['functions', /人力|\bhr\b|招聘|行政|法务|法律|采购|供应链|物流|秘书|培训|党建|文秘/i],
  ['trainee', /管培|管理培训生|储备干部|培训生/i],
]

export function classifyPositions(text) {
  const value = String(text || '')
  const matched = JOB_FUNCTIONS.filter(([, re]) => re.test(value)).map(([key]) => key)
  return matched.length ? matched : (value ? ['other'] : [])
}

export function mapJobRow(row, { category, source }) {
  const company = pick(row, JOB_FIELD_ALIASES.company)
  if (!company) return null

  const positions = pick(row, JOB_FIELD_ALIASES.positions)
  let applyUrl = extractUrl(pick(row, JOB_FIELD_ALIASES.apply_url))
  if (!applyUrl) {
    // 链接列的表头各 tab 叫法不一，退而求其次找第一个像 URL 的格子
    for (const v of Object.values(row)) {
      applyUrl = extractUrl(v)
      if (applyUrl) break
    }
  }
  const deadline = pick(row, JOB_FIELD_ALIASES.deadline)

  return {
    external_key: stableKey('job', category, company, applyUrl || positions),
    category,
    company,
    company_type: pick(row, JOB_FIELD_ALIASES.company_type),
    graduation_years: splitMulti(pick(row, JOB_FIELD_ALIASES.graduation_years)),
    industries: splitMulti(pick(row, JOB_FIELD_ALIASES.industries)),
    positions,
    job_functions: classifyPositions(positions),
    locations: splitMulti(pick(row, JOB_FIELD_ALIASES.locations)),
    deadline,
    deadline_date: parseDate(deadline),
    education: pick(row, JOB_FIELD_ALIASES.education),
    major_requirement: pick(row, JOB_FIELD_ALIASES.major_requirement),
    written_test: pick(row, JOB_FIELD_ALIASES.written_test),
    apply_url: applyUrl,
    notes: pick(row, JOB_FIELD_ALIASES.notes),
    start_date: parseDate(pick(row, JOB_FIELD_ALIASES.start_date)),
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
