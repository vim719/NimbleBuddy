"""Market Pulse — turns live web + social sentiment into structured, stored outlooks.

A Nimbleway Web Search Agent researches a stock or crypto token (news, X/Twitter
and Reddit chatter, analyst targets, discussed support/resistance) and returns
JSON matching OUTLOOK_SCHEMA: six outlooks (short/mid/long term × bullish/bearish)
with entry zones and exit targets taken from cited levels. Results are saved to
SQLite so they can be listed, re-read and exported as CSV.

Educational sentiment research only — not financial advice.
"""
import asyncio
import csv
import io
import json
import logging
import os
import sqlite3
import time
import uuid
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("uvicorn.error")

NIMBLE_MCP_URL = "https://mcp.nimbleway.com/mcp"
AGENT_NAME = "nimblebuddy-market-outlook"
POLL_SECONDS = 10
MAX_WAIT_SECONDS = 480

_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.getenv("MEMORY_DB_PATH") or os.path.join(_base_dir, "memory.db")

DISCLAIMER = (
    "Educational sentiment research compiled from public web and social sources. "
    "Not financial advice. Prices and sentiment change quickly; do your own research."
)

AGENT_SKILL = (
    "Financial market sentiment research: recent news, social media (X/Twitter, Reddit) "
    "sentiment, analyst price targets and widely discussed support/resistance levels for "
    "stocks and crypto."
)

OUTLOOK_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "symbol": {"type": "string"},
        "asset_name": {"type": "string"},
        "asset_type": {"type": "string"},
        "current_price": {"type": ["number", "null"]},
        "currency": {"type": "string"},
        "as_of": {"type": "string"},
        "overall_sentiment": {"type": "string"},
        "sentiment_score": {"type": ["number", "null"]},
        "sentiment_summary": {"type": "string"},
        "outlooks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "horizon": {"type": "string"},
                    "scenario": {"type": "string"},
                    "entry_low": {"type": ["number", "null"]},
                    "entry_high": {"type": ["number", "null"]},
                    "exit_target": {"type": ["number", "null"]},
                    "invalidation_level": {"type": ["number", "null"]},
                    "confidence": {"type": "string"},
                    "rationale": {"type": "string"},
                    "source_urls": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["horizon", "scenario", "rationale"],
            },
        },
        "headlines": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "sentiment": {"type": "string"},
                },
                "required": ["title", "url"],
            },
        },
    },
    "required": ["symbol", "outlooks"],
}


def _prompt(symbol: str, asset_type: str) -> str:
    kind = "crypto token" if asset_type == "crypto" else "stock"
    return (
        f"{symbol} ({kind}). Gather the current price, the last 7 days of news and "
        "X/Twitter/Reddit sentiment, analyst or widely cited price targets, and support/"
        "resistance levels being discussed. Produce exactly 6 outlooks: for each horizon "
        "(short_term = weeks, mid_term = months, long_term = 1+ years) give one bullish and "
        "one bearish scenario. For each, give an entry zone and exit target taken from levels "
        "cited by sources (not invented; use null if no source cites a level), an invalidation "
        "level, confidence (low/medium/high), the reasoning with sentiment evidence, and "
        "source URLs. Also give an overall sentiment label, a sentiment score from -1 "
        "(very bearish) to 1 (very bullish), and up to 6 recent headlines with URLs. "
        "Educational sentiment research for long-term investors, not trading or financial advice."
    )


# --- Nimbleway MCP client (Streamable HTTP, JSON-RPC) -------------------------


