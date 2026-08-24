import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

// Resolve the backend .env relative to this source file. dotenv's default
// lookup uses process.cwd(), which breaks when the server is launched from the
// monorepo root or an IDE task with a different working directory.
const backendEnvPath = fileURLToPath(new URL('../../.env', import.meta.url))
dotenv.config({ path: backendEnvPath })

