---
description: Run a Make.com blueprint test suite and summarize results
argument-hint: "<project or test directory> [test-name-pattern]"
---

Run the blueprint test suite in: `$ARGUMENTS`

Use the `run_testsuite` MCP tool with `cwd` set to the directory. If the user
gave a filter word, pass it as `testNamePattern`.

Report pass/fail counts. If anything failed, list the failing test names and
quote the relevant part of the output tail, then suggest the likely cause
(a dropped guard, a changed mapper, or a handler/stub mismatch).
