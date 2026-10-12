const API_BASE_URL = '/api/market'

export interface MarketOutlook {
  horizon: string
  scenario: string
  entry_low?: number | null
  entry_high?: number | null
  exit_target?: number | null
  invalidation_level?: number | null
  confidence?: string
  rationale: string
  source_urls?: string[]
}

export interface MarketInsight {
  id: string
  symbol: string
  asset_type: string
  created_at: number
  asset_name?: string
  current_price?: number | null
  currency?: string
  as_of?: string
  overall_sentiment?: string
  sentiment_score?: number | null
  sentiment_summary?: string
  outlooks: MarketOutlook[]
  headlines?: { title: string; url: string; sentiment?: string }[]
  live_price?: { price_usd: number; change_24h_pct?: number | null; source: string; name?: string }
  citations?: string[]
  disclaimer?: string
}

export type MarketInsightSummary = Pick<
  MarketInsight,
  'id' | 'symbol' | 'asset_type' | 'created_at' | 'overall_sentiment' | 'sentiment_score' | 'current_price'
>

export interface MarketJob {
  status: 'running' | 'done' | 'error'
  symbol: string
  insight_id?: string
  error?: string
  elapsed_seconds: number
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.code !== 0) {
    throw new Error(body.detail || body.msg || `HTTP ${response.status}`)
  }
  return body.data as T
}

export function startOutlook(symbol: string, assetType: 'stock' | 'crypto'): Promise<{ jobId: string }> {
  return call('/outlook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, assetType }),
  })
}

export const getJob = (jobId: string) => call<MarketJob>(`/jobs/${jobId}`)
export const listInsights = () => call<MarketInsightSummary[]>('/insights')
export const getInsight = (id: string) => call<MarketInsight>(`/insights/${id}`)
export const insightCsvUrl = (id: string) => `${API_BASE_URL}/insights/${id}.csv`
