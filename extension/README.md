# Maya — Chrome Extension

Talk to Maya from the Chrome toolbar. A Manifest V3 popup that runs the live
voice session in the browser (RTC audio + RTM transcripts) and uses the same
backend as the web app — so Maya's persona, memory and Nimbleway web search
behave exactly the same.

## Run it

1. Start the backend from the repo root (it must be running while you talk):

   ```bash
   bun run dev
   ```

2. Build the extension:

   ```bash
   cd extension
   bun install
   bun run build
   ```

3. Load it in Chrome: open `chrome://extensions`, turn on **Developer mode**,
   click **Load unpacked**, and select `extension/dist`.

4. Pin the Maya icon (puzzle-piece menu), enter your name, and click **Start talking**.

The first time, Chrome can't show the microphone prompt inside a popup, so Maya
shows **Allow microphone**. Click it, allow access in the tab that opens, then
reopen the popup.

## How it works

| Step | Where |
|---|---|
| Token + channel | `GET /get_config` on the backend |
| Start Maya (memory + web search) | `POST /startAgent` |
| Live audio | RTC client in the popup (`src/lib/session.ts`) |
| Transcript + agent state | RTM + the voice client toolkit |
| End + save memory | `POST /stopAgent` (also sent when the popup closes) |

The App Certificate stays in `server/.env.local`; the extension only receives
short-lived tokens.

## Config

`VITE_API_BASE_URL` (see `.env.example`) defaults to `http://localhost:8000`.
If you point it elsewhere, add that origin to `host_permissions` in
`public/manifest.json` and rebuild.

## Limitations

- **Keep the popup open.** Clicking outside closes it and ends the call; Maya
  still saves the conversation when it closes.
- The bundle is large (~1 MB gzipped) because the real-time browser SDKs are heavy.
