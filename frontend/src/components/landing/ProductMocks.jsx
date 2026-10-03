import { useRef } from 'react'
import { useInView } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Bookmark, BookmarkCheck, Camera, Check, Clock3, Mic, Sparkles } from 'lucide-react'
import { BRAND_ASSETS } from '../../assets/brandAssets'
import './ProductMocks.css'

const INTERVIEWER_PHOTO = '/images/interviewer-hr.png'
const REVIEW_SCORES = [82, 71, 64, 86, 77]
const DIMENSIONS = ['technical', 'evidence', 'structure', 'communication', 'strategy']
const INTERVIEW_LANGUAGES = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'EN' },
  { id: 'de', label: 'DE' },
]

// Splits "use [SQL] daily" into text and keyword segments so translators can mark
// the JD keywords inline without the markup leaking into other languages.
function splitKeywords(line) {
  return line.split(/(\[[^\]]+\])/g).filter(Boolean).map((part) => (
    part.startsWith('[') ? { keyword: part.slice(1, -1) } : { text: part }
  ))
}

const asList = (value) => (Array.isArray(value) ? value : [])

// Same `**keyword**` markup the real interview report uses for its highlights.
function Emphasis({ text }) {
  return String(text).split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
    part.startsWith('**') ? <strong key={index} className="fl-mock-em">{part.slice(2, -2)}</strong> : <span key={index}>{part}</span>
  ))
}

function MockWindow({ title, mascot, className = '', children }) {
  const ref = useRef(null)
  const live = useInView(ref, { once: true, amount: 0.35 })

  return (
    <div ref={ref} className={`fl-mock ${className} ${live ? 'is-live' : ''}`} aria-hidden="true">
      <div className="fl-mock-window">
        <div className="fl-mock-bar">
          <span className="fl-mock-dots"><i /><i /><i /></span>
          <span className="fl-mock-title">{title}</span>
        </div>
        {children}
      </div>
      {mascot && <img className="fl-mock-mascot" src={mascot} alt="" />}
    </div>
  )
}

export function ResumeMock() {
  const { t } = useTranslation()
  const bullets = t('landingV2.how.mock.resume.bullets', { returnObjects: true })
  const lines = Array.isArray(bullets) ? bullets.map(splitKeywords) : []
  const keywords = lines.flat().filter((part) => part.keyword).map((part) => part.keyword)
  const missing = t('landingV2.how.mock.resume.missingKeywords', { returnObjects: true })

  return (
    <MockWindow title={t('landingV2.how.steps.resume.feature')} mascot={BRAND_ASSETS.resumeTailorWorking} className="fl-mock-resume">
      <div className="fl-mock-body">
        <div className="fl-mock-tabs">
          <span className="is-active">{t('landingV2.how.mock.resume.tabResume')}</span>
          <span>{t('landingV2.how.mock.resume.tabLetter')}</span>
          <em className="fl-mock-resume-run"><Sparkles size={12} /> {t('landingV2.how.mock.resume.run')}</em>
        </div>

        <div className="fl-mock-target">
          <small>{t('landingV2.how.mock.resume.targetLabel')}</small>
          <b>{t('landingV2.how.mock.resume.targetValue')}</b>
        </div>

        <div className="fl-mock-doc">
          <small>{t('landingV2.how.mock.resume.section')}</small>
          {lines.map((parts, lineIndex) => (
            <p key={lineIndex} style={{ '--d': `${0.5 + lineIndex * 0.55}s` }}>
              {parts.map((part, partIndex) => (part.keyword
                ? <mark key={partIndex} style={{ '--d': `${0.8 + lineIndex * 0.55 + partIndex * 0.12}s` }}>{part.keyword}</mark>
                : <span key={partIndex}>{part.text}</span>))}
            </p>
          ))}
        </div>

        <div className="fl-mock-keywords">
          <div className="fl-mock-matched">
            <small><Check size={11} strokeWidth={3} /> {t('landingV2.how.mock.resume.matched')}</small>
            <div>
              {keywords.map((keyword, index) => (
                <span key={keyword} style={{ '--d': `${1.9 + index * 0.16}s` }}>{keyword}</span>
              ))}
            </div>
          </div>
          <div className="fl-mock-missing">
            <small>{t('landingV2.how.mock.resume.missing')}</small>
            <div>
              {Array.isArray(missing) && missing.map((keyword) => <span key={keyword}>{keyword}</span>)}
            </div>
            <p>{t('landingV2.how.mock.resume.missingNote')}</p>
          </div>
        </div>
      </div>
    </MockWindow>
  )
}

