import test from 'node:test'
import assert from 'node:assert/strict'
import { loadKnowledge, loadPrompt } from '../src/agents/utils.js'

test('backend runtime data remains readable after the directory move', async () => {
  const prompt = await loadPrompt('opening_agent')
  const knowledge = await loadKnowledge('technical_domains')

  assert.ok(prompt.trim().length > 0)
  assert.ok(knowledge && typeof knowledge === 'object')
})