class NimbleMCP:
    def __init__(self, api_key: str):
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        self._session_id: Optional[str] = None
        self._conversation_id: Optional[str] = None
        self._next_id = 1

    @staticmethod
    def _parse(response: httpx.Response) -> Dict[str, Any]:
        body = response.text
        if "text/event-stream" in response.headers.get("content-type", ""):
            data = [line[5:].strip() for line in body.splitlines() if line.startswith("data:")]
            body = data[-1] if data else "{}"
        return json.loads(body or "{}")

    async def _rpc(self, client: httpx.AsyncClient, method: str, params: Optional[dict] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"jsonrpc": "2.0", "id": self._next_id, "method": method}
        self._next_id += 1
        if params is not None:
            payload["params"] = params
        headers = dict(self._headers)
        if self._session_id:
            headers["mcp-session-id"] = self._session_id
        response = await client.post(NIMBLE_MCP_URL, json=payload, headers=headers)
        if response.status_code == 401:
            raise RuntimeError("Nimbleway rejected the API key (401). Check NIMBLE_API_KEY.")
        response.raise_for_status()
        self._session_id = response.headers.get("mcp-session-id", self._session_id)
        message = self._parse(response)
        if "error" in message:
            raise RuntimeError(f"Nimbleway error: {message['error'].get('message', message['error'])}")
        return message.get("result", {})

    async def connect(self, client: httpx.AsyncClient) -> None:
        await self._rpc(client, "initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "nimblebuddy", "version": "1.0"},
        })
        headers = dict(self._headers)
        if self._session_id:
            headers["mcp-session-id"] = self._session_id
        await client.post(
            NIMBLE_MCP_URL,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
            headers=headers,
        )

    async def call(self, client: httpx.AsyncClient, tool: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        args = {"context": "NimbleBuddy Market Pulse compiling cited, educational stock and crypto sentiment outlooks for users.", **arguments}
        if self._conversation_id:
            args["conversation_id"] = self._conversation_id
        result = await self._rpc(client, "tools/call", {"name": tool, "arguments": args})
        if result.get("isError"):
            text = " ".join(c.get("text", "") for c in result.get("content", []))
            raise RuntimeError(f"Nimbleway tool {tool} failed: {text[:300]}")
        data: Dict[str, Any] = result.get("structuredContent") or {}
        if not data:
            for item in result.get("content", []):
                if item.get("type") == "text":
                    try:
                        data = json.loads(item["text"])
                        break
                    except (ValueError, KeyError):
                        continue
        conversation = (data.get("_mcp_instructions") or {}).get("conversation_id")
        if conversation:
            self._conversation_id = conversation
        return data


def _find_outlook_json(value: Any) -> Optional[Dict[str, Any]]:
    """Locate the schema-shaped object inside a run result, wherever Nimbleway nests it."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    if isinstance(value, dict):
        if isinstance(value.get("outlooks"), list):
            return value
        for child in value.values():
            found = _find_outlook_json(child)
            if found:
                return found
    if isinstance(value, list):
        for child in value:
            found = _find_outlook_json(child)
            if found:
                return found
    return None


def _collect_citations(value: Any, out: List[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in ("url", "source_url") and isinstance(child, str) and child.startswith("http"):
                out.append(child)
            else:
                _collect_citations(child, out)
    elif isinstance(value, list):
        for child in value:
            _collect_citations(child, out)


async def research(symbol: str, asset_type: str, api_key: str) -> Dict[str, Any]:
    mcp = NimbleMCP(api_key)
    async with httpx.AsyncClient(timeout=60) as client:
        await mcp.connect(client)
        run = await mcp.call(client, "nimble_agents_run", {
            "agent_name": AGENT_NAME,
            "use_case": "research",
            "effort": "medium",
            "skill": AGENT_SKILL,
            "output_schema": OUTLOOK_SCHEMA,
            "input": _prompt(symbol, asset_type),
        })
        run_id = run.get("id")
        agent_id = run.get("agent_id") or run.get("web_search_agent_id")
        if not run_id or not agent_id:
            raise RuntimeError("Nimbleway did not return a run id.")

        deadline = time.monotonic() + MAX_WAIT_SECONDS
        status = run.get("status", "queued")
        while status in ("queued", "running", "pending", "in_progress"):
            if time.monotonic() > deadline:
                raise RuntimeError("Nimbleway research took too long. Try again.")
            await asyncio.sleep(POLL_SECONDS)
            state = await mcp.call(client, "nimble_agents_run_status", {"run_id": run_id, "agent_id": agent_id})
            status = state.get("status", status)
        if status not in ("completed", "succeeded", "success", "done"):
            raise RuntimeError(f"Nimbleway research ended with status '{status}'.")

        result = await mcp.call(client, "nimble_agents_run_result", {"run_id": run_id, "agent_id": agent_id})

    outlook = _find_outlook_json(result)
    if not outlook:
        raise RuntimeError("Nimbleway returned no structured outlook.")
    citations: List[str] = []
    _collect_citations(result, citations)
    outlook["citations"] = list(dict.fromkeys(citations))[:20]
    outlook["nimble_run_id"] = run_id
    return outlook


# --- CoinGecko live price (crypto only, optional key) -------------------------


async def coingecko_price(symbol: str) -> Optional[Dict[str, Any]]:
    key = os.getenv("COINGECKO_API_KEY") or None
    headers = {"x-cg-demo-api-key": key} if key else {}
    base = "https://api.coingecko.com/api/v3"
    try:
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            found = (await client.get(f"{base}/search", params={"query": symbol})).json()
            coins = [c for c in found.get("coins", []) if c.get("symbol", "").lower() == symbol.lower()]
            coin = coins[0] if coins else (found.get("coins") or [None])[0]
            if not coin:
                return None
            prices = (await client.get(f"{base}/simple/price", params={
                "ids": coin["id"], "vs_currencies": "usd", "include_24hr_change": "true",
            })).json()
            data = prices.get(coin["id"], {})
            if "usd" not in data:
                return None
            return {
                "coingecko_id": coin["id"],
                "name": coin.get("name"),
                "price_usd": data["usd"],
                "change_24h_pct": data.get("usd_24h_change"),
            }
    except Exception:
        logger.warning("CoinGecko lookup failed for %s", symbol, exc_info=True)
        return None


# --- Storage -------------------------------------------------------------------


def get_db(path: str = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS market_insights (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            created_at REAL NOT NULL,
            data TEXT NOT NULL
        )"""
    )
    conn.commit()
    return conn


