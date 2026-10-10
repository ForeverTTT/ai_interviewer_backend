/**
 * 飞书「面经分享」文档导出的 Markdown → 面经对象（交给 mapExperienceJson 规范化后入库）。
 *
 * 每个「## 面经分享…」标题是一篇面经：标题拆出公司 / 岗位 / 轮次；
 * 正文里「一、业务面试」「二面：」这类小标题拆成多轮；
 * 默认每行都算面试题，明显是作者在讲感受 / 经过的行、面试形式说明、反问进心得。
 * 时长只认小标题里的（「二面 45min」）或明确说「时长 / 持续 / 整个面试」的句子，且至少 10 分钟。
 *
 * 公司名靠下面的列表识别（标题里公司和岗位常常连在一起，比如「字节广告策略产品一面」）；
 * 列表里没有的公司按第一个空格切分。新面经里出现新公司时往 COMPANIES 里加。
 */

// [匹配标题开头的正则, 标准公司名]，顺序重要：更具体的放前面
const COMPANIES = [
  [/^(字节跳动|字节|tictoc|tiktok)/i, '字节跳动'],
  [/^抖音/, '抖音'],
  [/^(阿里巴巴|阿里)/, '阿里巴巴'],
  [/^腾讯/, '腾讯'],
  [/^(?=IEG)/, '腾讯'],
  [/^TME/i, '腾讯音乐'],
  [/^(网易游戏|网易互娱|网易)/, '网易'],
  [/^(pwc|普华永道)+/i, '普华永道'],
  [/^(DTT|德勤)+/i, '德勤'],
  [/^(EY|安永)+/i, '安永'],
  [/^B站/, '哔哩哔哩'],
  [/^oppo/i, 'OPPO'],
  [/^360集团/, '360集团'],
  [/^邮储银行/, '中国邮政储蓄银行'],
  [/^农业银行/, '中国农业银行'],
  ...['美团', '滴滴', 'Anker', '米哈游', '叠纸游戏', '雀巢', '科大讯飞', '同花顺', '唯品会', '三七互娱', '锐捷网络',
    '华为', '贝壳找房', '快手', '拼多多', '良品铺子', '小米', '搜狐', '立信', '京东', '携程', '小红书', '顺丰', '壳牌',
    '英雄互娱', '卡夫亨氏', '陶氏化学', '阅文集团', '中信', '去哪儿网', '逸仙电商', '丰巢']
    .map(name => [new RegExp(`^${name}`, 'i'), name]),
]

const ROUND_WORDS = '业务终面|主管综合面|综合面|一面|二面|三面|四面|终面|群面|单面|初面|初试|复试|hr面|m面|vi面|pic面|par面|业务面试?|技术面|主管面|总监面'
const ROUND_AT_END = new RegExp(`((?:${ROUND_WORDS})(?:\\s*[+＋和]?\\s*(?:${ROUND_WORDS}))*)\\s*$`, 'i')
// 小标题：可带「一、」「1.」「第一轮」编号或「23上午」「下午」时间前缀，后面可跟时长，比如「二面 45min」「二面问题：」
const ROUND_HEADER = new RegExp(
  `^(?:[一二三四五六七八九十]+[、.．]\\s*|[1-9][、.．]\\s*|第[一二三四五]轮[:：]?\\s*)?(?:\\d{1,2}[日号]?\\s*)?(?:上午|下午|晚上)?\\s*(${ROUND_WORDS})[^，。？?]{0,14}$`,
  'i',
)
const NUMBERED = /^(?:\d{1,2}|[一二三四五六七八九十]{1,2})[、.．)）]\s*|^[（(]\d{1,2}[）)]\s*|^Q\d+[:：.]?\s*|^问题\s*\d+[:：]\s*/i
// 明显是作者在讲自己的感受 / 经过，不是题目
const NARRATIVE = /(?<!自)我|感觉|觉得|宝宝|寄了|哈哈|整体|总体|体验|建议|大家|！|好评|紧张|当天|结束之后|记不清/
// 「无领导：…」「半结构：…」「电商行业分析：…」这类「短标签：内容」是题目
const LABELLED = /^[^：:，。]{1,12}[：:]\s*\S/
const META = /^(面试(时间|形式|配置|时长|流程|方式)|形式|具体内容|时长|流程)[:：]/

function unescapeMd(s) {
  return s.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, '$1').replace(/\*\*/g, '').trim()
}

function durationOf(text) {
  const m = text.match(/(\d{1,3})\s*(?:分钟|min)/i)
  return m ? Number(m[1]) : null
}

