import type { DecisionRecord } from '@sabi/core'

/**
 * The `/dashboard` page: a read-only view over the proxy's in-memory recent rounds.
 *
 * Every number on the page is computed from `records`; nothing is projected or compared against a
 * period the proxy never saw. A round without a recorded cost is shown as unpriced ("—"), never as
 * $0, because borrowed-subscription and unpriced rounds carry no price, not a zero one.
 */

interface ModelRow {
  model: string
  tier: string
  rounds: number
  tokens: number
  input: number
  output: number
  total: number
  priced: boolean
}

const esc = (value: unknown): string =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })
const compact = (n: number): string => compactFormat.format(n)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

function money(n: number): string {
  if (n === 0) return '$0'
  const digits = n >= 100 ? 0 : n >= 1 ? 2 : 4
  return `$${n.toLocaleString('en', { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })}`
}

function mostFrequent(counts: Map<string, number>): string {
  let best = ''
  let max = -1
  for (const [key, n] of counts) if (n > max) [best, max] = [key, n]
  return best
}

/** Same rule as `sabi report`: only a finite, non-negative total is a price. */
function isPriced(rec: DecisionRecord): rec is DecisionRecord & { cost: NonNullable<DecisionRecord['cost']> } {
  return Number.isFinite(rec.cost?.total) && rec.cost!.total >= 0
}

function modelRows(records: DecisionRecord[]): ModelRow[] {
  const rows = new Map<string, ModelRow & { tiers: Map<string, number> }>()
  for (const rec of records) {
    const model = rec.servedModel || rec.upstreamModel
    const row = rows.get(model) ?? { model, tier: '', rounds: 0, tokens: 0, input: 0, output: 0, total: 0, priced: false, tiers: new Map() }
    row.rounds += 1
    row.tiers.set(rec.tier, (row.tiers.get(rec.tier) ?? 0) + 1)
    row.tokens += rec.usage?.totalTokens ?? 0
    if (isPriced(rec)) {
      row.priced = true
      row.input += rec.cost.input
      row.output += rec.cost.output
      row.total += rec.cost.total
    }
    rows.set(model, row)
  }
  return [...rows.values()]
    .map(({ tiers, ...row }) => ({ ...row, tier: mostFrequent(tiers) }))
    .sort((a, b) => b.tokens - a.tokens)
}

function niceMax(n: number): number {
  if (n <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(n))
  return ([1, 2, 2.5, 5, 10].find((step) => step * pow >= n) ?? 10) * pow
}

/** Catmull-Rom through the points as cubic Béziers; control points are clamped to the plot. */
function smoothPath(points: Array<[number, number]>, top: number, bottom: number): string {
  const clamp = (y: number) => Math.min(bottom, Math.max(top, y))
  let d = `M${points[0][0]},${points[0][1]}`
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[i - 1] ?? points[i], points[i], points[i + 1], points[i + 2] ?? points[i + 1]]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, clamp(p1[1] + (p2[1] - p0[1]) / 6)].map((v) => v.toFixed(1))
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, clamp(p2[1] - (p3[1] - p1[1]) / 6)].map((v) => v.toFixed(1))
    d += ` C${c1} ${c2} ${p2[0]},${p2[1]}`
  }
  return d
}

