# NimbleBuddy — Meet Anna

**🌐 Showcase: [vim719.github.io/NimbleBuddy](https://vim719.github.io/NimbleBuddy/)**

Anna is a real-time voice AI companion. Talk to her out loud — she answers in
under a second, remembers you across calls, and looks things up on the live web
with **Nimbleway**. Use her in the browser or from a Chrome toolbar popup.

![Anna call screen](docs/assets/web-call.jpg)

## Features

- **Real-time voice** — speak naturally and interrupt any time.
- **Cross-session memory** — enter your name and Anna picks up where your last call left off.
- **Live web search** — Anna calls Nimbleway's `nimble_search` tool over MCP for news, weather and anything recent.
- **Chrome extension** — talk to Anna from the toolbar (`extension/`).
- **Market Pulse** (`/market`) — Nimbleway turns live news, X/Twitter and Reddit sentiment into six cited stock/crypto outlooks (short/mid/long term × bullish/bearish, with entry zones and exit targets taken from sourced levels), saved to SQLite and exportable as CSV/JSON. Live crypto prices from CoinGecko. Educational, not financial advice.
- **Push-to-talk keys** — press **A** to talk, **X** to stop listening so background voices can't interrupt.
- **Wholesome persona** — warm and playful, declines explicit requests, points to real help on self-harm.

## Built with

| | |
|---|---|
| **Nimbleway** | Live web search inside the product (MCP server) |
| **Claude** | Design, coding, debugging and shipping |
| **Gemini** | Used during development |
| **Antigravity** | Development environment |

Voice pipeline: Deepgram nova-3 (speech-to-text) → OpenAI `gpt-4o-mini` (with
memory context and Nimbleway search) → MiniMax (text-to-speech), streamed over a
real-time RTC/RTM channel.

## Run it

**Prerequisites:** [Bun](https://bun.sh/), Python 3.10+, real-time voice
credentials (App ID + App Certificate), and a
[Nimbleway API key](https://online.nimbleway.com/settings/api-keys) for web search.

```bash
git clone https://github.com/vim719/NimbleBuddy
cd NimbleBuddy
bun run setup          # installs web deps and the Python venv, creates server/.env.local
```

Edit `server/.env.local`:

```env
AGORA_APP_ID=your-app-id
AGORA_APP_CERTIFICATE=your-app-certificate
NIMBLE_API_KEY=your-nimbleway-key
```

Then start everything and open **http://localhost:3000**:

```bash
bun run dev
```

End calls with **End Conversation** so Anna saves what you talked about.

### Chrome extension

With `bun run dev` running:

```bash
cd extension
bun install && bun run build
```

Open `chrome://extensions` → **Developer mode** → **Load unpacked** → select
`extension/dist`. Or grab the prebuilt zip from the
[showcase page](https://vim719.github.io/NimbleBuddy/). See
[extension/README.md](extension/README.md).

## Environment variables (`server/.env.local`)

| Variable | Default | Notes |
|---|---|---|
| `AGORA_APP_ID` | — | Required. Real-time voice App ID. |
| `AGORA_APP_CERTIFICATE` | — | Required. Stays on the server; never sent to the browser. |
| `NIMBLE_API_KEY` | — | Enables Nimbleway web search and Market Pulse. Unset = both off. |
| `COINGECKO_API_KEY` | — | Optional. CoinGecko demo key for live crypto prices (works keyless, rate-limited). |
| `OPENAI_MODEL` | `gpt-4o-mini` | LLM model. |
| `AGENT_GREETING` | built-in | Anna's opening line. |
| `MEMORY_DB_PATH` | `memory.db` | SQLite file for per-user memory. |
| `MEMORY_MAX_TURNS` | `20` | Turns remembered per user. |

## Repo map

- `web/` — Next.js 16 / React 19 app (:3000): call UI, transcript, voice orb.
- `server/` — FastAPI backend (:8000): tokens, agent lifecycle, SQLite memory, Nimbleway MCP wiring (`server/src/agent.py`), Market Pulse research + storage (`server/src/market.py`).
- `extension/` — Manifest V3 Chrome popup on the same backend.
- `docs/` — the GitHub Pages showcase.

## Commands

```bash
bun run dev            # backend + frontend
bun run verify         # web checks + build
bun run verify:local   # full local gate (needs credentials)
```

## License

MIT — see [LICENSE](LICENSE). Based on an MIT-licensed open-source voice agent recipe.
