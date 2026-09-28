import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { DecisionRecord } from '@sabi/core'
import { renderDashboard } from '../src/dashboard.ts'

function round(overrides: Partial<DecisionRecord>): DecisionRecord {
  return {
    ts: '2026-09-28T12:00:00.000Z', sessionId: 's', alias: 'sabi-code', mode: 'auto', rule: 'fallback', tier: 'cheap',
    reason: 'test', upstream: 'openrouter', upstreamModel: 'vendor/model', stream: false, state: {} as DecisionRecord['state'],
    outcome: 'ok', ...overrides,
  }
}

test('dashboard renders an empty state before any round', () => {
  const html = renderDashboard([])
  assert.match(html, /No rounds yet/)
  assert.match(html, /Not enough rounds with usage yet/)
})

test('dashboard escapes model names and never shows an unpriced round as $0', () => {
  const html = renderDashboard([
    round({ upstreamModel: '<img src=x onerror=alert(1)>', usage: { promptTokens: 10, completionTokens: 5, cachedTokens: 0, totalTokens: 15 } }),
    round({ ts: '2026-09-28T12:05:00.000Z', usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, totalTokens: 2 } }),
  ])
  assert.doesNotMatch(html, /<img src=x/)
  assert.match(html, /&#60;img src=x onerror=alert\(1\)&#62;/)
  assert.match(html, /<td>—<\/td>/)
  assert.match(html, /2 unpriced rounds/)
  assert.match(html, /<svg viewBox/)
})

test('dashboard totals priced cost and share per model', () => {
  const html = renderDashboard([
    round({ upstreamModel: 'a', cost: { input: 0.75, output: 0.25, total: 1 } }),
    round({ upstreamModel: 'b', cost: { input: 2, output: 1, total: 3 } }),
  ])
  assert.match(html, /<b>\$4\.00<\/b>/)
  assert.match(html, /75\.0%/)
  assert.match(html, /25\.0%/)
})
