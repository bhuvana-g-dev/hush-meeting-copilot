# Hush — Requirements

## Overview
Hush is a meeting transcript guardrails agent built on the Strands Agents SDK with Strands Decider 2B.  
It checks every action (flagging, redaction suggestion, escalation) against the transcript content before the action runs, using one guardrails decision pattern.

## Functional Requirements

### FR-1: Transcript ingestion
- Accept raw meeting transcript text via the chat interface.
- Parse it into structured speaker turns.

### FR-2: Topic extraction
- Extract the main discussion topics from a transcript (budget, hiring, legal, security, personnel, product, general).

### FR-3: Summarisation
- Produce a brief plain-text summary of key points from a transcript.

### FR-4: Sensitive item flagging
- Flag specific items as sensitive with a reason and category (pii, confidential, legal, financial, hostile, other).
- Only flag items that actually appear in the transcript.

### FR-5: Redaction suggestion
- Suggest a safe replacement string for a flagged item.
- Only suggest redactions for items grounded in the transcript.

### FR-6: Escalation
- Escalate high-risk content for human review with a reason and excerpt.
- Only escalate when there is clear sensitive content in the transcript.

### FR-7: Guardrails decision (primary decision pattern)
- Before every action tool call (flag, redact, escalate), use Strands Decider 2B to check:
  1. Is the action grounded in the transcript?
  2. Does the transcript contain genuinely sensitive material?
  3. Is the action premature (should the agent clarify first)?
- Block ungrounded or unwarranted actions with feedback (Guide).
- Route low-confidence cases to human confirmation (Confirm).
- Allow only grounded, warranted, non-premature actions (Proceed).

### FR-8: Low-confidence handling
- When the decider confidence is in the unsure band (0.40–0.60), route to human review (Confirm) rather than proceeding or blocking outright.

### FR-9: Demo UI
- Web UI accepting transcript text, showing the agent's reply, the selected action/verdict, decision confidence scores, and a generated suggestion or note.

## Non-Functional Requirements
- All action tools intercepted before execution (no bypass path).
- IS_KIT_EXAMPLE must not be present in the codebase.
- Apache-2.0 licence.
- Tags: #strands-decider-2b, #guardrails.
