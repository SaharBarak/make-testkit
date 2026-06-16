import { test } from "node:test";
import assert from "node:assert/strict";
import { render, renderDeep, evalFormula, passesFilter, registerFunction } from "../src/index.mjs";

test("render: resolves module path and keeps native type for full-string expr", () => {
  const b = { 1: { Email: "A@B.com" }, 2: { n: 3 } };
  assert.equal(render("{{1.Email}}", b), "A@B.com");
  assert.equal(render("{{2.n}}", b), 3); // number preserved
});

test("render: nested functions + concat", () => {
  const b = { 1: { name: "  Vish Bohara " } };
  assert.equal(render("{{lower(first(split(trim(1.name); space)))}}", b), "vish");
  assert.equal(render("hi {{1.name}}!", b).trim(), "hi   Vish Bohara !".trim());
});

test("render: ifempty + arithmetic + comparison", () => {
  const b = { 1: { a: "", n: 10 } };
  assert.equal(render("{{ifempty(1.a; 'fallback')}}", b), "fallback");
  assert.equal(render("{{1.n + 5}}", b), 15);
  assert.equal(render("{{1.n > 5}}", b), true);
});

test("render: backticked field names with spaces", () => {
  const b = { 20: { "Lemlist Campaign ID": "cmp_1" } };
  assert.equal(render("{{20.`Lemlist Campaign ID`}}", b), "cmp_1");
});

test("registerFunction: custom IML function is usable", () => {
  registerFunction("shout", (x) => String(x).toUpperCase() + "!");
  assert.equal(render("{{shout('hi')}}", {}), "HI!");
});

test("renderDeep: renders every string leaf", () => {
  const b = { 1: { email: "x@y.z" } };
  const out = renderDeep({ to: "{{1.email}}", meta: { tag: "lead-{{1.email}}" } }, b);
  assert.deepEqual(out, { to: "x@y.z", meta: { tag: "lead-x@y.z" } });
});

test("passesFilter: OR of ANDed conditions", () => {
  const filter = { conditions: [[{ a: "{{1.s}}", o: "text:equal", b: "New" }, { a: "{{1.e}}", o: "text:empty" }]] };
  assert.equal(passesFilter(filter, { 1: { s: "New", e: "" } }), true);
  assert.equal(passesFilter(filter, { 1: { s: "New", e: "x" } }), false);
});

test("evalFormula: Airtable subset", () => {
  const f = { Status: "New", "Lemlist Status": "", Email: "A@B.com" };
  assert.equal(evalFormula('AND({Status}="New", {Lemlist Status}="")', f), true);
  assert.equal(evalFormula('LOWER({Email})="a@b.com"', f), true);
  assert.equal(evalFormula('NOT({Status}="Contacted")', f), true);
});