export function InterviewMock() {
  const { t, i18n } = useTranslation()
  const activeLanguage = INTERVIEW_LANGUAGES.find(({ id }) => i18n.language?.startsWith(id))?.id ?? 'en'

  return (
    <MockWindow title={t('landingV2.how.steps.coach.feature')} mascot={BRAND_ASSETS.interviewCoachWriting} className="fl-mock-interview">
      <div className="fl-mock-room">
        <div className="fl-mock-stage">
          <img className="fl-mock-interviewer" src={INTERVIEWER_PHOTO} alt="" />
          <div className="fl-mock-stage-top">
            <span className="fl-mock-live"><i /> Live</span>
            <span className="fl-mock-phase">{t('landingV2.how.mock.coach.phase')}</span>
          </div>
          <div className="fl-mock-stage-bottom">
            <b>{t('landingV2.how.mock.coach.interviewer')}</b>
            <span className="fl-mock-wave"><i /><i /><i /><i /><i /></span>
            <small>{t('landingV2.how.mock.coach.speaking')}</small>
          </div>
          <div className="fl-mock-self">
            <img src={BRAND_ASSETS.communityAvatar} alt="" />
            <span>{t('landingV2.how.mock.coach.you')}</span>
          </div>
        </div>

        <div className="fl-mock-transcript">
          <div className="fl-mock-transcript-head">
            <b>{t('landingV2.how.mock.coach.transcript')}</b>
            <span><Clock3 size={11} /> 12:48</span>
          </div>
          <p className="fl-mock-bubble is-ai" style={{ '--d': '0.4s' }}>{t('landingV2.how.mock.coach.q1')}</p>
          <p className="fl-mock-bubble is-you" style={{ '--d': '1.3s' }}>{t('landingV2.how.mock.coach.a1')}</p>
          <p className="fl-mock-bubble is-ai is-follow" style={{ '--d': '2.4s' }}>
            <em>{t('landingV2.how.mock.coach.followUp')}</em>
            {t('landingV2.how.mock.coach.q2')}
          </p>
        </div>
      </div>

      <div className="fl-mock-controls">
        <span className="fl-mock-ctl is-on"><Mic size={13} /></span>
        <span className="fl-mock-ctl"><Camera size={13} /></span>
        <span className="fl-mock-langs">
          {INTERVIEW_LANGUAGES.map(({ id, label }) => (
            <i key={id} className={id === activeLanguage ? 'is-active' : ''}>{label}</i>
          ))}
        </span>
        <span className="fl-mock-connected"><i /> {t('landingV2.how.mock.coach.connected')}</span>
      </div>
    </MockWindow>
  )
}

export function ReviewMock() {
  const { t } = useTranslation()
  const overall = Math.round(REVIEW_SCORES.reduce((sum, score) => sum + score, 0) / REVIEW_SCORES.length)

  return (
    <MockWindow title={t('landingV2.how.steps.review.feature')} mascot={BRAND_ASSETS.reviewMentorWriting} className="fl-mock-review">
      <div className="fl-mock-report">
        <div className="fl-mock-readiness">
          <small>{t('landingV2.how.mock.review.readiness')}</small>
          <div className="fl-mock-ring" style={{ '--score': overall }}>
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" /><circle cx="50" cy="50" r="42" pathLength="100" /></svg>
            <b>{overall}</b>
          </div>
          <ul>
            {DIMENSIONS.map((dimension, index) => (
              <li key={dimension} style={{ '--score': REVIEW_SCORES[index], '--d': `${0.4 + index * 0.12}s` }}>
                <span>{t(`landingV2.how.mock.review.dimensions.${dimension}`)}</span>
                <b>{REVIEW_SCORES[index]}</b>
                <i />
              </li>
            ))}
          </ul>
        </div>

        <div className="fl-mock-card">
          <div className="fl-mock-card-head">
            <span>{t('landingV2.how.mock.review.round')}</span>
            <small>3 / 6</small>
          </div>
          <p className="fl-mock-question">{t('landingV2.how.mock.review.question')}</p>
          <div className="fl-mock-answer" style={{ '--d': '0.8s' }}>
            <small>{t('landingV2.how.mock.review.answerLabel')}</small>
            <p>{t('landingV2.how.mock.review.answer')}</p>
          </div>
          {/* Mirrors the back of the real question card: bulleted gaps, numbered tips. */}
          <div className="fl-mock-gap" style={{ '--d': '1.2s' }}>
            <small>{t('landingV2.how.mock.review.gapLabel')}</small>
            <ul>
              {asList(t('landingV2.how.mock.review.gaps', { returnObjects: true })).map((item) => (
                <li key={item}><Emphasis text={item} /></li>
              ))}
            </ul>
          </div>
          <div className="fl-mock-tip" style={{ '--d': '1.6s' }}>
            <small>{t('landingV2.how.mock.review.tipLabel')}</small>
            <ol>
              {asList(t('landingV2.how.mock.review.tips', { returnObjects: true })).map((item, index) => (
                <li key={item}><i>{index + 1}</i><span><Emphasis text={item} /></span></li>
              ))}
            </ol>
          </div>
          <span className="fl-mock-collect">
            <span className="fl-mock-collect-idle"><Bookmark size={12} /> {t('landingV2.how.mock.review.collect')}</span>
            <span className="fl-mock-collect-done"><BookmarkCheck size={12} /> {t('landingV2.how.mock.review.collected')}</span>
          </span>
        </div>
      </div>
    </MockWindow>
  )
}
