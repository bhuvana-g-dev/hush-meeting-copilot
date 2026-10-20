"""Hush tools: meeting copilot actions.

Each tool has a one-line docstring — the model reads it to decide which tool to use.

Read-only / analysis tools (analyse_transcript, extract_action_items, summarise_segment) run
without a guardrails check.

Action tools (interject, take_note) are intercepted by TranscriptGuard before they execute:
the guard asks Strands Decider 2B whether the action is warranted.
"""

from __future__ import annotations

from strands import tool

# ────────────────────────────────────────────── in-memory state (demo) ─

_notes: list[dict] = []
_interjections: list[dict] = []


# ──────────────────────────────────────────────────── read-only tools ──

@tool
def analyse_transcript(segment: str) -> dict:
    """Analyse a meeting transcript segment and return its topics and speaker turns."""
    import re

    lines = [l.strip() for l in segment.strip().splitlines() if l.strip()]
    turns = []
    for line in lines:
        m = re.match(r"^\[?([A-Za-z][A-Za-z ]{1,40})\]?:\s*(.+)$", line)
        if m:
            turns.append({"speaker": m.group(1).strip(), "text": m.group(2).strip()})

    keywords = {
        "budget": ["budget", "cost", "spend", "revenue", "invoice", "salary", "payment"],
        "legal": ["legal", "contract", "compliance", "liability", "nda", "lawsuit"],
        "security": ["password", "credential", "breach", "vulnerability", "access"],
        "hiring": ["hire", "candidate", "interview", "offer", "onboard", "resign"],
        "product": ["feature", "release", "roadmap", "sprint", "launch", "milestone"],
        "personnel": ["fired", "termination", "pip", "performance review", "complaint"],
        "action_items": ["will", "action", "follow up", "assign", "by friday", "deadline"],
    }
    text_lower = segment.lower()
    topics = [t for t, words in keywords.items() if any(w in text_lower for w in words)]

    return {
        "turns": turns,
        "speaker_count": len({t["speaker"] for t in turns}),
        "topics": topics or ["general discussion"],
    }


@tool
def extract_action_items(segment: str) -> dict:
    """Extract action items and commitments from a meeting transcript segment."""
    import re

    items = []
    patterns = [
        r"(?i)(will|shall|going to|needs? to|has to|must)\s+(.{10,80})",
        r"(?i)(action:?|follow.?up:?|todo:?)\s*(.{5,80})",
        r"(?i)(.{5,60})\s+by\s+(monday|tuesday|wednesday|thursday|friday|eod|eow|next week)",
    ]
    for p in patterns:
        for m in re.finditer(p, segment):
            item = m.group(0).strip()[:120]
            if item not in items:
                items.append(item)

    return {"action_items": items[:10]}


@tool
def summarise_segment(segment: str) -> dict:
    """Return a brief plain-text summary of the key points in a meeting transcript segment."""
    lines = [l.strip() for l in segment.strip().splitlines() if l.strip()]
    sample = lines[:6]
    note = f" (showing first {len(sample)} of {len(lines)} lines)" if len(lines) > 6 else ""
    return {"summary": "Segment highlights" + note + ":\n" + "\n".join(f"  • {l}" for l in sample)}


# ───────────────────────────────────────────────────── action tools ────
# These are intercepted by TranscriptGuard before they execute.

@tool
def interject(suggestion: str, reason: str) -> dict:
    """Interject in the meeting with a concise suggestion or alert for the participants."""
    if not suggestion.strip():
        return {"error": "suggestion must not be empty"}
    entry = {"suggestion": suggestion, "reason": reason}
    _interjections.append(entry)
    return {"interjected": True, "entry": entry, "total": len(_interjections)}


@tool
def take_note(note: str, category: str) -> dict:
    """Silently record a note about the meeting (decision, commitment, risk, PII flag, action item)."""
    valid = {"decision", "commitment", "risk", "pii_flag", "action_item", "general"}
    if category not in valid:
        return {"error": f"unknown category '{category}'; use one of {sorted(valid)}"}
    if not note.strip():
        return {"error": "note must not be empty"}
    entry = {"note": note, "category": category}
    _notes.append(entry)
    return {"noted": True, "entry": entry, "total": len(_notes)}


# Exported list for agent.py
TOOLS = [
    analyse_transcript,
    extract_action_items,
    summarise_segment,
    interject,
    take_note,
]
