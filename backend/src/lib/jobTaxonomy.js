/**
 * 求职信息和面经库共用的两套分类：岗位类别（按岗位名）和企业分类（按行业 / 公司名）。
 *
 * 都是关键词规则，一条可以命中多个类别，什么都没命中归 'other'。
 * 存 / 传的是 key，前端按 taxonomy.fn.<key> / taxonomy.ind.<key> 翻译。
 * 数组顺序就是前端下拉框的顺序。
 *
 * 面经库里不少岗位名和公司名是英文或德文，所以规则里中英德都有。
 * 短英文词（ui、hr、bd …）加 \b，免得命中单词中间的字母。
 */

export const JOB_FUNCTIONS = [
  // 设计类不用裸「设计」，免得把「IC 设计」「版图设计」归进来
  ['tech', /算法|开发|研发|测试|运维|架构|前端|后端|客户端|全栈|软件|硬件|芯片|嵌入式|程序|工程师|java|c\+\+|python|golang|大模型|机器学习|深度学习|数据挖掘|安全|电气|电子(?!商务)|通信|机械|自动化|半导体|\bic\b|电路|技术|engineer|developer|software|entwickl|informatik|machine learning|data scien|devops|backend|frontend|full.?stack/i],
  // 「产品运营」「产品销售」归运营 / 销售，其余带「产品」的都算产品
  ['product', /产品(?!运营|销售)|策划|\bpm\b|product manag|product owner|produktmanag/i],
  ['design', /设计师|\bui\b|\bux\b|交互设计|视觉设计|美术|原画|动画|插画|平面设计|建筑设计|工业设计|designer/i],
  ['data', /数据分析|商业分析|分析师|数据科学|\bbi\b|data analy|business analy|analyst/i],
  ['operations', /运营|社群|内容|新媒体|增长|电商|电子商务|编辑|operations|community|content/i],
  ['marketing', /市场|销售|营销|品牌|公关|(?<!电子)商务|\bbd\b|客户经理|渠道|广告|大客户|招商|marketing|sales|vertrieb|business development|key account/i],
  ['finance', /投资|投行|行业研究|投研|证券|基金|风控|精算|审计|会计|财务|金融|银行|信贷|理财|税务|finance|financial|controlling|accounting|audit|banking|investment/i],
  ['consulting', /咨询|顾问|consult|berater|beratung/i],
  ['functions', /人力|\bhr\b|招聘|行政|法务|法律|采购|供应链|物流|秘书|培训(?!生)|党建|党群|综合管理|文秘|recruit|human resources|personalwesen|procurement|einkauf|supply chain|logistic|legal/i],
  ['trainee', /管培|管理培训生|储备干部|培训生|trainee|graduate program/i],
]

