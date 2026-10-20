# Hush: AI meeting copilot

- **Pitch:** An AI copilot that listens to live meeting transcripts and decides — before acting —
  whether to interject with a suggestion, take a silent note, or stay quiet.
- **Who it is for:** Teams that want a copilot present in every meeting: catching sensitive
  disclosures, flagging missed action items, and recording decisions — without interrupting the
  flow unless it genuinely matters.
- **Features:**
  - analyse transcript segments and extract action items in real time
  - choose INTERJECT, TAKE_NOTE, or STAY_SILENT using Strands Decider 2B
  - interject with a concise, actionable suggestion when the meeting needs it
  - take a silent structured note (decision, commitment, risk, PII flag, action item)
  - low-confidence choices go to human review rather than acting automatically
  - sensitive content detected with STAY_SILENT triggers a human confirmation
  - live decision panel in the demo UI shows every probability and verdict
  - deployed on Amazon Bedrock AgentCore Runtime
- **The decision handed to Strands Decider 2B:** for each transcript segment, which of
  INTERJECT / TAKE_NOTE / STAY_SILENT is warranted, plus whether the content is sensitive.
  (`#guardrails`)
- **Why a decision model:** the choice must be made on every transcript segment, so it must be
  fast, cheap, and return a calibrated probability the code can branch on. One forward pass of
  Strands Decider 2B answers both questions simultaneously.
- **Amazon Bedrock:** the conversation, suggestions, note text, and analysis
  (Amazon Nova Pro by default; configurable via `BEDROCK_MODEL_ID` in `.env`).
- **Pattern tag:** `#guardrails`
- **Built with:** AWS User Group Madurai Strands Decider hackathon kit
