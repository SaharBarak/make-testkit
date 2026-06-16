// Example handler set + contracts for the lead-sync blueprint.
//
// This is the pattern every project follows: model your service modules as a
// tiny in-memory store + handlers, plug them into runBlueprint via ctx, and
// pin behavior with contracts. Everything here is synthetic — no real service,
// no real data.

/** Fresh in-memory store for one run/test. */
export function makeState() {
  return {
    leads: [
      { id: "L1", name: "Ada", email: "ADA@example.com", status: "New" },
      { id: "L2", name: "Grace", email: "", status: "New" },          // no email -> skip route
      { id: "L3", name: "Edsger", email: "edsger@example.com", status: "Contacted" }, // not New -> not selected
    ],
    pushed: new Set(),
    log: [],
  };
}

/** Module-key -> handler. Builtins (router, set-variables) come from the engine. */
export const handlers = {
  "demo:SearchLeads": ({ mapped, ctx }) => {
    const rows = ctx.state.leads.filter((l) => !mapped.status || l.status === mapped.status);
    return rows.length ? rows.map((r) => ({ ...r, __IMTLENGTH__: rows.length })) : [];
  },
  "demo:DedupKey": ({ mapped }) => ({ key: mapped.key }),
  "demo:PushLead": ({ mapped, ctx }) => {
    const email = String(mapped.email ?? "").toLowerCase();
    if (ctx.state.pushed.has(email)) {
      if (mapped.deduplicate) return { email, deduplicated: true };
      throw new Error(`lead already pushed: ${email}`);
    }
    ctx.state.pushed.add(email);
    ctx.state.log.push({ op: "push", email });
    return { email, ok: true };
  },
  "demo:UpdateLead": ({ mapped, ctx }) => {
    const lead = ctx.state.leads.find((l) => l.id === mapped.id);
    if (lead) Object.assign(lead, mapped.fields);
    ctx.state.log.push({ op: "update", id: mapped.id, fields: mapped.fields });
    return { id: mapped.id, ...mapped.fields };
  },
};

/** Config-drift guards: assert the scenario keeps the behavior we depend on. */
export const contracts = [
  {
    id: "selector-scopes-to-new",
    module: 1,
    assert: (m) => m.mapper.status === "New" || "selector must filter status = New",
  },
  {
    id: "dedup-lowercases-email",
    module: 2,
    assert: (m) => /lower\(/.test(m.mapper.key) || "dedup key must lowercase the email",
  },
  {
    id: "push-keeps-deduplicate-flag",
    module: 3,
    assert: (m) => m.mapper.deduplicate === true || "push must keep deduplicate=true to tolerate re-runs",
  },
  {
    id: "writeback-marks-pushed",
    module: 4,
    assert: (m) => m.mapper.fields?.syncState === "Pushed" || "must write syncState=Pushed after a successful push",
  },
];
