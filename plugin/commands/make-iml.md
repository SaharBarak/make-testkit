---
description: Evaluate a Make.com IML expression against a bundle context
argument-hint: "<iml expression> [with bundles {...}]"
---

Evaluate the Make IML expression the user provided: `$ARGUMENTS`

Use the `eval_iml` MCP tool. If the user gave example module data, pass it as the
`bundles` argument (module-id → output bundle). Report the resulting value and its
type. If the expression errors, show the parser message and suggest a fix
(common causes: unknown function, unbalanced `{{ }}`, or a module path that
doesn't exist in the provided bundles).