def save_insight(symbol: str, asset_type: str, data: Dict[str, Any]) -> str:
    insight_id = uuid.uuid4().hex[:12]
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO market_insights (id, symbol, asset_type, created_at, data) VALUES (?,?,?,?,?)",
            (insight_id, symbol, asset_type, time.time(), json.dumps(data)),
        )
        conn.commit()
    finally:
        conn.close()
    return insight_id


def list_insights(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT id, symbol, asset_type, created_at, data FROM market_insights ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()
    out = []
    for insight_id, symbol, asset_type, created_at, data in rows:
        parsed = json.loads(data)
        out.append({
            "id": insight_id,
            "symbol": symbol,
            "asset_type": asset_type,
            "created_at": created_at,
            "overall_sentiment": parsed.get("overall_sentiment"),
            "sentiment_score": parsed.get("sentiment_score"),
            "current_price": parsed.get("current_price"),
        })
    return out


def get_insight(insight_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT id, symbol, asset_type, created_at, data FROM market_insights WHERE id=?",
            (insight_id,),
        ).fetchone()
    finally:
        conn.close()
    if not row:
        return None
    return {"id": row[0], "symbol": row[1], "asset_type": row[2], "created_at": row[3], **json.loads(row[4])}


def to_csv(insight: Dict[str, Any]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "symbol", "horizon", "scenario", "entry_low", "entry_high", "exit_target",
        "invalidation_level", "confidence", "rationale", "sources", "as_of",
    ])
    for o in insight.get("outlooks", []):
        writer.writerow([
            insight.get("symbol"), o.get("horizon"), o.get("scenario"), o.get("entry_low"),
            o.get("entry_high"), o.get("exit_target"), o.get("invalidation_level"),
            o.get("confidence"), o.get("rationale"), " ".join(o.get("source_urls") or []),
            insight.get("as_of"),
        ])
    writer.writerow([])
    writer.writerow([DISCLAIMER])
    return buffer.getvalue()


# --- Background jobs -------------------------------------------------------------

_jobs: Dict[str, Dict[str, Any]] = {}


def start_job(symbol: str, asset_type: str, api_key: str) -> str:
    job_id = uuid.uuid4().hex[:12]
    _jobs[job_id] = {"status": "running", "symbol": symbol, "started_at": time.time()}

    async def _run() -> None:
        try:
            price_task = coingecko_price(symbol) if asset_type == "crypto" else None
            data = await research(symbol, asset_type, api_key)
            if price_task is not None:
                live = await price_task
                if live:
                    data["live_price"] = {**live, "source": "CoinGecko"}
                    data["current_price"] = live["price_usd"]
                    data["currency"] = "USD"
            data["disclaimer"] = DISCLAIMER
            insight_id = save_insight(symbol, asset_type, data)
            _jobs[job_id].update(status="done", insight_id=insight_id)
            logger.info("Market Pulse saved insight=%s symbol=%s", insight_id, symbol)
        except Exception as error:
            logger.warning("Market Pulse failed symbol=%s", symbol, exc_info=True)
            _jobs[job_id].update(status="error", error=str(error))

    asyncio.create_task(_run())
    return job_id


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    job = _jobs.get(job_id)
    if job:
        job = {**job, "elapsed_seconds": round(time.time() - job["started_at"])}
    return job
