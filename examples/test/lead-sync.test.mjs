// Example test suite: behavior + contract coverage for the lead-sync blueprint.
// Run with `node --test` from the repo root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runBlueprint, lintBlueprint, checkContracts } from "@make-testkit/engine";
import { makeState, handlers, contracts } from "../handlers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const bp = JSON.parse(readFileSync(resolve(HERE, "../blueprints/lead-sync.json"), "utf8"));

test("behavior: only New leads with an email get pushed + written back", async () => {
  const ctx = { state: makeState(), handlers };
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "success");
  assert.deepEqual([...ctx.state.pushed], ["ada@example.com"]); // L2 no email, L3 not New
  assert.equal(ctx.state.leads.find((l) => l.id === "L1").syncState, "Pushed");
});

test("behavior: re-run is idempotent (deduplicate flag tolerates the second push)", async () => {
  const ctx = { state: makeState(), handlers };
  ctx.state.pushed.add("ada@example.com"); // simulate a prior run
  const res = await runBlueprint(bp, ctx);
  assert.equal(res.status, "success"); // dedup -> no throw
});

test("lint: the example blueprint is structurally clean", () => {
  const errors = lintBlueprint(bp).filter((f) => f.level === "error");
  assert.deepEqual(errors, []);
});

test("contracts: all config-drift guards hold", () => {
  const { ok, results } = checkContracts(bp, contracts);
  assert.equal(ok, true, JSON.stringify(results.filter((r) => !r.ok), null, 2));
});
