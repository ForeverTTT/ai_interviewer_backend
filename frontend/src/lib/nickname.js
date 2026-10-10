import { getBackendBaseUrl } from './backendBase'
import { supabase } from './supabase'

/**
 * 社区昵称接口。后端校验规则见 backend/src/lib/nickname.js，这里只做调用和错误码。
 * 错误码对应 i18n 的 nickname.errors.<code>。
 */

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('AUTH')
  return { Authorization: `Bearer ${session.access_token}` }
}

export async function fetchNickname() {
  const res = await fetch(`${getBackendBaseUrl()}/api/profile`, { headers: await authHeaders() })
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()).nickname ?? null
}

/** → { available: true, nickname } 或 { available: false, code } */
export async function checkNickname(name) {
  const res = await fetch(`${getBackendBaseUrl()}/api/profile/nickname/check?name=${encodeURIComponent(name)}`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

/** 保存成功返回规范化后的昵称；失败抛出带 code 的错误 */
export async function saveNickname(nickname) {
  const res = await fetch(`${getBackendBaseUrl()}/api/profile/nickname`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ nickname }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(body.error || 'SAVE_FAILED')
    err.code = body.error || 'SAVE_FAILED'
    throw err
  }
  return body.nickname ?? null
}
