import { z } from 'zod'

export const validate = (schema) => (req, res, next) => {
  try {
    if (!schema || typeof schema.safeParse !== 'function') {
      return res.status(500).json({ error: 'Validation schema misconfigured' })
    }

    const result = schema.safeParse(req.body)
    if (result.success) return next()

    const err = result.error
    const issues = err?.issues || err?.errors || []
    console.error('[ValidationFailed]', {
      method: req.method,
      url: req.originalUrl || req.url,
      issues,
      zodMessage: err?.message,
      name: err?.name,
    })

    const mappedDetails = (Array.isArray(issues) ? issues : []).map((i) => ({
      path: Array.isArray(i?.path) ? i.path.join('.') : '',
      message: i?.message || 'Invalid input',
    }))

    const details = mappedDetails.length
      ? mappedDetails
      : [{ path: '', message: err?.message || 'Invalid input' }]
    return res.status(400).json({
      error: 'Validation failed',
      details,
    })
  } catch (error) {
    // If zod throws a non-ZodError (e.g., internal TypeError), avoid crashing the request.
    // Treat it as validation failure so the frontend can show useful feedback.
    const maybeIssues = error?.issues || error?.errors || []
    console.error('[ValidationMiddlewareCatch]', {
      method: req.method,
      url: req.originalUrl || req.url,
      error,
      maybeIssues,
    })
    if (Array.isArray(maybeIssues)) {
      return res.status(400).json({
        error: 'Validation failed',
        details: maybeIssues.map((i) => ({
          path: Array.isArray(i?.path) ? i.path.join('.') : '',
          message: i?.message || 'Invalid input',
        })),
      })
    }

    // Fallback: return a 400 with the error message for visibility.
    return res.status(400).json({
      error: 'Validation failed',
      details: [{ path: '', message: error?.message || 'Invalid input' }],
    })
  }
}
