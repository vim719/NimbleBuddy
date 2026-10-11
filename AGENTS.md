# Agent Development Guide

For coding agents working in `recipe-agent-memory`. This repository is the
**cross-session memory** recipe in the Agora Conversational AI recipes family.

## System shape

- **`server/`** — Python FastAPI agent backend (:8000). Owns Agora token
  generation, agent session lifecycle, and the per-user SQLite memory store.
  Uses the managed `OpenAI` vendor (Agora-managed, keyless). SDK: `agora-agents>=2.3.0`
  (`import agora_agent`).
- **`web/`** — Next.js 16 / React 19 / TypeScript frontend (:3000).
- **`extension/`** — Manifest V3 Chrome popup (Vite + React) that talks to the same
  backend; see `extension/README.md`.
- Auth: Token007 from `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE`.
- No `llm/` service — OpenAI is Agora-managed (zero-key by default).

## Pipeline

`DeepgramSTT(nova-3, en)` → `OpenAI` (warm assistant + memory context via `system_messages`) → `MiniMaxTTS(English_captivating_female1)`

## Memory flow

1. Pre-call: user enters an optional name handle in the web UI (`userKey`).
2. `/startAgent` receives `userKey`; server opens the SQLite store, loads prior
   turns for that handle, builds a `system_messages` list and passes it to
   `OpenAI(...)`.
3. Conversation proceeds; turns accumulate in Agora's session.
4. `/stopAgent` is called from the browser. The server calls
   `await session.get_history()` **before** `session.stop()` (the only window
   where history is available), serialises the turns, and calls `save_memory()`.
5. Next session with the same handle: prior turns are re-injected.

**Limitation:** if the session times out due to idle timeout (30 s of silence),
`stop()` is called by the SDK path that does not go through the capture block.
End conversations via the end-call button to ensure memory is saved.

## Routing / ownership

- UI and RTC/RTM lifecycle live in `web/`.
- Browser-facing `/api/*` paths are Next rewrites (`web/next.config.ts`) to the
  agent backend; do not add `web/app/api/**/route.ts` for agent/token logic.
- Token generation and agent lifecycle live in `server/src/agent.py`.
- Memory store (pure, no agora import) lives in `server/src/memory.py`.
- Memory store tests live in `server/tests/test_memory.py`.

## Supported modes

- **Local:** `bun run dev` starts `server` (:8000) and `web` (:3000).
  The web app calls `/api/*`; Next rewrites to
  `AGENT_BACKEND_URL=http://localhost:8000`.
- **Deploy:** deploy `web` (Next) + `server` (reachable FastAPI).
  Set `AGENT_BACKEND_URL` in the web deployment.

## Env vars

| Variable | Default | Notes |
|---|---|---|
| `AGORA_APP_ID` | — | required |
| `AGORA_APP_CERTIFICATE` | — | required |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model |
| `OPENAI_API_KEY` | — | optional — BYO only if your account requires it |
| `MEMORY_DB_PATH` | `memory.db` | path to SQLite file (relative to `server/`) |
| `MEMORY_MAX_TURNS` | `20` | rolling cap on stored turns per user |
| `NIMBLE_API_KEY` | — | optional — enables Nimble web search via `mcp_servers` |

## Patterns

- Keep the web client calling `/api/*`; hide backend placement behind Next rewrites.
- Keep token generation and the App Certificate in `server/`.
- `OPENAI_API_KEY` is optional: Agora manages the OpenAI key by default (keyless).
- `memory.py` must stay free of `agora_agent` imports so it can be unit-tested
  without the SDK installed.
- Always capture `get_history()` **before** `session.stop()`.

## Anti-patterns

- Do not reintroduce `llm/` or the `CustomLLM` vendor.
- Do not reintroduce Next Route Handlers for agent/token logic.
- Do not put `PORT` in `server/.env.example` (it would clobber the random port
  that `verify:local:fastapi` injects via `load_dotenv(override=True)`).
- Do not link to `docs/ai/` — that progressive-disclosure tree is not present yet.
- Never commit `*.db` files — they contain user conversation data.

## Commands

```bash
bun run setup
bun run dev
bun run doctor
bun run doctor:local
bun run verify         # web-only, no creds
bun run verify:local   # full local gate
```

Narrower checks: `bun run verify:backend`, `bun run verify:local:fastapi`,
`bun run verify:web:proxy`.

## Done criteria

1. Run the narrowest relevant verification command.
2. Web-affecting changes: `bun run verify:web` passes.
3. Backend-affecting changes: `bun run verify:local` (or narrower
   `verify:local:fastapi` / `verify:backend`) passes.
4. Memory logic changes: `pytest server/tests/test_memory.py -v` passes (5 tests).
5. If you change required env vars or setup steps, update the root README,
   the relevant module README, and `server/.env.example` together.

## Git conventions

- Conventional Commits: `type: description` or `type(scope): description`
  (`feat`, `fix`, `chore`, `test`, `docs`). Lowercase after the prefix, present
  tense.
- No AI tool names in commit messages or PR descriptions. No `Co-Authored-By`
  trailers. No `--no-verify`. No git config changes.
- Branch names: `type/short-description` (e.g. `feat/add-memory-export`).
