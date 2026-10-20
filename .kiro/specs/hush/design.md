# Hush — Design

## Architecture

```
User / Demo UI
      │
      ▼
HackathonAgent.chat(message)          agent/agent.py
      │
      ▼
Strands Agent (Amazon Bedrock LLM)    decider_kit/llm.py → BedrockModel
      │
      │  ← SYSTEM_PROMPT instructs the LLM to parse, summarise, flag, suggest, escalate
      │
      ├── parse_transcript()          } read-only: run without a guardrails check
      ├── extract_topics()            }
      ├── summarise_transcript()      }
      │
      ├── flag_sensitive_item() ──────┐
      ├── suggest_redaction()   ──────┤ ← intercepted by TranscriptGuard
      └── escalate_for_review() ──────┘
                │
                ▼
        TranscriptGuard.before_tool_call()       agent/decision.py
                │
                ▼
        Strands Decider 2B (one forward pass)    decider_kit/client.py
        Questions: content_grounded, contains_sensitive, premature
                │
           ┌────┴────────────────────────────────────┐
           │                                         │
        Proceed                         Guide / Confirm / Deny
        (action runs)                   (feedback sent back to LLM)
```

## Decision Pattern: guardrails

### Questions (all noul — calibrated probability)
1. `content_grounded`: Is the action grounded in content actually in the transcript?
2. `contains_sensitive`: Does the transcript contain genuinely sensitive material?
3. `premature`: Should the agent clarify with the user before acting?

### Verdict logic (priority order)
| Condition | Verdict | Strands action |
|-----------|---------|----------------|
| grounded < 0.50 | Not grounded | Guide |
| sensitive < 0.50 | No sensitive content | Guide |
| grounded or sensitive in [0.40, 0.60] | Low confidence | Confirm |
| premature > 0.50 | Premature | Guide |
| premature in [0.40, 0.60] | Unsure on timing | Confirm |
| All checks passed | Proceed | Proceed |

### Retry guard
If the LLM retries a call with the same tool + args after a Guide, the call is Denied.  
This ensures the intervention converges (Strands requirement).

## Data flow for eval_cases.jsonl
Each case contains:
- `state`: the conversation + proposed action (as a string, same format the decider receives)
- `expected`: `{"content_grounded": "yes"/"no", "contains_sensitive": "yes"/"no", "premature": "yes"/"no"}`
- `split`: `"tune"` or `"test"` (12 each, 24 total)

## Files
| File | Role |
|------|------|
| `agent/agent.py` | `HackathonAgent` — stable chat interface |
| `agent/decision.py` | `TranscriptGuard` — guardrails pattern |
| `agent/tools.py` | 6 tools (3 read-only, 3 guarded) |
| `agent/AGENT.md` | Agent description |
| `agent/features.yaml` | AgentCore features (both off) |
| `agent/demo_script.yaml` | Video demo script |
| `agent/eval_cases.jsonl` | 24 eval cases |
| `demo/static/index.html` | Demo UI (updated title + placeholder) |
| `.env` | Environment config (no secrets committed) |