function normalizeRound(word) {
  const w = word.replace(/\s+/g, '')
  return /^(hr|m|vi|pic|par)面$/i.test(w) ? w.replace(/^[a-z]+/i, s => s.toUpperCase()) : w
}

function parseTitle(raw) {
  let title = unescapeMd(raw)
    .replace(/^#+\s*/, '')
    .replace(/^面经分享\s*[·•・:：]?\s*/, '')
    .replace(/^#+\s*/, '')
    .replace(/^[•·]\s*/, '')
    .trim()

  let round = null
  const r = title.match(ROUND_AT_END)
  if (r) {
    round = r[1].split(/\s*[+＋和]\s*|(?=一面|二面|三面|四面)/).filter(Boolean).map(normalizeRound).join('+')
    title = title.slice(0, r.index).trim()
  }

  let company = null
  for (const [re, name] of COMPANIES) {
    const m = title.match(re)
    if (m) {
      company = name
      title = title.slice(m[0].length) // IEG 用零宽匹配，留在岗位里
      break
    }
  }
  if (!company) {
    const [first, ...rest] = title.split(/\s+/)
    company = first
    title = rest.join(' ')
  }

  const position = title.replace(/\s+/g, ' ').replace(/面经岗?$/, '').replace(/^[\s·•-]+|[\s·•-]+$/g, '').trim()
  return { company, position: position || null, round }
}

function isQuestion(line) {
  if (NUMBERED.test(line)) return true
  if (/[？?]\s*[）)]?$/.test(line)) return true
  if (NARRATIVE.test(line)) return false
  if (LABELLED.test(line)) return true
  return line.length <= 60
}

function parseBody(lines, titleRound) {
  const rounds = []
  const reflection = []
  let current = null
  let inReverse = false
  const startRound = (format, minutes) => {
    current = { format, questions: [] }
    if (minutes) current.duration_min = minutes
    rounds.push(current)
  }

  for (const raw of lines) {
    const line = unescapeMd(raw).replace(/^#+\s*/, '')
    if (!line) continue
    const bare = line.replace(NUMBERED, '')
    if (/^(?:最后(?:是)?)?反问(?:环节)?(?:[:：（(。]|$)/.test(bare) || /^请我反问/.test(bare)) {
      inReverse = true
      reflection.push(bare.replace(/[:：。]$/, '') + '：')
      continue
    }
    const header = line.length <= 24 ? line.match(ROUND_HEADER) : null
    if (header) {
      inReverse = false
      const minutes = durationOf(line)
      startRound(normalizeRound(header[1]), minutes >= 10 ? minutes : null)
      continue
    }
    if (inReverse) {
      reflection.push(`· ${line}`)
      continue
    }
    if (META.test(line)) {
      reflection.push(line)
      continue
    }
    // 「个人职业规划类：」「经历类：」「产品体验类」这类分组标签不是题目
    if (/^[^：:，。？?]{1,10}类[：:]?$/.test(line) || /^[^，。？?]{1,10}[：:]$/.test(line)) continue
    if (isQuestion(line)) {
      if (!current) startRound(titleRound || '面试')
      const q = line.replace(NUMBERED, '').replace(/[；;，,]$/, '').trim()
      if (q) current.questions.push(q)
    } else {
      reflection.push(line)
    }
  }
  // 「反问：」后面没跟具体问题的就是空标题，去掉
  const cleaned = reflection.filter((line, i) => !(/反问[^：]*：$/.test(line) && !reflection[i + 1]?.startsWith('· ')))
  return { rounds: rounds.filter(r => r.questions.length), reflection: cleaned.join('\n').trim() }
}

export function parseExperienceMarkdown(text, { month = new Date().toISOString().slice(0, 7) } = {}) {
  const sections = text.replace(/\r\n/g, '\n').split(/\n(?=## )/).filter(s => s.startsWith('## '))
  return sections.map((section) => {
    const [titleLine, ...body] = section.split('\n')
    const { company, position, round } = parseTitle(titleLine.replace(/^## /, ''))
    const { rounds, reflection } = parseBody(body, round)
    // 正文里的「5min 看题」「1分钟自我介绍」不是面试时长：只认明确说时长 / 持续 / 整个面试的句子，且至少 10 分钟
    const durationLine = body.find(l => /时长|持续|面试时间|全程|整个/.test(l) && (durationOf(l) || 0) >= 10)
    const duration = durationLine ? durationOf(durationLine) : null
    if (rounds.length === 1 && duration && !rounds[0].duration_min) rounds[0].duration_min = duration
    return {
      company,
      position: position || '未注明岗位',
      type: /实习|暑期/.test(titleLine) ? '实习' : '校招',
      date: month,
      language: 'Chinese',
      rounds,
      reflection: reflection || null,
    }
  })
}
