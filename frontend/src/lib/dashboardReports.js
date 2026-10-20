const GENERATION_LEASE_MS = 120_000

export function reportGenerationState(interview, now = Date.now()) {
  if (interview?.finalize_status === 'failed') return 'failed'
  if (interview?.report_sync_failed) return 'unknown'
  if (interview?.status !== 'finalizing' && interview?.finalize_status !== 'processing') return 'idle'
  const startedAt = Date.parse(interview.finalize_started_at || '')
  const age = now - startedAt
  return Number.isFinite(startedAt) && age >= -30_000 && age < GENERATION_LEASE_MS ? 'processing' : 'unknown'
}

export function mayAutoGenerateReport(interview) {
  // A failed attempt needs an explicit retry, not another request every visit.
  return interview?.finalize_status !== 'failed' && reportGenerationState(interview) === 'idle'
}

export async function generateDashboardReport(interview, { generate, load, update, active = () => true }) {
  if (!active()) return
  update({ ...interview, finalize_status: 'processing', finalize_started_at: new Date().toISOString() })
  try {
    const response = await generate()
    if (!active()) return
    if (response.ok && response.status !== 202) {
      const body = await response.json()
      if (body.interview) { update(body.interview); return }
    }
  } catch { /* Reconcile even when the transport lost the final response. */ }
  if (!active()) return
  try {
    const response = await load()
    if (!response.ok) throw new Error('Report status unavailable')
    const body = await response.json()
    if (!body.interview) throw new Error('Missing report status')
    if (active()) update(body.interview)
  } catch {
    // Restore the server's last known state; never leave optimistic processing
    // stuck in the shared dashboard cache or claim a network failure is final.
    if (active()) update({ ...interview, report_sync_failed: true })
  }
}
