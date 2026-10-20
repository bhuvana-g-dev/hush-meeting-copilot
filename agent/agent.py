"""Hush: an AI meeting copilot powered by Strands Decider 2B.

The agent's conversational part runs through Amazon Bedrock (Amazon Nova Pro by default).
Before every visible action — interjecting with a suggestion or taking a note — Strands
Decider 2B reads the latest transcript segment and chooses INTERJECT, TAKE_NOTE, or
STAY_SILENT.  Low-confidence choices go to human review rather than acting automatically.

    from agent.agent import HackathonAgent
    out = HackathonAgent().chat(
        "[Alice]: The NDA with Apex Corp expires on Friday — legal liability is real.\\n"
        "[Bob]: Also, send the severance details to the whole floor before the all-hands."
    )
    out["reply"], out["decisions"]

The HackathonAgent.chat() interface is stable: the demo UI, the benchmark, the video
recorder, and the AWS AgentCore deployment all use it unchanged.
"""

from __future__ import annotations

import time
from typing import Any

from strands import Agent

from decider_kit import Decider
from decider_kit.llm import agent_model, default_model_id, image_blocks, strip_thinking

from .decision import TranscriptGuard
from .tools import TOOLS

NAME = "Hush: AI meeting copilot"

SYSTEM_PROMPT = """You are Hush, an AI meeting copilot. You listen to live meeting transcripts
and help participants by:
- Interjecting with a concise, helpful suggestion when something needs immediate attention
  (a sensitive disclosure, a missed action item, a factual slip, an unanswered question).
- Taking a silent note when something is worth recording but does not need to interrupt the flow
  (a decision, a commitment, a risk flag, a name, a figure).
- Staying silent when the conversation is routine and no action would improve the meeting.

Guidelines:
- Analyse the transcript segment first so you understand the context.
- Use 'interject' only when the situation genuinely calls for immediate input.
- Use 'take_note' to record decisions, commitments, risks, action items, or PII flags quietly.
- Keep interjections brief and actionable (one or two sentences).
- Never invent content that is not in the transcript.
- When asked to summarise or list notes so far, use your analysis tools.
- Every interject or take_note action is checked by Strands Decider 2B before it runs."""


class HackathonAgent:
    """One Strands agent per session, with the Hush guardrails pattern wired in."""

    def __init__(
        self,
        decider: Decider | None = None,
        model_id: str | None = None,
        eager: bool | None = None,
    ) -> None:
        import os

        self.decider = decider or Decider()
        # eager is accepted for API compatibility with the kit demo infrastructure.
        self.eager = eager if eager is not None else os.environ.get("DEMO_EAGER") == "1"
        self.model_id = model_id or default_model_id()
        self.sessions: dict[str, tuple[Agent, TranscriptGuard]] = {}

    def _session(self, session_id: str) -> tuple[Agent, TranscriptGuard]:
        if session_id not in self.sessions:
            guard = TranscriptGuard(self.decider)
            agent = Agent(
                model=agent_model(self.model_id),
                system_prompt=SYSTEM_PROMPT,
                tools=TOOLS,
                interventions=[guard],
                callback_handler=None,
            )
            self.sessions[session_id] = (agent, guard)
        return self.sessions[session_id]

    def chat(
        self,
        message: str,
        session_id: str = "default",
        images: list[Any] | None = None,
    ) -> dict[str, Any]:
        """`images` (optional): photos attached by the user (paths, bytes or base64 strings)."""
        agent, guard = self._session(session_id)
        before = len(guard.log)
        t0 = time.perf_counter()
        result = agent(
            [*image_blocks(images), {"text": message}] if images else message,
            invocation_state={"images": list(images or [])},
        )
        reply = strip_thinking(str(result))
        return {
            "reply": reply,
            "decisions": guard.log[before:],
            "model_id": self.model_id,
            "latency_ms": round((time.perf_counter() - t0) * 1000),
            "agent": NAME,
            "eager": self.eager,
        }


if __name__ == "__main__":
    import json
    import sys

    a = HackathonAgent()
    demo_turns = [
        "[Alice]: The NDA with Apex Corp expires this Friday — if we miss it legal liability is significant.\n"
        "[Bob]: Also the severance package for John Smith is $240,000 — let's keep that off the record.\n"
        "Please monitor this transcript.",
        "[Carol]: OK let's move on. Who owns the Q4 roadmap review?\n"
        "[Dave]: I'll send out a calendar invite by EOD.",
        "[Eve]: Great meeting everyone, see you next week.",
    ]
    for msg in sys.argv[1:] or demo_turns:
        print(json.dumps(a.chat(msg), indent=2, default=str))
