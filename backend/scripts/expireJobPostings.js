#!/usr/bin/env node
import '../src/config/env.js'
import { chinaCalendarDate } from '../src/lib/chinaDate.js'
import { supabase } from '../src/lib/supabase.js'

const today = chinaCalendarDate()
const { count, error } = await supabase
  .from('job_postings')
  .delete({ count: 'exact' })
  .lt('deadline_date', today)

if (error) throw error
console.log(`北京时间 ${today}：已删除 ${Number(count || 0)} 条超过截止日期的岗位`)
