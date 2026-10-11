# Agora Agent Backend — Cross-Session Memory Recipe

FastAPI service that owns Agora token generation, agent session lifecycle, and the
per-user SQLite memory store. It is the service the web client reaches through the
Next.js `/api/*` rewrite proxy (port 8000).

## What this service does

Runs a warm conversational assistant using only Agora-managed vendors — **zero-key**:

**Pipeline:** `DeepgramSTT(nova-3, en)` → `OpenAI` (assistant with memory context via `system_messages`) → `MiniMaxTTS(English_captivating_female1)`

The `OpenAI` vendor is Agora-managed (keyless by default). There is **no
separate `llm/` service** in this recipe.

On each `/startAgent` call the server:
1. Loads prior conversation turns from SQLite for the supplied `userKey` handle.
2. Builds `system_messages` that include a base prompt and, when prior turns
   exist, a recalled-memory block.
3. Passes those `system_messages` to the `OpenAI(...)` vendor.

On each `/stopAgent` call the server:
1. Calls `await session.get_history()` **before** `session.stop()`.
2. Persists the captured turns to SQLite via `memory.save_memory()`.

## Run

Use the repo-root `README.md` for the full local flow (`bun run dev`). To work on
this module directly:

The root commands below select the correct virtualenv interpreter on macOS,
Linux, and Windows, so activation is not required:

```shell
bun run setup:server
bun run backend
```

## Tests

```bash
cd server
source venv/bin/activate
pytest tests/test_memory.py -v   # 5 unit tests, no Agora creds needed
```

## Environment

`server/.env.example` is the template. Required:

- `AGORA_APP_ID` — Agora project App ID.
- `AGORA_APP_CERTIFICATE` — Agora project App Certificate.

Optional:

| Variable | Default | Notes |
| --- | :---: | --- |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `OPENAI_API_KEY` | — | BYO only — Agora manages the OpenAI key by default (keyless). |
| `MEMORY_DB_PATH` | `memory.db` | Path to the SQLite file (relative to `server/`). |
| `MEMORY_MAX_TURNS` | `20` | Rolling cap on stored turns per user handle. |
| `NIMBLE_API_KEY` | — | Optional. Enables Nimble web search (`nimble_search` via MCP) for Maya. |
| `AGENT_GREETING` | built-in | Optional opening line override |

## API

- `GET /get_config` — token + channel/UID config
- `POST /startAgent` — start an agent session (`userKey` optional, triggers memory recall)
- `POST /stopAgent` — stop an agent session and persist conversation memory

The repo-root `bun run verify:local:fastapi` exercises these routes through the
Next proxy using a fake agent (`scripts/run_fake_server.py`), so no live Agora
session is required.

## Limitation

If the session times out due to idle silence (30 s), the SDK stop path bypasses
the history-capture block. End conversations via the end-call button to ensure
memory is saved.
