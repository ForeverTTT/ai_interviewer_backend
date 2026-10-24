import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, BookOpen, BriefcaseBusiness, Building2, CalendarClock, ExternalLink,
  FileSearch, GraduationCap, Loader2, MapPin, Mic2,
} from 'lucide-react'
import { authenticatedFetch } from '../lib/authenticatedFetch'
import { getBackendBaseUrl } from '../lib/backendBase'
import { track } from '../lib/analytics'
import './CommunityPages.css'

function Facts({ job, t }) {
  const facts = [
    [MapPin, t('jobs.city'), job.locations?.join(' / ')],
    [BriefcaseBusiness, t('jobs.companyType'), job.company_type],
    [GraduationCap, t('jobs.year'), job.graduation_years?.join(' / ')],
    [CalendarClock, t('jobs.colDeadline'), job.deadline_date || job.deadline],
  ].filter(([, , value]) => value)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {facts.map(([Icon, label, value]) => (
        <div key={label} className="rounded-2xl border border-brand-line bg-brand-inset px-4 py-3">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-brand-muted"><Icon className="h-3.5 w-3.5" />{label}</p>
          <p className="mt-1.5 text-[13.5px] font-semibold text-brand-ink">{value}</p>
        </div>
      ))}
    </div>
  )
}

export default function JobDetailPage() {
  const { t } = useTranslation()
  const { jobId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [data, setData] = useState(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authenticatedFetch(`${getBackendBaseUrl()}/api/jobs/${jobId}`)
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body.error || 'load')
        if (!cancelled) setData(body)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [jobId])

  useEffect(() => {
    if (data?.job) document.title = `${data.job.job_title || data.job.positions} · ${data.job.company} · FlowLab`
  }, [data])

  const hasJobsHistory = typeof location.state?.jobsReturnTo === 'string' && location.state.jobsReturnTo.startsWith('/jobs')
  const returnToJobs = () => hasJobsHistory ? navigate(-1) : navigate('/jobs')

  if (error) return (
    <div className="community-page grid min-h-[70vh] place-items-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="font-semibold text-brand-danger">{t('jobs.detailError')}</p>
        <button type="button" onClick={returnToJobs} className="lk-btn lk-btn-ghost">
          <ArrowLeft className="h-4 w-4" />
          {t('jobs.backToJobs')}
        </button>
      </div>
    </div>
  )
  if (!data) return <div className="community-page grid min-h-[70vh] place-items-center"><Loader2 className="h-8 w-8 animate-spin text-brand-muted" /></div>

  const { job, handoff, sources = [] } = data
  const title = job.job_title || job.positions || t('jobs.untitled')
  return (
    <div className="community-page pb-20 pt-[calc(var(--ui-nav-h)+1.5rem)]">
      <div className="community-shell max-w-5xl">
        <button
          type="button"
          onClick={returnToJobs}
          className="relative z-20 mb-5 inline-flex cursor-pointer items-center gap-2 rounded-full px-1 py-1 text-[13px] font-semibold text-brand-muted transition-colors hover:text-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink/30"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('jobs.backToJobs')}
        </button>
        <article className="experience-card overflow-hidden">
          <header className="border-b border-brand-line bg-brand-inset px-6 py-7 sm:px-9 sm:py-9">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-bold text-brand-muted"><Building2 className="h-4 w-4" />{job.company}</p>
                <h1 className="mt-3 font-brand text-3xl font-semibold tracking-[-0.03em] text-brand-ink sm:text-4xl">{title}</h1>
                <p className="mt-3 text-[13px] text-brand-muted">{[job.department, ...(job.industries || [])].filter(Boolean).join(' · ')}</p>
              </div>
              {job.is_open === false
                ? <span className="lk-btn cursor-not-allowed border border-brand-line bg-brand-card text-brand-muted" aria-disabled="true">{t('jobs.closedForApplications')}</span>
                : job.apply_url && <a href={job.apply_url} target="_blank" rel="noopener noreferrer" onClick={() => track('job_apply_clicked', { jobId, company: job.company })} className="lk-btn lk-btn-primary">{t('jobs.apply')}<ExternalLink className="h-4 w-4" /></a>}
            </div>
          </header>

          <div className="grid gap-8 px-6 py-7 sm:px-9 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="min-w-0 space-y-8">
              <section>
                <h2 className="font-brand text-xl font-semibold text-brand-ink">{t('jobs.jdTitle')}</h2>
                <div className="mt-4 whitespace-pre-wrap text-[14px] leading-7 text-brand-ink">{job.job_description || handoff.jobDescription || t('jobs.jdMissing')}</div>
              </section>
              {(job.major_requirement || job.notes) && <section className="rounded-2xl border border-brand-line bg-brand-inset p-5 text-[13.5px] leading-7 text-brand-muted">{[job.major_requirement, job.notes].filter(Boolean).join('\n')}</section>}
              <section className="flex flex-wrap gap-2">
                <Link to={`/setup?jobId=${job.id}`} className="lk-btn lk-btn-primary"><Mic2 className="h-4 w-4" />{t('jobs.mockInterview')}</Link>
                <Link to={`/resume-tailor?jobId=${job.id}`} className="lk-btn lk-btn-ghost"><FileSearch className="h-4 w-4" />{t('jobs.tailorResume')}</Link>
                <Link to={`/experiences?q=${encodeURIComponent(job.company)}`} className="lk-btn lk-btn-ghost"><BookOpen className="h-4 w-4" />{t('jobs.seeExperiences')}</Link>
              </section>
            </div>
            <aside className="space-y-5">
              <Facts job={job} t={t} />
              {sources.length > 0 && <div className="rounded-2xl border border-brand-line bg-brand-card p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-brand-muted">{t('jobs.sources')}</p>
                {sources.map((source, index) => {
                  const sourceUrl = source.source_url
                  return sourceUrl
                    ? <a key={`${source.source_name}-${index}`} href={sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => track('job_source_clicked', { jobId, source: source.source_name })} className="mt-2 flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-ink hover:text-brand-accent">{source.source_name}<ExternalLink className="h-3.5 w-3.5" /></a>
                    : <p key={`${source.source_name}-${index}`} className="mt-2 text-[12.5px] font-semibold text-brand-ink">{source.source_name}</p>
                })}
              </div>}
            </aside>
          </div>
        </article>
      </div>
    </div>
  )
}
