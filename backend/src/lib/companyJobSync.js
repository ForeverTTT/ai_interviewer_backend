import { fetchHuaweiCampusSnapshot } from './huaweiJobImport.js'
import { crawlJobPostingSource } from './officialJobImport.js'
import { fetchTencentJobsSnapshot } from './tencentJobImport.js'
import { fetchTencentCampusJobsSnapshot } from './tencentCampusJobImport.js'
import { importJobTables } from './jobImport.js'
import { fetchMokaJobsSnapshot } from './mokaJobImport.js'
import { fetchHotjobJobsSnapshot } from './hotjobImport.js'
import { fetchFeishuCareerJobsSnapshot } from './feishuCareerImport.js'
import { fetchZhiyeJobsSnapshot } from './zhiyeJobImport.js'
import { fetchLegacyZhiyeJobsSnapshot } from './zhiyeLegacyImport.js'
import { fetchMeituanJobsSnapshot } from './meituanJobImport.js'
import { fetchBaiduJobsSnapshot } from './baiduJobImport.js'
import { fetchXiaomiJobsSnapshot } from './xiaomiJobImport.js'
import { fetchOppoJobsSnapshot } from './oppoJobImport.js'
import { fetchLenovoJobsSnapshot } from './lenovoJobImport.js'
import { fetchEightfoldJobsSnapshot } from './eightfoldJobImport.js'
import { fetchVivoSocialJobsSnapshot } from './vivoJobImport.js'
import { fetchMihoyoJobsSnapshot } from './mihoyoJobImport.js'
import { fetchBydJobsSnapshot } from './bydJobImport.js'
import { fetchLixiangJobsSnapshot } from './lixiangJobImport.js'
import { fetchJdJobsSnapshot } from './jdJobImport.js'
import { fetchKuaishouCampusSnapshot } from './kuaishouJobImport.js'
import { fetchLenovoSocialJobsSnapshot } from './lenovoSocialJobImport.js'
import { fetchXiaohongshuJobsSnapshot } from './xiaohongshuJobImport.js'
import { fetchIntelChinaJobsSnapshot } from './intelJobImport.js'
import { fetchBilibiliJobsSnapshot } from './bilibiliJobImport.js'
import { fetchKuaishouSocialSnapshot } from './kuaishouSocialJobImport.js'
import { fetchNeteaseCampusSnapshot } from './neteaseJobImport.js'
import { fetchAntJobsSnapshot } from './antJobImport.js'
import { fetchPddCampusSnapshot } from './pddJobImport.js'

const waitMs = ms => new Promise(resolve => setTimeout(resolve, ms))

export const companyJobAdapters = {
  'huawei-campus': (source, runtime) => fetchHuaweiCampusSnapshot({
    ...source.options,
    ...runtime,
  }),
  'tencent-careers': (source, runtime) => fetchTencentJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'tencent-campus': (source, runtime) => fetchTencentCampusJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'jsonld-crawl': (source, runtime) => crawlJobPostingSource({
    ...source.options,
    ...runtime,
  }),
  'moka-public': (source, runtime) => fetchMokaJobsSnapshot({
    companyName: source.companyName,
    startUrl: source.seedUrl,
    ...source.options,
    ...runtime,
  }),
  'hotjob-wecruit': (source, runtime) => fetchHotjobJobsSnapshot({
    companyName: source.companyName,
    startUrl: source.seedUrl,
    ...source.options,
    ...runtime,
  }),
  'feishu-career': (source, runtime) => fetchFeishuCareerJobsSnapshot({
    companyName: source.companyName,
    startUrl: source.seedUrl,
    fallbackCategory: source.fallbackCategory,
    ...source.options,
    ...runtime,
  }),
  'zhiye-public': (source, runtime) => fetchZhiyeJobsSnapshot({
    companyName: source.companyName,
    startUrl: source.seedUrl,
    ...source.options,
    ...runtime,
  }),
  'zhiye-legacy': (source, runtime) => fetchLegacyZhiyeJobsSnapshot({
    companyName: source.companyName,
    startUrl: source.seedUrl,
    fallbackCategory: source.fallbackCategory,
    ...source.options,
    ...runtime,
  }),
  'zhiye-auto': async (source, runtime) => {
    try {
      return await fetchZhiyeJobsSnapshot({
        companyName: source.companyName,
        startUrl: source.seedUrl,
        ...source.options,
        ...runtime,
      })
    } catch (error) {
      if (!/PortalId|公开接口/.test(error.message)) throw error
      return fetchLegacyZhiyeJobsSnapshot({
        companyName: source.companyName,
        startUrl: source.seedUrl,
        ...source.options,
        ...runtime,
      })
    }
  },
  'meituan-official': (source, runtime) => fetchMeituanJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'baidu-official': (source, runtime) => fetchBaiduJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'xiaomi-official': (source, runtime) => fetchXiaomiJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'oppo-official': (source, runtime) => fetchOppoJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'lenovo-official': (source, runtime) => fetchLenovoJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'eightfold-pcsx': (source, runtime) => fetchEightfoldJobsSnapshot({
    companyName: source.companyName,
    ...source.options,
    ...runtime,
  }),
  'vivo-official': (_source, runtime) => fetchVivoSocialJobsSnapshot(runtime),
  'mihoyo-official': (source, runtime) => fetchMihoyoJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'byd-official': (source, runtime) => fetchBydJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'lixiang-official': (source, runtime) => fetchLixiangJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'jd-official': (source, runtime) => fetchJdJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'kuaishou-campus': (source, runtime) => fetchKuaishouCampusSnapshot({
    ...source.options,
    ...runtime,
  }),
  'lenovo-social': (source, runtime) => fetchLenovoSocialJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'xiaohongshu-official': (source, runtime) => fetchXiaohongshuJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'intel-workday': (source, runtime) => fetchIntelChinaJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'bilibili-official': (source, runtime) => fetchBilibiliJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'kuaishou-social': (source, runtime) => fetchKuaishouSocialSnapshot({
    ...source.options,
    ...runtime,
  }),
  'netease-campus': (source, runtime) => fetchNeteaseCampusSnapshot({
    ...source.options,
    ...runtime,
  }),
  'ant-official': (source, runtime) => fetchAntJobsSnapshot({
    ...source.options,
    ...runtime,
  }),
  'pdd-campus': (source, runtime) => fetchPddCampusSnapshot({
    ...source.options,
    ...runtime,
  }),
}

