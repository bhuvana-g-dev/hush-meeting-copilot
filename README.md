# Hush: AI meeting copilot

**An AI copilot that listens to live meeting transcripts and uses Strands Decider 2B to choose
INTERJECT, TAKE_NOTE, or STAY_SILENT -- never acting without a calibrated reason.**

An agent on AWS that hands one decision to **Strands Decider 2B** and the conversation to
**Amazon Bedrock**. Decision pattern: `#guardrails`. Tags: `#strands-decider-2b` `#guardrails`.

- Video: (add the YouTube/Vimeo public link after recording with `.\kit.cmd video`)
- Article: (add the AWS Builder Center link after publishing)
- Deployed: run `.\kit.cmd deploy` to deploy to Amazon Bedrock AgentCore Runtime

## 🎙️ NEW: Google Meet Integration

**Hush now connects to live Google Meet calls via Chrome Extension!**

- ✅ Capture real-time captions from Google Meet
- ✅ AI analysis of live conversations as they happen
- ✅ Privacy-focused: only reads visible captions
- ✅ No changes to existing Hush functionality

**Quick Start:**
1. Load the extension from `chrome-extension/` folder
2. Join a Google Meet call and enable captions
3. Click Start Capture in the extension
4. View AI decisions in the Hush dashboard

**See [GOOGLE_MEET_INTEGRATION.md](GOOGLE_MEET_INTEGRATION.md) for complete setup and testing instructions.**

## The project

- **Pitch:** A meeting copilot that decides -- before acting -- whether to interject with a
  suggestion, take a silent note, or stay quiet.
- **Who it is for:** Teams that want an AI present in every meeting: catching sensitive
  disclosures, flagging missed action items, and recording decisions without interrupting the
  flow unless it genuinely matters.
- **Features:**
  - **NEW: Live Google Meet caption capture** via Chrome Extension
  - analyse transcript segments and extract action items in real time
  - choose INTERJECT, TAKE_NOTE, or STAY_SILENT using Strands Decider 2B
  - interject with a concise, actionable suggestion when the meeting genuinely needs it
  - take a silent structured note (decision, commitment, risk, PII flag, action item)
  - low-confidence choices routed to human review rather than acting automatically
  - sensitive content detected with STAY_SILENT triggers a human confirmation step
  - live decision panel in the demo UI shows every probability and verdict
  - deployed on Amazon Bedrock AgentCore Runtime
- **The decision:** before every action (interject or take_note), Strands Decider 2B reads the
  transcript and answers: which of INTERJECT / TAKE_NOTE / STAY_SILENT is warranted, and does
  the transcript contain sensitive material? (`#guardrails`)
- **Amazon Bedrock:** the conversation, suggestions, note text, and transcript analysis
  (Amazon Nova Pro by default; set `BEDROCK_MODEL_ID` in `.env`).

## How it is built

Strands Agents with Amazon Bedrock for the generative part, the tools in `agent/tools.py`,
deployed to Amazon Bedrock AgentCore Runtime, and one decision handed to Strands Decider 2B
at a clear seam in the agent's path.

Every Amazon Bedrock model id is set in `.env` (`BEDROCK_MODEL_ID`, and
`BEDROCK_SMALL/MEDIUM/LARGE_MODEL_ID` for routing), Amazon Nova by default.

**Chrome Extension:** The Google Meet integration uses a Manifest V3 extension that captures
visible captions from the meeting DOM and sends them to the existing Hush backend via the
`/api/chat` endpoint. No core agent logic was modified—the extension simply provides a new
input source for transcripts.

## Reusable decision pattern: meeting copilot action guard

The pattern lives in [`agent/decision.py`](agent/decision.py), labelled
`REUSABLE DECISION PATTERN`. It contains the typed questions and their options, the wiring that
puts the decision in the agent's path, and a note on how to reuse it.

Typed questions:

