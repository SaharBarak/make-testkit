// Airtable filterByFormula evaluator — the subset real scenarios use.
// Supports: AND OR NOT LOWER UPPER FIND ARRAYJOIN TRUE FALSE BLANK
// REGEX_REPLACE, {Field} references, "string" literals, numbers,
// comparisons (= != > < >= <=), and `&` concatenation.
//
// Returns a boolean (the formula's truthiness), matching how Airtable uses
// filterByFormula to keep/drop records.

const truthyA = (v) => !(v === undefined || v === null || v === "" || v === false || v === 0);

export function evalFormula(formula, fields) {
  let pos = 0;
  const src = formula;
  const ws = () => { while (/\s/.test(src[pos] ?? "")) pos++; };

  function parseCompare() {
    const l = parseConcat();
    ws();
    const m = src.slice(pos).match(/^(!=|>=|<=|=|>|<)/);
    if (!m) return l;
    pos += m[1].length;
    const r = parseConcat();
    const [a, b] = [l, r];
    switch (m[1]) {
      case "=": return String(a ?? "") === String(b ?? "");
      case "!=": return String(a ?? "") !== String(b ?? "");
      case ">": return Number(a) > Number(b);
      case "<": return Number(a) < Number(b);
      case ">=": return Number(a) >= Number(b);
      case "<=": return Number(a) <= Number(b);
    }
  }
  function parseConcat() {
    let v = parseAtom(); ws();
    while (src[pos] === "&") { pos++; v = String(v ?? "") + String(parseAtom() ?? ""); ws(); }
    return v;
  }
  function args() {
    const out = [];
    pos++; ws(); // (
    if (src[pos] === ")") { pos++; return out; }
    for (;;) {
      out.push(parseCompare()); ws();
      if (src[pos] === ",") { pos++; ws(); continue; }
      if (src[pos] === ")") { pos++; break; }
      throw new Error(`formula: bad char '${src[pos]}' @${pos}: ${src}`);
    }
    return out;
  }
  function parseAtom() {
    ws();
    if (src[pos] === '"') {
      pos++; let out = "";
      while (pos < src.length && src[pos] !== '"') {
        if (src[pos] === "\\") { out += src[pos + 1]; pos += 2; } else out += src[pos++];
      }
      pos++; return out;
    }
    if (src[pos] === "{") {
      const end = src.indexOf("}", pos);
      const name = src.slice(pos + 1, end); pos = end + 1;
      return fields[name];
    }
    const m = src.slice(pos).match(/^[A-Z_]+/);
    if (m && src[pos + m[0].length] === "(") {
      pos += m[0].length;
      const fn = m[0]; const a = args();
      switch (fn) {
        case "AND": return a.every((x) => truthyA(x));
        case "OR": return a.some((x) => truthyA(x));
        case "NOT": return !truthyA(a[0]);
        case "LOWER": return String(a[0] ?? "").toLowerCase();
        case "UPPER": return String(a[0] ?? "").toUpperCase();
        case "TRUE": return true;
        case "FALSE": return false;
        case "BLANK": return "";
        case "FIND": { const i = String(a[1] ?? "").indexOf(String(a[0] ?? "")); return i < 0 ? 0 : i + 1; }
        case "ARRAYJOIN": return Array.isArray(a[0]) ? a[0].join(",") : String(a[0] ?? "");
        case "REGEX_REPLACE": return String(a[0] ?? "").replace(new RegExp(String(a[1]), ""), String(a[2] ?? ""));
        default: throw new Error(`formula: unsupported fn ${fn}`);
      }
    }
    const num = src.slice(pos).match(/^-?\d+(\.\d+)?/);
    if (num) { pos += num[0].length; return Number(num[0]); }
    throw new Error(`formula: cannot parse @${pos}: ${src.slice(pos, pos + 30)}`);
  }
  const out = parseCompare();
  return truthyA(out);
}
