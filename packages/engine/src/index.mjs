// @make-testkit/engine — offline execution engine for Make.com blueprints.
//
// Run, evaluate, and statically analyze exported Make scenarios in pure
// Node.js, with no network and no Make account. Reproduces Make's IML
// templating, filter operators, router/aggregator/iterator semantics, and
// error-handling directives (including auto-disable on consecutive errors).
export { render, renderDeep, truthy, registerFunction } from "./iml.mjs";
export { passesFilter, registerOperator } from "./filters.mjs";
export { evalFormula } from "./formula.mjs";
export { builtins } from "./builtins.mjs";
export { runBlueprint, createScenarioRunner } from "./interpreter.mjs";
export { walkModules, moduleMap, lintBlueprint, checkContracts } from "./contracts.mjs";
