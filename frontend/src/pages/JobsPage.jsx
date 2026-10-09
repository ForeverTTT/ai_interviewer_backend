import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Search, MapPin, Clock, GraduationCap, ExternalLink, Loader2,
  BookOpen, PenLine, ChevronDown, CalendarClock,
} from 'lucide-react'
import { getBackendBaseUrl } from '../lib/backendBase'
import { supabase } from '../lib/supabase'
import { track } from '../lib/analytics'
import { BRAND_ASSETS } from '../assets/brandAssets'
import './CommunityPages.css'

const PAGE_SIZE = 24
const DAY_MS = 24 * 60 * 60 * 1000

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
    ? Math.ceil((new Date(`${job.deadline_date}T23:59:59`) - Date.now()) / DAY_MS)
    : null
  const urgent = daysLeft !== null && daysLeft >= 0 && daysLeft <= 7
  const expired = daysLeft !== null && daysLeft < 0
  return (
    <span className={`flex items-center gap-1 ${urgent ? 'font-bold text-brand-danger' : expired ? 'text-brand-muted line-through' : ''}`}>
      <CalendarClock className="h-3.5 w-3.5" />
      {urgent ? t('jobs.daysLeft', { n: daysLeft }) : job.deadline}
    </span>
  )
}

function JobCard({ job, t }) {
  const [expanded, setExpanded] = useState(false)
  const positions = job.positions || ''
  const long = positions.length > 60

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="experience-card flex flex-col gap-4 p-6"
    >
      <div className="flex flex-wrap items-center gap-2">
        {job.company_type && (
          <span className="inline-flex items-center rounded-lg border border-brand-line bg-brand-inset px-2.5 py-1 text-[11px] font-bold text-brand-ink">
            {job.company_type}
          </span>
        )}
        {job.graduation_years?.map(y => (
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

      <div className="min-w-0">
        <h3 className="font-brand text-[17px] font-semibold leading-tight tracking-[-0.01em] text-brand-ink sm:text-[19px]">
          {job.company}
        </h3>
        {job.industries?.length > 0 && (
          <p className="mt-1 text-[12px] text-brand-muted">{job.industries.join(' · ')}</p>
        )}
      </div>

      {positions && (
        <div>
          <p className={`whitespace-pre-line text-[13.5px] leading-relaxed text-brand-ink ${expanded ? '' : 'line-clamp-2'}`}>
            {positions}
          </p>
          {long && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-brand-muted hover:text-brand-ink"
            >
              {expanded ? t('jobs.collapse') : t('jobs.expand')}
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-brand-muted">
        {job.locations?.length > 0 && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {job.locations.length > 4 ? `${job.locations.slice(0, 4).join(' / ')} +${job.locations.length - 4}` : job.locations.join(' / ')}
          </span>
        )}
        <DeadlineBadge job={job} t={t} />
        {job.education && (
          <span className="flex items-center gap-1">
            <GraduationCap className="h-3.5 w-3.5" />
            {job.education}
          </span>
        )}
        {job.source_updated_at && (
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {t('jobs.updatedAt', { date: job.source_updated_at })}
          </span>
        )}
      </div>

      {(job.major_requirement || job.notes) && (
        <p className="rounded-xl border border-brand-line bg-brand-inset px-4 py-2.5 text-[12.5px] leading-relaxed text-brand-muted">
          {[job.major_requirement, job.notes].filter(Boolean).join(' · ')}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {job.apply_url && (
          <a
            href={job.apply_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('job_apply_clicked', { category: job.category, companyType: job.company_type })}
            className="lk-btn lk-btn-primary"
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

function FilterSelect({ label, value, onChange, options, allLabel }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="ml-1 text-[12px] font-bold text-brand-muted">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-[42px] min-w-[140px] rounded-full border border-brand-line bg-brand-card px-4 text-[13px] font-semibold text-brand-ink focus:border-brand-ink focus:outline-none"
      >
        <option value="">{allLabel}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.value}（{o.count}）</option>
        ))}
      </select>
    </label>
  )
}

export default function JobsPage() {
  const { t } = useTranslation()
  const [facets, setFacets] = useState(null)
  const [filters, setFilters] = useState({ category: '', companyType: '', year: '', city: '', open: true })
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [jobs, setJobs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const requestId = useRef(0)

  useEffect(() => {
    document.title = `${t('jobs.title')} · FlowLab`
  }, [t])

  useEffect(() => {
    authedFetch('/api/jobs/facets').then(setFacets).catch(() => setFacets({ categories: [], companyTypes: [], years: [], cities: [], sources: [] }))
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(async (nextPage) => {
    const id = ++requestId.current
    const params = new URLSearchParams({ page: String(nextPage), pageSize: String(PAGE_SIZE), open: String(filters.open) })
    if (search) params.set('q', search)
    for (const key of ['category', 'companyType', 'year', 'city']) {
      if (filters[key]) params.set(key, filters[key])
    }
    if (nextPage === 1) setLoading(true)
    else setLoadingMore(true)
    try {
      const data = await authedFetch(`/api/jobs?${params}`)
      if (id !== requestId.current) return
      setJobs(prev => (nextPage === 1 ? data.jobs : [...prev, ...data.jobs]))
      setTotal(data.total)
      setPage(nextPage)
      setError(false)
    } catch {
      if (id === requestId.current) setError(true)
    } finally {
      if (id === requestId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [filters, search])

  useEffect(() => {
    load(1)
  }, [load])

  const setFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value }))
  const categoryTabs = [{ value: '', count: facets?.total ?? 0, label: t('jobs.allCategories') }, ...(facets?.categories || [])]
  const hasMore = jobs.length < total

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
                {facets.sources?.length > 0 && ` · ${t('jobs.source', { source: facets.sources.join('、') })}`}
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
            <FilterSelect label={t('jobs.companyType')} value={filters.companyType} onChange={v => setFilter('companyType', v)} options={facets.companyTypes} allLabel={t('jobs.any')} />
            <FilterSelect label={t('jobs.year')} value={filters.year} onChange={v => setFilter('year', v)} options={facets.years} allLabel={t('jobs.any')} />
            <FilterSelect label={t('jobs.city')} value={filters.city} onChange={v => setFilter('city', v)} options={facets.cities} allLabel={t('jobs.any')} />
            {!loading && !error && (
              <span className="mb-3 ml-auto text-[12.5px] font-semibold text-brand-muted">{t('jobs.resultCount', { n: total })}</span>
            )}
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
            <div className="experience-grid min-w-0">
              {jobs.length === 0 ? (
                <div className="community-empty px-10 py-20 text-center">
                  <p className="text-[13.5px] font-bold text-brand-muted">
                    {facets?.total === 0 ? t('jobs.emptyLibrary') : t('jobs.noResults')}
                  </p>
                </div>
              ) : (
                jobs.map(job => <JobCard key={job.id} job={job} t={t} />)
              )}
            </div>
            {hasMore && (
              <div className="mt-8 flex justify-center">
                <button type="button" onClick={() => load(page + 1)} disabled={loadingMore} className="lk-btn lk-btn-ghost">
                  {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('jobs.loadMore', { n: total - jobs.length })}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
