---
description: Simulate a Make.com blueprint run offline and explain the trace
argument-hint: "<path to blueprint .json> [handlers module]"
---

Simulate the Make blueprint at: `$ARGUMENTS`

1. Use the `simulate_blueprint` MCP tool. Pass the blueprint path as `blueprint`.
   If the scenario uses non-builtin service modules (anything that isn't a
   router/aggregator/iterator/set-variables/json/webhook), it needs a
   `handlersModule` — ask the user for the path to an `.mjs` exporting
   `handlers`, or point at `examples/handlers.mjs` to demo.
2. Report the run `status` (success / warning / error), any `error`, and the
   `dlq` (incomplete executions).
3. Walk the `trace` to explain what each module did — which bundles were
   filtered, which fanned out, where it errored or was handled by a directive.

If the run errors, identify the failing module from the trace and explain why.
