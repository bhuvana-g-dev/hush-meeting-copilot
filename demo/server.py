"""Hush demo server — meeting companion UI.

Routes
------
GET  /                       -> index.html  (the meeting workspace)
GET  /api/info               -> agent name, LLM, decider, target
POST /api/analyse            -> analyse a transcript segment; always fires the decision pipeline
POST /api/chat               -> conversational fallback (kept for kit compatibility)
POST /api/reset              -> clear agent session
GET  /api/notes              -> all notes collected this session
GET  /api/interjections      -> all interjections collected this session

The key fix for "0 decisions":
  /api/analyse bypasses the LLM chat loop and calls the agent with a transcript segment
  that is prefixed to explicitly request analysis AND action, so the LLM always calls
  interject or take_note (rather than just replying in text).  Every call to either
  guarded tool fires TranscriptGuard -> Strands Decider 2B -> a record in guard.log.
"""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from decider_kit.config import load_dotenv

load_dotenv()
STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Hush — meeting companion")

from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
_agent: Any = None


# ── request bodies ────────────────────────────────────────────────────────────

_current_goal: str = ""


class Turn(BaseModel):
    message: str
    session_id: str = "demo"
    images: list[str] = []


class GoalRequest(BaseModel):
    goal: str
    session_id: str = "meeting"


class WingmanRequest(BaseModel):
    """Real-time wingman evaluation request for live meetings."""
    segment: str
    goal: str = ""
    session_id: str = "meeting"
    context: str = ""


class SegmentRequest(BaseModel):
    """A transcript segment submitted for real-time analysis."""
    segment: str            # raw transcript lines, e.g. "[Alice]: The NDA expires Friday."
    goal: str = ""          # optional attendee meeting aim
    session_id: str = "meeting"
    context: str = ""       # optional: prior summary for continuity


# ── agent initialisation ──────────────────────────────────────────────────────

def agent() -> Any:
    global _agent
    if _agent is None:
        if os.environ.get("DEMO_TARGET") == "agentcore":
            _agent = AgentCoreClient(os.environ["AGENTCORE_ARN"])
        else:
            from agent.agent import HackathonAgent
            _agent = HackathonAgent()
    return _agent


class AgentCoreClient:
    """Same chat() interface, served by the agent deployed on Amazon Bedrock AgentCore Runtime."""

    def __init__(self, arn: str):
        import boto3
        self.arn = arn
        self.client = boto3.client("bedrock-agentcore",
                                   region_name=os.environ.get("AWS_REGION", "us-east-1"))
        self.sessions: dict[str, str] = {}

    def chat(self, message: str, session_id: str = "demo",
             images: list[str] | None = None) -> dict[str, Any]:
        sid = self.sessions.setdefault(session_id, f"demo-{session_id}-{uuid.uuid4().hex}")
        payload = {"prompt": message, **({"images": images} if images else {})}
        r = self.client.invoke_agent_runtime(
            agentRuntimeArn=self.arn, runtimeSessionId=sid,
            payload=json.dumps(payload).encode())
        body = r["response"].read() if hasattr(r["response"], "read") else r["response"]
        out = json.loads(body)
        out["served_by"] = "Amazon Bedrock AgentCore Runtime"
        return out


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC / "index.html")


@app.get("/api/info")
def info() -> dict[str, Any]:
    from decider_kit.config import settings
    s = settings()
    name = "Hush"
    try:
        from agent import agent as mod
        name = getattr(mod, "NAME", name)
    except Exception:
        pass
    decider = s.decider_mode
    if os.environ.get("DEMO_TARGET") == "agentcore":
        dep = Path(__file__).resolve().parent.parent / "submission" / "deployment.json"
        if dep.exists():
            decider = json.loads(dep.read_text()).get("decider_mode", decider)
    from decider_kit.llm import describe
    llm = describe()
    if os.environ.get("DEMO_TARGET") == "agentcore":
        llm = f"Amazon Bedrock ({s.bedrock_model})"
    return {"agent": name, "llm": llm, "bedrock_model": s.bedrock_model,
            "decider": decider, "target": os.environ.get("DEMO_TARGET", "local")}


