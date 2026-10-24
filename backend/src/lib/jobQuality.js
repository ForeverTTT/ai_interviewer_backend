const textLength = value => String(value || '').replace(/\s+/g, '').length

/**
 * 给推荐系统一个稳定、可解释的数据质量信号。分数只表示岗位资料是否完整、是否接近
 * 企业原始来源，不表示岗位本身好坏。
 */
export function assessJobQuality({
  sourceType = 'feishu',
  jobDescription,
  applyUrl,
  jdUrl,
  isLegacyAggregate = false,
} = {}) {
  const descriptionLength = textLength(jobDescription)
  const hasDirectLink = Boolean(applyUrl || jdUrl)

  if (isLegacyAggregate) {
    return { content_quality: 'aggregate', quality_score: hasDirectLink ? 30 : 20 }
  }
  if (descriptionLength >= 120) {
    if (sourceType === 'official') return { content_quality: 'full', quality_score: 100 }
    if (sourceType === 'ats') return { content_quality: 'full', quality_score: 90 }
    return { content_quality: 'full', quality_score: hasDirectLink ? 75 : 65 }
  }
  if (descriptionLength >= 35) {
    const sourceBonus = sourceType === 'official' ? 15 : sourceType === 'ats' ? 10 : 0
    return { content_quality: 'partial', quality_score: Math.min(75, 50 + sourceBonus + (hasDirectLink ? 5 : 0)) }
  }
  return { content_quality: 'link_only', quality_score: hasDirectLink ? 40 : 15 }
}
