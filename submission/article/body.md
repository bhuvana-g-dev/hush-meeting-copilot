# Hush: an AI meeting copilot that decides before it acts

By Bhuvana

Every meeting has a moment where someone shares something they should not have, or where an action item disappears into the noise, or where a question hangs unanswered until everyone has logged off. I built Hush to catch those moments -- and to stay quiet when the meeting does not need help.

The key challenge was not building an agent that could interject. It was building one that knows when not to. That is the decision I handed to Strands Decider 2B.

## The project

Hush is an AI meeting copilot. You paste a transcript segment into the chat (or stream it from your meeting tool), and Hush decides what to do:

- **INTERJECT** -- offer a concise suggestion to the participants when something genuinely needs attention: a legal deadline about to be missed, a plain-text credential shared verbally, a question that has been asked twice and not answered.
- **TAKE_NOTE** -- record a structured note silently when the content is worth keeping but does not need to interrupt: a decision made, a commitment given, a risk flagged, a financial figure that should stay off the record.
- **STAY_SILENT** -- do nothing when the conversation is routine.

The live demo shows the agent analysing a board meeting transcript. The decision panel on the right shows the three probabilities from Strands Decider 2B and the verdict -- proceed, guide, or confirm -- in real time.

< FIGURE 1 of 3: upload submission/article/img/demo.png here >
Alt text: The Hush demo UI: the conversation on the left, the Strands Decider 2B decision panel with INTERJECT/TAKE_NOTE/STAY_SILENT probabilities and verdict on the right

Hush is for teams that want a copilot present in every meeting without someone manually reviewing every transcript. The three-action guardrail means it speaks up when it has good reason to, and records silently when it does not.

## How I built it

The agent runs on Strands Agents with Amazon Bedrock (Amazon Nova Pro) for the generative part. The tools in `agent/tools.py` cover the analysis side (analyse_transcript, extract_action_items, summarise_segment) and the action side (interject, take_note). Every `interject` or `take_note` call is intercepted by `TranscriptGuard` before it executes.

< FIGURE 2 of 3: upload submission/article/img/architecture.png here >
Alt text: Architecture diagram: the user, the Strands agent with tools and the TranscriptGuard decision, Amazon Bedrock for generation, and Strands Decider 2B for the action choice

The deployed agent runs on Amazon Bedrock AgentCore Runtime. I used Kiro and a spec in `.kiro/specs/hush/` to drive the build: requirements, design, and tasks in three Markdown files, worked through in order.

## The decision I handed to Strands Decider 2B

The action choice needed to be fast, cheap, and return a number I could branch on -- not a paragraph I would have to parse. An LLM call for every transcript segment would add 1 to 2 seconds of latency and cost per decision. Strands Decider 2B answers in one forward pass, returns calibrated probabilities directly, and runs for a fraction of the cost.

I ask two questions about each transcript segment and the proposed tool call:

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
            "true":  "clear sensitive content is present (a name + contact, a financial figure "
                     "that should be off the record, legal liability language, a plain-text "
                     "password, hostile remarks)",
            "false": "the transcript is routine meeting content with nothing sensitive",
        },
    ),
}
```

The wiring in `TranscriptGuard.before_tool_call` branches on the answers:

- If `action.confidence` is below 0.65, the call goes to `Confirm` (human review) rather than proceeding or blocking.
- If the decider chose STAY_SILENT but `contains_sensitive` is yes, that also goes to `Confirm` -- a safety gate for the cases where the agent would have stayed quiet over something it should have flagged.
- If the chosen action does not match the tool being called (the LLM tried to `interject` when the decider said `TAKE_NOTE`), the guard sends it back with `Guide` and specific feedback.
- Only when action confidence is high and the action matches the tool does the call `Proceed`.

A guided call retried unchanged is `Deny`-ed, so the intervention always converges.

## Measured

The numbers below come from `.\kit.cmd bench --split test` run against the Hush eval cases in `agent/eval_cases.jsonl` (24 labelled cases, 12 held out for the test split). The decider ran via the AWS User Group Madurai hosted API. The LLM baseline used Amazon Nova Pro on Amazon Bedrock.

<!-- BENCH TABLE: run .\kit.cmd bench --split tune then --split test, then paste submission/bench/results.md here -->
<!-- Example of what the table will look like:

| | Strands Decider 2B | us.amazon.nova-pro-v1:0 |
|---|---|---|
| Accuracy | XX.X% | XX.X% |
| Latency p50 per decision | XXX ms | X,XXX ms |
| Latency p95 | XXX ms | X,XXX ms |
| Cost per 1,000 decisions | $0.0350 | $X.XXXX |
| Answered alone at confidence >= 0.7 | XX% | 100% |
| Accuracy when confident | XX.X% | XX.X% |

At the median the decider was X.Xx faster than the LLM.
-->

Key things to watch in the results:

- The decider handles INTERJECT vs TAKE_NOTE vs STAY_SILENT as a 3-way choice, which is harder than the binary noul questions in the kit example. The per-question accuracy on `action` shows how well the option descriptions are tuned.
- `contains_sensitive` is a noul question and typically easier for the decider; high accuracy here means the safety gate is reliable.
- Cases with `action.confidence` below 0.65 go to human review. The "answered alone" row shows what share the decider handles without a human, and the "accuracy when confident" row shows how accurate it is on those cases.

< FIGURE 3 of 3: upload submission/article/img/bench-confidence.png here >
Alt text: Accuracy vs share of decisions answered alone as the confidence threshold moves, for Strands Decider 2B and the Bedrock LLM baseline

## The reusable decision pattern

The full pattern lives in [`agent/decision.py`](agent/decision.py), headed `REUSABLE DECISION PATTERN: meeting copilot action guard (#guardrails)`. It includes the typed questions and their option descriptions, the `TranscriptGuard` InterventionHandler wiring, and step-by-step reuse instructions.

To drop it into another agent:

1. Copy `agent/decision.py` to your project.
2. Replace INTERJECT / TAKE_NOTE / STAY_SILENT with the actions that suit your domain.
3. Keep `contains_sensitive` or replace it with your own safety gate noul question.
4. Set `GUARDED_TOOLS` to the names of your action tools.
5. Tune `CONFIDENT` (default 0.65) to match your risk tolerance.
6. Pass `TranscriptGuard(Decider())` in your `Agent`'s `interventions=` list.

The shape -- choice over actions, noul safety gate, low-confidence to Confirm -- works anywhere you need an agent to decide between acting, recording, or waiting before every tool call that produces visible output.

## What I learned and what is next

The hardest part was writing the option descriptions for the choice question. The difference between INTERJECT and TAKE_NOTE is a judgement call, and the decider does better when the descriptions give concrete examples ("a plain-text password shared verbally") rather than abstract criteria. Running `.\kit.cmd bench --split tune` and adjusting the descriptions before looking at the test split made the accuracy numbers honest.

What is next: streaming transcript input (WebSocket from a real meeting tool), a session-level memory of all notes taken, and tuning on a larger eval set with more near-miss cases between INTERJECT and TAKE_NOTE.

---

Code: (add GitHub repo link) . Video: (add YouTube/Vimeo link) . Tags: #strands-decider-2b #guardrails

Built with the AWS User Group Madurai Strands Decider hackathon kit
