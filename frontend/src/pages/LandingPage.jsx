import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { BRAND_ASSETS } from '../assets/brandAssets'
import boschLogo from '../assets/logos/bosch.png'
import sapLogo from '../assets/logos/sap.png'
import schaefflerLogo from '../assets/logos/schaeffler.png'
import {
  ArrowRight,
  AudioLines,
  Bot,
  Check,
  ChevronRight,
  Monitor,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import LanguageSwitcher from '../components/LanguageSwitcher'
import { InterviewMock, ResumeMock, ReviewMock } from '../components/landing/ProductMocks'
import './LandingPage.css'

const BRAND_WORDMARK = BRAND_ASSETS.wordmark
const HERO_STICKER = BRAND_ASSETS.stickers.interviewPractice
const WHY_STICKER = BRAND_ASSETS.stickers.smallStepsBigTomorrow
const PROGRESS_STICKER = BRAND_ASSETS.stickers.goodProgress
const ENCOURAGEMENT_STICKER = BRAND_ASSETS.stickers.youGotThis
const COMMUNITY_AVATAR = BRAND_ASSETS.communityAvatar

const COMMUNITY_POSTS = [
  { id: '032' },
  { id: '117' },
  { id: '208' },
  { id: '284' },
  { id: '351' },
  { id: '426' },
]

const TECH_ITEMS = [
  { id: 'agent', icon: Bot },
  { id: 'sft', icon: SlidersHorizontal },
  { id: 'voice', icon: AudioLines },
  { id: 'simulation', icon: Monitor },
  { id: 'privacy', icon: ShieldCheck },
]

const OFFER_LOGOS = [
  { id: 'heidelberg', name: 'Universität Heidelberg', src: '/logos/uni-heidelberg.svg' },
  { id: 'bmw', name: 'BMW', src: '/logos/bmw.svg' },
  { id: 'siemens', name: 'Siemens', src: '/logos/siemens.svg' },
  { id: 'sap', name: 'SAP', src: sapLogo },
  { id: 'bosch', name: 'Bosch', src: boschLogo },
  { id: 'schaeffler', name: 'Schaeffler', src: schaefflerLogo },
  { id: 'tum', name: 'Technische Universität München', src: '/logos/uni-tum.svg' },
  { id: 'rwth', name: 'RWTH Aachen', src: '/logos/uni-rwth.svg' },
  { id: 'eth', name: 'ETH Zürich', src: '/logos/uni-eth.svg' },
]

function Hero({ ctaLink }) {
  const { t } = useTranslation()
  const proofPoints = ['jd', 'voice', 'review']
  return (
    <section className="fl-hero">
      <div className="fl-mesh fl-mesh-a" aria-hidden="true" /><div className="fl-mesh fl-mesh-b" aria-hidden="true" />
      <div className="fl-hero-grid">
        <motion.div className="fl-hero-copy" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
          <img className="fl-hero-logo" src={BRAND_WORDMARK} alt="FlowLab" />
          <h1 className="fl-hero-title">
            {t('landingV2.hero.title')}
            <br />
            <em>{t('landingV2.hero.titleAccent')}</em>
          </h1>
          <p className="fl-hero-lead">{t('landingV2.hero.lead')}</p>
          <div className="fl-hero-actions">
            <Link to={ctaLink} className="fl-primary-cta">{t('landingV2.hero.primary')} <ArrowRight size={19} strokeWidth={2.4} /></Link>
            <a href="#meet-shells" className="fl-secondary-cta">{t('landingV2.hero.secondary')} <ChevronRight size={18} /></a>
          </div>
          <div className="fl-proof-row" aria-label={t('landingV2.hero.proofLabel')}>
            {proofPoints.map((key) => <span key={key}><Check size={13} strokeWidth={3} /> {t(`landingV2.hero.proof.${key}`)}</span>)}
          </div>
        </motion.div>

        <div className="fl-hero-visual">
          <div className="fl-stage-glass">
            <motion.span className="fl-character-halo fl-halo-blue" initial={{ opacity: 0, scale: 0.82 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.75, ease: [0.16, 1, 0.3, 1] }} />
            <motion.img
              className="fl-base-hero-mascot"
              src={HERO_STICKER}
              alt={t('landingV2.hero.stickerAlt')}
              initial={{ opacity: 0, y: 34, rotate: -2, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

const HOW_STEPS = [
  { id: 'coach', Mock: InterviewMock, route: '/setup' },
  { id: 'resume', Mock: ResumeMock, route: '/resume-tailor' },
  { id: 'review', Mock: ReviewMock, route: '/dashboard' },
]

function HowFlowLabWorks({ user }) {
  const { t } = useTranslation()

  return (
    <section className="fl-how-section" id="meet-shells">
      <div className="fl-how-heading">
        <h2>{t('landingV2.how.title')}</h2>
        <p>{t('landingV2.how.subtitle')}</p>
      </div>

      <div className="fl-how-list">
        {HOW_STEPS.map(({ id, Mock, route }, index) => {
          const points = t(`landingV2.how.steps.${id}.points`, { returnObjects: true })
          return (
            <motion.article
              key={id}
              className={`fl-how-step fl-how-${id} ${index % 2 ? 'is-flipped' : ''}`}
              initial={{ opacity: 0, y: 36 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.22 }}
              transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="fl-how-visual">
                <Mock />
              </div>

              <div className="fl-how-copy">
                <span className="fl-how-kicker">{String(index + 1).padStart(2, '0')} · {t(`landingV2.how.steps.${id}.kicker`)}</span>
                <h3>{t(`landingV2.how.steps.${id}.feature`)}</h3>
                <p className="fl-how-intro">{t(`landingV2.how.steps.${id}.intro`)}</p>
                <ul className="fl-how-points">
                  {Array.isArray(points) && points.map((point) => (
                    <li key={point}><Check size={14} strokeWidth={3} /> {point}</li>
                  ))}
                </ul>
                <Link to={user ? route : '/login'} className="fl-how-cta">
                  {t(`landingV2.how.steps.${id}.cta`)} <ArrowRight size={17} />
                </Link>
              </div>
            </motion.article>
          )
        })}
      </div>

      <motion.div
        className="fl-how-soon"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <img src={BRAND_ASSETS.jobDetective} alt="" aria-hidden="true" />
        <div>
          <span className="fl-how-status">{t('landingV2.how.soon.badge')}</span>
          <h3>{t('landingV2.how.soon.title')}</h3>
          <p>{t('landingV2.how.soon.copy')}</p>
        </div>
      </motion.div>
    </section>
  )
}

function WhyFlowLab() {
  const { t } = useTranslation()
  const reasons = ['loop', 'mentor', 'resume', 'simulation']
  const path = ['search', 'resume', 'interview', 'review']

  return (
    <section className="fl-why-section">
      <motion.div
        className="fl-why-heading"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.45 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2>{t('landingV2.why.title')}</h2>
        <p>{t('landingV2.why.copy')}</p>
      </motion.div>

      <div className="fl-why-layout">
        <motion.div
          className="fl-why-story"
          initial={{ opacity: 0, x: -28 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <img className="fl-why-sticker" src={WHY_STICKER} alt={t('landingV2.why.stickerAlt')} />
          <h3>{t('landingV2.why.storyTitle')}</h3>
          <p>{t('landingV2.why.storyCopy')}</p>
          <div className="fl-why-path" aria-label={t('landingV2.why.pathLabel')}>
            {path.map((step, index) => (
              <div key={step}>
                <i>{String(index + 1).padStart(2, '0')}</i>
                <span>{t(`landingV2.why.path.${step}`)}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <div className="fl-why-reasons">
          {reasons.map((reason, index) => (
            <motion.article
              key={reason}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.45 }}
              transition={{ duration: 0.58, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{t(`landingV2.why.reasons.${reason}.title`)}</h3>
                <p>{t(`landingV2.why.reasons.${reason}.copy`)}</p>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Technology() {
  const { t } = useTranslation()

  return (
    <section className="fl-tech-section">
      <motion.div
        className="fl-tech-heading"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2>{t('landingV2.tech.title')}</h2>
        <p>{t('landingV2.tech.copy')}</p>
      </motion.div>

      <div className="fl-tech-grid">
        {TECH_ITEMS.map(({ id, icon: Icon }, index) => (
          <article
            key={id}
            className={`fl-tech-card fl-tech-card-${id}`}
          >
            <div className="fl-tech-card-top">
              <span className="fl-tech-icon"><Icon size={21} strokeWidth={1.8} /></span>
              <span className="fl-tech-index">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <span className="fl-tech-term">{t(`landingV2.tech.items.${id}.term`)}</span>
            <h3>{t(`landingV2.tech.items.${id}.title`)}</h3>
            <p>{t(`landingV2.tech.items.${id}.copy`)}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function OfferShowcase() {
  const { t } = useTranslation()

  const renderLogos = (duplicate = false) => (
    <div className="fl-offer-logo-row" aria-hidden={duplicate ? 'true' : undefined}>
      {OFFER_LOGOS.map((logo) => (
        <div className="fl-offer-logo" key={`${duplicate ? 'copy' : 'original'}-${logo.id}`} title={logo.name}>
          <img src={logo.src} alt={duplicate ? '' : logo.name} />
        </div>
      ))}
    </div>
  )

  return (
    <section className="fl-offer-section">
      <motion.div
        className="fl-offer-heading"
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.45 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <h2>{t('landingV2.offer.title')}</h2>
        <p>{t('landingV2.offer.disclaimer')}</p>
      </motion.div>
      <div className="fl-offer-band">
        <div className="fl-offer-marquee" aria-label={t('landingV2.offer.logoLabel')}>
          <div className="fl-offer-track">
            {renderLogos()}
            {renderLogos(true)}
          </div>
        </div>
      </div>
    </section>
  )
}

function CommunityPreview() {
  const { t } = useTranslation()

  const renderPost = (post, duplicate = false) => (
    <article
      key={`${post.id}-${duplicate ? 'duplicate' : 'original'}`}
      className={`fl-community-post fl-community-post-${post.id}`}
      aria-hidden={duplicate ? 'true' : undefined}
    >
      <div className="fl-community-post-head">
        <img src={COMMUNITY_AVATAR} alt={duplicate ? '' : t('landingV2.community.avatarAlt')} />
        <div><strong>{t('landingV2.community.member', { id: post.id })}</strong><span>{t(`landingV2.community.posts.${post.id}.meta`)}</span></div>
        <em>{t(`landingV2.community.posts.${post.id}.tag`)}</em>
      </div>
      <h3>{t(`landingV2.community.posts.${post.id}.title`)}</h3>
      <p>{t(`landingV2.community.posts.${post.id}.copy`)}</p>
      <div className="fl-community-post-foot"><span>{t(`landingV2.community.posts.${post.id}.saves`)}</span><span>{t(`landingV2.community.posts.${post.id}.replies`)}</span></div>
    </article>
  )

  return (
    <section className="fl-section fl-community-preview">
      <div className="fl-community-heading">
        <motion.img
          className="fl-community-sticker"
          src={PROGRESS_STICKER}
          alt={t('landingV2.community.stickerAlt')}
          initial={{ opacity: 0, y: 18, rotate: -5 }}
          whileInView={{ opacity: 1, y: 0, rotate: 3 }}
          viewport={{ once: true, amount: 0.35 }}
          transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
        />
        <h2>{t('landingV2.community.title')}</h2>
        <p>{t('landingV2.community.copy')}</p>
      </div>
      <div className="fl-community-carousel" aria-label={t('landingV2.community.carouselLabel')}>
        <div className="fl-community-feed">
          <div className="fl-community-track">
            {COMMUNITY_POSTS.map((post) => renderPost(post))}
            {COMMUNITY_POSTS.map((post) => renderPost(post, true))}
          </div>
        </div>
      </div>
    </section>
  )
}

function Closing({ ctaLink }) {
  const { t } = useTranslation()
  return (
    <section className="fl-closing-wrap" aria-label={t('landingV2.closing.aria')}>
      <div className="fl-closing">
        <motion.img className="fl-closing-mascot" src={ENCOURAGEMENT_STICKER} alt={t('landingV2.closing.stickerAlt')} initial={{ opacity: 0, y: 18, rotate: -3 }} whileInView={{ opacity: 1, y: 0, rotate: 2 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }} />
        <Link to={ctaLink} className="fl-primary-cta fl-primary-dark">{t('landingV2.closing.cta')} <ArrowRight size={19} /></Link>
      </div>
    </section>
  )
}

function LandingFooter({ ctaLink }) {
  const { t } = useTranslation()
  return (
    <footer className="fl-footer">
      <div className="fl-footer-main">
        <div className="fl-footer-about">
          <Link to="/" className="fl-footer-brand"><img className="fl-footer-wordmark" src={BRAND_WORDMARK} alt="FlowLab" /></Link>
        </div>
        <div className="fl-footer-column"><strong>{t('landingV2.footer.quickNav')}</strong><Link to="/">{t('landingV2.footer.home')}</Link><Link to={ctaLink}>{t('landingV2.footer.start')}</Link><Link to="/dashboard">{t('landingV2.footer.growth')}</Link><Link to="/profile">{t('landingV2.footer.profile')}</Link></div>
        <div className="fl-footer-column"><strong>{t('landingV2.footer.about')}</strong><span>{t('landingV2.footer.languages')}</span><span>{t('landingV2.footer.roles')}</span><span>{t('landingV2.footer.companion')}</span></div>
      </div>
      <div className="fl-footer-bottom"><span>{t('landingV2.footer.copyright')}</span><span>{t('landingV2.footer.tagline')}</span></div>
    </footer>
  )
}

export default function LandingPage() {
  const { user } = useAuth()
  const { t, i18n } = useTranslation()
  const ctaLink = user ? '/setup' : '/login'

  useEffect(() => {
    document.title = t('landingV2.metaTitle')
  }, [i18n.resolvedLanguage, t])

  return (
    <div className="flowlab-landing">
      <div className="fl-landing-language">
        <LanguageSwitcher />
      </div>
      <main>
        <Hero ctaLink={ctaLink} />
        <HowFlowLabWorks user={user} />
        <OfferShowcase />
        <WhyFlowLab />
        <Technology />
        <CommunityPreview />
        <Closing ctaLink={ctaLink} />
      </main>
      <LandingFooter ctaLink={ctaLink} />
    </div>
  )
}