export const INDUSTRIES = [
  ['internet', /互联网|\bit\b|软件|游戏|电商|科技|人工智能|信息数据|字节|抖音|腾讯|阿里|淘宝|蚂蚁|百度|美团|京东|拼多多|网易|快手|小红书|滴滴|哔哩|bilibili|携程|米哈游|得物|shein|希音|google|microsoft|amazon|\bmeta\b|apple|\bsap\b|zalando|delivery hero|n26|personio|celonis/i],
  ['auto', /汽车|车企|整车|新能源车|自动驾驶|比亚迪|蔚来|理想汽车|小鹏|吉利|长城汽车|长安|上汽|广汽|一汽|东风|北汽|奇瑞|零跑|极氪|赛力斯|问界|特斯拉|tesla|bmw|宝马|mercedes|奔驰|daimler|戴姆勒|volkswagen|大众|audi|奥迪|porsche|保时捷|bosch|博世|continental|大陆集团|\bzf\b|采埃孚|schaeffler|舍弗勒|automotive/i],
  ['semiconductor', /电子(?!商务)|通信|半导体|芯片|集成电路|智能硬件|华为|中兴|小米|联想|英伟达|nvidia|intel|英特尔|\bamd\b|infineon|英飞凌|qualcomm|高通|ericsson|nokia/i],
  ['finance', /银行|证券|基金|保险|金融|投资|信托|期货|资管|bank|allianz|安联|munich re|insurance|versicherung|finance/i],
  ['consumer', /快消|消费|零售|贸易|批发|商超|食品|饮料|日化|美妆|服装|服饰|宝洁|联合利华|雀巢|欧莱雅|p&g|procter|unilever|nestl|l'or[eé]al|adidas|阿迪达斯|puma|henkel|汉高|lidl|aldi|retail|fmcg/i],
  ['manufacturing', /制造|机械|工业|装备|材料|化工|重工|机器人|家电|电器|数码产品|矿产|钢铁|冶金|有色|军工|国防|造纸|siemens|西门子|basf|巴斯夫|bayer|拜耳|thyssenkrupp|蒂森|trumpf|manufactur/i],
  ['energy', /能源|电力|电网|石油|石化|光伏|储能|煤炭|核电|环保|宁德时代|\be\.on\b|\brwe\b|energy|energie/i],
  ['consulting', /咨询|专业服务|商务服务|财税|审计|法律服务|律师事务所|会计师事务所|四大|麦肯锡|波士顿咨询|贝恩|德勤|普华永道|安永|毕马威|埃森哲|mckinsey|\bbcg\b|boston consulting|bain|deloitte|\bpwc\b|\bey\b|ernst|kpmg|accenture|roland berger|罗兰贝格|consulting/i],
  ['healthcare', /医疗|医药|生物|制药|健康|医院|药业|roche|罗氏|novartis|诺华|pfizer|辉瑞|siemens healthineers|biontech|pharma|health|medizin/i],
  ['education', /教育|培训|学校|大学|学院|新东方|好未来|education|university|universit/i],
  ['realestate', /地产|房地产|建筑|建工|基建|工程局|中建|中铁|中交|real estate|immobilien|construction/i],
  ['media', /传媒|文化|广告|影视|出版|媒体|media|verlag/i],
  ['logistics', /物流|交通|航空|铁路|航运|港口|快递|顺丰|lufthansa|汉莎|deutsche bahn|dhl|logistics|airline/i],
  ['public', /事业单位|政府|公务员|公共服务|科研|研究院|研究所|机关|fraunhofer|弗劳恩霍夫|max planck|马普/i],
  ['services', /生活服务|酒店|餐饮|旅游|商旅|物业|产业园|健身|家政|hotel|gastronomie/i],
  ['agriculture', /农林牧渔|农业|林业|畜牧|渔业|养殖|种业|饲料|agrar|agricultur/i],
]

function classify(rules, text) {
  const value = String(text || '')
  if (!value.trim()) return []
  const matched = rules.filter(([, re]) => re.test(value)).map(([key]) => key)
  return matched.length ? matched : ['other']
}

/** 招聘岗位 / 面经岗位名 → 岗位类别 */
export function classifyPositions(text) {
  return classify(JOB_FUNCTIONS, text)
}

/** 行业类别、公司名、表格分类拼在一起 → 企业分类 */
export function classifyIndustry(...parts) {
  return classify(INDUSTRIES, parts.flat().filter(Boolean).join(' '))
}

/** 下拉框排序：按规则数组的顺序，'other' 放最后 */
export function taxonomyOrder(rules) {
  const order = [...rules.map(([key]) => key), 'other']
  return (a, b) => order.indexOf(a.value) - order.indexOf(b.value)
}

export function normalizeCompany(name) {
  return String(name || '').toLowerCase().replace(/[\s（）()·.,，-]/g, '')
}

/**
 * 面经只有公司名：先用求职信息库里同名公司的企业分类（companyIndustries：
 * normalizeCompany(公司名) → keys），查不到再按公司名关键词归类。
 */
export function tagExperience(exp, companyIndustries = new Map()) {
  const known = companyIndustries.get(normalizeCompany(exp.company))
  return {
    ...exp,
    job_functions: classifyPositions([exp.position, exp.department].filter(Boolean).join(' ')),
    industry_keys: known?.length ? known : classifyIndustry(exp.company),
  }
}
