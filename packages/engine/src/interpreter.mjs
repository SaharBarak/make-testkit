// Blueprint interpreter: executes a Make blueprint's flow against in-memory
// state, reproducing real Make execution semantics — including FAILURE
// semantics — so a scenario that would fail live fails here too.
//
// Modeled behavior (sources: help.make.com error-handling/aggregator/router
// docs + integromat/imt-proto):
// - Bundles process serially, depth-first (bundle N+1 starts after N finishes).
// - Module error, no `onerror` route: run stops; status "error" (rollback) —
//   or, when scenario setting dlq=true and the error is NOT on the first
//   module, an incomplete execution is stored and the run is a "warning".
// - `onerror` route runs with the error exposed as {{failedId.error.message}}.
//   Route modules keep their filters; the route's effect is decided by the
//   directive it reaches: Resume (substitute output, continue), Ignore (drop
//   bundle, continue), Break (store incomplete execution, run = warning),
//   Commit (halt run, success), Rollback (halt run, error). If a filter blocks
//   the route before any directive, default (unhandled) semantics apply.
// - Aggregator collects every bundle that reaches it during the run and emits
//   ONE bundle { array, __IMTAGGLENGTH__ } afterwards — even when zero bundles
//   arrived (empty aggregate), unless stopOnEmpty.
// - createScenarioRunner() tracks consecutive failed runs: scheduling disables
//   after `maxErrors` (default 3) consecutive errors; instant (webhook)
//   scenarios disable on the FIRST error. Warnings never disable.
import { renderDeep, render } from "./iml.mjs";
import { passesFilter } from "./filters.mjs";
import { builtins } from "./builtins.mjs";

const DIRECTIVES = new Set([
  "builtin:Resume", "builtin:Ignore", "builtin:Break", "builtin:Commit", "builtin:Rollback",
]);

class ModuleError extends Error {
  constructor(mod, cause) {
    super(cause.message);
    this.moduleId = mod.id;
    this.moduleName = mod.module;
    this.cause = cause;
  }
}
class HaltRun extends Error {
  constructor(status, error = null) { super(`halt:${status}`); this.status = status; this.runError = error; }
}
class DirectiveSignal extends Error {
  constructor(mod, bundles) { super(`directive:${mod.module}`); this.mod = mod; this.bundles = bundles; }
}

const scenarioMeta = (bp) => bp.metadata ?? bp.blueprint?.metadata ?? {};

/**
 * Execute a blueprint once.
 * @param bp   Make blueprint JSON ({ flow, metadata } or { blueprint: {...} }).
 * @param ctx  { state?, handlers?, stubs?, trigger?, bundles?, trace? }
 *   - handlers: map of module-key -> handler({ mod, mapped, bundles, ctx }).
 *     Merged over the generic builtins; a trailing "*" key matches by prefix.
 *   - stubs: map of module-id -> fn, takes precedence over handlers (canned I/O).
 *   - trigger: bundle returned by webhook/mailhook trigger modules.
 * @returns run result { status, error, dlq, trace, warning }.
 */
export async function runBlueprint(bp, ctx = {}) {
  const flow = bp.flow ?? bp.blueprint?.flow;
  if (!Array.isArray(flow)) throw new Error("runBlueprint: blueprint has no flow array");
  const settings = scenarioMeta(bp).scenario ?? {};
  ctx.trace = ctx.trace ?? [];
  ctx.handlers = { ...builtins, ...(ctx.handlers ?? {}) };
  ctx.run = {
    status: "success", error: null, dlq: [], trace: ctx.trace,
    warning: false, dlqEnabled: settings.dlq === true, firstModuleId: flow[0]?.id,
  };
  ctx.aggs = registerAggregators(flow);

  try {
    await runFlow(flow, { ...(ctx.bundles ?? {}) }, ctx);
    await flushAggregators(ctx);
  } catch (e) {
    if (e instanceof HaltRun) {
      ctx.run.status = e.status;
      ctx.run.error = e.runError;
    } else if (e instanceof ModuleError) {
      // Unhandled module error: incomplete execution when dlq is on and the
      // failure is mid-run (never for the first module — real Make rule);
      // otherwise the run fails and ACID changes roll back.
      if (ctx.run.dlqEnabled && e.moduleId !== ctx.run.firstModuleId) {
        ctx.run.dlq.push({ moduleId: e.moduleId, module: e.moduleName, message: e.message });
        ctx.run.warning = true;
      } else {
        ctx.run.status = "error";
        ctx.run.error = { moduleId: e.moduleId, module: e.moduleName, message: e.message };
      }
    } else throw e; // interpreter bug or unsupported semantics — fail loudly
  }
  if (ctx.run.status === "success" && ctx.run.warning) ctx.run.status = "warning";
  return ctx.run;
}

// Track consecutive-error auto-disable across runs, like the live scheduler.
export function createScenarioRunner(bp) {
  const meta = scenarioMeta(bp);
  const maxErrors = meta.scenario?.maxErrors ?? 3;
  const instant = meta.instant === true;
  let consecutive = 0;
  return {
    disabled: false,
    runs: [],
    async run(ctx) {
      if (this.disabled) throw new Error("scenario is disabled (consecutive-error limit reached)");
      const res = await runBlueprint(bp, ctx);
      this.runs.push(res);
      if (res.status === "error") {
        consecutive += 1;
        if (instant || consecutive >= maxErrors) this.disabled = true;
      } else consecutive = 0;
      return res;
    },
  };
}

