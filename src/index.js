import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import 'dotenv/config'
import interviewsRouter from './routes/interviews.js'
import chatRouter from './routes/chat.js'
import profileRouter from './routes/profile.js'
import gallupRouter from './routes/gallup.js'
import aiAssistantRouter from './routes/aiAssistant.js'
import experiencesRouter from './routes/experiences.js'

const app = express()
const PORT = process.env.PORT || 5000
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Trust proxy for Cloud Run / Load Balancer
app.set('trust proxy', 1)

// 1. Security Headers (Helmet)
// Includes CSP, HSTS, X-Frame-Options, etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://*.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://*.supabase.co"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      upgradeInsecureRequests: [],
    },
  },
}))

// 2. Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Increased for dev/testing
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
})

// 3. Strict Limiter for AI and Auth sensitive routes
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 500, // Increased for dev/testing
  message: { error: 'Hourly limit reached for AI/Auth services. Please wait.' },
})

// Middleware
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/api/', globalLimiter) // Apply to all API routes
app.use('/api/chat', strictLimiter) // Extra protection for AI chat
app.use('/api/ai-assistant', strictLimiter) // Extra protection for Assistant

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'InterviewDE API',
  })
})

// Routes
app.use('/api/interviews', interviewsRouter)
app.use('/api/chat', chatRouter)
app.use('/api/profile', profileRouter)
app.use('/api/gallup', gallupRouter)
app.use('/api/ai-assistant', aiAssistantRouter)
app.use('/api/experiences', experiencesRouter)

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` })
})

// Error handler
app.use((err, req, res, next) => {
  console.error('[Express Error]', err)
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║  InterviewDE Backend                 ║
║  Running on http://localhost:${PORT}   ║
╚══════════════════════════════════════╝
  `)
})
