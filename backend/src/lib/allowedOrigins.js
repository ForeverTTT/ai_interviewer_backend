const LOCAL_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

/**
 * FRONTEND_URL accepts a comma-separated list so the old Firebase URL keeps
 * working while users move to the custom domain.
 */
export function parseFrontendOrigins(value) {
  return String(value || 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

export function getAllowedOrigins(value = process.env.FRONTEND_URL) {
  return [...new Set([...parseFrontendOrigins(value), ...LOCAL_ORIGINS])]
}