function registerAggregators(flow, map = new Map()) {
  flow.forEach((mod, i) => {
    if (mod.module === "builtin:BasicAggregator")
      map.set(mod.id, { mod, post: flow.slice(i + 1), items: [], baseBundles: null });
    for (const route of mod.routes ?? []) registerAggregators(route.flow ?? [], map);
  });
  return map;
}

async function flushAggregators(ctx) {
  for (const agg of ctx.aggs.values()) {
    const { mod, post, items, baseBundles } = agg;
    if (!items.length && mod.parameters?.stopOnEmpty) {
      ctx.trace.push({ id: mod.id, module: mod.module, bundles: 0, stoppedOnEmpty: true });
      continue;
    }
    const out = { array: items, __IMTAGGLENGTH__: items.length };
    ctx.trace.push({ id: mod.id, module: mod.module, bundles: 1, aggregated: items.length });
    await runFlow(post, { ...(baseBundles ?? ctx.bundles ?? {}), [mod.id]: out }, ctx);
  }
}

async function runFlow(flow, bundles, ctx) {
  const [head, ...rest] = flow;
  if (!head) return;

  if (DIRECTIVES.has(head.module)) throw new DirectiveSignal(head, bundles);

  if (head.module === "builtin:BasicRouter") {
    // Routes run sequentially per bundle; route conditions live in the filter
    // of each route's first module.
    for (const route of head.routes ?? []) await runFlow(route.flow ?? [], { ...bundles }, ctx);
    return;
  }

  if (head.module === "builtin:BasicAggregator") {
    const agg = ctx.aggs.get(head.id);
    agg.baseBundles ??= { ...bundles };
    agg.items.push(renderDeep(head.mapper ?? {}, bundles));
    return; // post-aggregator flow runs once, in flushAggregators
  }

  const outputs = await execModule(head, bundles, ctx); // bundles array, or null (filtered / dropped)
  if (outputs === null) return;
  for (const out of outputs) {
    await runFlow(rest, { ...bundles, [head.id]: out }, ctx);
  }
}

async function execModule(mod, bundles, ctx) {
  if (mod.filter && !passesFilter(mod.filter, bundles)) {
    ctx.trace.push({ id: mod.id, module: mod.module, filtered: true });
    return null;
  }
  let out;
  try {
    out = await invoke(mod, bundles, ctx);
  } catch (e) {
    if (e instanceof HaltRun || e instanceof DirectiveSignal) throw e;
    ctx.trace.push({ id: mod.id, module: mod.module, error: e.message });
    return handleModuleError(mod, e, bundles, ctx);
  }
  const arr = out === undefined ? [{}] : Array.isArray(out) ? out : [out];
  ctx.trace.push({ id: mod.id, module: mod.module, bundles: arr.length });
  return arr;
}

async function invoke(mod, bundles, ctx) {
  // Test stub takes precedence (e.g. canned LLM output) — a stub that throws
  // simulates the third-party module erroring.
  if (ctx.stubs?.[mod.id])
    return ctx.stubs[mod.id]({ bundles, mod, ctx, render: (t) => render(t, bundles) });
  const key = mod.module;
  const handler =
    ctx.handlers[key] ??
    ctx.handlers[Object.keys(ctx.handlers).find((k) => k.endsWith("*") && key.startsWith(k.slice(0, -1))) ?? ""];
  if (!handler)
    throw new Error(`interpreter: no handler for module ${key} (mod ${mod.id}) — register one in ctx.handlers or pass a stub`);
  // A handler may opt out of IML pre-rendering (e.g. log sinks carrying deeply
  // escaped JSON the IML subset can't render) via handler.raw = true.
  const mapped = handler.raw ? (mod.mapper ?? {}) : renderDeep(mod.mapper ?? {}, bundles);
  return handler({ mod, mapped, bundles, ctx });
}

async function handleModuleError(mod, err, bundles, ctx) {
  if (!Array.isArray(mod.onerror) || !mod.onerror.length) throw new ModuleError(mod, err);

  // Error route: error is addressable as {{failedId.error.message}}.
  const errBundles = { ...bundles, [mod.id]: { error: { message: err.message } } };
  let directive = null;
  try {
    await runFlow(mod.onerror, errBundles, ctx);
  } catch (e) {
    if (!(e instanceof DirectiveSignal)) throw e;
    directive = e;
  }
  if (!directive) throw new ModuleError(mod, err); // route never reached a directive

  const d = directive.mod;
  ctx.trace.push({ id: d.id, module: d.module, handled: mod.id });
  switch (d.module) {
    case "builtin:Resume": // substitute output from the directive's mapper
      return [renderDeep(d.mapper ?? {}, directive.bundles)];
    case "builtin:Ignore": // drop this bundle, keep processing the rest
      return null;
    case "builtin:Break": { // incomplete execution; run becomes a warning
      if (!ctx.run.dlqEnabled)
        ctx.trace.push({ id: d.id, module: d.module, note: "Break without dlq enabled — live Make requires incomplete-executions storage" });
      ctx.run.dlq.push({ moduleId: mod.id, module: mod.module, message: err.message });
      ctx.run.warning = true;
      return null;
    }
    case "builtin:Commit":
      throw new HaltRun("success");
    case "builtin:Rollback":
      throw new HaltRun("error", { moduleId: mod.id, module: mod.module, message: err.message });
    default:
      throw new ModuleError(mod, err);
  }
}
