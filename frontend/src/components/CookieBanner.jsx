import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import './CookieBanner.css'
import { BRAND_ASSETS } from '../assets/brandAssets'
import { CONSENT_KEY, setConsent } from '../lib/analytics'

/** 页脚等处的「Cookie 设置」入口派发这个事件，重新打开横幅。 */
export const OPEN_COOKIE_SETTINGS_EVENT = 'open-cookie-settings'

export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))
}

const BRAND_MARK = BRAND_ASSETS.appIcon

export default function CookieBanner() {
  const { t } = useTranslation()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem(CONSENT_KEY)
    // Ask until the user makes a choice. A refusal is respected and not asked
    // again; it can be changed from "Cookie settings".
    if (consent !== 'accepted' && consent !== 'declined') {
      const timer = setTimeout(() => setIsVisible(true), 500)
      return () => clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const open = () => setIsVisible(true)
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, open)
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, open)
  }, [])

  const handleAccept = () => {
    setConsent(true)
    setIsVisible(false)
  }

  const handleDecline = () => {
    setConsent(false)
    setIsVisible(false)
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className="fl-cookie-banner"
          data-track-section="cookie-banner"
        >
          <div className="fl-cookie-card">
            <span className="fl-cookie-glow fl-cookie-glow-yellow" aria-hidden="true" />
            <span className="fl-cookie-glow fl-cookie-glow-mint" aria-hidden="true" />

            <div className="fl-cookie-layout">
              <div className="fl-cookie-brand" aria-hidden="true">
                <img src={BRAND_MARK} alt="" />
              </div>

              <div className="fl-cookie-content">
                <div className="fl-cookie-title-row">
                  <h3>{t('common.cookie.title')}</h3>
                </div>
                <p>{t('common.cookie.desc')}</p>
              </div>

              <div className="fl-cookie-actions">
                <button
                  onClick={handleDecline}
                  className="fl-cookie-button fl-cookie-button-secondary"
                >
                  {t('common.cookie.decline')}
                </button>
                <button
                  onClick={handleAccept}
                  className="fl-cookie-button fl-cookie-button-primary"
                >
                  {t('common.cookie.accept')}
                </button>
              </div>

              <button 
                onClick={() => setIsVisible(false)}
                className="fl-cookie-close"
                aria-label={t('common.cookie.close')}
              >
                <X />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
