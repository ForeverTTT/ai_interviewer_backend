import { supabase } from '../src/lib/supabase.js'

const questions = [
  {
    index_number: 1,
    question_zh: '我对自己产出的工作质量有着近乎严苛的标准，并始终致力于实现卓越的执行结果。',
    question_en: 'I set extremely high standards for my work quality and always strive for excellence in execution.',
    question_de: 'Ich setze extrem hohe Qualitätsstandards und strebe nach Exzellenz in der Ausführung.',
    category: 'executing'
  },
  {
    index_number: 2,
    question_zh: '我发现自己能够自然地通过逻辑和热情引导他人，使他们认同并支持我的观点。',
    question_en: 'I naturally guide others through logic and passion, making them align with and support my views.',
    question_de: 'Ich leite andere ganz natürlich durch Logik und Leidenschaft.',
    category: 'influencing'
  },
  {
    index_number: 3,
    question_zh: '我具备敏锐的情感触觉，能够洞察他人的微小情绪变化并建立深刻的共鸣。',
    question_en: 'I have keen emotional perception, allowing me to spot subtle mood shifts and build deep empathy.',
    question_de: 'Ich habe eine feine Wahrnehmung für Stimmungen und baue Empathie auf.',
    category: 'relationship'
  },
  {
    index_number: 4,
    question_zh: '我习惯于跳出当下的局限，系统性地思考各种潜在的可能性及未来的战略蓝图。',
    question_en: 'I habitually look beyond current limitations to systematically think about future strategies and possibilities.',
    question_de: 'Ich blicke gewohnheitsmäßig über Grenzen hinaus und denke strategisch.',
    category: 'strategic'
  },
  {
    index_number: 5,
    question_zh: '一旦设定目标，我会表现出极强的毅力，不达目的绝不罢休，且享受攻克难关的过程。',
    question_en: 'Once I set a goal, I show great perseverance and enjoy the process of overcoming obstacles.',
    question_de: 'Habe ich ein Ziel, zeige ich große Ausdauer und genieße den Prozess.',
    category: 'executing'
  },
  {
    index_number: 6,
    question_zh: '在复杂或不确定的局势中，我往往会本能地接过指挥权，为团队指明前进方向。',
    question_en: 'In uncertain situations, I instinctively take charge to provide clear direction for the team.',
    question_de: 'In unsicheren Lagen übernehme ich instinktiv die Führung.',
    category: 'influencing'
  },
  {
    index_number: 7,
    question_zh: '我深信团队的凝聚力是成功的核心，并致力于创造一个包容且高度协作的工作环境。',
    question_en: 'I believe team cohesion is key to success and work to create an inclusive and collaborative environment.',
    question_de: 'Teamzusammenhalt ist für mich der Schlüssel zum Erfolg.',
    category: 'relationship'
  },
  {
    index_number: 8,
    question_zh: '我热衷于拆解复杂信息，通过严密的逻辑推演发现隐藏在数据背后的底层规律。',
    question_en: 'I love breaking down complex information to find underlying patterns through rigorous logic.',
    question_de: 'Ich liebe es, Informationen zu Mustern zu zerlegen.',
    category: 'strategic'
  },
  {
    index_number: 9,
    question_zh: '我善于构建高效的运作流程，通过优化资源配置确保每一个环节都能发挥最大效能。',
    question_en: 'I am good at building efficient workflows to ensure every resource is used to its maximum potential.',
    question_de: 'Ich bin gut darin, effiziente Arbeitsabläufe zu erstellen, um Ressourcen optimal zu nutzen.',
    category: 'executing'
  },
  {
    index_number: 10,
    question_zh: '在公众场合或社交互动中，我总能以积极的状态影响氛围，并将互动转化为机会。',
    question_en: 'In social settings, I always maintain a positive state to influence the atmosphere and create opportunities.',
    question_de: 'In sozialen Situationen bewahre ich einen positiven Zustand, um die Atmosphäre zu beeinflussen und Chancen zu schaffen.',
    category: 'influencing'
  },
  {
    index_number: 11,
    question_zh: '我倾向于投资他人的成长，看到他人潜力的激发会给我带来极大的职业成就感。',
    question_en: 'I am inclined to invest in others\' growth and feel a great sense of achievement when their potential is unlocked.',
    question_de: 'Ich investiere gerne in das Wachstum anderer und empfinde Erfolg, wenn ihr Potenzial freigesetzt wird.',
    category: 'relationship'
  },
  {
    index_number: 12,
    question_zh: '面对挑战时，我总能另辟蹊径，提出具有颠覆性的创意或极具远见的解决方案。',
    question_en: 'When facing challenges, I often propose disruptive ideas or highly visionary solutions.',
    question_de: 'Bei Herausforderungen schlage ich oft bahnbrechende Ideen oder visionäre Lösungen vor.',
    category: 'strategic'
  },
  {
    index_number: 13,
    question_zh: '我将承诺视为最核心的价值，无论面临多大的外部压力，都会坚守职责的底线。',
    question_en: 'I view commitment as a core value and will hold the line on my responsibilities despite external pressure.',
    question_de: 'Commitment ist für mich ein Kernwert, auch unter Druck.',
    category: 'executing'
  },
  {
    index_number: 14,
    question_zh: '我擅长通过极具感染力的表达方式，在更广阔的层面上传递愿景并激发听众的行动。',
    question_en: 'I am skilled at communicating vision in a compelling way that inspires a wider audience to take action.',
    question_de: 'Ich kann Visionen überzeugend kommunizieren und andere zum Handeln inspirieren.',
    category: 'influencing'
  },
  {
    index_number: 15,
    question_zh: '我具有卓越的冲突解决能力，能够在多元化的诉求中找到平衡点并驱动共识。',
    question_en: 'I have excellent conflict resolution skills and can find a balance among diverse interests.',
    question_de: 'Ich habe exzellente Fähigkeiten zur Konfliktlösung und finde Balance zwischen Interessen.',
    category: 'relationship'
  },
  {
    index_number: 16,
    question_zh: '在采取行动之前，我会进行全方位的风险评估和详尽的规划，确保胜券在握。',
    question_en: 'Before taking action, I perform comprehensive risk assessments and detailed planning to ensure success.',
    question_de: 'Vor dem Handeln führe ich umfassende Risikobewertungen und detaillierte Planungen durch.',
    category: 'strategic'
  },
  {
    index_number: 17,
    question_zh: '我拥有一种内在的竞争动力，不断追求自我超越，并将‘平庸’视为最大的挑战。',
    question_en: 'I have an inner competitive drive to constantly excel and view \'mediocrity\' as the biggest challenge.',
    question_de: 'Ich habe einen inneren Wettbewerbsdrang und betrachte Mittelmäßigkeit als größte Herausforderung.',
    category: 'executing'
  },
  {
    index_number: 18,
    question_zh: '我喜欢在竞争环境中验证自己的实力，并将胜利视为衡量个人成就的重要指标。',
    question_en: 'I enjoy validating my strength in competitive environments and view winning as a key success metric.',
    question_de: 'Ich messe mich gerne im Wettbewerb und sehe den Sieg als Erfolgskriterium.',
    category: 'influencing'
  },
  {
    index_number: 19,
    question_zh: '我极其看重基于深厚信任的长期伙伴关系，而非依赖于短期利益的临时互动。',
    question_en: 'I highly value long-term partnerships built on deep trust over temporary interactions based on short-term gain.',
    question_de: 'Ich schätze langfristige Partnerschaften auf Basis von tiefem Vertrauen sehr.',
    category: 'relationship'
  },
  {
    index_number: 20,
    question_zh: '我拥有一种持续的求知欲，乐于探索未知领域，并能快速整合不同领域的知识。',
    question_en: 'I have a continuous desire to learn, eager to explore new fields and quickly integrate knowledge from different domains.',
    question_de: 'Ich lerne ständig dazu, erkunde neue Bereiche und integriere Wissen schnell.',
    category: 'strategic'
  }
]

async function seed() {
  console.log('Seeding gallup_questions...')
  const { data, error } = await supabase
    .from('gallup_questions')
    .upsert(questions, { onConflict: 'index_number' })

  if (error) {
    console.error('Error seeding questions:', error.message)
    console.error('Make sure the "gallup_questions" table exists in your Supabase database.')
    process.exit(1)
  }

  console.log('Successfully seeded 20 questions into gallup_questions table.')
}

seed()
