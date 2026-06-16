// Blueprint static analysis: walk the flow, lint for common structural defects,
// and assert user-defined "contracts" (config-drift guards) against a blueprint.
//
// Contracts are how you pin behavior that lives in the Make UI: assert that a
// scenario still carries a dedup filter, a write-back, a freshness gate, etc.,
// so an edit in the UI that drops a guard fails CI before the next run.

const DIRECTIVES = new Set([
  "builtin:Resume", "builtin:Ignore", "builtin:Break", "builtin:Commit", "builtin:Rollback",
]);

const flowOf = (bp) => bp.flow ?? bp.blueprint?.flow ?? [];

/** Depth-first generator over every module, descending into routes and onerror. */
export function* walkModules(flow) {
  for (const mod of flow ?? []) {
    yield mod;
    for (const route of mod.routes ?? []) yield* walkModules(route.flow ?? []);
    if (Array.isArray(mod.onerror)) yield* walkModules(mod.onerror);
  }
}

/** Flat id -> module map for the whole blueprint. */
export function moduleMap(bp) {
  return new Map([...walkModules(flowOf(bp))].map((m) => [m.id, m]));
}

// Pull every {{ ... }} expression's leading module-id reference out of a value
// tree, so lint can flag references to ids that don't exist.
function* imlRefs(value) {
  if (typeof value === "string") {
    for (const m of value.matchAll(/\{\{\s*(\d+)\b/g)) yield Number(m[1]);
  } else if (Array.isArray(value)) {
    for (const v of value) yield* imlRefs(v);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) yield* imlRefs(v);
  }
}

/**
 * Lint a blueprint for structural defects. Pure structure — no execution.
 * @returns Array<{ level: "error"|"warning", code, moduleId?, message }>
 */
export function lintBlueprint(bp) {
  const findings = [];
  const flow = flowOf(bp);
  const mods = [...walkModules(flow)];
  const ids = new Set(mods.map((m) => m.id));

  // duplicate ids
  const seen = new Set();
  for (const m of mods) {
    if (seen.has(m.id)) findings.push({ level: "error", code: "duplicate-id", moduleId: m.id, message: `module id ${m.id} appears more than once` });
    seen.add(m.id);
  }

  for (const m of mods) {
    // IML references to non-existent module ids (typo'd mappings)
    for (const ref of new Set(imlRefs(m.mapper))) {
      if (!ids.has(ref))
        findings.push({ level: "error", code: "unresolved-ref", moduleId: m.id, message: `mapper references {{${ref}.…}} but module ${ref} does not exist` });
    }
    // unknown filter operators
    for (const group of m.filter?.conditions ?? []) {
      for (const cond of group) {
        if (cond.o && !KNOWN_OPS.has(cond.o))
          findings.push({ level: "warning", code: "unknown-operator", moduleId: m.id, message: `filter uses operator "${cond.o}" not in the engine's known set` });
      }
    }
    // error route that never reaches a directive = no-op error handler
    if (Array.isArray(m.onerror) && m.onerror.length) {
      const hasDirective = [...walkModules(m.onerror)].some((x) => DIRECTIVES.has(x.module));
      if (!hasDirective)
        findings.push({ level: "warning", code: "dangling-onerror", moduleId: m.id, message: `onerror route has no directive (Resume/Ignore/Break/Commit/Rollback) — error stays unhandled` });
    }
    // router with fewer than two routes
    if (m.module === "builtin:BasicRouter" && (m.routes?.length ?? 0) < 2)
      findings.push({ level: "warning", code: "thin-router", moduleId: m.id, message: `router has ${m.routes?.length ?? 0} route(s)` });
  }

  // aggregator with nothing after it in its flow level
  for (const m of flow) {
    const i = flow.indexOf(m);
    if (m.module === "builtin:BasicAggregator" && i === flow.length - 1)
      findings.push({ level: "warning", code: "terminal-aggregator", moduleId: m.id, message: `aggregator is the last module — its single output bundle is unused` });
  }

  return findings;
}

const KNOWN_OPS = new Set([
  "exist", "notexist", "text:equal", "text:equal:ci", "text:notequal", "text:contain",
  "text:contain:ci", "text:notcontain:ci", "text:empty", "text:notempty",
  "number:equal", "number:notequal", "number:greater", "number:greaterorequal",
  "number:lessorequal", "number:less", "date:equal", "boolean:equal",
  "array:greater", "array:empty", "array:notempty",
]);

/**
 * Run user-defined contracts against a blueprint.
 * @param contracts Array<{ id, module?, assert(mod|bp, bp) => true | string }>
 *   - `module` set: assert receives that module (by id); a missing module fails.
 *   - `module` unset: assert receives the whole blueprint.
 *   - assert returns true to pass, or a string describing the failure.
 * @returns { ok, results: Array<{ id, ok, message? }> }
 */
export function checkContracts(bp, contracts) {
  const mods = moduleMap(bp);
  const results = contracts.map((c) => {
    try {
      if (c.module !== undefined) {
        const mod = mods.get(c.module);
        if (!mod) return { id: c.id, ok: false, message: `module ${c.module} not found` };
        const r = c.assert(mod, bp);
        return r === true ? { id: c.id, ok: true } : { id: c.id, ok: false, message: typeof r === "string" ? r : "assertion returned false" };
      }
      const r = c.assert(bp, bp);
      return r === true ? { id: c.id, ok: true } : { id: c.id, ok: false, message: typeof r === "string" ? r : "assertion returned false" };
    } catch (e) {
      return { id: c.id, ok: false, message: e.message };
    }
  });
  return { ok: results.every((r) => r.ok), results };
}
