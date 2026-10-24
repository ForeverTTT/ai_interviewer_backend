const ALLOWED_SORTS = new Set(['updated', 'deadline_asc', 'deadline_desc'])
const ALLOWED_VIEWS = new Set(['card', 'list'])
const MULTI_FILTERS = ['industry', 'fn', 'companyType', 'year', 'city']

function readList(params, key) {
  return [...new Set(String(params.get(key) || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean))]
}

export function parseJobsListState(search, fallbackView = 'card') {
  const params = search instanceof URLSearchParams ? search : new URLSearchParams(search)
  const sort = params.get('sort')
  const view = params.get('view')
  const requestedPage = Number.parseInt(params.get('page') || '1', 10)
  return {
    search: params.get('q') || '',
    filters: {
      category: params.get('category') || '',
      industry: readList(params, 'industry'),
      fn: readList(params, 'fn'),
      companyType: readList(params, 'companyType'),
      year: readList(params, 'year'),
      city: readList(params, 'city'),
      open: params.get('open') !== '0',
      sort: ALLOWED_SORTS.has(sort) ? sort : 'updated',
    },
    view: ALLOWED_VIEWS.has(view) ? view : (ALLOWED_VIEWS.has(fallbackView) ? fallbackView : 'card'),
    page: Number.isInteger(requestedPage) ? Math.min(Math.max(requestedPage, 1), 50) : 1,
  }
}

export function createJobsListSearch({ search, filters, view, page }) {
  const params = new URLSearchParams()
  if (search) params.set('q', search)
  if (filters.category) params.set('category', filters.category)
  for (const key of MULTI_FILTERS) {
    if (filters[key]?.length) params.set(key, filters[key].join(','))
  }
  if (filters.open === false) params.set('open', '0')
  if (filters.sort && filters.sort !== 'updated') params.set('sort', filters.sort)
  if (view === 'list') params.set('view', 'list')
  if (page > 1) params.set('page', String(page))
  return params
}
