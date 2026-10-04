import { supabase } from '../lib/supabase.js'
import { trackServerEvent } from '../lib/analytics.js'

/**
 * Middleware to check if user has enough tokens.
 * Reads req.tokenCost and req.tokenFeature (analytics label) set by the route.
 */
export async function checkTokens(req, res, next) {
  const userId = req.user?.id
  const cost = req.tokenCost || 0

  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) throw error
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    const currentTokens = profile.tokens ?? 1000
    if (currentTokens < cost) {
      if (req.tokenFeature) {
        trackServerEvent(req, 'tokens_insufficient', {
          props: { feature: req.tokenFeature, required: cost, balance: currentTokens },
        })
      }
      return res.status(403).json({ 
        error: 'Insufficient tokens', 
        details: `This action requires ${cost} tokens, but you only have ${currentTokens}.`,
        code: 'INSUFFICIENT_TOKENS'
      })
    }

    // Attach current tokens to request for potential use later
    req.userTokens = currentTokens
    next()
  } catch (err) {
    console.error('[TokenMiddleware] Check error:', err)
    res.status(500).json({ error: 'Failed to verify token balance' })
  }
}

/**
 * Utility to deduct tokens from a user.
 * @param {string} userId - The user ID.
 * @param {number} amount - Amount to deduct.
 * @param {{ req?: object, feature?: string }} [analytics] - Labels the tokens_spent event.
 */
export async function deductTokens(userId, amount, { req, feature } = {}) {
  if (amount <= 0) return
  
  // Use a RPC or a simple update. 
  // For safety, we should use a transaction or filter to ensure tokens don't go negative.
  const { data, error } = await supabase.rpc('deduct_user_tokens', { 
    p_user_id: userId, 
    p_amount: amount 
  })

  if (error) {
    // If RPC doesn't exist, fallback to simple update (less safe under race conditions)
    console.warn('[TokenUtil] deduct_user_tokens RPC missing, falling back to update')
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()
    const currentTokens = profile.tokens ?? 1000
    const newTokens = Math.max(0, currentTokens - amount)
    
    await supabase.from('profiles').update({ tokens: newTokens }).eq('id', userId)
    if (feature) trackServerEvent(req, 'tokens_spent', { userId, props: { feature, amount, balanceAfter: newTokens } })
    return
  }

  if (feature) {
    const balanceAfter = Number.isInteger(data) ? data : undefined
    trackServerEvent(req, 'tokens_spent', { userId, props: { feature, amount, balanceAfter } })
  }
}

/**
 * Utility to add tokens to a user.
 * @param {string} userId - The user ID.
 * @param {number} amount - Amount to add.
 * @param {{ req?: object, feature?: string }} [analytics] - Labels the tokens_earned event.
 */
export async function addTokens(userId, amount, { req, feature } = {}) {
  if (amount <= 0) return
  
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single()
  const currentTokens = profile.tokens ?? 1000
  const newTokens = currentTokens + amount
  
  await supabase.from('profiles').update({ tokens: newTokens }).eq('id', userId)
  if (feature) trackServerEvent(req, 'tokens_earned', { userId, props: { feature, amount } })
}
