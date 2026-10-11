import os, sys, tempfile, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import memory  # noqa: E402


def fresh():
    path = os.path.join(tempfile.mkdtemp(), "memory.db")
    return memory.get_db(path), path


def test_empty_returns_no_turns_and_no_system_message():
    conn, _ = fresh()
    assert memory.get_memory(conn, "alice") == []
    assert memory.build_memory_system_message([]) is None


def test_save_then_recall_roundtrip_across_connections():
    conn, path = fresh()
    memory.save_memory(conn, "alice", [
        {"role": "user", "content": "I'm allergic to peanuts"},
        {"role": "assistant", "content": "Noted — no peanuts."},
    ])
    again = memory.get_memory(memory.get_db(path), "alice")
    assert any("peanuts" in t["content"] for t in again)


def test_memory_is_keyed_per_user():
    conn, _ = fresh()
    memory.save_memory(conn, "alice", [{"role": "user", "content": "I like jazz"}])
    memory.save_memory(conn, "bob", [{"role": "user", "content": "I like metal"}])
    assert any("jazz" in t["content"] for t in memory.get_memory(conn, "alice"))
    assert not any("jazz" in t["content"] for t in memory.get_memory(conn, "bob"))


def test_save_accumulates_and_caps_to_max():
    conn, _ = fresh()
    for i in range(memory.MAX_TURNS + 10):
        memory.save_memory(conn, "alice", [{"role": "user", "content": f"fact {i}"}])
    turns = memory.get_memory(conn, "alice")
    assert len(turns) == memory.MAX_TURNS
    assert turns[-1]["content"] == f"fact {memory.MAX_TURNS + 9}"


def test_build_system_message_contains_remembered_content():
    msg = memory.build_memory_system_message([{"role": "user", "content": "allergic to peanuts"}])
    assert msg["role"] == "system"
    assert "peanuts" in msg["content"]
