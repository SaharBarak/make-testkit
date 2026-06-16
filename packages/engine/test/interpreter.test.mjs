import { test } from "node:test";
import assert from "node:assert/strict";
import { runBlueprint, createScenarioRunner, lintBlueprint, checkContracts } from "../src/index.mjs";

// A tiny in-memory "CRM" handler set, mirroring how a real project plugs its
// own modules in. No external service, no business data — pure illustration.
function crmHandlers() {
  return {
    "demo:SearchLeads": ({ mapped, ctx }) => {
      const rows = ctx.state.leads.filter((l) => !mapped.status || l.status === mapped.status);
      return rows.length ? rows.map((l) => ({ ...l, __IMTLENGTH__: rows.length })) : [];
    },
    "demo:PushLead": ({ mapped, ctx }) => {
      if (ctx.state.pushed.has(mapped.email)) throw new Error(`already pushed ${mapped.email}`);
      ctx.state.pushed.add(mapped.email);
      ctx.state.log.push({ op: "push", email: mapped.email });
      return { email: mapped.email, ok: true };
    },
  };
}
const state = () => ({ leads: [{ email: "a@x.io", status: "New" }, { email: "b@x.io", status: "Done" }], pushed: new Set(), log: [] });

// Selector -> push. Filter keeps only "New" leads.
const pushFlow = {
  name: "demo-push",
  flow: [
    { id: 1, module: "demo:SearchLeads", mapper: { status: "New" } },
    { id: 2, module: "demo:PushLead", mapper: { email: "{{1.email}}" } },
  ],
};

test("run: happy path fans out and pushes only matching leads", async () => {
  const ctx = { state: state(), handlers: crmHandlers() };
  const res = await runBlueprint(pushFlow, ctx);
  assert.equal(res.status, "success");
  assert.deepEqual([...ctx.state.pushed], ["a@x.io"]);
});

test("run: unhandled module error -> status error (rollback semantics)", async () => {
  const ctx = { state: state(), handlers: crmHandlers() };
  ctx.state.pushed.add("a@x.io"); // force PushLead to throw
  const res = await runBlueprint(pushFlow, ctx);
  assert.equal(res.status, "error");
  assert.equal(res.error.moduleId, 2);
});

test("run: dlq=true turns a mid-run error into a warning + incomplete execution", async () => {
  const ctx = { state: state(), handlers: crmHandlers() };
  ctx.state.pushed.add("a@x.io");
  const bp = { ...pushFlow, metadata: { scenario: { dlq: true } } };
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "warning");
  assert.equal(res.dlq.length, 1);
});

test("run: onerror Ignore directive drops the failing bundle and continues", async () => {
  const ctx = { state: state(), handlers: crmHandlers() };
  ctx.state.leads.push({ email: "a@x.io", status: "New" }); // duplicate -> 2nd push throws
  const bp = {
    flow: [
      { id: 1, module: "demo:SearchLeads", mapper: { status: "New" } },
      { id: 2, module: "demo:PushLead", mapper: { email: "{{1.email}}" }, onerror: [{ id: 99, module: "builtin:Ignore" }] },
    ],
  };
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "success"); // error swallowed by Ignore
  assert.equal(ctx.state.pushed.size, 1);
});

test("router: routes run independently per bundle", async () => {
  const ctx = { state: state(), handlers: crmHandlers() };
  const bp = {
    flow: [
      { id: 1, module: "demo:SearchLeads", mapper: {} },
      { id: 10, module: "builtin:BasicRouter", routes: [
        { flow: [{ id: 2, module: "demo:PushLead", mapper: { email: "{{1.email}}" },
          filter: { conditions: [[{ a: "{{1.status}}", o: "text:equal", b: "New" }]] } }] },
        { flow: [{ id: 3, module: "util:SetVariables", mapper: { variables: [{ name: "seen", value: "{{1.email}}" }] } }] },
      ] },
    ],
  };
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "success");
  assert.deepEqual([...ctx.state.pushed], ["a@x.io"]); // only the New lead pushed
});

test("aggregator: collects bundles and emits one array bundle", async () => {
  const ctx = { state: state(), handlers: crmHandlers(), stubs: {} };
  const bp = {
    flow: [
      { id: 1, module: "demo:SearchLeads", mapper: {} },
      { id: 5, module: "builtin:BasicAggregator", mapper: { e: "{{1.email}}" } },
      { id: 6, module: "demo:PushLead", mapper: { email: "{{5.array.0.e}}", count: "{{5.__IMTAGGLENGTH__}}" } },
    ],
  };
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "success");
  const agg = res.trace.find((t) => t.id === 5);
  assert.equal(agg.aggregated, 2);
});

test("createScenarioRunner: disables after maxErrors consecutive errors", async () => {
  const bp = { ...pushFlow, metadata: { scenario: { maxErrors: 2 } } };
  const runner = createScenarioRunner(bp);
  for (let i = 0; i < 2; i++) {
    const ctx = { state: state(), handlers: crmHandlers() };
    ctx.state.pushed.add("a@x.io");
    await runner.run(ctx);
  }
  assert.equal(runner.disabled, true);
});

test("lintBlueprint: flags unresolved references and duplicate ids", () => {
  const bp = { flow: [
    { id: 1, module: "demo:SearchLeads", mapper: {} },
    { id: 1, module: "demo:PushLead", mapper: { email: "{{7.email}}" } },
  ] };
  const codes = lintBlueprint(bp).map((f) => f.code);
  assert.ok(codes.includes("duplicate-id"));
  assert.ok(codes.includes("unresolved-ref"));
});

test("checkContracts: asserts a guard survives in the blueprint", () => {
  const contracts = [
    { id: "push-uses-search-email", module: 2, assert: (m) => /\{\{1\.email\}\}/.test(m.mapper.email) || "push must map email from the search step" },
    { id: "selector-filters-new", module: 1, assert: (m) => m.mapper.status === "New" || "selector must scope to New" },
  ];
  const { ok, results } = checkContracts(pushFlow, contracts);
  assert.equal(ok, true, JSON.stringify(results));
});
