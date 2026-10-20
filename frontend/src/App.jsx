import { Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Outlet, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { ThemeProvider } from './context/ThemeContext'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import CookieBanner from './components/CookieBanner'
import PageAtmosphere from './components/brand/PageAtmosphere'
import AppShell from './components/app/AppShell'
import { useAuth } from './hooks/useAuth'
import { lazyWithReload } from './lib/lazyWithReload'
import { BRAND_ASSETS } from './assets/brandAssets'
import { trackPageView } from './lib/analytics'
import { resetPageCapture } from './lib/autocapture'

const LandingPage = lazyWithReload(() => import('./pages/LandingPage'))
const LoginPage = lazyWithReload(() => import('./pages/LoginPage'))
const SetupPage = lazyWithReload(() => import('./pages/SetupPage'))
const InterviewPage = lazyWithReload(() => import('./pages/InterviewPage'))
const DashboardPage = lazyWithReload(() => import('./pages/DashboardPage'))
const NotesPage = lazyWithReload(() => import('./pages/NotesPage'))
const InterviewReportPage = lazyWithReload(() => import('./pages/InterviewReportPage'))
const AuthCallbackPage = lazyWithReload(() => import('./pages/AuthCallbackPage'))
const ResetPasswordPage = lazyWithReload(() => import('./pages/ResetPasswordPage'))
const ProfilePage = lazyWithReload(() => import('./pages/ProfilePage'))
const GallupTestPage = lazyWithReload(() => import('./pages/GallupTestPage'))
const ExperiencesPage = lazyWithReload(() => import('./pages/ExperiencesPage'))
const ResumeTailorPage = lazyWithReload(() => import('./pages/ResumeTailorPage'))
const JobsPage = lazyWithReload(() => import('./pages/JobsPage'))
const CoachPage = lazyWithReload(() => import('./pages/CoachPage'))
const AdminReviewPage = lazyWithReload(() => import('./pages/AdminReviewPage'))

function PageFallback() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-paper text-brand-muted">
      <img src={BRAND_ASSETS.appIcon} alt="" className="h-14 w-14 animate-pulse-soft object-contain" />
      <span role="status" aria-live="polite" className="text-[12.5px] tracking-wide">Loading…</span>
    </div>
  )
}

/**
 * 站内通用外壳：浮动顶栏 + 页面内容 + 页脚。
 * atmosphere：内页顶部铺一层淡淡的港口插画；首页自己有整幅主视觉，所以关掉。
 */
function Layout({ children, hideFooter = false, hideNavbar = false, atmosphere = true }) {
  return (
    <div className="relative min-h-screen bg-brand-paper">
      {atmosphere && <PageAtmosphere />}
      {!hideNavbar && <Navbar />}
      <main className="relative z-10 min-h-[calc(100dvh-var(--ui-nav-h))]">{children}</main>
      {!hideFooter && <Footer />}
    </div>
  )
}

/**
 * 公开页（面经库）：登录后进入带侧栏的工作台外壳，未登录时仍是官网式顶栏布局。
 */
function AdaptiveLayout({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <PageFallback />
  return user ? <AppShell>{children}</AppShell> : <Layout>{children}</Layout>
}

/** 每次路由变化记录一次页面浏览（query 变化不算新页面）。未同意 Cookie 时不采集。 */
function usePageTracking() {
  const { pathname } = useLocation()
  useEffect(() => {
    resetPageCapture()
    trackPageView(pathname)
  }, [pathname])
}

/** ThemeProvider 放在带 Outlet 的布局内，保证与路由上下文一致且切换路由时不丢主题状态 */
function AppThemeShell() {
  usePageTracking()
  return (
    <ThemeProvider>
      {/* 尊重系统「减少动态效果」设置：framer-motion 的位移动画自动降级为淡入 */}
      <MotionConfig reducedMotion="user">
        <Outlet />
        <CookieBanner />
      </MotionConfig>
    </ThemeProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<AppThemeShell />}>
          <Route path="/" element={
            <Layout atmosphere={false} hideNavbar hideFooter>
              <LandingPage />
            </Layout>
          } />

          <Route path="/login" element={<LoginPage />} />

          {/* OAuth callback — must NOT be wrapped in ProtectedRoute */}
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/auth/reset-password" element={<ResetPasswordPage />} />

          <Route path="/setup" element={
            <ProtectedRoute>
              <AppShell>
                <SetupPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/interview" element={
            <ProtectedRoute>
              {/* No navbar/footer in interview mode - full screen */}
              <InterviewPage />
            </ProtectedRoute>
          } />
          <Route path="/interview/:interviewId" element={
            <ProtectedRoute>
              <InterviewPage />
            </ProtectedRoute>
          } />

          <Route path="/dashboard" element={
            <ProtectedRoute>
              <AppShell>
                <DashboardPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/notes" element={
            <ProtectedRoute>
              <AppShell>
                <NotesPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/profile" element={
            <ProtectedRoute>
              <AppShell>
                <ProfilePage />
              </AppShell>
            </ProtectedRoute>
          } />
          <Route path="/profile/edit" element={
            <ProtectedRoute>
              <AppShell>
                <ProfilePage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/resume-tailor" element={
            <ProtectedRoute>
              <AppShell>
                <ResumeTailorPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/interview/:interviewId/report" element={
            <ProtectedRoute>
              <AppShell>
                <InterviewReportPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/gallup" element={
            <ProtectedRoute>
              <AppShell>
                <GallupTestPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/jobs" element={
            <ProtectedRoute>
              <AppShell>
                <JobsPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/coaches" element={
            <ProtectedRoute>
              <AppShell>
                <CoachPage />
              </AppShell>
            </ProtectedRoute>
          } />

          <Route path="/experiences" element={
            <AdaptiveLayout>
              <ExperiencesPage />
            </AdaptiveLayout>
          } />

          {/* Admin-only; the page and the API both check ADMIN_EMAILS */}
          <Route path="/admin/experiences" element={
            <ProtectedRoute>
              <AppShell>
                <AdminReviewPage />
              </AppShell>
            </ProtectedRoute>
          } />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