@app.get("/api/goal")
def get_goal() -> dict[str, str]:
    return {"goal": _current_goal}


@app.post("/api/goal")
def set_goal(req: GoalRequest) -> dict[str, Any]:
    global _current_goal
    _current_goal = req.goal.strip()
    return {"ok": True, "goal": _current_goal}


@app.post("/api/wingman")
def wingman(req: WingmanRequest) -> JSONResponse:
    """Evaluate live meeting transcript specifically for the attendee's personal goal."""
    global _current_goal
    if not req.segment.strip():
        return JSONResponse({"error": "segment is empty"}, status_code=400)

    effective_goal = req.goal.strip() or _current_goal
    try:
        a = agent()
        if hasattr(a, "evaluate_wingman"):
            out = a.evaluate_wingman(req.segment, effective_goal, req.session_id, req.context)
        else:
            out = {
                "nudge_type": "STAY_SILENT",
                "goal_relevance": "NONE",
                "wake_up_summary": "",
                "suggested_doubt": "",
                "reason": "Agent does not support wingman evaluation",
                "goal_status": "pending",
                "decisions": [],
            }
        return JSONResponse(out)
    except Exception as e:
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=500)


@app.post("/api/analyse")
def analyse(req: SegmentRequest) -> JSONResponse:
    """Analyse a transcript segment through the real decision pipeline.

    This is the primary endpoint for the meeting workspace.  It always calls the agent
    with an instruction that reliably triggers interject or take_note, ensuring the
    Strands Decider 2B guardrails fire and decisions appear in the panel.
    """
    global _current_goal
    if not req.segment.strip():
        return JSONResponse({"error": "segment is empty"}, status_code=400)

    effective_goal = req.goal.strip() or _current_goal

    # Construct a message that reliably drives the LLM to use a tool.
    message = (
        "New transcript segment received. "
        "Analyse it and take the appropriate action — "
        "call interject if something needs immediate attention, "
        "call take_note to record a decision or commitment silently, "
        "or stay silent if the content is routine. "
        "Do not reply with a plain explanation — use the tools.\n\n"
        + req.segment
    )
    if req.context:
        message = f"Session context so far:\n{req.context}\n\n{message}"

    try:
        a = agent()
        out = a.chat(message, req.session_id)

        # Attach wingman evaluation if available
        if hasattr(a, "evaluate_wingman"):
            try:
                wingman_res = a.evaluate_wingman(req.segment, effective_goal, req.session_id, req.context)
                out["wingman"] = wingman_res
            except Exception:
                pass

        # Attach current session notes and interjections for the intelligence panel.
        try:
            from agent.tools import _notes, _interjections
            out["session_notes"] = list(_notes)
            out["session_interjections"] = list(_interjections)
        except Exception:
            pass
        return JSONResponse(out)
    except Exception as e:
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=500)


@app.post("/api/chat")
def chat(t: Turn) -> JSONResponse:
    """Conversational fallback — kept for kit compatibility and the demo mode input."""
    try:
        a = agent()
        if t.images:
            import inspect
            if "images" not in inspect.signature(a.chat).parameters:
                return JSONResponse(
                    {"error": "this agent does not take images"}, status_code=400)
            return JSONResponse(a.chat(t.message, t.session_id, images=t.images))
        return JSONResponse(a.chat(t.message, t.session_id))
    except Exception as e:
        return JSONResponse({"error": f"{type(e).__name__}: {e}"}, status_code=500)


@app.post("/api/reset")
def reset() -> dict[str, bool]:
    global _agent
    _agent = None
    # Also clear in-memory tool state so notes/interjections start fresh.
    try:
        import agent.tools as t
        t._notes.clear()
        t._interjections.clear()
    except Exception:
        pass
    return {"ok": True}


@app.get("/api/notes")
def get_notes() -> JSONResponse:
    try:
        from agent.tools import _notes
        return JSONResponse({"notes": list(_notes)})
    except Exception:
        return JSONResponse({"notes": []})


@app.get("/api/interjections")
def get_interjections() -> JSONResponse:
    try:
        from agent.tools import _interjections
        return JSONResponse({"interjections": list(_interjections)})
    except Exception:
        return JSONResponse({"interjections": []})
