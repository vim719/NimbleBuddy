# Architecture — Cross-Session Memory Recipe

Two processes. The browser talks only to Next.js `/api/*`, which rewrites to the
agent backend. The agent backend owns Agora tokens, agent lifecycle, and the
SQLite per-user memory store. OpenAI is Agora-managed (keyless) — no separate
LLM service is needed.

## Request flow

```
Browser
  │  GET /api/get_config              → token + channel/UIDs
  │  POST /api/startAgent { userKey } → start agent session (with memory context)
  ▼
Next.js  (rewrites /api/* → AGENT_BACKEND_URL)
  ▼
Agent backend (server/, :8000)
  │  1. loads prior turns from SQLite for userKey
  │  2. builds system_messages = [base_prompt, memory_context]
  │  3. starts session: OpenAI(model=OPENAI_MODEL, system_messages=...)
  ▼
Agora ConvoAI Cloud
  │  user speech → Deepgram STT (managed, nova-3, en)
  │  text → OpenAI (Agora-managed, keyless, model=OPENAI_MODEL)
  │  response → MiniMax TTS (managed, English_captivating_female1)
  ▼
User hears warm, context-aware response; RTM transcript + metrics → web UI

POST /api/stopAgent { agentId }
  ▼
Agent backend
  │  await session.get_history()   ← must happen BEFORE session.stop()
  │  memory.save_memory(conn, userKey, turns)
  │  await session.stop()
```

## Why no llm/ service

This recipe uses the **managed OpenAI vendor**
(`agora_agent.agentkit.vendors.OpenAI`). Agora holds the OpenAI API key on its
cloud; the recipe is zero-key by default. An optional `OPENAI_API_KEY` env var
lets you bring your own account if needed.

This means:
- No `llm/` service to expose publicly.
- No tunnel (ngrok) required.
- The only required credentials are `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE`.

## Memory store

`server/src/memory.py` is a **pure module** (no `agora_agent` import) containing:

| Function | Purpose |
| --- | --- |
| `get_db(path)` | Open (or create) the SQLite connection and ensure the schema exists. |
| `get_memory(conn, user_key)` | Return stored turns for a handle, or `[]`. |
| `save_memory(conn, user_key, new_turns)` | Merge new turns, cap to `MAX_TURNS`, persist. |
| `build_memory_system_message(turns)` | Build a `{"role":"system","content":...}` dict from turns, or `None` if empty. |

The module is unit-tested independently of the Agora SDK (`server/tests/test_memory.py`).

## get_history capture window

`session.get_history()` only works **while the agent session is running**.
`agent.stop()` therefore:
1. Pops the session and user_key from the in-memory maps.
2. Calls `get_history()`.
3. Persists the turns via `save_memory()`.
4. Calls `session.stop()`.

If the session was evicted by idle timeout before `stop()` is called, the
history is unavailable. This is noted as a limitation in the README.

## API (agent backend, port 8000)

| Endpoint | Method | Body | Description |
| --- | --- | --- | --- |
| `/get_config` | GET | — | Token + channel/UID config |
| `/startAgent` | POST | `{channelName, rtcUid, userUid, userKey?}` | Start agent session (memory injected if userKey given) |
| `/stopAgent` | POST | `{agentId}` | Stop agent; captures and persists memory |

The browser calls these as `/api/*`; Next rewrites them to `AGENT_BACKEND_URL`.

## Auth

- Browser → agent backend: none (local dev).
- Agent backend → Agora cloud: Token007, generated from `AGORA_APP_ID` +
  `AGORA_APP_CERTIFICATE`.
- Agora cloud → OpenAI: Agora-managed key (transparent to this recipe).
  Optionally overridden by `OPENAI_API_KEY` if provided.