function timeLabel(ms: number, spanMs: number): string {
  const date = new Date(ms)
  return spanMs > 86_400_000
    ? date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function tokensChart(records: DecisionRecord[]): string {
  const timed = records
    .map((rec) => ({ t: Date.parse(rec.ts), tokens: rec.usage?.totalTokens }))
    .filter((p): p is { t: number; tokens: number } => p.tokens !== undefined && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t)
  if (timed.length < 2 || timed[timed.length - 1].t === timed[0].t) {
    return '<p class="empty">Not enough rounds with usage yet. The chart appears after two rounds report tokens.</p>'
  }
  // ponytail: fixed bucket count; per-round points are too spiky past ~30 rounds.
  const first = timed[0].t
  const span = timed[timed.length - 1].t - first
  const count = Math.min(30, timed.length)
  const buckets = Array.from({ length: count }, (_, i) => ({ t: first + (span * (i + 0.5)) / count, tokens: 0, rounds: 0 }))
  for (const { t, tokens } of timed) {
    const bucket = buckets[Math.min(count - 1, Math.floor(((t - first) / span) * count))]
    bucket.tokens += tokens
    bucket.rounds += 1
  }

  const [W, H, left, right, top, bottom] = [640, 340, 48, 16, 12, 308]
  const max = niceMax(Math.max(...buckets.map((b) => b.tokens)))
  const x = (i: number) => left + ((W - left - right) * i) / (count - 1)
  const y = (v: number) => bottom - ((bottom - top) * v) / max
  const round1 = (v: number) => Math.round(v * 10) / 10
  const points = buckets.map((b, i): [number, number] => [round1(x(i)), round1(y(b.tokens))])
  const line = smoothPath(points, top, bottom)
  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = y(max * f)
    return `<line class="grid" x1="${left}" x2="${W - right}" y1="${gy}" y2="${gy}"/><text class="axis" x="${left - 10}" y="${gy + 4}" text-anchor="end">${esc(compact(max * f))}</text>`
  }).join('')
  const last = points[points.length - 1]
  const [from, to] = [esc(timeLabel(first, span)), esc(timeLabel(first + span, span))]
  const data = buckets.map((b, i) => ({ x: points[i][0], y: points[i][1], label: timeLabel(b.t, span), tokens: compact(b.tokens), rounds: b.rounds }))

  return `
    <div class="chart" data-points="${esc(JSON.stringify(data))}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tokens per time bucket, ${from} to ${to}">
        <defs><linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0.02"/>
        </linearGradient></defs>
        ${grid}
        <path d="${line} L${last[0]},${bottom} L${points[0][0]},${bottom} Z" fill="url(#fill)"/>
        <path d="${line}" class="line"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="5" class="dot"/>
        <line class="cross" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/>
        <circle class="hover" r="5" visibility="hidden"/>
        <text class="axis" x="${left}" y="${H - 6}">${from}</text>
        <text class="axis" x="${W - right}" y="${H - 6}" text-anchor="end">${to}</text>
      </svg>
      <div class="tip" hidden></div>
    </div>`
}

