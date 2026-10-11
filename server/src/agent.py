"""
Agent — Cross-Session Memory Recipe

High-level API for managing Agora Conversational AI Agents with per-user
persistent memory. The pipeline is:

  DeepgramSTT(nova-3, en) → OpenAI (warm assistant with injected memory) → MiniMaxTTS

OpenAI is Agora-managed (keyless by default). Conversation history is captured
via session.get_history() BEFORE stop and persisted per-user-handle in SQLite.
On the next session the same handle's memory is re-injected via system_messages.
"""
import logging
import os
from typing import Any, Dict, Optional

from agora_agent import Area, AsyncAgora
from agora_agent.agentkit import Agent as AgoraAgent
from agora_agent.agentkit.vendors import OpenAI, DeepgramSTT, MiniMaxTTS
import memory

logger = logging.getLogger("uvicorn.error")

BASE_SYSTEM = (
    "You are Maya, a warm and playful AI companion who genuinely enjoys talking to the "
    "user. Be affectionate, curious, and a little playful, but never pushy or explicit. "
    "Keep replies to one or two short spoken sentences. Ask about the user's day, feelings, "
    "and interests, and remember what they tell you.\n"
    "Boundaries: this is a friendly, wholesome conversation. If the user asks for sexual or "
    "explicit content, gently decline and steer back to something warm. If the user mentions "
    "self-harm, respond with care and encourage contacting a real person or a local "
    "crisis line, and do not roleplay around it."
)

WEB_SEARCH_SYSTEM = (
    "You can search the web with the nimble_search tool. Use it when the user asks about "
    "news, current events, facts you are unsure of, or anything that may have changed "
    "recently. Before searching, say a short filler like 'Let me look that up.' Then answer "
    "in one or two spoken sentences — never read out URLs, lists, or markdown."
)

NIMBLE_MCP_URL = "https://mcp.nimbleway.com/mcp"


