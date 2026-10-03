import express from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../lib/supabase.js'
import { checkTokens, deductTokens } from '../middleware/tokens.js'
import { topGallupDomain, trackServerEvent } from '../lib/analytics.js'

const router = express.Router()

// GET /api/gallup/results - Fetch existing results or progress
router.get('/results', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallup_responses')
      .select('*')
      .eq('user_id', req.user.id)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 is "no rows found"
      throw error
    }

    // Auto-patch translations for legacy records
    if (data && data.status === 'completed' && data.results && data.results.analysis) {
      const domains = Object.keys(data.results.analysis);
      let needsPatch = false;
      for (const dom of domains) {
        if (!data.results.analysis[dom].translations) {
          needsPatch = true;
          break;
        }
      }

      if (needsPatch) {
        const patchPromises = domains.map(async (dom) => {
          const tier = data.results.analysis[dom].tier;
          const { data: transData } = await supabase
            .from('gallup_analysis_content')
            .select('content, lang')
            .eq('domain_key', dom)
            .eq('score_tier', tier);

          if (transData && transData.length > 0) {
            const translations = {};
            transData.forEach(r => translations[r.lang] = r.content);
            data.results.analysis[dom].translations = translations;
          }
        });
        await Promise.all(patchPromises);
      }
    }

    res.json(data || { answers: {}, results: [], status: 'not_started' })
  } catch (error) {
    console.error('[Gallup Get Error]', error)
    res.status(500).json({ error: 'Failed to fetch gallup results' })
  }
})

// GET /api/gallup/questions - Fetch all 20 questions
router.get('/questions', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('gallup_questions')
      .select('*')
      .order('index_number', { ascending: true })

    if (error) throw error

    res.json(data)
  } catch (error) {
    console.error('[Gallup Questions Get Error]', error)
    res.status(500).json({ error: 'Failed to fetch gallup questions' })
  }
})

// POST /api/gallup/analyze - Generate DB-based report and save
router.post('/analyze', requireAuth, (req, _, next) => { req.tokenCost = 100; req.tokenFeature = 'gallup'; next(); }, checkTokens, async (req, res) => {
  const { answers, results, language = 'zh', status } = req.body

  try {
    // 1. Calculate tiers for each domain
    const analysisData = {};
    const promises = results.map(async (domain) => {
      const tier = domain.score >= 75 ? 'high' : domain.score >= 40 ? 'medium' : 'low';

      const { data, error } = await supabase
        .from('gallup_analysis_content')
        .select('content, lang')
        .eq('domain_key', domain.key)
        .eq('score_tier', tier);

      if (!error && data && data.length > 0) {
        const translations = {};
        data.forEach(row => {
          translations[row.lang] = row.content;
        });

        analysisData[domain.key] = {
          tier,
          translations,
          dimensions: translations[language] || translations['en'] || translations['zh'] || []
        };
      } else {
        // Fallback if not seeded yet
        analysisData[domain.key] = {
          tier,
          dimensions: []
        };
      }
    });

    await Promise.all(promises);

    const finalBlob = {
      scores: results,
      analysis: analysisData // Object with keys: executing, influencing, relationship, strategic
    }

    const { data: upsertData, error } = await supabase
      .from('gallup_responses')
      .upsert({
        user_id: req.user.id,
        answers,
        results: finalBlob,
        status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) throw error

    await deductTokens(req.user.id, 100, { req, feature: 'gallup' })
    trackServerEvent(req, 'gallup_completed', { props: { topDomain: topGallupDomain(results) } })
    res.json({ ...upsertData, tokensDeducted: 100 })
  } catch (error) {
    console.error('[Gallup Analyze Error]', error)
    res.status(500).json({ error: 'Failed to generate and save analysis' })
  }
})


// POST /api/gallup/save - Save progress or final results
router.post('/save', requireAuth, async (req, res) => {
  const { answers, results, status } = req.body

  try {
    const { data, error } = await supabase
      .from('gallup_responses')
      .upsert({
        user_id: req.user.id,
        answers,
        results,
        status,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select()
      .single()

    if (error) throw error

    res.json(data)
  } catch (error) {
    console.error('[Gallup Save Error]', error)
    res.status(500).json({ error: 'Failed to save gallup results' })
  }
})

export default router