export function renderDashboard(records: DecisionRecord[]): string {
  const rows = modelRows(records)
  const tokens = rows.reduce((sum, row) => sum + row.tokens, 0)
  const failed = records.filter((rec) => rec.outcome !== 'ok').length
  const fallbacks = records.filter((rec) => rec.fallback).length
  const cost = rows.reduce((sum, row) => sum + row.total, 0)
  const unpriced = records.filter((rec) => !isPriced(rec)).length
  const health = records.length === 0
    ? 'waiting for the first round'
    : failed === 0 ? 'all rounds ok' : `${failed} of ${records.length} rounds failed`

  const cards = rows.length === 0
    ? '<p class="empty">No rounds yet. Send a request through the proxy and refresh.</p>'
    : rows.map((row) => `
      <div class="kpi">
        <div class="kpi-head"><span class="kpi-name" title="${esc(row.model)}">${esc(row.model)}</span><span class="badge">${esc(row.tier)}</span></div>
        <div class="kpi-value">${esc(compact(row.tokens))}</div>
        <div class="muted">${plural(row.rounds, 'round')}</div>
      </div>`).join('')

  const costRows = rows.map((row) => `
      <tr>
        <td class="model" title="${esc(row.model)}">${esc(row.model)}</td>
        ${[row.input, row.output, row.total].map((v) => `<td>${row.priced ? money(v) : '—'}</td>`).join('')}
        <td>${row.priced && cost > 0 ? `${((row.total / cost) * 100).toFixed(1)}%` : '—'}</td>
      </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sabi Dashboard</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f5f6f8; --card: #ffffff; --line: #eceef2; --zebra: #f7f8fa;
    --ink: #101217; --muted: #6b7180; --accent: #e8175d; --accent-soft: #fde8ef;
    --radius: 20px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-size: 14px; line-height: 1.45; }
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 14px 32px; background: var(--card); border-bottom: 1px solid var(--line); }
  .brand { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); font-weight: 600; }
  .brand i { width: 14px; height: 14px; border-radius: 4px; background: var(--accent); }
  main { max-width: 1280px; margin: 0 auto; padding: 32px; display: grid; gap: 20px; }
  .head { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: 16px; }
  h1 { margin: 0; font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
  h2 { margin: 2px 0 0; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .muted, .eyebrow { color: var(--muted); }
  .eyebrow { font-size: 13px; }
  .pill { padding: 8px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); color: var(--muted); font-size: 13px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 24px; min-width: 0; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); padding: 8px 0; }
  .kpi { padding: 16px 28px; border-left: 1px solid var(--line); min-width: 0; }
  .kpi:first-child { border-left: 0; }
  .kpi-head { display: flex; justify-content: space-between; gap: 8px; color: var(--muted); }
  .kpi-name, .model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kpi-value { margin: 10px 0 6px; font-size: 40px; font-weight: 600; letter-spacing: -0.03em; line-height: 1.1; }
  .badge { flex: none; padding: 2px 8px; border-radius: 999px; background: var(--zebra); font-size: 12px; }
  .grid2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; }
  .total { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin: 14px 0 18px; }
  .total b { font-size: 36px; font-weight: 600; letter-spacing: -0.03em; }
  .chart { position: relative; margin-top: 12px; }
  svg { display: block; width: 100%; height: auto; }
  .grid { stroke: var(--line); stroke-dasharray: 3 4; }
  .axis { fill: var(--muted); font-size: 12px; }
  .line { fill: none; stroke: var(--accent); stroke-width: 2.5; stroke-linejoin: round; }
  .dot, .hover { fill: var(--accent); stroke: var(--card); stroke-width: 2; }
  .cross { stroke: var(--muted); stroke-width: 1; }
  .tip { position: absolute; top: 0; transform: translateX(-50%); pointer-events: none; padding: 8px 10px; border-radius: 10px; background: var(--ink); color: #fff; font-size: 12px; white-space: nowrap; }
  .table { border: 1px solid var(--line); border-radius: 14px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 14px 16px; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.02em; color: var(--muted); border-bottom: 1px solid var(--line); }
  tbody tr:nth-child(even) { background: var(--zebra); }
  td { font-variant-numeric: tabular-nums; }
  .model { max-width: 220px; }
  .empty { color: var(--muted); padding: 24px 28px; margin: 0; }
  @media (max-width: 900px) { .grid2 { grid-template-columns: 1fr; } }
  @media (max-width: 600px) {
    .bar, main { padding-left: 16px; padding-right: 16px; }
    .kpi { border-left: 0; border-top: 1px solid var(--line); }
    .kpi:first-child { border-top: 0; }
  }
</style>
</head>
<body>
<header class="bar"><span class="brand"><i></i>Sabi</span><span class="muted">Local proxy</span></header>
<main>
  <section class="head">
    <div>
      <h1>Overview</h1>
      <div class="muted">${plural(rows.length, 'model')} served · ${esc(compact(tokens))} tokens · ${records.length} rounds · ${esc(health)}${fallbacks ? ` · ${fallbacks} fallbacks` : ''}</div>
    </div>
    <span class="pill">Last ${records.length} rounds, since the proxy started</span>
  </section>
  <section class="card kpis" aria-label="Tokens by model">${cards}</section>
  <section class="grid2">
    <div class="card">
      <div class="eyebrow">Recent rounds</div>
      <h2>Tokens usage</h2>
      ${tokensChart(records)}
    </div>
    <div class="card">
      <div class="eyebrow">Across all models</div>
      <h2>What it's costing</h2>
      <div class="total"><b>${money(cost)}</b><span class="muted">estimated from configured prices${unpriced ? ` · ${plural(unpriced, 'unpriced round')}` : ''}</span></div>
      <div class="table"><table>
        <thead><tr><th>Model</th><th>Input</th><th>Output</th><th>Total</th><th>Share</th></tr></thead>
        <tbody>${costRows || '<tr><td colspan="5" class="muted">No rounds yet.</td></tr>'}</tbody>
      </table></div>
    </div>
  </section>
</main>
<script>
  for (const chart of document.querySelectorAll('.chart')) {
    const points = JSON.parse(chart.dataset.points)
    const svg = chart.querySelector('svg'), tip = chart.querySelector('.tip')
    const cross = svg.querySelector('.cross'), hover = svg.querySelector('.hover')
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); hover.setAttribute('visibility', 'hidden') }
    svg.addEventListener('pointerleave', hide)
    svg.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect(), scale = svg.viewBox.baseVal.width / box.width
      const vx = (event.clientX - box.left) * scale
      const p = points.reduce((a, b) => Math.abs(b.x - vx) < Math.abs(a.x - vx) ? b : a)
      cross.setAttribute('x1', p.x); cross.setAttribute('x2', p.x); cross.setAttribute('visibility', 'visible')
      hover.setAttribute('cx', p.x); hover.setAttribute('cy', p.y); hover.setAttribute('visibility', 'visible')
      tip.textContent = p.label + ' · ' + p.tokens + ' tokens · ' + p.rounds + (p.rounds === 1 ? ' round' : ' rounds')
      tip.style.left = (p.x / scale) + 'px'
      tip.hidden = false
    })
  }
</script>
</body>
</html>`
}
