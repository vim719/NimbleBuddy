// Talks to the existing FastAPI backend (server/). The App Certificate never
// leaves the server; the extension only receives short-lived tokens.
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export interface SessionConfig {
  app_id: string
  token: string
  uid: string
  channel_name: string
  agent_uid: string
}

type Envelope<T> = { code: number; msg?: string; data?: T }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, init)
  } catch {
    throw new Error(`Can't reach the Maya backend at ${API_BASE_URL}. Is "npm run dev" running?`)
  }
  const body = (await response.json().catch(() => ({}))) as Envelope<T> & { detail?: string }
  if (!response.ok || body.code !== 0 || body.data === undefined) {
    throw new Error(body.detail || body.msg || `HTTP ${response.status}`)
  }
  return body.data
}

export function getConfig(options?: { channel?: string; uid?: string }): Promise<SessionConfig> {
  const params = new URLSearchParams()
  if (options?.channel) params.set('channel', options.channel)
  if (options?.uid) params.set('uid', options.uid)
  const query = params.toString()
  return call<SessionConfig>(`/get_config${query ? `?${query}` : ''}`)
}

export async function startAgent(config: SessionConfig, userKey?: string): Promise<string> {
  const payload: Record<string, unknown> = {
    channelName: config.channel_name,
    rtcUid: Number(config.agent_uid),
    userUid: Number(config.uid),
  }
  if (userKey) payload.userKey = userKey
  const data = await call<{ agent_id: string }>('/startAgent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return data.agent_id
}

// keepalive lets the request finish even if the popup is closing; stopping the
// agent is what saves the conversation to memory.
export async function stopAgent(agentId: string, keepalive = false): Promise<void> {
  await fetch(`${API_BASE_URL}/stopAgent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId }),
    keepalive,
  })
}
