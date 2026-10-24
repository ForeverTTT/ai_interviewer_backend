#!/usr/bin/env node
import { parseArgs } from 'node:util'
import '../src/config/env.js'
import { cleanupLegacyFeishuJobs } from '../src/lib/legacyFeishuCleanup.js'
import { supabase } from '../src/lib/supabase.js'

const { values: opts } = parseArgs({ options: {
  'dry-run': { type: 'boolean', default: false },
} })

await cleanupLegacyFeishuJobs({ supabase, dryRun: opts['dry-run'] })
