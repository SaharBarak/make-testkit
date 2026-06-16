import { spawn } from "node:child_process";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { render, runBlueprint, lintBlueprint, checkContracts } from "@make-testkit/engine";
import { loadBlueprint, loadHandlers, loadContracts, loadState, jsonResult, errorResult } from "./util.js";

/** eval_iml — render a Make IML expression against a bundle context. */
export function registerEvalIml(server: McpServer) {
  server.registerTool(
    "eval_iml",
    {
      title: "Evaluate IML expression",
      description:
        "Render a Make.com IML expression (the {{...}} language) against a bundle context and return the resulting value. " +
        "Use to debug a mapper formula: ifempty/lower/trim/split/join/replace/if, arithmetic, comparisons, backticked field names, and dotted module paths are supported.",
      inputSchema: {
        expression: z.string().describe("IML expression or template, e.g. {{lower(1.Email)}} or hello {{1.name}}"),
        bundles: z
          .record(z.any())
          .optional()
          .describe('Module-id -> output bundle map, e.g. {"1": {"Email": "A@B.com", "name": "Vi"}}'),
      },
    },
    async ({ expression, bundles }) => {
      try {
        const value = render(expression, (bundles ?? {}) as Record<string, unknown>);
        return jsonResult({ expression, value, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value });
      } catch (e) {
        return errorResult(`IML error: ${(e as Error).message}`);
      }
    },
  );
}

/** simulate_blueprint — execute a blueprint offline and return result + trace. */
export function registerSimulate(server: McpServer) {
  server.registerTool(
    "simulate_blueprint",
    {
      title: "Simulate a Make blueprint run",
      description:
        "Execute an exported Make.com blueprint offline through the engine, reproducing router/aggregator/iterator and error-handling semantics. " +
        "Returns the run status (success/warning/error), any error, dead-letter (incomplete) executions, and a step-by-step trace. " +
        "App/service modules need handlers: point handlersModule at an .mjs exporting `handlers` (or a factory). Builtins (router, set-variables, json, feeder, webhooks) work out of the box.",
      inputSchema: {
        blueprint: z.union([z.string(), z.record(z.any())]).describe("Blueprint as a file path, JSON string, or inline object"),
        trigger: z.record(z.any()).optional().describe("Bundle returned by the trigger module (webhook/mailhook)"),
        bundles: z.record(z.any()).optional().describe("Seed bundles available before the first module"),
        handlersModule: z.string().optional().describe("Path to an .mjs module exporting `handlers` (module-key -> handler), optionally a `makeState`/`createState` factory to seed ctx.state"),
      },
    },
    async ({ blueprint, trigger, bundles, handlersModule }) => {
      try {
        const bp = await loadBlueprint(blueprint);
        const handlers = await loadHandlers(handlersModule);
        const state = await loadState(handlersModule);
        const ctx: Record<string, unknown> = { state, handlers, trigger, bundles };
        const res = await runBlueprint(bp, ctx);
        return jsonResult(res);
      } catch (e) {
        return errorResult(`Simulation error: ${(e as Error).message}`);
      }
    },
  );
}

/** lint_blueprint — static analysis + optional contract checks. */
export function registerLint(server: McpServer) {
  server.registerTool(
    "lint_blueprint",
    {
      title: "Lint / validate a Make blueprint",
      description:
        "Statically analyze a Make.com blueprint for defects (duplicate module ids, IML references to non-existent modules, unknown filter operators, dangling error routes, thin routers, terminal aggregators) without running it. " +
        "Optionally run config-drift contracts from contractsModule to assert that hand-installed guards still exist.",
      inputSchema: {
        blueprint: z.union([z.string(), z.record(z.any())]).describe("Blueprint as a file path, JSON string, or inline object"),
        contractsModule: z.string().optional().describe("Path to an .mjs module exporting `contracts` (array) or a default factory"),
      },
    },
    async ({ blueprint, contractsModule }) => {
      try {
        const bp = await loadBlueprint(blueprint);
        const findings = lintBlueprint(bp);
        const contracts = await loadContracts(contractsModule);
        const contractReport = contracts ? checkContracts(bp, contracts) : undefined;
        const errors = findings.filter((f) => f.level === "error").length;
        return jsonResult({
          ok: errors === 0 && (contractReport?.ok ?? true),
          summary: { errors, warnings: findings.length - errors, contracts: contractReport?.results.length ?? 0 },
          findings,
          contracts: contractReport,
        });
      } catch (e) {
        return errorResult(`Lint error: ${(e as Error).message}`);
      }
    },
  );
}

/** run_testsuite — run a project's node:test suite and summarize results. */
export function registerRunTestsuite(server: McpServer) {
  server.registerTool(
    "run_testsuite",
    {
      title: "Run a Make blueprint test suite",
      description:
        "Run a project's Node test suite (`node --test`) in a target directory and return a pass/fail summary with the failing test names and output tail. " +
        "Use to verify a whole suite of blueprint contract/behavior tests after editing a scenario.",
      inputSchema: {
        cwd: z.string().describe("Directory to run the test suite in (the project or test folder)"),
        testNamePattern: z.string().optional().describe("Only run tests whose name matches this pattern (node --test-name-pattern)"),
        timeoutMs: z.number().int().positive().max(600_000).optional().describe("Kill the run after this many ms (default 120000)"),
      },
    },
    async ({ cwd, testNamePattern, timeoutMs }) => {
      const args = ["--test"];
      if (testNamePattern) args.push(`--test-name-pattern=${testNamePattern}`);
      return await new Promise((resolveP) => {
        const child = spawn("node", args, { cwd, env: process.env });
        let out = "";
        const cap = (d: Buffer) => { out += d.toString(); if (out.length > 200_000) out = out.slice(-200_000); };
        child.stdout.on("data", cap);
        child.stderr.on("data", cap);
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs ?? 120_000);
        child.on("close", (code) => {
          clearTimeout(timer);
          const m = out.match(/# pass (\d+)[\s\S]*?# fail (\d+)/);
          const fails = [...out.matchAll(/^(?:not ok|✖|✗)\s+\d*\s*(.+)$/gm)].map((x) => x[1].trim());
          resolveP(
            jsonResult({
              ok: code === 0,
              exitCode: code,
              pass: m ? Number(m[1]) : undefined,
              fail: m ? Number(m[2]) : undefined,
              failing: fails.slice(0, 50),
              outputTail: out.slice(-4000),
            }),
          );
        });
        child.on("error", (e) => { clearTimeout(timer); resolveP(errorResult(`Failed to spawn node --test: ${e.message}`)); });
      });
    },
  );
}
