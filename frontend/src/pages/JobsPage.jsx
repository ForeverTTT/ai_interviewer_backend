import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Search, MapPin, Clock, GraduationCap, ExternalLink, Loader2,
  BookOpen, PenLine, CalendarClock, LayoutGrid, List,
  ArrowUp, ArrowDown, ArrowUpDown, ArrowRight, ChevronDown,
  ChevronLeft, ChevronRight,
} from 'lucide-react'
import { getBackendBaseUrl } from '../lib/backendBase'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import { BRAND_ASSETS } from '../assets/brandAssets'
import FilterSelect from '../components/FilterSelect'
import { daysUntilChinaDeadline } from '../lib/chinaDate'
import { createJobsListSearch, parseJobsListState } from '../lib/jobsListState'
import './CommunityPages.css'

const PAGE_SIZE = 20
const VIEW_KEY = 'landit_jobs_view'
const LIST_COLUMNS = 'md:grid-cols-[minmax(150px,1.1fr)_minmax(0,2.2fr)_minmax(110px,1fr)_minmax(110px,0.9fr)_140px]'
const PAGE_CACHE_TTL_MS = 60 * 1000
let jobsPageCache = null
const jobsRequestCache = new Map()

function readView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'card'
  } catch {
    return 'card'
  }
}

/**
 * 届次从早到晚排，连续的合并：['2026届', '2024届', '2025届', '海外往届'] → ['2024–2026届', '海外往届']
 */
