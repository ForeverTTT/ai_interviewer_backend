import { z } from 'zod'

const MAX_RETRY_AGE_MS = 23 * 60 * 60 * 1000
const email = z.email()
const sender = z.string().trim().refine(value => {
  if (/\r|\n/.test(value)) return false
  return email.safeParse(value.match(/^[^<>]+<([^<>]+)>$/)?.[1] || value).success
})
const batchSchema = z.object({
  id: z.uuid(),
  digest_day: z.iso.date(),
  total_count: z.number().int().positive(),
  help_count: z.number().int().nonnegative(),
  interview_count: z.number().int().nonnegative(),
  down_count: z.number().int().nonnegative(),
  recipient: email,
  sender,
  dashboard_url: z.url().refine(value => value.startsWith('https://')),
  first_send_attempt_at: z.iso.datetime({ offset: true }).nullable(),
})

export function berlinDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const part = type => parts.find(item => item.type === type).value
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function digestConfig(env) {
  const recipient = email.safeParse(env.FEEDBACK_DIGEST_TO?.trim())
  const from = sender.safeParse(env.FEEDBACK_DIGEST_FROM)
  let dashboardUrl = env.FEEDBACK_DIGEST_DASHBOARD_URL?.trim()
  if (!dashboardUrl) {
    const project = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(env.SUPABASE_URL || '')?.[1]
    if (project) dashboardUrl = `https://supabase.com/dashboard/project/${project}/editor`
  }
  const url = z.url().safeParse(dashboardUrl)
  if (!recipient.success || !from.success || !url.success || !url.data.startsWith('https://')) {
    throw new Error('Configure FEEDBACK_DIGEST_TO, FEEDBACK_DIGEST_FROM and a valid HTTPS dashboard URL')
  }
  return { recipient: recipient.data, sender: from.data, dashboardUrl: url.data }
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char])

export function digestEmail(batch) {
  const subject = `FlowLab 用户反馈提醒 · ${batch.digest_day}（${batch.total_count} 条新反馈）`
  const lines = [
    `你有 ${batch.total_count} 条尚未通知的用户反馈。`,
    `帮助与反馈：${batch.help_count} 条`,
    `面试体验反馈：${batch.interview_count} 条（其中负面评价 ${batch.down_count} 条）`,
    '',
    '打开 Supabase，选择 user_feedback 表查看详情：',
    batch.dashboard_url,
    '',
    '此邮件仅包含数量；反馈原文保存在 Supabase。',
  ]
  return {
    from: batch.sender, to: [batch.recipient], subject,
    text: lines.join('\n'),
    html: `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(lines[0])}</p><ul><li>${escapeHtml(lines[1])}</li><li>${escapeHtml(lines[2])}</li></ul><p><a href="${escapeHtml(batch.dashboard_url)}">打开 Supabase 查看 user_feedback</a></p><p>${escapeHtml(lines.at(-1))}</p>`,
  }
}

// A setup check is separate from feedback delivery so it never consumes the
// day's digest or marks any real feedback as notified.
export function digestSetupEmail(config) {
  return {
    from: config.sender, to: [config.recipient],
    subject: 'FlowLab 用户反馈提醒 · 配置验证',
    text: [
      '这是一封反馈提醒的配置测试邮件。',
      '系统将每天德国时间上午 9 点检查用户反馈，有尚未通知的反馈时发送一封汇总邮件，没有新反馈则不发送。',
      '邮件包含反馈数量和查看入口，反馈原文保存在 Supabase。',
      `查看入口：${config.dashboardUrl}`,
    ].join('\n\n'),
  }
}

async function rpc(db, name, params) {
  const { data, error } = await db.rpc(name, params)
  // Never log SQL errors or user feedback, which can contain private data.
  if (error) throw new Error(`Feedback digest database step failed: ${name}`)
  return data
}

export async function runFeedbackDigest({ db, config, send, dryRun = true, now = () => new Date() }) {
  if (dryRun) {
    const counts = await rpc(db, 'preview_feedback_digest')
    return { status: 'dry_run', ...counts }
  }
  let batch = await rpc(db, 'prepare_feedback_digest', {
    p_day: berlinDay(now()), p_recipient: config.recipient,
    p_sender: config.sender, p_dashboard_url: config.dashboardUrl,
  })
  if (['empty', 'already_sent'].includes(batch?.status)) return { status: batch.status }
  if (batch?.status !== 'ready') throw new Error('Unexpected feedback digest state')
  batch = batchSchema.parse(batch)
  if (batch.recipient !== config.recipient || batch.sender !== config.sender || batch.dashboard_url !== config.dashboardUrl) {
    throw new Error('Pending digest settings differ; reconcile the existing batch before changing recipients')
  }
  const started = await rpc(db, 'begin_feedback_digest_attempt', { p_id: batch.id })
  if (started?.status === 'already_sent') return { status: 'already_sent' }
  batch = batchSchema.parse(started)
  const age = now().getTime() - new Date(batch.first_send_attempt_at).getTime()
  if (!batch.first_send_attempt_at || !Number.isFinite(age) || age >= MAX_RETRY_AGE_MS || age < -60_000) {
    throw new Error(`Digest ${batch.id} needs delivery reconciliation before retry; email idempotency window may have expired`)
  }
  // Persisted counts/envelope ensure every retry has the same key AND payload.
  const providerId = await send(digestEmail(batch), `feedback-digest/${batch.id}`)
  if (typeof providerId !== 'string' || !providerId.trim()) throw new Error('Email provider returned no email ID')
  await rpc(db, 'complete_feedback_digest', { p_id: batch.id, p_provider_id: providerId })
  return { status: 'sent', batch_id: batch.id, total_count: batch.total_count }
}

export function resendSender(apiKey, fetchImpl = fetch) {
  if (!apiKey?.trim()) throw new Error('Configure RESEND_API_KEY before sending')
  return async (body, key) => {
    let response
    try {
      response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error('Email provider request failed; retry this batch within 23 hours')
    }
    if (!response.ok) throw new Error(`Email provider rejected request (HTTP ${response.status})`)
    let payload
    try { payload = await response.json() } catch { throw new Error('Email provider returned an invalid response') }
    if (typeof payload?.id !== 'string' || !payload.id.trim()) throw new Error('Email provider returned no email ID')
    return payload.id
  }
}
