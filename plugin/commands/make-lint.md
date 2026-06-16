---
description: Lint a Make.com blueprint and check config-drift contracts
argument-hint: "<path to blueprint .json> [contracts module]"
---

Lint the Make blueprint at: `$ARGUMENTS`

Use the `lint_blueprint` MCP tool with the blueprint path. If the user has a
contracts module (config-drift guards), pass it as `contractsModule`.

Summarize:
- structural errors (duplicate ids, unresolved `{{N.…}}` references) — these
  block; explain each and the fix.
- warnings (unknown filter operators, dangling onerror routes, thin routers,
  terminal aggregators) — note which are intentional vs worth fixing.
- contract results — for any failed contract, quote its message and point at the
  module that drifted.

End with a one-line verdict: safe to deploy or not.
