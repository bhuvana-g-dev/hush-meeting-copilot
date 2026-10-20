"""REUSABLE DECISION PATTERN: meeting copilot action guard  (#guardrails)

What it does
    Before Hush takes any visible action during a live meeting (interjecting with a suggestion,
    taking a note, or staying silent), Strands Decider 2B reads the latest transcript segment
    and decides which of three actions is warranted:

    INTERJECT  — something in the transcript needs immediate attention: a sensitive disclosure,
                 a missed action item, a factual slip, or a question left unanswered.  The
                 agent generates a concise suggestion for the meeting participants.
    TAKE_NOTE  — the content is worth recording (a decision, a commitment, a risk flag, a name
                 or a figure) but does not need to interrupt the flow.  The agent appends a
                 structured note.
    STAY_SILENT — the transcript is routine; no action improves the meeting.

    A second noul question, contains_sensitive, acts as a safety gate: if the decider is
    confident that the transcript contains genuinely sensitive material (PII, confidential
    financial data, legal risk, credentials) AND the action is STAY_SILENT, the guard upgrades
    the verdict to Confirm so a human can decide.

    Low-confidence action choices (below CONFIDENT threshold) always go to Confirm rather than
    acting automatically.

Typed questions and options
    action (choice): Which action should the meeting copilot take right now?
        INTERJECT  — something needs immediate attention; offer a concise suggestion
        TAKE_NOTE  — worth recording silently; append a structured note
        STAY_SILENT — no action needed; remain quiet

    contains_sensitive (noul): Does the transcript contain material that warrants
        special attention — PII, confidential business data, legal or financial risk, credentials,
        or hostile language?
        true  — clear sensitive content is present
        false — the transcript is routine meeting content

Wiring
    `TranscriptGuard` is a Strands `InterventionHandler`.  Pass it to the Agent:

        guard = TranscriptGuard(Decider())
        agent = Agent(model=..., tools=[...], interventions=[guard])

    It intercepts calls to GUARDED_TOOLS only (interject, take_note); analysis tools run
    untouched.  A guided call retried unchanged is denied so the intervention converges
    (Strands requirement).

Confidence handling
    action.confidence >= CONFIDENT → act (Proceed or Guide based on the verdict)
    action.confidence <  CONFIDENT → human review (Confirm)
    STAY_SILENT + contains_sensitive.yes → human review (Confirm)

How to reuse this pattern
    1. Copy this file into your agent/ directory.
    2. Replace INTERJECT / TAKE_NOTE / STAY_SILENT with the actions that suit your domain.
    3. Keep the contains_sensitive noul question or replace it with your own safety gate.
    4. Tune CONFIDENT to match your risk tolerance (lower = more human reviews).
    5. Pass TranscriptGuard(Decider()) in your Agent's interventions= list.
    6. Read guard.log after each turn for the demo panel and benchmark.
"""

from __future__ import annotations

import json
from typing import Any

from strands.interventions import Confirm, Deny, Guide, InterventionHandler, Proceed

from decider_kit import Decider
from decider_kit.patterns.guardrails import render_messages

PATTERN_TAG = "#guardrails"

# Tools that produce visible output or side-effects; all others run untouched.
GUARDED_TOOLS = {"interject", "take_note"}

# Minimum confidence to act without human review.
CONFIDENT: float = 0.65

# ──────────────────────────────────────────────── typed questions ──────

QUESTIONS = {
    "action": Decider.choice(
        "Which action should the meeting copilot take right now?",
        {
            "INTERJECT":   "something in the transcript needs immediate attention — a sensitive "
                           "disclosure, a missed action item, a factual error, or an unanswered "
                           "question — and a short suggestion to the participants would help",
            "TAKE_NOTE":   "the content is worth recording silently (a decision, a commitment, "
                           "a risk flag, a name or a figure) but does not require interrupting",
            "STAY_SILENT": "the conversation is routine and no action from the copilot would "
                           "improve the meeting",
        },
    ),
    "contains_sensitive": Decider.noul(
        "Does the transcript contain material that warrants special attention — PII, confidential "
        "business data, legal or financial risk language, credentials, or hostile language?",
        {
            "true":  "clear sensitive content is present (a name + contact, a financial figure "
                     "that should be off the record, legal liability language, a plain-text "
                     "password, hostile remarks)",
            "false": "the transcript is routine meeting content with nothing sensitive",
        },
    ),
}

# ──────────────────────────────────────────────── intervention handler ─

