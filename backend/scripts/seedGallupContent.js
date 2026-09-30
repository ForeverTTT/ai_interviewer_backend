import { supabase } from '../src/lib/supabase.js'

// Helper to generate the 5 dimensions based on domain, tier, and language
function generateContent(domain, tier, lang) {
  const isZh = lang === 'zh'
  const isEn = lang === 'en'
  const isDe = lang === 'de'

  const domainsZh = { executing: '执行力', influencing: '影响力', relationship: '关系建立', strategic: '战略思维' }
  const domainsEn = { executing: 'Executing', influencing: 'Influencing', relationship: 'Relationship', strategic: 'Strategic' }
  const domainsDe = { executing: 'Umsetzung', influencing: 'Einflussnahme', relationship: 'Beziehungsaufbau', strategic: 'Strategie' }

  let dName = isZh ? domainsZh[domain] : isEn ? domainsEn[domain] : domainsDe[domain]

  const dimTitles = isZh ? 
    ['核心特征概述', '职场行为表现', '领导力风格', '潜在短板盲区', '高阶提升策略'] : isEn ? 
    ['Core Characteristics', 'Workplace Behavior', 'Leadership Style', 'Potential Blind Spots', 'Advanced Strategies'] : 
    ['Kernmerkmale', 'Verhalten am Arbeitsplatz', 'Führungsstil', 'Mögliche blinde Flecken', 'Erweiterte Strategien']

  // Just a comprehensive, professional placeholder text generator for this demonstration.
  // Real implementation might have static mapped files, but this handles the massive matrix cleanly.
  const levelsZh = {
    high: [
        `您的${dName}极度突出，这是您最核心的内驱力。您能够本能地在此领域展现出非凡的天赋，并且在不需要外界过多干预的情况下达成最优结果。`,
        `在团队中，您是${dName}的绝对核心标杆。当项目陷入焦灼或需要这方面的能力突破时，所有人都会第一时间想到并依赖您的产出。`,
        `您的领导力带有强烈的${dName}色彩。您喜欢通过建立高标准的预期来感染并带领团队前进，属于“以身作则”或“愿景驱动”的类型。`,
        `因为${dName}过强，您可能会对那些在这方面稍弱的同事缺乏耐心，或者忽视了其他三个维度的平衡，导致在处理全面性复杂任务时出现偏差。`,
        `不要仅仅满足于自我实现，试着将您的${dName}转化为团队的系统流程或赋能工具，教会他人如何像您一样思考和行动，从而最大化您的杠杆效应。`
    ],
    medium: [
        `您的${dName}处于均衡状态，能够在需要时有效激活，同时也能与其他能力配合使用，不会显得过于单一。`,
        `在日常工作中，您的${dName}能够作为良好的辅助能力支撑您的整体发挥，保证了您在多元环境下的适应性和抗压能力。`,
        `您能够根据团队的需要灵活调整，当缺乏${dName}的主导者时，您完全有能力顶上并维持团队的平稳运行。`,
        `由于没有将其发挥到极致，有时候您可能会在遇到仅依赖${dName}才能解决的极端挑战时感到有些吃力，产生犹豫不决。`,
        `您可以尝试在接下来的半年内，刻意寻找一两个需要大量使用${dName}的项目，进行有意识的刻意练习，将其培养为您的第二大核心长板。`
    ],
    low: [
        `相较于您的其他突出天赋，${dName}并非您最首选或最本能的解决问题方式。您更习惯用其他能力来弥补。`,
        `当工作大量需要单凭${dName}来推进时，您可能会感到能量消耗较快，或者需要花费比他人更多的时间来适应。`,
        `您倾向于寻找在${dName}方面互补的伙伴，通过授权或合作的方式来弥补自身在此领域的精力分配不足。`,
        `完全忽视${dName}可能会成为您职业晋升的明显短板，尤其是在向高级管理层跨越时，缺乏该维度会导致决策闭环的缺失。`,
        `寻找一位以${dName}为首要天赋的导师或搭档。不要强求自己变成这方面的专家，而是学会如何利用系统、工具或团队资源来管理这一短板。`
    ]
  }

  const levelsEn = {
    high: [
        `Your ${dName} domain is exceptionally dominant. This is your core driver, allowing you to instinctively excel and deliver maximum results autonomously.`,
        `In a team setting, you represent the highest benchmark for ${dName}. When challenges arise requiring this skill, others immediately rely on your output.`,
        `Your leadership style is deeply rooted in ${dName}. You inspire and guide your team by setting high standards and leading by innate example.`,
        `Due to your intense ${dName}, you may show impatience toward colleagues who lack this trait, or overlook necessary balance with other domain dimensions.`,
        `Instead of relying solely on personal execution, transform your ${dName} into repeatable systems and team-wide tools to multiply your impact.`
    ],
    medium: [
        `Your ${dName} is balanced and adaptable. You can effectively activate it when needed, harmoniously combining it with your other strengths.`,
        `In daily tasks, your ${dName} acts as a solid supporting pillar. It ensures your versatility and resilience across diverse operational environments.`,
        `You are flexible. When the team lacks a dedicated ${dName} champion, you can confidently step up and keep operations running smoothly.`,
        `Because this is not your absolute peak strength, you might occasionally hesitate when faced with extreme challenges that exclusively demand ${dName}.`,
        `Consider deliberately taking on 1-2 projects over the next six months that heavily rely on ${dName} to intentionally cultivate it into a secondary spike.`
    ],
    low: [
        `Compared to your primary talents, ${dName} is not your instinctive go-to. You naturally prefer leveraging your other stronger domains to solve problems.`,
        `Tasks strictly demanding high levels of ${dName} might drain your energy quickly or require significantly more conscious effort compared to peers.`,
        `You tend to seek out partners who are strong in ${dName}, effectively offsetting your own energy distribution through smart delegation and collaboration.`,
        `Completely ignoring ${dName} could become a noticeable bottleneck in senior leadership transitions, where a holistic multi-dimensional approach is required.`,
        `Partner with a mentor or colleague whose top talent is ${dName}. Don't force yourself to be an expert; focus on managing this area through systems or team resources.`
    ]
  }

  const levelsDe = {
    high: [
        `Ihr Bereich ${dName} ist extrem ausgeprägt. Dies ist Ihr absoluter Kernantrieb, der es Ihnen ermöglicht, instinktiv Höchstleistungen zu erzielen.`,
        `Im Team gelten Sie als der absolute Maßstab für ${dName}. Bei spezifischen Herausforderungen verlässt sich jeder sofort auf Ihre Fähigkeiten.`,
        `Ihr Führungsstil ist tief in ${dName} verwurzelt. Sie inspirieren und leiten Ihr Team, indem Sie hohe Standards setzen und vorbildhaft vorangehen.`,
        `Aufgrund Ihrer ausgeprägten ${dName} könnten Sie Ungeduld gegenüber Kollegen zeigen, denen diese Eigenschaft fehlt, oder das Gleichgewicht vernachlässigen.`,
        `Geben Sie sich nicht nur mit persönlicher Exzellenz zufrieden. Wandeln Sie Ihre ${dName} in strukturierte Systeme um, um Ihr Team zu befähigen.`
    ],
    medium: [
        `Ihre ${dName} ist ausgewogen und anpassungsfähig. Sie können sie effektiv aktivieren und harmonisch mit Ihren anderen Stärken kombinieren.`,
        `Im Tagesgeschäft dient Ihre ${dName} als solide und unterstützende Säule, die Ihre Anpassungsfähigkeit in verschiedenen Arbeitsumgebungen sicherstellt.`,
        `Sie können sich flexibel anpassen. Wenn es dem Team an einem ${dName}-Spezialisten mangelt, können Sie diese Rolle kompetent übernehmen.`,
        `Da dies nicht Ihre absolute Spitzenstärke ist, zögern Sie vielleicht bei extremen Herausforderungen, die ausschließlich stark auf ${dName} angewiesen sind.`,
        `Erwägen Sie, in den nächsten Monaten gezielt Projekte zu übernehmen, die ${dName} erfordern, um dies als zweite Kernkompetenz zu kultivieren.`
    ],
    low: [
        `Im Vergleich zu Ihren Haupttalenten ist ${dName} nicht Ihr instinktiver Problemlösungsansatz. Sie nutzen lieber Ihre anderen, stärkeren Bereiche.`,
        `Aufgaben, die ein hohes Maß an ${dName} erfordern, könnten Ihre Energie schneller verbrauchen oder erfordern bewusstere Anstrengungen Ihrerseits.`,
        `Sie neigen dazu, Partner zu suchen, die in ${dName} stark sind, und gleichen so Ihre eigene Energie durch intelligente Aufgabenteilung aus.`,
        `Die völlige Vernachlässigung von ${dName} könnte zu einem Engpass bei Beförderungen auf Führungsebene werden, da dort Mehrdimensionalität gefragt ist.`,
        `Arbeiten Sie mit einem Kollegen zusammen, dessen Haupttalent ${dName} ist. Nutzen Sie Teampartnerschaften anstatt zu versuchen, ein Experte zu werden.`
    ]
  }

  const source = isZh ? levelsZh : isEn ? levelsEn : levelsDe
  const contentArray = source[tier]

  return dimTitles.map((title, i) => ({
    title,
    text: contentArray[i]
  }))
}