function formatGraduationYears(years) {
  const nums = [...new Set((years || []).map(y => y.match(/^(\d{4})届$/)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b)
  const others = (years || []).filter(y => !/^\d{4}届$/.test(y))
  const ranges = []
  for (const n of nums) {
    const last = ranges[ranges.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else ranges.push([n, n])
  }
  return [...ranges.map(([a, b]) => (a === b ? `${a}届` : `${a}–${b}届`)), ...others]
}

function formatLocations(locations, max) {
  if (!locations?.length) return ''
  return locations.length > max ? `${locations.slice(0, max).join(' / ')} +${locations.length - max}` : locations.join(' / ')
}

async function authedFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('AUTH')
  const res = await fetch(`${getBackendBaseUrl()}${path}`, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

/** 截止日期 7 天内标红；没有具体日期（尽快投递 / 招满为止）就原样显示 */
function DeadlineBadge({ job, t }) {
  if (!job.deadline) return null
  const daysLeft = job.deadline_date
    ? daysUntilChinaDeadline(job.deadline_date)
    : null
  const urgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
  const expired = daysLeft !== null && daysLeft < 0
  return (
    <span className={`flex items-center gap-1 ${urgent ? 'font-bold text-brand-danger' : expired ? 'text-brand-muted line-through' : ''}`}>
      <CalendarClock className="h-3.5 w-3.5" />
      {/* 原表日期写法不统一（2027/10/08、2027-9-30 …），有解析出的日期就统一显示 */}
      {urgent ? t('jobs.daysLeft', { n: daysLeft }) : (job.deadline_date || job.deadline)}
    </span>
  )
}

// 卡片上最多显示几个岗位类别，多的折成 +N，避免标签换行太多
const MAX_CARD_FUNCTIONS = 3

function JobCard({ job, t, jobsReturnTo }) {
  const title = job.job_title || job.positions || t('jobs.untitled')

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="experience-card flex flex-col gap-4 p-6"
    >
      <div className="min-w-0">
        <h3 className="font-brand text-[17px] font-semibold leading-tight tracking-[-0.01em] text-brand-ink sm:text-[19px]">
          {title}
        </h3>
        <p className="mt-1 text-[13px] font-semibold text-brand-muted">{job.company}</p>
        <p className="mt-1 text-[12px] text-brand-muted">{[job.department, ...(job.industries || [])].filter(Boolean).join(' · ')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {job.company_type && (
          <span className="inline-flex items-center rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-[11px] font-bold text-brand-ink">
            {job.company_type}
          </span>
        )}
        {job.job_functions?.slice(0, MAX_CARD_FUNCTIONS).map(fn => (
          <span key={fn} className="inline-flex items-center rounded-lg bg-brand-ink px-2.5 py-1 text-[11px] font-bold text-brand-on-ink">
            {t(`taxonomy.fn.${fn}`, fn)}
          </span>
        ))}
        {job.job_functions?.length > MAX_CARD_FUNCTIONS && (
          <span
            title={job.job_functions.slice(MAX_CARD_FUNCTIONS).map(fn => t(`taxonomy.fn.${fn}`, fn)).join(' · ')}
            className="inline-flex items-center rounded-lg bg-brand-ink/80 px-2 py-1 text-[11px] font-bold text-brand-on-ink"
          >
            +{job.job_functions.length - MAX_CARD_FUNCTIONS}
          </span>
        )}
        {formatGraduationYears(job.graduation_years).map(y => (
          <span key={y} className="inline-flex items-center rounded-lg border border-brand-line bg-brand-card px-2.5 py-1 text-[11px] font-bold text-brand-muted">
            {y}
          </span>
        ))}
        {job.written_test && (
          <span className="inline-flex items-center gap-1 rounded-lg border border-brand-line bg-brand-card px-2.5 py-1 text-[11px] font-medium text-brand-muted">
            <PenLine className="h-3 w-3" />
            {job.written_test}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-brand-muted">
        {job.locations?.length > 0 && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {formatLocations(job.locations, 4)}
          </span>
        )}
        <DeadlineBadge job={job} t={t} />
        {job.education && (
          <span className="flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" />
            {job.education}
          </span>
        )}
        {(job.published_at || job.source_updated_at) && (
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {job.published_at
              ? t('jobs.publishedAt', { date: job.published_at })
              : t('jobs.updatedAt', { date: job.source_updated_at })}
          </span>
        )}
      </div>

      {(job.major_requirement || job.notes) && (
        <p className="rounded-xl border border-brand-line bg-brand-inset px-4 py-2.5 text-[12.5px] leading-relaxed text-brand-muted">
          {[job.major_requirement, job.notes].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Link to={`/jobs/${job.id}`} state={{ jobsReturnTo }} className="lk-btn lk-btn-primary">
          {t('jobs.viewDetail')}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        {job.apply_url && (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('job_apply_clicked', { category: job.category, companyType: job.company_type })}
            className="lk-btn lk-btn-ghost"
          >
            {t('jobs.apply')}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <Link to={`/experiences?q=${encodeURIComponent(job.company)}`} className="lk-btn lk-btn-ghost">
          <BookOpen className="h-3.5 w-3.5" />
          {t('jobs.seeExperiences')}
        </Link>
      </div>
    </motion.article>
  )
}

/** 列表视图的一行：桌面端按表头分列，手机上叠成几行 */
function JobRow({ job, t, jobsReturnTo }) {
  const title = job.job_title || job.positions || t('jobs.untitled')
  return (
    <div className={`grid gap-x-5 gap-y-2 border-t border-brand-line px-5 py-4 first:border-t-0 md:items-center ${LIST_COLUMNS}`}>
      <div className="min-w-0">
        <Link to={`/jobs/${job.id}`} state={{ jobsReturnTo }} className="truncate font-brand text-[15px] font-semibold text-brand-ink hover:underline">{title}</Link>
        <p className="mt-0.5 truncate text-[12px] text-brand-muted">
          {job.company}
        </p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-[13.5px] text-brand-ink">{[job.company_type, job.department].filter(Boolean).join(' · ')}</p>
        {job.job_functions?.length > 0 && (
          <p className="mt-0.5 truncate text-[12px] text-brand-muted">
            {job.job_functions.map(fn => t(`taxonomy.fn.${fn}`, fn)).join(' · ')}
          </p>
        )}
      </div>
      <p className="flex min-w-0 items-center gap-1 text-[12.5px] text-brand-muted">
        <MapPin className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{formatLocations(job.locations, 3)}</span>
      </p>
      <div className="text-[12.5px] text-brand-muted">
        <DeadlineBadge job={job} t={t} />
      </div>
      <div className="flex items-center gap-2 md:justify-end">
        <Link
          to={`/jobs/${job.id}`}
          state={{ jobsReturnTo }}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-brand-ink px-3.5 py-1.5 text-[12px] font-bold text-brand-on-ink transition-opacity hover:opacity-90"
        >
          {t('jobs.viewDetail')}
          <ArrowRight className="h-3 w-3" />
        </Link>
        {job.apply_url && (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('job_apply_clicked', { category: job.category, companyType: job.company_type })}
            className="grid h-8 w-8 place-items-center rounded-full border border-brand-line text-brand-muted transition-colors hover:border-brand-ink hover:text-brand-ink"
            title={t('jobs.apply')}
            aria-label={t('jobs.apply')}
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <Link
          to={`/experiences?q=${encodeURIComponent(job.company)}`}
          title={t('jobs.seeExperiences')}
          aria-label={t('jobs.seeExperiences')}
          className="grid h-8 w-8 place-items-center rounded-full border border-brand-line text-brand-muted transition-colors hover:border-brand-ink hover:text-brand-ink"
        >
          <BookOpen className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}

export default function JobsPage() {
  const { t } = useTranslation()
  const [urlParams, setUrlParams] = useSearchParams()
  const initialRef = useRef(null)
  if (!initialRef.current) {
    const query = urlParams.toString()
    const cached = jobsPageCache?.query === query ? jobsPageCache : null
    initialRef.current = { parsed: parseJobsListState(urlParams, readView()), cached }
  }
  const initial = initialRef.current.cached || initialRef.current.parsed
  const [facets, setFacets] = useState(null)
  const [filters, setFilters] = useState(initial.filters)
  const [searchInput, setSearchInput] = useState(initial.search)
  const [search, setSearch] = useState(initial.search)
  const [jobs, setJobs] = useState(initial.jobs || [])
  const [total, setTotal] = useState(initial.total || 0)
  const [page, setPage] = useState(initial.page || 1)
  const [loading, setLoading] = useState(!initialRef.current.cached)
  const [error, setError] = useState(initial.error || false)
  const [view, setView] = useState(initial.view)
  const requestId = useRef(0)
  const didInitialLoad = useRef(false)
  const lastLoadKey = useRef(null)
  const cacheSnapshot = useRef(null)
  // 届次筛选项是分组（2025届及更早 …），查询时要换成组里实际的届次；用 ref 免得筛选项加载完又多查一次
  const yearGroupsRef = useRef([])

  const changeView = (next) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // 存不了就只在本次生效
    }
  }

  useEffect(() => {
    document.title = `${t('jobs.title')} · FlowLab`
  }, [t])

  useEffect(() => {
    authedFetch('/api/jobs/facets').then(data => {
      yearGroupsRef.current = data.years || []
      setFacets(data)
    }).catch(() => setFacets({ categories: [], industries: [], functions: [], companyTypes: [], years: [], cities: [] }))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const nextSearch = searchInput.trim()
      if (nextSearch !== search) {
        setPage(1)
        setSearch(nextSearch)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, searchInput])

  const fetchPage = useCallback(async (nextPage) => {
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE), open: String(filters.open), sort: filters.sort })
    if (search) params.set('q', search)
    if (filters.category) params.set('category', filters.category)
    // 多选：逗号拼在一起，后端拆开按「任一满足」查
    for (const key of ['industry', 'fn', 'companyType', 'city']) {
      if (filters[key].length) params.set(key, filters[key].join(','))
    }
    if (filters.year.length) {
      const members = filters.year.flatMap(key => yearGroupsRef.current.find(g => g.value === key)?.members || [key])
      params.set('year', [...new Set(members)].join(','))
    }
    const path = `/api/jobs?${params}`
    const cached = jobsRequestCache.get(path)
    if (cached && Date.now() - cached.at < PAGE_CACHE_TTL_MS) return cached.data

    const startedAt = performance.now()
    const data = await authedFetch(path)
    console.info('[Jobs performance]', {
      page: nextPage,
      clientMs: Math.round(performance.now() - startedAt),
      ...data.timing,
    })
    jobsRequestCache.set(path, { at: Date.now(), data })
    // 用户连续筛选时限制内存占用；旧条目由插入顺序淘汰。
    if (jobsRequestCache.size > 40) jobsRequestCache.delete(jobsRequestCache.keys().next().value)
    return data
  }, [filters, search])

  const load = useCallback(async (nextPage) => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const data = await fetchPage(nextPage)
      if (id !== requestId.current) return
      setJobs(data.jobs)
      setTotal(data.total)
      setPage(nextPage)
      setError(false)
    } catch {
      if (id === requestId.current) setError(true)
    } finally {
      if (id === requestId.current) {
        setLoading(false)
      }
    }
  }, [fetchPage])

  const loadKey = JSON.stringify({ search, filters })

  useEffect(() => {
    // 只有届次筛选依赖 facets 中的分组成员；普通列表与筛选统计并行加载。
    if (!facets && filters.year.length) return
    // facets 稍后返回时查询条件没有变化，不重复请求岗位列表。
    if (lastLoadKey.current === loadKey) return
    lastLoadKey.current = loadKey
    if (!didInitialLoad.current) {
      didInitialLoad.current = true
      if (initialRef.current.cached) return
      load(initialRef.current.parsed.page)
      return
    }
    load(1)
  }, [facets, fetchPage, filters.year.length, load, loadKey])

  const currentParams = createJobsListSearch({ search, filters, view, page })
  const currentQuery = currentParams.toString()
  const jobsReturnTo = `/jobs${currentQuery ? `?${currentQuery}` : ''}`

  useEffect(() => {
    if (urlParams.toString() !== currentQuery) setUrlParams(currentParams, { replace: true })
  }, [currentQuery, currentParams, setUrlParams, urlParams])

  cacheSnapshot.current = { query: currentQuery, search, filters, view, page, jobs, total, error, scrollY: window.scrollY }
  useEffect(() => () => {
    jobsPageCache = { ...cacheSnapshot.current, scrollY: window.scrollY }
  }, [])

  useLayoutEffect(() => {
    const scrollY = initialRef.current.cached?.scrollY
    if (!Number.isFinite(scrollY) || scrollY <= 0) return
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, scrollY))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  const setFilter = (key, value) => {
    setPage(1)
    setFilters(prev => ({ ...prev, [key]: value }))
  }
  const yearLabel = (key) => {
    const group = facets?.years?.find(g => g.value === key)
    if (key === 'earlier') return t('jobs.yearEarlier', { year: group?.year })
    if (key === 'later') return t('jobs.yearLater', { year: group?.year })
    return key
  }
  const categoryTabs = [{ value: '', count: facets?.total ?? 0, label: t('jobs.allCategories') }, ...(facets?.categories || [])]
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const visiblePages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter(value => value >= 1 && value <= totalPages)
    .sort((a, b) => a - b)

  const goToPage = (nextPage) => {
    if (loading || nextPage === page || nextPage < 1 || nextPage > totalPages) return
    load(nextPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="community-page pb-16 pt-[calc(var(--ui-nav-h)+1.5rem)]">
      <div className="community-shell">
        <section className="community-hero">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="community-hero-copy">
            <h1 className="community-title">{t('jobs.title')}</h1>
            <p className="community-subtitle">{t('jobs.subtitle')}</p>
            {facets?.total > 0 && (
              <p className="mt-5 text-[12.5px] text-brand-muted">
                {t('jobs.stats', { n: facets.total })}
                {facets.lastUpdated && ` · ${t('jobs.lastUpdated', { date: facets.lastUpdated })}`}
              </p>
            )}
          </motion.div>
          <div className="community-egg-stage" aria-hidden="true">
            <img className="community-egg" src={BRAND_ASSETS.communityAvatar} alt="" />
          </div>
        </section>

        <div className="community-toolbar">
          <div className="community-search">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder={t('jobs.searchPlaceholder')}
            />
          </div>
          <button
            type="button"
            onClick={() => setFilter('open', !filters.open)}
            aria-pressed={filters.open}
            className={`community-filter ${filters.open ? 'is-active' : ''}`}
          >
            {t('jobs.openOnly')}
          </button>
        </div>

        {categoryTabs.length > 1 && (
          <div className="community-filters mb-5" role="group">
            {categoryTabs.map(tab => (
              <button
                key={tab.value || 'all'}
                type="button"
                onClick={() => setFilter('category', tab.value)}
                aria-pressed={filters.category === tab.value}
                className={`community-filter ${filters.category === tab.value ? 'is-active' : ''}`}
              >
                {tab.label || tab.value}
                <span className="community-filter-count">{tab.count}</span>
              </button>
            ))}
          </div>
        )}

        {facets && (
          <div className="mb-6 flex flex-wrap items-end gap-3">
            <FilterSelect label={t('taxonomy.industryLabel')} values={filters.industry} onChange={v => setFilter('industry', v)} options={facets.industries || []} allLabel={t('jobs.any')} formatLabel={v => t(`taxonomy.ind.${v}`, v)} />
            <FilterSelect label={t('taxonomy.functionLabel')} values={filters.fn} onChange={v => setFilter('fn', v)} options={facets.functions || []} allLabel={t('jobs.any')} formatLabel={v => t(`taxonomy.fn.${v}`, v)} />
            <FilterSelect label={t('jobs.companyType')} values={filters.companyType} onChange={v => setFilter('companyType', v)} options={facets.companyTypes} allLabel={t('jobs.any')} />
            <FilterSelect label={t('jobs.year')} values={filters.year} onChange={v => setFilter('year', v)} options={facets.years} allLabel={t('jobs.any')} formatLabel={yearLabel} />
            <FilterSelect label={t('jobs.city')} values={filters.city} onChange={v => setFilter('city', v)} options={facets.cities} allLabel={t('jobs.any')} />
            <div className="ml-auto flex items-center gap-3">
              {!loading && !error && (
                <span className="text-[12.5px] font-semibold text-brand-muted">{t('jobs.resultCount', { n: total })}</span>
              )}
              <div className="relative shrink-0">
                <select
                  value={filters.sort}
                  onChange={e => setFilter('sort', e.target.value)}
                  aria-label={t('jobs.sortLabel')}
                  className="h-[36px] min-w-[126px] appearance-none rounded-full border border-brand-line bg-brand-card py-0 pl-4 pr-10 text-[12px] font-bold text-brand-ink focus:border-brand-ink focus:outline-none"
                >
                  <option value="updated">{t('jobs.sortUpdated')}</option>
                  <option value="deadline_asc">{t('jobs.sortDeadlineAsc')}</option>
                  <option value="deadline_desc">{t('jobs.sortDeadlineDesc')}</option>
                </select>
                <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand-muted" />
              </div>
              <div className="flex rounded-full border border-brand-line bg-brand-card p-1" role="group" aria-label={t('jobs.viewLabel')}>
                {[['card', LayoutGrid, t('jobs.viewCard')], ['list', List, t('jobs.viewList')]].map(([key, Icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => changeView(key)}
                    aria-pressed={view === key}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${view === key ? 'bg-brand-ink text-brand-on-ink' : 'text-brand-muted hover:text-brand-ink'}`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="h-8 w-8 animate-spin text-brand-muted" />
            <span className="ml-3 text-[13px] font-bold text-brand-muted">{t('jobs.loading')}</span>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-32">
            <p className="text-[13px] font-bold text-brand-danger">{t('jobs.error')}</p>
          </div>
        ) : (
          <>
            {jobs.length === 0 ? (
              <div className="community-empty px-10 py-20 text-center">
                <p className="text-[13.5px] font-bold text-brand-muted">
                  {facets?.total === 0 ? t('jobs.emptyLibrary') : t('jobs.noResults')}
                </p>
              </div>
            ) : view === 'list' ? (
              <div className="experience-card overflow-hidden">
                <div className={`hidden gap-x-5 border-b border-brand-line bg-brand-inset px-5 py-2.5 text-[11.5px] font-bold text-brand-muted md:grid ${LIST_COLUMNS}`}>
                  <span>{t('jobs.colPositions')}</span>
                  <span>{t('jobs.colCompany')}</span>
                  <span>{t('jobs.city')}</span>
                  <button
                    type="button"
                    onClick={() => setFilter('sort', filters.sort === 'deadline_asc' ? 'deadline_desc' : 'deadline_asc')}
                    title={filters.sort === 'deadline_asc' ? t('jobs.sortDeadlineDesc') : t('jobs.sortDeadlineAsc')}
                    className={`inline-flex items-center gap-1 justify-self-start transition-colors hover:text-brand-ink ${filters.sort.startsWith('deadline') ? 'text-brand-ink' : ''}`}
                  >
                    {t('jobs.colDeadline')}
                    {filters.sort === 'deadline_asc' ? <ArrowUp className="h-3.5 w-3.5" />
                      : filters.sort === 'deadline_desc' ? <ArrowDown className="h-3.5 w-3.5" />
                        : <ArrowUpDown className="h-3.5 w-3.5 opacity-60" />}
                  </button>
                  <span />
                </div>
                {jobs.map(job => <JobRow key={job.id} job={job} t={t} jobsReturnTo={jobsReturnTo} />)}
              </div>
            ) : (
              <div className="experience-grid job-grid min-w-0">
                {jobs.map(job => <JobCard key={job.id} job={job} t={t} jobsReturnTo={jobsReturnTo} />)}
              </div>
            )}
            {totalPages > 1 && (
              <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label={t('jobs.pagination')}>
                <button type="button" onClick={() => goToPage(page - 1)} disabled={page === 1 || loading} className="lk-btn lk-btn-ghost h-10 px-3" aria-label={t('jobs.previousPage')}>
                  <ChevronLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">{t('jobs.previousPage')}</span>
                </button>
                {visiblePages.map((value, index) => (
                  <span key={value} className="contents">
                    {index > 0 && value - visiblePages[index - 1] > 1 && <span className="px-1 text-brand-muted">…</span>}
                    <button
                      type="button"
                      onClick={() => goToPage(value)}
                      disabled={loading}
                      aria-current={value === page ? 'page' : undefined}
                      className={`h-10 min-w-10 rounded-full border px-3 text-[12.5px] font-bold transition-colors ${value === page ? 'border-brand-ink bg-brand-ink text-brand-on-ink' : 'border-brand-line bg-brand-card text-brand-muted hover:text-brand-ink'}`}
                    >
                      {value}
                    </button>
                  </span>
                ))}
                <button type="button" onClick={() => goToPage(page + 1)} disabled={page === totalPages || loading} className="lk-btn lk-btn-ghost h-10 px-3" aria-label={t('jobs.nextPage')}>
                  <span className="hidden sm:inline">{t('jobs.nextPage')}</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
                <span className="ml-2 text-[12px] font-semibold text-brand-muted">{t('jobs.pageStatus', { page, pages: totalPages })}</span>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  )
}