class TranscriptGuard(InterventionHandler):
    """Gates Hush's action tools with a single Strands Decider 2B call.

    Attributes
    ----------
    log : list[dict]
        One record per intercepted tool call, in order.  Each record contains at minimum:
        pattern, tool, verdict, action (the chosen option), action_confidence,
        contains_sensitive, and decider_ms.  Read after each HackathonAgent.chat() call.
    """

    name = "transcript-guard"

    def __init__(
        self,
        decider: Decider,
        confident: float = CONFIDENT,
        confirm_when_unsure: bool = True,
    ) -> None:
        self.decider = decider
        self.confident = confident
        self.confirm_when_unsure = confirm_when_unsure
        self.log: list[dict[str, Any]] = []
        self._guided: set[str] = set()

    def before_invocation(self, event: Any, **kwargs: Any) -> Any:
        """Reset guided-call memory at the start of each new user turn."""
        self._guided.clear()
        return Proceed()

    def before_tool_call(self, event: Any, **kwargs: Any) -> Any:
        name = event.tool_use["name"]

        if name not in GUARDED_TOOLS:
            return Proceed()

        args = event.tool_use.get("input") or {}
        sig = f"{name}:{json.dumps(args, sort_keys=True)}"

        # Guide must converge: deny an unchanged retry.
        if sig in self._guided:
            self.log.append({
                "pattern": PATTERN_TAG,
                "tool": name,
                "args": args,
                "verdict": "deny",
                "reason": "retried a guided call unchanged",
            })
            return Deny(
                reason=(
                    "This exact action was already blocked. "
                    "Ask the user for clarification instead of retrying unchanged."
                )
            )

        # Build the state the decider reads: the conversation + the proposed tool call.
        state = (
            "A live meeting is in progress. A meeting copilot is reviewing the latest "
            "transcript segment to decide whether to interject, take a note, or stay silent.\n\n"
            f"--- TRANSCRIPT SEGMENT ---\n{render_messages(event.agent.messages)}\n\n"
            f"--- PROPOSED ACTION ---\ntool: {name}\narguments: {json.dumps(args)}"
        )

        answers = self.decider.ask(state, QUESTIONS)
        action_decision = answers["action"]
        sensitive_decision = answers["contains_sensitive"]

        chosen = action_decision.label or "STAY_SILENT"
        action_conf = action_decision.confidence
        sensitive = sensitive_decision.p_yes or 0.0

        rec: dict[str, Any] = {
            "pattern": PATTERN_TAG,
            "tool": name,
            "args": args,
            "action": chosen,
            "action_confidence": round(action_conf, 3),
            "contains_sensitive": round(sensitive, 3),
            "decider_ms": round(self.decider.last_latency_ms or 0),
        }

        # ── Decision logic ────────────────────────────────────────────

        # Low confidence: always route to human rather than acting or blocking.
        if self.confirm_when_unsure and action_conf < self.confident:
            rec["verdict"] = "confirm"
            rec["reason"] = "low confidence — routing to human review"
            self.log.append(rec)
            return Confirm(
                prompt=(
                    f"Copilot is unsure (confidence {action_conf:.0%}): "
                    f"run '{name}' now?"
                ),
                response="yes",
            )

        # The decider chose STAY_SILENT but sensitive content is present → human check.
        if chosen == "STAY_SILENT" and sensitive_decision.yes:
            rec["verdict"] = "confirm"
            rec["reason"] = "STAY_SILENT overridden by sensitive content"
            self.log.append(rec)
            return Confirm(
                prompt=(
                    "Sensitive content detected but copilot chose STAY_SILENT. "
                    f"Run '{name}' anyway?"
                ),
                response="yes",
            )

        # The tool name must match what the decider chose.
        tool_action = "INTERJECT" if name == "interject" else "TAKE_NOTE"
        if chosen != tool_action:
            rec["verdict"] = "guide"
            rec["reason"] = f"decider chose {chosen}; tool is {tool_action}"
            self.log.append(rec)
            self._guided.add(sig)
            if chosen == "STAY_SILENT":
                return Guide(
                    feedback=(
                        "The meeting content does not warrant any action right now. "
                        "Stay silent and continue monitoring the transcript."
                    )
                )
            other = "take_note" if name == "interject" else "interject"
            return Guide(
                feedback=(
                    f"The right action here is {chosen.lower().replace('_', ' ')}, "
                    f"not {tool_action.lower().replace('_', ' ')}. "
                    f"Use the '{other}' tool instead."
                )
            )

        # All checks passed.
        rec["verdict"] = "proceed"
        self.log.append(rec)
        return Proceed()
