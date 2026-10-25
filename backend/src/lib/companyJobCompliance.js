const ALLOWED_PUBLIC_ADAPTERS = new Set([
  'huawei-campus',
  'tencent-careers',
  'tencent-campus',
  'jsonld-crawl',
  'moka-public',
  'hotjob-wecruit',
  'feishu-career',
  'zhiye-public',
  'zhiye-legacy',
  'zhiye-auto',
  'meituan-official',
  'baidu-official',
  'xiaomi-official',
  'oppo-official',
  'lenovo-official',
  'eightfold-pcsx',
  'vivo-official',
  'mihoyo-official',
  'byd-official',
  'lixiang-official',
  'jd-official',
  'kuaishou-campus',
  'lenovo-social',
  'xiaohongshu-official',
  'intel-workday',
  'ant-official',
  'pdd-campus',
  'ctrip-official',
])

const REVIEWED_ADAPTER_POLICIES = Object.freeze({
  // 该接口需要使用从网站前端代码取得的 HMAC 密钥生成签名，不允许自动访问。
  'kuaishou-social': {
    status: 'blocked',
    reason: '需要生成网站访问签名；在取得企业书面授权或正式接口前禁止自动同步',
  },
  // 官网当前会拒绝服务器直接访问。不能通过 Cookie、代理或其他方式绕过 403。
  'netease-campus': {
    status: 'blocked',
    reason: '官网存在访问控制；在取得企业授权或正式接口前禁止自动同步',
  },
  // 职位接口需要先取得 CSRF 凭证。先保留实现供审核，不进入生产自动任务。
  'bilibili-official': {
    status: 'review',
    reason: '公开职位接口包含 CSRF 访问流程；确认网站条款或取得授权前不自动同步',
  },
})

const VALID_STATUSES = new Set(['allowed', 'review', 'blocked'])
const STATUS_PRIORITY = { allowed: 0, review: 1, blocked: 2 }

export function jobSourceAutomationPolicy(source = {}) {
  const configured = source.automationPolicy
  if (configured != null && !VALID_STATUSES.has(configured)) {
    throw new Error(`来源「${source.name || source.id || '未知'}」的 automationPolicy 无效：${configured}`)
  }
  const reviewed = REVIEWED_ADAPTER_POLICIES[source.adapter]
  if (reviewed && configured === 'allowed') {
    throw new Error(`来源「${source.name || source.id || '未知'}」不能覆盖适配器 ${source.adapter} 的合规限制`)
  }
  const adapterDefault = reviewed || (ALLOWED_PUBLIC_ADAPTERS.has(source.adapter)
    ? { status: 'allowed', reason: '' }
    : { status: 'review', reason: `新适配器 ${source.adapter || '(未配置)'} 尚未完成自动访问审核` })
  const statuses = [adapterDefault.status, configured].filter(Boolean)
  const status = statuses.sort((a, b) => STATUS_PRIORITY[b] - STATUS_PRIORITY[a])[0] || 'allowed'
  return {
    status,
    reason: source.policyReason || adapterDefault.reason || '',
  }
}

export function assertAutomatedJobSourceAllowed(source) {
  const policy = jobSourceAutomationPolicy(source)
  if (policy.status !== 'allowed') {
    throw new Error(`合规策略已${policy.status === 'blocked' ? '禁止' : '暂停'}自动访问：${policy.reason}`)
  }
  return policy
}

export function restrictedStaticSourceNames(sources = []) {
  return [...new Set(sources
    .filter(source => jobSourceAutomationPolicy(source).status !== 'allowed')
    .map(source => source.name)
    .filter(Boolean))]
}

