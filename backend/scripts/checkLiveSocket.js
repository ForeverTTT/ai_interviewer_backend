import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const frontendEnvPath = fileURLToPath(new URL('../../frontend/.env', import.meta.url))
const frontendEnv = dotenv.parse(await readFile(frontendEnvPath))
const supabase = createClient(frontendEnv.VITE_SUPABASE_URL, frontendEnv.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const checkLanguage = process.argv[2] || 'English'

const { data, error } = await supabase.auth.signInWithPassword({
  email: frontendEnv.VITE_LOCAL_EMAIL || 'local@example.com',
  password: frontendEnv.VITE_LOCAL_PASSWORD || 'localdev123',
})
if (error || !data.session?.access_token) throw error || new Error('Local login did not return a session')

const result = await new Promise((resolve, reject) => {
  const socket = new WebSocket('ws://localhost:5000/api/chat/live', {
    headers: { Origin: 'http://localhost:3000' },
  })
  let audioEvents = 0
  let transcript = ''
  const timeout = setTimeout(() => {
    socket.terminate()
    reject(new Error('Live WebSocket check timed out'))
  }, 30_000)

  socket.on('open', () => {
    socket.send(JSON.stringify({
      type: 'start',
      token: data.session.access_token,
      config: {
        position: checkLanguage === 'Chinese' ? '人工智能实习生' : 'Software Engineer',
        jobDescription: 'Backend engineering role using JavaScript and cloud services.',
        language: checkLanguage,
        duration: 10,
        roleTrack: 'work',
      },
    }))
  })

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'audio') audioEvents++
    if (message.type === 'output_transcript') transcript = message.text || transcript
    if (message.type === 'error') {
      clearTimeout(timeout)
      socket.close()
      reject(new Error(message.message))
    }
    if (message.type === 'turn_complete') {
      clearTimeout(timeout)
      socket.close(1000, 'Check complete')
      resolve({
        ok: audioEvents > 0 && Boolean((message.outputText || transcript).trim()),
        audioEvents,
        transcript: (message.outputText || transcript).trim(),
      })
    }
  })

  socket.on('error', (socketError) => {
    clearTimeout(timeout)
    reject(socketError)
  })
})

console.log(JSON.stringify(result))
if (!result.ok) process.exitCode = 1
