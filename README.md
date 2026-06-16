# make-testkit

**Test [Make.com](https://www.make.com) (Integromat) scenarios offline — no account, no network, no waiting on a real run to find out a mapper was wrong.**

Make scenarios are real software: filters, routers, iterators, aggregators, IML
formulas, and error-handling routes. But they live in a web UI with no unit
tests, so a dropped guard or a typo in a `{{...}}` mapper ships silently and you
find out when leads get double-pushed or an email goes out blank.

make-testkit runs your **exported blueprint JSON** through an engine that
reproduces Make's execution semantics — including failure semantics — so you can
assert behavior in CI the same way you would any other code.

```
┌─────────────────┐   ┌──────────────────┐   ┌────────────────────┐
│ @make-testkit/   │   │ @make-testkit/    │   │ Claude Code plugin  │
│ engine           │──▶│ mcp (MCP server)  │──▶│ (slash commands)    │
│ run · eval · lint│   │ 4 tools over stdio│   │ /make-iml /make-… │
└─────────────────┘   └──────────────────┘   └────────────────────┘
```

## What's in the box

- **`@make-testkit/engine`** — the core. An IML expression evaluator, Make filter
  operators, an Airtable `filterByFormula` evaluator, a blueprint interpreter
  that models routers / aggregators / iterators and the five error directives
  (Resume, Ignore, Break, Commit, Rollback) plus consecutive-error auto-disable,
  and a static **linter + contract checker**.
- **`@make-testkit/mcp`** — a Model Context Protocol server exposing four tools:
  `eval_iml`, `simulate_blueprint`, `lint_blueprint`, `run_testsuite`.
- **Claude Code plugin** — `/make-iml`, `/make-simulate`, `/make-lint`,
  `/make-test`, wired to the MCP server.

## Quickstart

```bash
git clone https://github.com/SaharBarak/make-testkit
cd make-testkit
npm install
npm run build   # builds the MCP server
npm test        # runs the engine + example suites
```

### Use the engine

```js
import { runBlueprint, lintBlueprint, checkContracts } from "@make-testkit/engine";
import { makeState, handlers, contracts } from "./examples/handlers.mjs";
import bp from "./examples/blueprints/lead-sync.json" with { type: "json" };

// 1. simulate a run
const ctx = { state: makeState(), handlers };
const res = await runBlueprint(bp, ctx);
console.log(res.status);          // "success" | "warning" | "error"
console.log(ctx.state.pushed);    // what the scenario actually did

// 2. lint for structural defects
console.log(lintBlueprint(bp));   // unresolved refs, duplicate ids, …

// 3. pin behavior with config-drift contracts
console.log(checkContracts(bp, contracts).ok);
```

Your service modules (Airtable, an HTTP API, an LLM, …) are plugged in as
`handlers` keyed by Make module name, or **stubbed per test** so every external
assumption stays explicit. Builtins (router, aggregator, iterator,
set-variables, JSON, webhooks) work out of the box.

### Use it from Claude Code

```
/plugin marketplace add SaharBarak/make-testkit
/plugin install make-testkit@make-testkit
```

Then, in any project that has Make blueprints:

```
/make-lint ./scenarios/lead-sync.json ./scenarios/contracts.mjs
/make-simulate ./scenarios/lead-sync.json ./scenarios/handlers.mjs
/make-iml {{lower(trim(1.Email))}}
```

### Use the MCP server directly

Add to any MCP client (e.g. `claude mcp add`):

```json
{
  "mcpServers": {
    "make-testkit": { "command": "node", "args": ["/abs/path/make-testkit/packages/mcp/dist/index.js"] }
  }
}
```

## How it models Make

The interpreter follows the documented Make execution model: bundles process
serially depth-first; a module error with no `onerror` route stops the run
(rollback) — unless the scenario has DLQ enabled and the error is mid-run, in
which case it stores an incomplete execution and the run is a *warning*; error
routes expose `{{failedId.error.message}}` and resolve to whichever directive
they reach; aggregators emit a single `{ array, __IMTAGGLENGTH__ }` bundle even
when empty. See `packages/engine/src/interpreter.mjs` for the full notes.

It is a faithful **subset** — it covers the module types and IML functions real
scenarios use, and fails loudly on anything it doesn't model rather than
guessing. Extend it with `registerFunction`, `registerOperator`, and your own
handlers.

## Docs

Full guide and API: **https://saharbarak.github.io/make-testkit/**

## License

MIT © Sahar Barak
