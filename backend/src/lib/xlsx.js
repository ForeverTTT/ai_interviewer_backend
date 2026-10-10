import { inflateRawSync } from 'node:zlib'

/**
 * 读 .xlsx 的最小实现（飞书导出的表格够用，不引第三方依赖）：
 * 解 zip → 读 workbook / sharedStrings / 每个 worksheet → 每张表一组行对象（首行做表头）。
 *
 * 支持：共享字符串、内联字符串（含富文本分段）、数字、布尔、公式缓存值。
 * 日期在 xlsx 里是序列号数字，原样返回字符串，交给 parseDate 识别。
 * 不支持：zip64、加密文件。
 */

function readZip(buf) {
  // End of central directory：从文件尾往前找签名 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 xlsx（zip）文件')

  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const files = new Map()

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('zip 目录损坏')
    const method = buf.readUInt16LE(offset + 10)
    const compressedSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)

    files.set(name.replace(/^\//, ''), () => {
      const localNameLen = buf.readUInt16LE(localOffset + 26)
      const localExtraLen = buf.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameLen + localExtraLen
      const data = buf.subarray(start, start + compressedSize)
      if (method === 0) return data
      if (method === 8) return inflateRawSync(data)
      throw new Error(`不支持的 zip 压缩方式 ${method}`)
    })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return files
}

function unescapeXml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? unescapeXml(m[1]) : null
}

/** <si> / <is> 里可能是一个 <t>，也可能是多段富文本 <r><t>…</t></r> */
function textRuns(xml) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)]
    .map(m => unescapeXml(m[1] || ''))
    .join('')
}

function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0]
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSheet(xml, shared) {
  const rows = []
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    const cells = []
    let next = 0
    for (const c of (rowMatch[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1]
      const body = c[2] || ''
      const ref = attr(tag, 'r')
      const idx = ref ? columnIndex(ref) : next
      next = idx + 1
      const type = attr(tag, 't')
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
      let value = ''
      if (type === 's') value = v ? shared[Number(v[1])] ?? '' : ''
      else if (type === 'inlineStr') value = textRuns(body)
      else if (type === 'b') value = v ? (v[1] === '1' ? 'TRUE' : 'FALSE') : ''
      else value = v ? unescapeXml(v[1]) : ''
      cells[idx] = value
    }
    rows.push(Array.from(cells, x => x ?? ''))
  }
  return rows
}

/**
 * 返回 [{ name, rows: [{ 表头: 值 }] }]，按工作簿里的顺序。
 * 首个非空行做表头；表头重名时第二个起加「 (2)」后缀，空表头列忽略。
 */
export function readXlsx(buf) {
  const files = readZip(buf)
  const read = (path) => {
    const get = files.get(path.replace(/^\//, ''))
    return get ? get().toString('utf8') : null
  }

  const shared = []
  const sharedXml = read('xl/sharedStrings.xml')
  if (sharedXml) {
    for (const si of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textRuns(si[1]))
  }

  const rels = new Map()
  for (const tag of (read('xl/_rels/workbook.xml.rels') || '').match(/<Relationship\b[^>]*>/g) || []) {
    rels.set(attr(tag, 'Id'), attr(tag, 'Target'))
  }

  const sheets = []
  for (const tag of (read('xl/workbook.xml') || '').match(/<sheet\b[^>]*>/g) || []) {
    const target = rels.get(attr(tag, 'r:id'))
    if (!target) continue
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
    const xml = read(path)
    if (!xml) continue

    const grid = parseSheet(xml, shared).filter(r => r.some(c => String(c).trim() !== ''))
    if (!grid.length) {
      sheets.push({ name: attr(tag, 'name'), rows: [] })
      continue
    }
    const seen = new Map()
    const headers = grid[0].map(h => {
      const name = String(h).trim()
      if (!name) return null
      const n = (seen.get(name) || 0) + 1
      seen.set(name, n)
      return n === 1 ? name : `${name} (${n})`
    })
    const rows = grid.slice(1).map(r => Object.fromEntries(
      headers.map((h, i) => [h, String(r[i] ?? '').trim()]).filter(([h]) => h),
    ))
    sheets.push({ name: attr(tag, 'name'), rows })
  }
  return sheets
}
