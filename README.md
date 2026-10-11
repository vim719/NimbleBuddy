# NimbleBuddy — Meet Maya

**🌐 Showcase: [vim719.github.io/NimbleBuddy](https://vim719.github.io/NimbleBuddy/)**

Maya is a real-time voice AI companion that remembers you across calls and
searches the live web with Nimble. Talk to her in the browser or from a Chrome
toolbar popup (`extension/`). Built on the Agora Conversational AI
cross-session memory recipe below.

![Maya call screen](docs/assets/web-call.jpg)

---

## Agora Conversational AI — Memory Recipe (Python)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Python](https://img.shields.io/badge/python-%3E%3D3.10-blue)](https://www.python.org/)
[![Bun](https://img.shields.io/badge/bun-latest-black)](https://bun.sh/)

The **cross-session memory** recipe in the Agora Conversational AI recipes family.
A returning user (identified by a name handle entered before the call) is remembered
across sessions — the agent re-injects their conversation history via `system_messages`
so it can greet them naturally and recall what was said before. Fully **zero-key** —
OpenAI is Agora-managed (no `OPENAI_API_KEY` required unless you bring your own account).

**Pipeline:** `DeepgramSTT(nova-3, en)` → `OpenAI` (warm assistant + memory context) → `MiniMaxTTS`

**Persona:** this copy is customised as **Maya**, a warm, playful companion with
wholesome boundaries (declines explicit requests, points to real help on self-harm).
Edit `BASE_SYSTEM` in `server/src/agent.py` to change her personality, and
`AGENT_GREETING` in `server/.env.local` to change her opening line.

## Prerequisites

- [Python 3.10+](https://www.python.org/)
- [Bun](https://bun.sh/)
- [Agora CLI](https://github.com/AgoraIO/cli) — makes generating an App ID + App Certificate easy

The same commands work on macOS, Linux, and Windows. On macOS/Linux, setup uses
`python3`; on Windows, it uses the Python launcher (`py`) or `python`. WSL and
virtualenv activation are not required.

## Run It

```bash
# 1. Install web deps + create the Python venv
bun run setup

# 2. Add Agora credentials (CLI), or edit server/.env.local by hand
agora login
agora project use <your-project>          # select which project to use
agora project env write server/.env.local # writes App ID + Certificate

# 3. Run backend + web
bun run dev
```

Open [http://localhost:3000](http://localhost:3000), enter your name (optional),
then click **Start Conversation**. On a second call with the same name the agent
will greet you using what you told it before.

### Working from a clone

If you cloned this repo (rather than scaffolding via the Agora CLI), the steps
above are complete as written: `bun run setup` creates the Python venv and
installs web dependencies, then `bun run dev` brings up both services. You
still need Agora credentials in `server/.env.local` before a conversation can connect.

Services:

- Frontend — http://localhost:3000
- Backend — http://localhost:8000
- Mock LLM — N/A (managed OpenAI, no local service)
- API docs — http://localhost:8000/docs

## Deploy

Deploy `web` (Next.js) and `server` (a reachable FastAPI backend). Set
`AGENT_BACKEND_URL` in the web deployment so the Next rewrites reach the backend.

The SQLite memory file (`memory.db`) is local to wherever the server process runs.
For multi-instance deployments, point `MEMORY_DB_PATH` at a shared volume.

A backend-only Docker image is published to
`ghcr.io/AgoraIO-Conversational-AI/recipe-agent-memory` on `v*` tags.
It exposes **BACKEND-ONLY** (:8000). No separate LLM container is needed —
OpenAI is Agora-managed.

## Environment variables

Backend env file: [`server/.env.example`](server/.env.example).

| Variable | Required | Default | Notes |
| --- | :---: | :---: | --- |
| `AGORA_APP_ID` | ✅ | — | Agora Console → Project → App ID |
| `AGORA_APP_CERTIFICATE` | ✅ | — | Agora Console → Project → App Certificate |
| `OPENAI_MODEL` | | `gpt-4o-mini` | OpenAI model |
| `OPENAI_API_KEY` | | — | Optional — Agora manages the OpenAI key by default (keyless). Set only if your account requires it. |
| `MEMORY_DB_PATH` | | `memory.db` | Path to the SQLite file (relative to `server/`, or absolute). In Docker: `/tmp/memory.db`. |
| `MEMORY_MAX_TURNS` | | `20` | Rolling cap on stored turns per user handle. |
| `NIMBLE_API_KEY` | | — | Optional. Enables Nimble web search (`nimble_search` via MCP) for Maya. |
| `AGENT_GREETING` | | built-in | Optional opening line override |

## Commands

```bash
bun run setup            # install web deps + create server/ venv
bun run dev              # run backend (:8000) + web (:3000)

bun run doctor           # prerequisite check (no creds needed)
bun run doctor:local     # + .env.local + credentials checks

bun run verify           # web-only gate (no Agora creds needed)
bun run verify:local     # full local gate: backend compile + smoke tests + web build
bun run clean            # remove venvs and build artifacts
```

Tests run standalone (no Agora cloud needed): `pytest` in `server/`, plus
`bun run verify` in `web/`. CI runs them on Linux/macOS/Windows × Python 3.10 & 3.13.

## Architecture

```
Browser (localhost:3000)
  │  fetch /api/*
  ▼
Next.js  ──rewrite──▶  Agent backend  (server/, localhost:8000)
                          │  loads SQLite memory for user handle
                          │  starts agent session with memory-injected system_messages
                          ▼
                       Agora ConvoAI Cloud
                          │  Deepgram STT (managed, nova-3, en)
                          │  OpenAI (Agora-managed, keyless)
                          │  MiniMax TTS (managed)
                          ▼
                       User hears warm, context-aware responses

On stop:  session.get_history() ──▶  SQLite (memory.db)
          (captured BEFORE session.stop())
```

No separate `llm/` service — OpenAI is Agora-managed and requires no API key.
See [ARCHITECTURE.md](./ARCHITECTURE.md).

## What You Get

- **Cross-session memory**: the user enters a name handle before the call; prior conversation turns are loaded from SQLite and re-injected via `llm.system_messages` so the agent greets them by name and recalls earlier topics.
- A **Next.js** web client (:3000) that drives the RTC/RTM lifecycle and only ever calls `/api/*`.
- A **FastAPI** agent backend (:8000) that owns Agora token generation, agent session lifecycle, and the SQLite memory store.
- The `/api/get_config` · `/api/startAgent` · `/api/stopAgent` contract between the web client and the backend (Next rewrites, no Route Handlers).
- **Managed keyless OpenAI** — Agora-managed, no `OPENAI_API_KEY` required.
- **Zero-key** setup — the full pipeline runs with no LLM API key by default.

## How It Works

1. The browser calls `/api/get_config`; the backend mints an Agora token from
   `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE`.
2. The user enters an optional name handle. The browser calls `/api/startAgent`
   with `userKey` in the body.
3. The backend calls `get_history(handle)` on the SQLite store, loads any prior
   turns for that handle, and builds `system_messages = [base_system_prompt, memory_context]`.
4. The agent session starts with those system messages; the model greets the
   user using recalled context.
5. The user speaks; Agora runs STT → OpenAI → MiniMax TTS → audio back to the user.
6. `/api/stopAgent` is called (end-call button). The server calls
   `await session.get_history()` **before** `session.stop()` — the only window
   where history is available — then persists the turns to SQLite for that handle.

**Limitation:** if the session times out due to idle silence (30 s), the SDK
stop path bypasses the history-capture block. End the call via the button to
ensure memory is saved.

## Repo Map

- `web/` — Next.js frontend (:3000); RTC/RTM lifecycle and UI.
- `server/` — FastAPI agent backend (:8000); Agora tokens, agent lifecycle, SQLite memory.
- `extension/` — Chrome toolbar popup for talking to Maya (uses the same backend); see `extension/README.md`.
- `ARCHITECTURE.md` — system shape and component boundaries.
- `AGENTS.md` — guide for coding agents working in this repo.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Agent does not recall previous conversation | Make sure you used the same name handle in both sessions and ended the first call via the end-call button (not by closing the tab). |
| `memory.db` grows large | Reduce `MEMORY_MAX_TURNS` or delete the file to reset all memory. |
| Local calls fail under a global proxy (Clash, etc.) | Configure your proxy to send `127.0.0.1`, `localhost`, and RFC-1918 ranges DIRECT. |

## More Docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [AGENTS.md](./AGENTS.md)

## License

Released under the [MIT License](./LICENSE).