class Agent:
    """
    High-level wrapper for Agora Conversational AI Agent with cross-session memory.

    Uses the managed OpenAI vendor (Agora-managed, keyless). Conversation turns
    are stored per user handle in SQLite and re-injected as system context on
    subsequent sessions.
    """

    def __init__(self):
        self.app_id = os.getenv("AGORA_APP_ID")
        self.app_certificate = os.getenv("AGORA_APP_CERTIFICATE")
        self.greeting = os.getenv(
            "AGENT_GREETING",
            "Hey, it's nice to hear from you. Tell me your name so I can remember you.",
        )

        # OpenAI is Agora-managed (keyless). OPENAI_API_KEY is optional.
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.openai_model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

        # Optional: Nimble web search via MCP. Disabled when the key is unset.
        self.nimble_api_key = os.getenv("NIMBLE_API_KEY") or None

        if not self.app_id or not self.app_certificate:
            raise ValueError("AGORA_APP_ID and AGORA_APP_CERTIFICATE are required")

        self.client = AsyncAgora(
            area=Area.US,
            app_id=self.app_id,
            app_certificate=self.app_certificate,
        )

        # Track active sessions by agent_id
        self._sessions: Dict[str, Any] = {}
        # Map agent_id -> user_key for memory capture on stop
        self._agent_users: Dict[str, str] = {}

    async def start(
        self,
        channel_name: str,
        agent_uid: int,
        user_uid: int,
        output_audio_codec: Optional[str] = None,
        user_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Start memory-enabled assistant agent."""
        if not channel_name or not str(channel_name).strip():
            raise ValueError("channel_name is required and cannot be empty")
        if agent_uid <= 0:
            raise ValueError("agent_uid is required and cannot be empty")
        if user_uid <= 0:
            raise ValueError("user_uid is required and cannot be empty")

        # Build system messages: base prompt + per-user memory if available
        system_messages = [{"role": "system", "content": BASE_SYSTEM}]
        mcp_servers = None
        if self.nimble_api_key:
            system_messages.append({"role": "system", "content": WEB_SEARCH_SYSTEM})
            mcp_servers = [
                {
                    "name": "nimble",
                    "endpoint": NIMBLE_MCP_URL,
                    "headers": {"Authorization": f"Bearer {self.nimble_api_key}"},
                    "allowed_tools": ["nimble_search"],
                    "timeout_ms": 10000,
                }
            ]
        if user_key:
            conn = memory.get_db()
            try:
                past_turns = memory.get_memory(conn, user_key)
                mem_msg = memory.build_memory_system_message(past_turns)
                if mem_msg is not None:
                    system_messages.append(mem_msg)
            finally:
                conn.close()

        llm = OpenAI(
            api_key=self.openai_api_key,
            model=self.openai_model,
            system_messages=system_messages,
            greeting_message=self.greeting,
            temperature=0.7,
            mcp_servers=mcp_servers,
        )

        stt = DeepgramSTT(model="nova-3", language="en")
        tts = MiniMaxTTS(model="speech_2_6_turbo", voice_id="English_captivating_female1")

        parameters = {
            "audio_scenario": "chorus",  # web client — ultra-low-latency chorus profile
            "data_channel": "rtm",
            "enable_error_message": True,
            "enable_metrics": True,
        }
        if isinstance(output_audio_codec, str) and output_audio_codec.strip():
            parameters["output_audio_codec"] = output_audio_codec.strip()

        agora_agent = AgoraAgent(
            client=self.client,
            greeting=self.greeting,
            failure_message="Please wait a moment.",
            max_history=50,
            turn_detection={
                "config": {
                    "speech_threshold": 0.5,
                    "start_of_speech": {
                        "mode": "vad",
                        "vad_config": {
                            "interrupt_duration_ms": 160,
                            "prefix_padding_ms": 300,
                        },
                    },
                    "end_of_speech": {
                        "mode": "vad",
                        "vad_config": {
                            "silence_duration_ms": 480,
                        },
                    },
                },
            },
            advanced_features={"enable_rtm": True, "enable_tools": bool(mcp_servers)},
            parameters=parameters,
        )

        agora_agent = (
            agora_agent
            .with_stt(stt)
            .with_llm(llm)
            .with_tts(tts)
        )

        session = agora_agent.create_async_session(
            channel=channel_name,
            agent_uid=str(agent_uid),
            remote_uids=[str(user_uid)],
            enable_string_uid=False,
            idle_timeout=30,
            expires_in=3600,
        )

        logger.info(
            "Starting memory agent channel=%s agent_uid=%s user_uid=%s user_key=%s",
            channel_name,
            agent_uid,
            user_uid,
            user_key or "(anonymous)",
        )

        try:
            agent_id = await session.start()
        except Exception:
            logger.exception(
                "Failed to start memory agent channel=%s agent_uid=%s user_uid=%s",
                channel_name,
                agent_uid,
                user_uid,
            )
            raise

        # Save session (and optional user key) for memory capture on stop
        self._sessions[agent_id] = session
        if user_key:
            self._agent_users[agent_id] = user_key

        logger.info(
            "Started memory agent agent_id=%s channel=%s",
            agent_id,
            channel_name,
        )

        return {
            "agent_id": agent_id,
            "channel_name": channel_name,
            "status": "started",
        }

    async def stop(self, agent_id: str) -> None:
        """Capture history, persist memory, then stop the agent."""
        if not agent_id or not str(agent_id).strip():
            raise ValueError("agent_id is required and cannot be empty")

        session = self._sessions.pop(agent_id, None)
        user_key = self._agent_users.pop(agent_id, None)

        # Capture conversation BEFORE stopping (get_history only works while running)
        if session and user_key:
            try:
                history = await session.get_history()
                contents = getattr(history, "contents", None) or []
                turns = [
                    {
                        "role": getattr(c, "role", "user"),
                        "content": getattr(c, "content", ""),
                    }
                    for c in contents
                ]
                conn = memory.get_db()
                try:
                    memory.save_memory(conn, user_key, turns)
                    logger.info(
                        "Saved %d turns for user_key=%s agent_id=%s",
                        len(turns),
                        user_key,
                        agent_id,
                    )
                finally:
                    conn.close()
            except Exception:
                logger.warning(
                    "memory capture failed agent_id=%s", agent_id, exc_info=True
                )

        if session:
            try:
                await session.stop()
                logger.info("Stopped agent from active session agent_id=%s", agent_id)
                return
            except Exception:
                logger.warning(
                    "Failed to stop agent from active session; falling back agent_id=%s",
                    agent_id,
                    exc_info=True,
                )

        logger.info("Stopping agent through client.stop_agent agent_id=%s", agent_id)
        await self.client.stop_agent(agent_id)
