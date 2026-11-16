---
"@zimi-ai/zimi-code": patch
---

Saving a model pulled from an endpoint no longer fails with "provider already exists" when that endpoint was configured before: the existing provider gains the new model and keeps its stored key, and `POST /api/v1/providers` accepts `on_existing: "merge"` for the same behavior.
