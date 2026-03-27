import express from 'express'
import cors from 'cors'
import 'dotenv/config'
import interviewsRouter from './routes/interviews.js'
import chatRouter from './routes/chat.js'
import profileRouter from './routes/profile.js'
import gallupRouter from './routes/gallup.js'

const app = express()
const PORT = process.env.PORT || 5000
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

// Middleware
app.use(cors({
  origin: [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

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
