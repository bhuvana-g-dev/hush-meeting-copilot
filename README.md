# Hush: AI meeting copilot

**An AI copilot that listens to live meeting transcripts and uses Strands Decider 2B to choose
INTERJECT, TAKE_NOTE, or STAY_SILENT -- never acting without a calibrated reason.**

An agent on AWS that hands one decision to **Strands Decider 2B** and the conversation to
**Amazon Bedrock**. Decision pattern: `#guardrails`. Tags: `#strands-decider-2b` `#guardrails`.

- Video: (add the YouTube/Vimeo public link after recording with `.\kit.cmd video`)
- Article: (add the AWS Builder Center link after publishing)
- Deployed: run `.\kit.cmd deploy` to deploy to Amazon Bedrock AgentCore Runtime

## The project

- **Pitch:** A meeting copilot that decides -- before acting -- whether to interject with a
  suggestion, take a silent note, or stay quiet.
- **Who it is for:** Teams that want an AI present in every meeting: catching sensitive
  disclosures, flagging missed action items, and recording decisions without interrupting the
  flow unless it genuinely matters.
- **Features:**
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

## Credits

Built with the **AWS User Group Madurai** Strands Decider hackathon kit
(https://www.awsugmdu.in). The reusable library (`decider_kit/`, the demo UI, the video and
article tooling, and the Kiro steering, skills and hooks) is the user group's; the Hush agent
in `agent/` is the participant's original work.

Strands Decider: https://github.com/strands-labs/strands-decider (Apache-2.0).

Licence: Apache-2.0 (see LICENSE).
