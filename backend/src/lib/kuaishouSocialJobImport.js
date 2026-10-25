export const KUAISHOU_SOCIAL_ORIGIN = 'https://zhaopin.kuaishou.cn'

function dateOnly(value) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/)
  return match?.[0] || ''
}

export function kuaishouSocialJobToRow(job, { workLocations = new Map(), categories = new Map() } = {}) {
  const id = String(job.id || '').trim()
  const locationCodes = [...new Set([
    ...(Array.isArray(job.workLocationsCode) ? job.workLocationsCode : []),
    job.workLocationCode,
  ].filter(Boolean).map(String))]
  const locationNames = locationCodes.map(code => workLocations.get(code) || code)
  const detailUrl = `${KUAISHOU_SOCIAL_ORIGIN}/#/official/social/job-info/${encodeURIComponent(id)}`
  return {
    公司: '快手',
    企业类型: '民企',
    行业类别: '互联网/科技',
    招聘岗位: String(job.name || '').trim(),
    职位描述: [
      job.description ? `岗位职责\n${String(job.description).trim()}` : '',
      job.positionDemand ? `任职要求\n${String(job.positionDemand).trim()}` : '',
    ].filter(Boolean).join('\n\n'),
    工作地点: [...new Set(locationNames.filter(Boolean))].join('、'),
    工作类型: '社会招聘',
    批次: '社招',
    部门: String(job.departmentName || '').trim(),
    备注: categories.get(String(job.positionCategoryCode || '')) || '',
    发布时间: dateOnly(job.releaseTime || job.updateTime),
    截止时间: dateOnly(job.closeTime),
    职位ID: id,
    岗位身份标识: `kuaishou:social:${id}`,
    职位详情链接: detailUrl,
    简历投递链接: detailUrl,
  }
}

/**
 * 快手社招接口要求客户端生成站点访问签名。签名实现和密钥不应由聚合任务复制或绕过；
 * 保留行映射仅用于兼容历史快照，自动同步在取得企业授权或正式接口前永久关闭。
 */
export async function fetchKuaishouSocialSnapshot() {
  throw new Error('合规策略已禁止快手社招自动同步：需要企业书面授权或正式接口')
}