```python
QUESTIONS = {
    "action": Decider.choice(
        "Which action should the meeting copilot take right now?",
        {
            "INTERJECT":   "something in the transcript needs immediate attention -- a sensitive "
                           "disclosure, a missed action item, a factual error, or an unanswered "
                           "question -- and a short suggestion to the participants would help",
            "TAKE_NOTE":   "the content is worth recording silently (a decision, a commitment, "
                           "a risk flag, a name or a figure) but does not require interrupting",
            "STAY_SILENT": "the conversation is routine and no action from the copilot would "
                           "improve the meeting",
        },
    ),
    "contains_sensitive": Decider.noul(
        "Does the transcript contain material that warrants special attention -- PII, confidential "
        "business data, legal or financial risk language, credentials, or hostile language?",
        {
            "true":  "clear sensitive content is present",
            "false": "the transcript is routine meeting content with nothing sensitive",
        },
    ),
}
```

The `TranscriptGuard` InterventionHandler intercepts `interject` and `take_note` before they
run. Low-confidence action choices go to `Confirm` (human review). STAY_SILENT combined with
sensitive content also goes to `Confirm`. See `agent/decision.py` for the full wiring and
reuse instructions.

## Measured

Run `.\kit.cmd bench --split tune` then `.\kit.cmd bench --split test` to produce
`submission/bench/results.md`. The table below will be filled with real numbers after that run.

<!-- TODO: paste submission/bench/results.md here after running .\kit.cmd bench --split test -->

Reproduce with `.\kit.cmd bench` (cases in `agent/eval_cases.jsonl`; 24 cases, 12 tune + 12
test; charts in `submission/bench/`).

## Run it

```powershell
# Windows
.\kit.cmd setup         # choose decider and LLM, test both
.\kit.cmd demo          # web UI at http://localhost:8501
.\kit.cmd bench         # Strands Decider 2B vs Amazon Bedrock LLM on the same questions
.\kit.cmd deploy        # Amazon Bedrock AgentCore Runtime
```

```bash
# macOS / Linux
./kit setup
./kit demo
./kit bench
./kit deploy
```

Requirements: Python 3.10+, AWS credentials with Amazon Bedrock access (us-east-1, Amazon Nova
Pro), and for deploying: Node 20+ with the AgentCore CLI (`.\kit.cmd agentcore-cli`).

### Google Meet Integration Setup

See [GOOGLE_MEET_INTEGRATION.md](GOOGLE_MEET_INTEGRATION.md) for detailed instructions.

**Quick setup:**

1. **Generate extension icons:**
   ```bash
   cd chrome-extension
   python generate_icons.py
   ```

2. **Load extension in Chrome:**
   - Open `chrome://extensions`
   - Enable Developer mode
   - Click "Load unpacked"
   - Select `chrome-extension/` folder

3. **Use in Google Meet:**
   - Join a meeting and enable captions (CC button)
   - Click Hush extension icon
   - Click "Start Capture"
   - Open Hush dashboard to see live AI decisions

## Testing

```bash
# Run all tests
python -m pytest tests/ -v

# Test extension integration
python -m pytest tests/test_extension_integration.py -v

# Run existing tests (verify no regressions)
python -m pytest tests/test_agent_contract.py tests/test_tools.py -v
```

## Project Structure

```
hush-meeting-copilot/
├── agent/                      # Core Hush agent (unchanged)
│   ├── agent.py               # Main agent orchestrator
│   ├── decision.py            # Strands Decider 2B guardrails
│   ├── tools.py               # Agent tools (interject, take_note)
│   └── eval_cases.jsonl       # Evaluation dataset
├── chrome-extension/          # NEW: Google Meet integration
│   ├── manifest.json          # Extension config
│   ├── content.js             # Caption capture
│   ├── background.js          # API communication
│   ├── popup.html/js          # Extension UI
│   └── README.md              # Extension docs
├── demo/
│   ├── server.py              # FastAPI backend
│   └── static/
│       └── index.html         # Web UI (updated with Meet status)
├── tests/
│   ├── test_extension_integration.py  # NEW: Extension tests
│   └── ...                    # Existing tests (all preserved)
├── GOOGLE_MEET_INTEGRATION.md # NEW: Integration guide
└── README.md                  # This file
```

## Credits

Built with the **AWS User Group Madurai** Strands Decider hackathon kit
(https://www.awsugmdu.in). The reusable library (`decider_kit/`, the demo UI, the video and
article tooling, and the Kiro steering, skills and hooks) is the user group's; the Hush agent
in `agent/` is the participant's original work.

Strands Decider: https://github.com/strands-labs/strands-decider (Apache-2.0).

Licence: Apache-2.0 (see LICENSE).