function validateSource(source, adapters = companyJobAdapters) {
  if (!source?.id || !source?.name || !source?.adapter) throw new Error('每个企业来源都必须配置 id、name 和 adapter')
  if (!adapters[source.adapter]) throw new Error(`来源「${source.name}」使用了未知 adapter：${source.adapter}`)
}

/**
 * 逐企业执行独立快照同步。一个企业失败不会影响其他企业，也不会下架该企业的旧岗位。
 * 只有 adapter 明确返回 complete=true，才允许以快照中缺失的 source_key 判定岗位已撤下。
 */
export async function syncCompanyJobSources(sources, {
  supabase,
  dryRun = false,
  sample = false,
  force = false,
  selectedIds = [],
  limit,
  fetchImpl = fetch,
  adapters = companyJobAdapters,
  importer = importJobTables,
  onResult,
  log = console.log,
} = {}) {
  const selected = new Set(selectedIds)
  const enabled = sources.filter(source => source.enabled !== false && (!selected.size || selected.has(source.id)))
  if (!enabled.length) throw new Error(selected.size ? `没有找到已启用的来源：${[...selected].join('、')}` : '没有已启用的企业岗位来源')

  const results = []
  for (let sourceIndex = 0; sourceIndex < enabled.length; sourceIndex++) {
    const source = enabled[sourceIndex]
    try {
      validateSource(source, adapters)
      const adapter = adapters[source.adapter]
      if (!adapter) throw new Error(`adapter 未注册：${source.adapter}`)
      log(`\n=== ${source.name} ===`)
      const delayMs = Math.max(Number(source.requestDelayMs ?? 180), 0)
      const snapshot = await adapter(source, {
        fetchImpl,
        ...(limit ? { limit } : {}),
        wait: requestedMs => waitMs(Number.isFinite(Number(requestedMs)) ? Number(requestedMs) : delayMs),
      })
      const rows = snapshot?.rows || []
      log(`抓取 ${rows.length} 条；快照${snapshot?.complete ? '完整' : '不完整'}`)
      if (snapshot?.diagnostics?.failures?.length) {
        const examples = snapshot.diagnostics.failures.slice(0, 3)
          .map(item => item.reason || JSON.stringify(item))
          .join('；')
        log(`失败页面/详情 ${snapshot.diagnostics.failures.length} 个${examples ? `：${examples}` : ''}`)
      }
      if (snapshot?.diagnostics?.skippedNotFound?.length) {
        log(`官网列表中已有 ${snapshot.diagnostics.skippedNotFound.length} 条详情下架，已跳过`)
      }
      if (snapshot?.diagnostics?.unavailable) {
        log(`官网明确标记 ${snapshot.diagnostics.unavailable} 条岗位不可投递，将在本次完整同步中下架`)
      }

      // dry-run 可以用 --limit 快速抽样；真实写入必须是完整快照，防止误删。
      if (!dryRun && snapshot?.complete !== true) {
        throw new Error('本次抓取不是完整快照，已停止写库和下架操作')
      }
      const authoritativeEmpty = snapshot?.complete === true && snapshot?.authoritativeEmpty === true
      if (!rows.length && source.allowEmpty !== true && !authoritativeEmpty) {
        throw new Error('抓取结果为 0，已保留数据库中的现有岗位')
      }
      const deactivateMissingImmediately = snapshot?.complete === true && snapshot?.deactivateMissingImmediately === true

      const imported = await importer([{
        label: source.name,
        rows,
        fallback: source.fallbackCategory || '其他',
      }], {
        supabase,
        source: source.name,
        sourceType: source.sourceType || 'official',
        replace: snapshot?.complete === true,
        minKeepRatio: force || deactivateMissingImmediately ? 0 : Number(source.minKeepRatio ?? 0.55),
        requiredMissingRuns: deactivateMissingImmediately ? 1 : Number(source.requiredMissingRuns ?? 2),
        dryRun,
        sample,
        log,
      })
      const result = { id: source.id, name: source.name, ok: true, complete: snapshot?.complete === true, rows: rows.length, ...imported }
      results.push(result)
      if (onResult) await onResult(result, source)
    } catch (error) {
      log(`来源「${source?.name || source?.id || '未知'}」同步失败：${error.message}`)
      const result = { id: source?.id, name: source?.name, ok: false, error: error.message }
      results.push(result)
      if (onResult) await onResult(result, source)
    }
    if (sourceIndex < enabled.length - 1 && Number(source.sourceDelayMs) > 0) {
      await waitMs(Number(source.sourceDelayMs))
    }
  }
  return results
}
