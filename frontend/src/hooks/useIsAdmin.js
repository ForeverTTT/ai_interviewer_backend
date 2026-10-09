import { useEffect, useState } from 'react'
import { getBackendBaseUrl } from '../lib/backendBase'
import { authenticatedFetch } from '../lib/authenticatedFetch'

// One lookup per signed-in user per page load; the sidebar and the admin page share it.
const cache = new Map()

function fetchIsAdmin(userId) {
  if (!cache.has(userId)) {
    const request = authenticatedFetch(`${getBackendBaseUrl()}/api/admin/me`)
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((data) => Boolean(data.isAdmin))
      .catch(() => {
        cache.delete(userId)
        return false
      })
    cache.set(userId, request)
  }
  return cache.get(userId)
}

/** null while checking, then true / false. */
export function useIsAdmin(user) {
  const userId = user?.id
  const [state, setState] = useState({ userId: null, isAdmin: null })

  useEffect(() => {
    if (!userId) return undefined
    let cancelled = false
    fetchIsAdmin(userId).then((isAdmin) => {
      if (!cancelled) setState({ userId, isAdmin })
    })
    return () => { cancelled = true }
  }, [userId])

  if (!userId) return false
  return state.userId === userId ? state.isAdmin : null
}
