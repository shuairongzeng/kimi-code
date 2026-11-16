---
"@zimi-ai/zimi-code": minor
---

Auto-configure a provider from just its API URL and key: `POST /api/v1/providers` with `discover: true` now detects the wire protocol, pulls the model list, and fills in context sizes and reasoning levels, writing nothing when the endpoint cannot be probed; `POST /api/v1/agents/discover-models` additionally returns the detected protocol and per-model reasoning levels.
