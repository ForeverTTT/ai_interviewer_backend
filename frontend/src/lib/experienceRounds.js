/**
 * A shared experience describes one interview round, stored as rounds[0].
 * Older posts may still hold several rounds; those keep their per-round layout.
 */

/** "技术面 · 30 min" for single-round posts, '' otherwise. */
export function roundSummary(rounds) {
  if (!Array.isArray(rounds) || rounds.length !== 1) return ''
  const { format, duration_min: duration } = rounds[0]
  return [format, duration ? `${duration} min` : ''].filter(Boolean).join(' · ')
}
