// Generic Make builtin module handlers — app-agnostic plumbing modules that
// behave identically across every scenario. App/service modules (Airtable,
// HTTP APIs, LLMs, ...) are NOT here: register those in ctx.handlers, or stub
// them per test so every external assumption stays explicit.
//
// A handler receives { mod, mapped, bundles, ctx } and returns a bundle
// object, an array of bundles (fan-out), or undefined (-> one empty bundle).
// Set `handler.raw = true` to receive the un-rendered mapper.
//
// builtin:BasicRouter, builtin:BasicAggregator and the error directives
// (Resume/Ignore/Break/Commit/Rollback) are interpreted structurally by the
// interpreter, so they intentionally have no entry here.

export const builtins = {
  // Set multiple variables -> single bundle of name/value pairs.
  "util:SetVariables": ({ mapped }) => {
    const out = {};
    for (const v of mapped.variables ?? []) out[v.name] = v.value;
    return out;
  },
  // Set a single variable.
  "util:SetVariable2": ({ mapped }) => ({ [mapped.name]: mapped.value }),

  // Parse JSON text into a bundle.
  "json:ParseJSON": ({ mapped }) => JSON.parse(mapped.json),
  // Serialize a value to a JSON string.
  "json:CreateJSON": ({ mapped }) => ({ json: JSON.stringify(mapped) }),

  // Iterator / feeder: fan a single array bundle into N bundles.
  "builtin:BasicFeeder": ({ mapped }) => {
    const arr = mapped.array ?? [];
    return Array.isArray(arr) ? arr.map((x) => (typeof x === "object" ? x : { value: x })) : [arr];
  },
  "builtin:BasicIterator": ({ mapped }) => {
    const arr = mapped.array ?? [];
    return Array.isArray(arr) ? arr.map((x) => (typeof x === "object" ? x : { value: x })) : [arr];
  },

  // Instant-trigger modules: emit the supplied trigger bundle.
  "gateway:CustomWebHook": ({ ctx }) => ctx.trigger ?? {},
  "gateway:CustomMailHook": ({ ctx }) => ctx.trigger ?? {},

  // Sleep is a no-op in the simulator (deterministic, instant).
  "builtin:sleep": () => ({}),
};
