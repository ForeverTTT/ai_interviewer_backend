#!/usr/bin/env node
import '../src/config/env.js'
import { buildJobFacets, writeJobFacetsSnapshot } from '../src/lib/jobFacets.js'
import { supabase } from '../src/lib/supabase.js'

const startedAt = Date.now()
const value = await buildJobFacets(supabase)
const snapshot = await writeJobFacetsSnapshot(supabase, value)
console.log(`岗位筛选快照已更新：${snapshot.total} 个开放岗位，耗时 ${Date.now() - startedAt}ms，生成于 ${snapshot.generatedAt}`)
