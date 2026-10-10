/**
 * 公开昵称的格式规则（面经库发布者名）。唯一性由数据库唯一索引保证（不区分大小写）。
 *
 * - 2–20 个字（按字符算，一个汉字算一个）；首尾空格去掉，中间连续空格合成一个。
 * - 只能用中英文、数字、空格和 _ - · .
 * - 不能像邮箱、网址或手机号，免得把联系方式公开出去。
 * - 不能冒充匿名名或官方（匿名荷包蛋、管理员、FlowLab …）。
 */

export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 20

const ALLOWED = /^[\p{Script=Han}\p{L}\p{N} _\-·.]+$/u
const RESERVED = /匿名|荷包蛋|管理员|官方|客服|admin|moderator|flowlab|不卡壳/i

export function normalizeNickname(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ')
}

/** 返回 { ok: true, value } 或 { ok: false, code }，code 给前端翻译 */
export function validateNickname(raw) {
  const value = normalizeNickname(raw)
  const length = [...value].length
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return { ok: false, code: 'NICKNAME_LENGTH' }
  if (/@|https?:|www\.|\.(com|cn|net|org|de)\b/i.test(value) || /\d{7,}/.test(value.replace(/[\s\-_.·]/g, ''))) {
    return { ok: false, code: 'NICKNAME_CONTACT' }
  }
  if (!ALLOWED.test(value)) return { ok: false, code: 'NICKNAME_CHARS' }
  if (RESERVED.test(value)) return { ok: false, code: 'NICKNAME_RESERVED' }
  return { ok: true, value }
}
