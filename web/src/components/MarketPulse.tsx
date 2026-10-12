'use client'

import { ArrowLeft, Download, ExternalLink, Loader2, Search, TrendingDown, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { HoverLetters } from '@/components/HoverLetters'
import {
  type MarketInsight,
  type MarketInsightSummary,
  type MarketOutlook,
  getInsight,
  getJob,
  insightCsvUrl,
  listInsights,
  startOutlook,
} from '@/services/market'

const HORIZONS = [
  { key: 'short', label: 'Short term', hint: 'weeks' },
  { key: 'mid', label: 'Mid term', hint: 'months' },
  { key: 'long', label: 'Long term', hint: '1+ years' },
] as const

const STEPS = [
  'Searching news from the last 7 days',
  'Reading X/Twitter and Reddit chatter',
  'Collecting analyst targets and key levels',
  'Structuring six cited outlooks',
]

function formatPrice(value?: number | null, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const digits = value >= 1000 ? 0 : value >= 1 ? 2 : 6
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: digits,
  }).format(value)
}

// Nimbleway may return the score as -1..1 or 0..100; normalise to -1..1.
function normaliseScore(score?: number | null) {
  if (score === null || score === undefined) return null
  if (score > 1 && score <= 100) return (score - 50) / 50
  return Math.max(-1, Math.min(1, score))
}

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function OutlookCard({ outlook, currency }: { outlook: MarketOutlook; currency: string }) {
  const bullish = outlook.scenario.toLowerCase().includes('bull')
  const accent = bullish ? 'var(--c-green)' : 'var(--c-red)'
  return (
    <article
      className="group rounded-2xl border border-border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg"
      style={{ borderTop: `4px solid ${accent}` }}
    >
      <header className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: accent }}>
          {bullish ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          {bullish ? 'Bullish' : 'Bearish'}
        </span>
        {outlook.confidence ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium capitalize text-muted-foreground">
            {outlook.confidence} confidence
          </span>
        ) : null}
      </header>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-muted p-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Entry zone</dt>
          <dd className="mt-0.5 text-[13px] font-semibold">
            {formatPrice(outlook.entry_low, currency)}
            {outlook.entry_high ? (
              <span className="block text-muted-foreground">– {formatPrice(outlook.entry_high, currency)}</span>
            ) : null}
          </dd>
        </div>
        <div className="rounded-lg p-2" style={{ background: `color-mix(in srgb, ${accent} 12%, white)` }}>
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exit target</dt>
          <dd className="mt-0.5 text-[13px] font-semibold" style={{ color: accent }}>
            {formatPrice(outlook.exit_target, currency)}
          </dd>
        </div>
        <div className="rounded-lg bg-muted p-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Invalidation</dt>
          <dd className="mt-0.5 text-[13px] font-semibold">{formatPrice(outlook.invalidation_level, currency)}</dd>
        </div>
      </dl>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-primary">
          Why — evidence & sources
        </summary>
        <p className="mt-2 leading-6 text-muted-foreground">{outlook.rationale}</p>
        {outlook.source_urls?.length ? (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {outlook.source_urls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {hostname(url)} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </article>
  )
}

function SentimentMeter({ score, label }: { score: number | null; label?: string }) {
  const pct = score === null ? 50 : Math.round(((score + 1) / 2) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Market sentiment</span>
        <span className="text-sm font-semibold">{label ?? '—'}</span>
      </div>
      <div
        className="relative mt-2 h-3 rounded-full"
        style={{ background: 'linear-gradient(90deg, var(--c-red), var(--c-yellow) 50%, var(--c-green))' }}
      >
        <span
          className="absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-foreground shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>Bearish</span>
        <span>Neutral</span>
        <span>Bullish</span>
      </div>
    </div>
  )
}

export default function MarketPulse() {
  const [symbol, setSymbol] = useState('BTC')
  const [assetType, setAssetType] = useState<'crypto' | 'stock'>('crypto')
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [insight, setInsight] = useState<MarketInsight | null>(null)
  const [history, setHistory] = useState<MarketInsightSummary[]>([])
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshHistory = useCallback(() => {
    listInsights()
      .then(setHistory)
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshHistory()
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [refreshHistory])

  const openInsight = useCallback(async (id: string) => {
    try {
      setInsight(await getInsight(id))
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load that outlook.')
    }
  }, [])

  const poll = useCallback(
    (jobId: string) => {
      pollRef.current = setTimeout(async () => {
        try {
          const job = await getJob(jobId)
          setElapsed(job.elapsed_seconds)
          if (job.status === 'running') return poll(jobId)
          setRunning(false)
          if (job.status === 'error') {
            setError(job.error ?? 'Research failed.')
            return
          }
          if (job.insight_id) {
            await openInsight(job.insight_id)
            refreshHistory()
          }
        } catch (nextError) {
          setRunning(false)
          setError(nextError instanceof Error ? nextError.message : 'Lost connection to the backend.')
        }
      }, 3000)
    },
    [openInsight, refreshHistory],
  )

  const run = async () => {
    const ticker = symbol.trim().toUpperCase()
    if (!ticker || running) return
    setError(null)
    setInsight(null)
    setElapsed(0)
    setRunning(true)
    try {
      const { jobId } = await startOutlook(ticker, assetType)
      poll(jobId)
    } catch (nextError) {
      setRunning(false)
      setError(nextError instanceof Error ? nextError.message : 'Could not start research.')
    }
  }

  const currency = insight?.currency && insight.currency.length === 3 ? insight.currency : 'USD'
  const score = normaliseScore(insight?.sentiment_score)
  const step = Math.min(STEPS.length - 1, Math.floor(elapsed / 25))

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <div className="palette-bars" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-6">
        <nav className="mb-8 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="h-4 w-4" /> Talk to Anna
          </Link>
          <span className="text-xs text-muted-foreground">
            Powered by <b className="text-primary">Nimbleway</b>
          </span>
        </nav>

        <header className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            Live web → structured insight
          </p>
          <h1 className="mt-3 text-[clamp(38px,6vw,64px)] font-bold italic leading-[1.05] tracking-[-0.035em]">
            <HoverLetters text="Market" autoWave /> <span className="palette-gradient-text">Pulse</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Nimbleway reads the news, X/Twitter and Reddit for any stock or token, then returns six cited outlooks —
            short, mid and long term — saved to a structured database.
          </p>
        </header>

        <form
          className="mx-auto mt-8 flex max-w-xl flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-[0_20px_50px_rgba(20,22,31,0.08)] sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void run()
          }}
        >
          <div className="flex rounded-xl bg-muted p-1 text-sm font-medium">
            {(['crypto', 'stock'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAssetType(type)}
                className={`rounded-lg px-3 py-1.5 capitalize transition-colors ${
                  assetType === type ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          <input
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            placeholder={assetType === 'crypto' ? 'BTC, ETH, SOL…' : 'AAPL, NVDA, TSLA…'}
            aria-label="Ticker symbol"
            className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm font-semibold uppercase outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={running}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(25,130,196,0.28)] transition-all hover:-translate-y-0.5 hover:bg-accent disabled:opacity-60 disabled:hover:translate-y-0"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {running ? 'Researching…' : 'Get outlook'}
          </button>
        </form>

        <p className="mx-auto mt-3 max-w-xl text-center text-[11px] text-muted-foreground">
          Educational sentiment research from public sources — not financial advice.
        </p>

        {running ? (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-border bg-card p-5">
            <p className="text-sm font-semibold">
              Nimbleway is researching {symbol.toUpperCase()} · {elapsed}s
            </p>
            <ol className="mt-3 space-y-2 text-sm">
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  className={`flex items-center gap-2 ${index <= step ? 'text-foreground' : 'text-muted-foreground/60'}`}
                >
                  {index < step ? (
                    <span className="h-2 w-2 rounded-full bg-[var(--c-green)]" />
                  ) : index === step ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-border" />
                  )}
                  {label}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">Usually 1–3 minutes.</p>
          </div>
        ) : null}

        {error ? (
          <p className="mx-auto mt-6 max-w-xl rounded-xl bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {insight ? (
          <section className="mt-10">
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
              <div className="rounded-2xl border border-border bg-card p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-2xl font-bold italic tracking-tight">
                    {insight.asset_name ?? insight.symbol}{' '}
                    <span className="text-base font-semibold not-italic text-muted-foreground">{insight.symbol}</span>
                  </h2>
                  <div className="flex gap-2">
                    <a
                      href={insightCsvUrl(insight.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                    >
                      <Download className="h-3.5 w-3.5" /> CSV
                    </a>
                    <a
                      href={`/api/market/insights/${insight.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary"
                    >
                      JSON
                    </a>
                  </div>
                </div>
                <p className="mt-2 text-3xl font-bold">
                  {formatPrice(insight.current_price, currency)}
                  {insight.live_price?.change_24h_pct != null ? (
                    <span
                      className="ml-2 text-sm font-semibold"
                      style={{ color: insight.live_price.change_24h_pct >= 0 ? 'var(--c-green)' : 'var(--c-red)' }}
                    >
                      {insight.live_price.change_24h_pct >= 0 ? '+' : ''}
                      {insight.live_price.change_24h_pct.toFixed(2)}% 24h
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {insight.live_price ? `Live price: ${insight.live_price.source}` : 'Price from Nimbleway research'}
                  {insight.as_of ? ` · research as of ${insight.as_of}` : ''}
                </p>
                {insight.sentiment_summary ? (
                  <p className="mt-4 text-sm leading-6 text-muted-foreground">{insight.sentiment_summary}</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
                <SentimentMeter score={score} label={insight.overall_sentiment} />
                {insight.headlines?.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent headlines
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {insight.headlines.slice(0, 5).map((headline) => (
                        <li key={headline.url} className="text-sm">
                          <a
                            href={headline.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="line-clamp-2 hover:text-primary"
                          >
                            {headline.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {HORIZONS.map((horizon) => {
                const items = insight.outlooks.filter((o) => o.horizon.toLowerCase().startsWith(horizon.key))
                return (
                  <div key={horizon.key}>
                    <h3 className="mb-2 flex items-baseline gap-2 text-lg font-bold italic">
                      {horizon.label}
                      <span className="text-xs font-medium not-italic text-muted-foreground">{horizon.hint}</span>
                    </h3>
                    <div className="space-y-3">
                      {items.length ? (
                        items.map((outlook) => (
                          <OutlookCard
                            key={`${outlook.horizon}-${outlook.scenario}`}
                            outlook={outlook}
                            currency={currency}
                          />
                        ))
                      ) : (
                        <p className="text-sm text-muted-foreground">No outlook returned.</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <p className="mt-6 rounded-xl border border-[color-mix(in_srgb,var(--c-yellow)_60%,white)] bg-[color-mix(in_srgb,var(--c-yellow)_14%,white)] p-3 text-xs text-muted-foreground">
              {insight.disclaimer ??
                'Educational sentiment research compiled from public sources. Not financial advice.'}
            </p>
          </section>
        ) : null}

        {history.length ? (
          <section className="mt-12">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Saved outlooks · structured database
            </h3>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Symbol</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Price</th>
                    <th className="px-4 py-2">Sentiment</th>
                    <th className="px-4 py-2">Saved</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-t border-border hover:bg-muted/60">
                      <td className="px-4 py-2 font-semibold">{row.symbol}</td>
                      <td className="px-4 py-2 capitalize text-muted-foreground">{row.asset_type}</td>
                      <td className="px-4 py-2">{formatPrice(row.current_price)}</td>
                      <td className="px-4 py-2">{row.overall_sentiment ?? '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(row.created_at * 1000).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void openInsight(row.id)}
                          className="text-xs font-medium text-primary hover:underline"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
