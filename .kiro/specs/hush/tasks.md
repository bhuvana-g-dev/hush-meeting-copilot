# Hush — Implementation Tasks

## Done (implemented by Kiro)
- [x] `agent/decision.py` — TranscriptGuard with labelled REUSABLE DECISION PATTERN docstring
- [x] `agent/tools.py` — 6 tools (parse, extract, summarise; flag, redact, escalate)
- [x] `agent/agent.py` — HackathonAgent with stable chat() interface
- [x] `agent/AGENT.md` — agent description and pattern tag
- [x] `agent/features.yaml` — AgentCore features (both off)
- [x] `agent/demo_script.yaml` — 4-turn demo script for video
- [x] `agent/eval_cases.jsonl` — 24 cases, 12 tune + 12 test
- [x] `demo/static/index.html` — title and placeholder updated for Hush
- [x] `.env` — config template (no secrets)
- [x] `.kiro/specs/hush/` — requirements, design, tasks

## Remaining (requires credentials / runtime)
- [ ] Fill `DECIDER_API_KEY` in `.env` (UGMDU key from https://www.awsugmdu.in)
- [ ] Run `.\kit.cmd test` and fix any failures
- [ ] Run `.\kit.cmd bench --split tune` then `.\kit.cmd bench --split test`
- [ ] Run `.\kit.cmd check` and fix all FAILs
- [ ] Update README.md with real measured numbers
- [ ] Run `.\kit.cmd article` and review draft
- [ ] Run `.\kit.cmd video` and verify output
- [ ] Configure AWS credentials and run `.\kit.cmd deploy`
- [ ] Run `.\kit.cmd publish <repo-name>`
- [ ] Submit repo link, article link, video link before deadline