async function seed() {
  console.log('Seeding gallup_analysis_content table...')
  
  // Create table if not exists (using Supabase Postgres interface, ideally you run an SQL script)
  // We'll trust the user will run the SQL script we provide, or this seed might fail. 
  // Let's first drop existing records if any, but since we are seeding all combinations we will just upsert.
  
  const domains = ['executing', 'influencing', 'relationship', 'strategic']
  const tiers = ['high', 'medium', 'low']
  const langs = ['zh', 'en', 'de']

  const payload = []

  // Generate unique ID deterministically to avoid exploding the table 
  // or use domain_key + score_tier + lang as compound key upsert.
  for (const domain of domains) {
    for (const tier of tiers) {
      for (const lang of langs) {
         payload.push({
           domain_key: domain,
           score_tier: tier,
           lang: lang,
           content: generateContent(domain, tier, lang)
         })
      }
    }
  }

  // Insert to supabase
  const { data, error } = await supabase
    .from('gallup_analysis_content')
    .upsert(payload, { onConflict: 'domain_key, score_tier, lang' })

  if (error) {
    console.error('Error seeding contents:', error.message)
    console.error('Hint: Did you forget to run the `gallup_analysis_schema.sql` script to create the table?')
    process.exit(1)
  }

  console.log(`Successfully seeded ${payload.length} analysis blocks into gallup_analysis_content table.`)
}

seed()
