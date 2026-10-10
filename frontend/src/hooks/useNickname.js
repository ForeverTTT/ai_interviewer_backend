import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { fetchNickname } from '../lib/nickname'

/**
 * 当前用户的社区昵称。未登录时为 null。
 * 在一处保存后用 setNickname 更新，同页其他地方（发布表单、个人资料）会跟着变。
 */
export function useNickname() {
  const { user } = useAuth()
  const [nickname, setNickname] = useState(null)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    if (!user) {
      setNickname(null)
      setLoaded(true)
      return
    }
    try {
      setNickname(await fetchNickname())
    } catch {
      setNickname(null)
    } finally {
      setLoaded(true)
    }
  }, [user])

  useEffect(() => {
    reload()
  }, [reload])

  return { nickname, setNickname, loaded, reload }
}
