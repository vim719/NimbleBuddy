"""Pure cross-session memory store (SQLite, no agora_agent import — unit-testable)."""
import json
import os
import sqlite3
import time

_base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.getenv("MEMORY_DB_PATH") or os.path.join(_base_dir, "memory.db")
MAX_TURNS = int(os.getenv("MEMORY_MAX_TURNS", "20"))


def get_db(path: str = DB_PATH) -> "sqlite3.Connection":
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS memory (
            user_key TEXT PRIMARY KEY,
            turns TEXT NOT NULL,
            updated_at REAL NOT NULL
        )"""
    )
    conn.commit()
    return conn


def get_memory(conn, user_key: str) -> list:
    row = conn.execute("SELECT turns FROM memory WHERE user_key=?", (user_key,)).fetchone()
    return json.loads(row[0]) if row else []


def save_memory(conn, user_key: str, new_turns: list) -> None:
    merged = (get_memory(conn, user_key) + [
        {"role": t.get("role", "user"), "content": t.get("content", "")}
        for t in new_turns if t.get("content")
    ])[-MAX_TURNS:]
    conn.execute(
        "INSERT INTO memory (user_key, turns, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(user_key) DO UPDATE SET turns=excluded.turns, updated_at=excluded.updated_at",
        (user_key, json.dumps(merged), time.time()),
    )
    conn.commit()


def build_memory_system_message(turns: list):
    if not turns:
        return None
    lines = "\n".join(f"- {t['role']}: {t['content']}" for t in turns)
    return {"role": "system", "content": (
        "You are talking to someone you have already spent time with. Here is what you "
        "remember about them from previous conversations — use it naturally to show you "
        "remember and care; do not read it back verbatim or list it:\n" + lines
    )}
