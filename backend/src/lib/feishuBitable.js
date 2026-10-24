/**
 * 飞书多维表格 OpenAPI 的最小客户端：用自建应用的 tenant_access_token 读整张表，
 * 把每条记录转成和导出 Excel / CSV 一样的「表头 → 文本」行对象，交给 mapJobRow。
 *
 * 前提：应用开通了多维表格只读权限，并且在表格右上角「…→ 添加文档应用」里加了这个应用。
 */
const BASE = 'https://open.feishu.cn/open-apis'
const PAGE_SIZE = 500

/** https://xxx.feishu.cn/base/<app_token>?table=<table_id>&view=… → { appToken, tableId } */
export function parseBitableUrl(url) {
  const u = new URL(url)
  const m = u.pathname.match(/\/base\/([A-Za-z0-9]+)/)
  if (!m) throw new Error(`不是多维表格链接（应为 …/base/<app_token>…）: ${url}`)
  return { appToken: m[1], tableId: u.searchParams.get('table') || null }
}

// 字段类型：https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/guide
const DATE_TYPES = new Set([5, 1001, 1002])
const SKIP_TYPES = new Set([17, 18, 21]) // 附件、单向 / 双向关联（「父记录」之类，只有记录 id）

/** 毫秒时间戳 → 北京时间 '2026-10-08'，有时分时 '2026-10-08 14:30'（parseDate 都认） */
function formatDate(ms) {
  const d = new Date(Number(ms) + 8 * 3600000)
  if (Number.isNaN(d.getTime())) return ''
  const iso = d.toISOString()
  const time = iso.slice(11, 16)
  return time === '00:00' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${time}`
}

/** 超链接：显示文字就是网址时只留网址，否则「文字 网址」，extractUrl 能从里面取出网址 */
function linkText(text, link) {
  if (!link) return text || ''
  return !text || text === link ? link : `${text} ${link}`
}

function textOf(value, type) {
  if (value == null) return ''
  if (DATE_TYPES.has(type) && typeof value === 'number') return formatDate(value)
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '是' : ''
  if (Array.isArray(value)) {
    // 多行文本是分段数组（普通文字 / 链接 / @人），直接拼；多选、人员、查找引用等是列表，用逗号分开（splitMulti 认）
    if (value.every(v => v && typeof v === 'object' && typeof v.type === 'string' && 'text' in v)) {
      return value.map(seg => (seg.type === 'url' ? linkText(seg.text, seg.link) : seg.text ?? '')).join('')
    }
    return value.map(v => textOf(v, type)).filter(Boolean).join(',')
  }
  if (typeof value === 'object') {
    // 公式 / 查找引用：{ type: 实际字段类型, value: [...] }
    if ('value' in value && Array.isArray(value.value)) return textOf(value.value, value.type ?? type)
    if ('link' in value) return linkText(value.text, value.link)
    if ('full_address' in value) return value.full_address || ''
    if ('name' in value) return value.name || ''
    if ('text' in value) return value.text || ''
  }
  return ''
}

/** 一条记录 → 行对象；表里所有列都给上（空的写 ''），和导出文件一样，方便按表头判断有没有某一列 */
export function recordToRow(record, fields) {
  const row = {}
  // 内部来源 ID 不作为普通表头暴露，mapJobRow 仍可用它做稳定来源键。
  Object.defineProperty(row, '__source_record_id', { value: record.record_id || '', enumerable: false })
  for (const f of fields) {
    if (SKIP_TYPES.has(f.type)) continue
    row[f.field_name] = textOf(record.fields?.[f.field_name], f.type).trim()
  }
  return row
}

export function createBitableClient({ appId, appSecret, fetchImpl = fetch, retries = 4 }) {
  let token = null

  async function call(method, path, { query, body, auth = true } = {}) {
    const url = new URL(BASE + path)
    for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v)
    for (let attempt = 0; ; attempt++) {
      const headers = { 'Content-Type': 'application/json; charset=utf-8' }
      if (auth) headers.Authorization = `Bearer ${await getToken()}`
      const res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
      const json = await res.json().catch(() => ({}))
      // 频率限制（HTTP 429 / code 99991400）和 5xx 等一会儿重试
      const retryable = res.status === 429 || res.status >= 500 || json.code === 99991400
      if (retryable && attempt < retries) {
        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt))
        continue
      }
      if (!res.ok || json.code !== 0) {
        throw new Error(`飞书接口 ${method} ${path} 失败: HTTP ${res.status} code ${json.code} ${json.msg || ''}`.trim())
      }
      return json
    }
  }

  async function getToken() {
    if (token) return token
    const json = await call('POST', '/auth/v3/tenant_access_token/internal', {
      auth: false,
      body: { app_id: appId, app_secret: appSecret },
    })
    token = json.tenant_access_token
    return token
  }

  async function paginate(method, path, { query, body } = {}) {
    const items = []
    let pageToken
    do {
      const json = await call(method, path, { query: { ...query, page_token: pageToken }, body })
      items.push(...(json.data?.items || []))
      pageToken = json.data?.has_more ? json.data.page_token : undefined
    } while (pageToken)
    return items
  }

  return {
    listTables: appToken => paginate('GET', `/bitable/v1/apps/${appToken}/tables`, { query: { page_size: 100 } }),
    listFields: (appToken, tableId) =>
      paginate('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, { query: { page_size: 100 } }),
    listRecords: (appToken, tableId) =>
      paginate('POST', `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, { query: { page_size: PAGE_SIZE }, body: {} }),
  }
}
