// Memory only: never persist report content in browser storage. Snapshots are
// keyed by user, survive route changes and are discarded on sign-out.
const EMPTY = Object.freeze({
  interviews: [], growthOverview: null, hasInterviews: false,
  loadError: false, refreshing: false,
})

export function createDashboardStore() {
  const entries = new Map()
  const listeners = new Set()
  const notify = () => listeners.forEach(listener => listener())
  const entryFor = userId => {
    if (!entries.has(userId)) entries.set(userId, { snapshot: EMPTY, pending: null, overviewPending: null })
    return entries.get(userId)
  }
  const update = (userId, change) => {
    if (!userId) return
    const entry = entries.get(userId)
    if (!entry) return
    entry.snapshot = { ...entry.snapshot, ...(typeof change === 'function' ? change(entry.snapshot) : change) }
    notify()
  }
  return {
    get: userId => entries.get(userId)?.snapshot || EMPTY,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
    update,
    clear: () => { entries.clear(); notify() },
    load(userId, loaders) {
      if (!userId) return Promise.resolve(null)
      const entry = entryFor(userId)
      update(userId, { refreshing: true, loadError: false })
      // A sign-out or account reset invalidates any late network responses.
      const current = () => entries.get(userId) === entry
      const finish = field => {
        if (!current()) return
        entry[field] = null
        update(userId, { refreshing: Boolean(entry.pending || entry.overviewPending) })
      }
      const interviews = entry.pending || Promise.resolve().then(loaders.interviews).then(value => {
        if (current()) update(userId, { interviews: value, hasInterviews: true })
        return value
      }).catch(() => {
        if (current()) update(userId, { loadError: true })
        return null
      }).finally(() => finish('pending'))
      const overview = entry.overviewPending || Promise.resolve().then(loaders.overview).then(value => {
        if (current()) update(userId, { growthOverview: value })
      }).catch(() => {}).finally(() => finish('overviewPending'))
      entry.pending = interviews
      entry.overviewPending = overview
      // Report consumers don't wait for task generation / growth aggregation.
      return interviews
    },
  }
}

export const dashboardStore = createDashboardStore()
