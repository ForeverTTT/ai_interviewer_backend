import { Router } from 'express'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.use(requireAuth)

/**
 * GET MY NOTIFICATIONS (latest 30 + unread count)
 */
router.get('/', async (req, res) => {
  try {
    const [list, unread] = await Promise.all([
      supabase
        .from('user_notifications')
        .select('id, type, payload, read_at, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('user_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .is('read_at', null),
    ])
    if (list.error) throw list.error
    if (unread.error) throw unread.error

    res.json({ notifications: list.data || [], unreadCount: unread.count || 0 })
  } catch (err) {
    console.error('[Notifications] List error:', err)
    res.status(500).json({ error: err.message || 'Failed to load notifications' })
  }
})

/**
 * MARK ALL AS READ
 */
router.post('/read', async (req, res) => {
  try {
    const { error } = await supabase
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', req.user.id)
      .is('read_at', null)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    console.error('[Notifications] Mark read error:', err)
    res.status(500).json({ error: err.message || 'Failed to update notifications' })
  }
})

export default router
