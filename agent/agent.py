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

    def evaluate_wingman(
        self,
        segment: str,
        goal: str = "",
        session_id: str = "meeting",
        context: str = "",
    ) -> dict[str, Any]:
        """Real-time wingman evaluation for an attendee during live meetings.

        Answers:
        1. Did the conversation shift to the attendee's goal? (FOCUS_ALERT / wake-up summary)
        2. Is this an opportune moment to ask their doubt? (ASK_DOUBT / suggested question)
        3. Was the attendee's goal resolved? (GOAL_RESOLVED)
        4. Should it stay silent to avoid distracting the attendee? (STAY_SILENT)
        5. Extracts live notes (concepts, actions, decisions) and hesitation-buster doubt cues.
        """
        import re

        clean_segment = segment.strip()
        clean_goal = goal.strip()

        if not clean_segment:
            return {"error": "segment is empty"}

        if not clean_goal:
            return {
                "nudge_type": "STAY_SILENT",
                "goal_relevance": "NONE",
                "wake_up_summary": "",
                "suggested_doubt": "",
                "doubt_tip": "",
                "suggested_questions": [],
                "extracted_notes": [],
                "reason": "No meeting goal set. Enter your aim to activate personal alerts and doubt suggestions.",
                "goal_status": "pending",
                "decisions": [],
            }

        # Format state for Strands Decider 2B
        state = (
            f"Attendee Goal: {clean_goal}\n\n"
            f"--- LIVE MEETING TRANSCRIPT ---\n{clean_segment}\n\n"
            f"Prior Context: {context or 'None'}"
        )

        wingman_qs = {
            "is_goal_relevant": Decider.noul(
                f"Does this meeting transcript relate to or touch upon the attendee's goal: '{clean_goal}'?",
                {
                    "true": "the segment discusses topics directly related to the user's goal",
                    "false": "the segment is routine or completely unrelated to the user's goal",
                },
            ),
            "wingman_cue": Decider.choice(
                f"What live wingman cue should be displayed to the attendee right now regarding their goal '{clean_goal}'?",
                {
                    "FOCUS_ALERT": "the discussion just shifted to or highlights the attendee's goal; alert the user immediately so they refocus",
                    "ASK_DOUBT": "the speaker finished making a point, paused, or invited questions, offering an opportune moment to ask a doubt",
                    "GOAL_RESOLVED": "the key information or question the attendee wanted was answered or resolved in this turn",
                    "STAY_SILENT": "routine conversation or not the right moment; stay silent so the attendee is not disturbed",
                },
            ),
        }

        decisions_record = []
        is_rel = False
        cue = "STAY_SILENT"

        try:
            answers = self.decider.ask(state, wingman_qs)
            rel_dec = answers["is_goal_relevant"]
            cue_dec = answers["wingman_cue"]
            is_rel = rel_dec.yes
            raw_cue = cue_dec.label or "STAY_SILENT"
            # If the segment is not relevant to the user's goal, stay silent so the attendee is not disturbed
            cue = raw_cue if is_rel else "STAY_SILENT"
            decisions_record.append({
                "pattern": "#wingman",
                "goal_relevant": rel_dec.yes,
                "goal_rel_conf": round(rel_dec.confidence, 3),
                "cue": cue,
                "cue_conf": round(cue_dec.confidence, 3),
                "decider_ms": round(self.decider.last_latency_ms or 0),
            })
        except Exception:
            # Heuristic fallback if network/decider is unavailable
            text_lower = clean_segment.lower()
            goal_words = [w.lower() for w in re.findall(r"\w+", clean_goal) if len(w) > 3]
            overlap = any(w in text_lower for w in goal_words)
            is_rel = overlap
            if not is_rel:
                cue = "STAY_SILENT"
            elif any(q in text_lower for q in ["question", "doubt", "what do you think", "any thoughts", "?", "makes sense", "pause"]):
                cue = "ASK_DOUBT"
            else:
                cue = "FOCUS_ALERT"

        speakers = re.findall(r"\[?([A-Za-z][A-Za-z ]{1,30})\]?:", clean_segment)
        active_speaker = speakers[-1] if speakers else "The speaker"

        # Extract the most salient utterance from the segment
        turns = [l.strip() for l in clean_segment.splitlines() if l.strip()]
        last_turn = turns[-1] if turns else clean_segment
        # Strip speaker prefix if present for clean quoting
        clean_quote = re.sub(r"^\[?[A-Za-z][A-Za-z ]{1,30}\]?:?\s*", "", last_turn).strip()

        wake_up_summary = ""
        suggested_doubt = ""
        doubt_tip = ""
        suggested_questions: list[str] = []
        reason = ""
        goal_status = "in_progress" if is_rel else "pending"

        # Generate contextual doubt questions & hesitation-buster cues
        topic_subject = clean_goal.replace("Ask about", "").replace("Learn", "").strip() or clean_goal
        clean_quote_snippet = clean_quote[:70] + ("..." if len(clean_quote) > 70 else "")

        if cue == "FOCUS_ALERT":
            wake_up_summary = f"{active_speaker} just brought up your topic: \"{clean_quote_snippet}\""
            reason = f"Context Alert: '{clean_goal}' is now being actively discussed."
        elif cue == "ASK_DOUBT":
            suggested_doubt = f"Regarding {topic_subject}, could you clarify the best approach or next steps for {clean_quote_snippet}?"
            suggested_questions = [
                f"{active_speaker}, could you give a practical example of how {topic_subject} is applied in production?",
                f"Are there any common pitfalls or prerequisites we should be careful of with {topic_subject}?",
                f"How does this impact the overall timeline and architecture for our {topic_subject} goal?",
            ]
            doubt_tip = "Don't hesitate to ask! The speaker just concluded their point. Asking now shows active participation and clarifies doubts before moving forward."
            wake_up_summary = f"{active_speaker} concluded explanation: \"{clean_quote_snippet}\""
            reason = f"Opportune moment to ask doubt: {active_speaker} paused or concluded this explanation."
        elif cue == "GOAL_RESOLVED":
            wake_up_summary = f"{active_speaker} covered key details: \"{clean_quote_snippet}\""
            reason = f"Resolution detected: details relating to '{clean_goal}' were addressed."
            goal_status = "resolved"

        # ── Live Auto-Notes Extraction ────────────────────────────────────
        extracted_notes = []
        for line in turns:
            sp = re.findall(r"^\[?([A-Za-z][A-Za-z ]{1,30})\]?:?\s*", line)
            sp_name = sp[0] if sp else active_speaker
            line_body = re.sub(r"^\[?[A-Za-z][A-Za-z ]{1,30}\]?:?\s*", "", line).strip()
            if not line_body or len(line_body) < 12:
                continue

            lower_line = line_body.lower()
            # 1. Action Items
            if any(k in lower_line for k in ["need to", "must", "will deploy", "deadline", "action item", "todo", "make sure to", "by tomorrow", "by friday", "deliver", "ship"]):
                extracted_notes.append({
                    "category": "Action Item",
                    "icon": "action",
                    "text": line_body,
                    "speaker": sp_name,
                })
            # 2. Decisions & Takeaways
            elif any(k in lower_line for k in ["decided", "agreed", "conclusion", "we should use", "recommended", "the rule is", "important", "remember that"]):
                extracted_notes.append({
                    "category": "Decision",
                    "icon": "decision",
                    "text": line_body,
                    "speaker": sp_name,
                })
            # 3. Goal-relevant core concepts / tools
            elif is_rel and any(w in lower_line for w in [w.lower() for w in re.findall(r"\w+", clean_goal) if len(w) > 3]):
                extracted_notes.append({
                    "category": "Core Concept",
                    "icon": "concept",
                    "text": line_body,
                    "speaker": sp_name,
                })

        return {
            "nudge_type": cue,
            "goal_relevance": "HIGH" if is_rel else "NONE",
            "wake_up_summary": wake_up_summary,
            "suggested_doubt": suggested_doubt,
            "doubt_tip": doubt_tip,
            "suggested_questions": suggested_questions,
            "extracted_notes": extracted_notes,
            "speaker": active_speaker,
            "reason": reason,
            "goal_status": goal_status,
            "decisions": decisions_record,
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
