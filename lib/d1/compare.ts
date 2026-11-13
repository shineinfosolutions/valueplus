/**
 * The comparator behind shadow reads (lib/d1/shadow.ts): is D1's answer the same as MongoDB's?
 *
 * Both answers are first brought to the form the user would actually receive (JSON), then compared:
 *  - ObjectId -> its 24-hex string, Date -> ISO text, Decimal128 / Long -> number or text (as the JSON would);
 *  - a key whose value is undefined OR null counts as missing. D1 cannot tell "field absent" from "field null"
 *    (both are NULL in a column), and no screen treats the two differently;
 *  - key order is ignored (JSON objects have none);
 *  - numbers are equal when |a - b| <= 1e-9 x max(1, |a|, |b|) (D1 REAL vs Mongo double after arithmetic);
 *  - `ignorePaths`: parts of the answer that are left out of the comparison (with the reason at the call site),
 *    e.g. "data[].stockByWarehouse[]._id": the ids Mongo gives array entries, which D1 does not keep;
 *  - `unorderedPaths`: arrays whose order the API does not define (a find() without sort): compared as multisets;
 *  - `tieOrder`: arrays sorted by a key where equal keys come back in no defined order (sort by createdAt with
 *    several documents created in the same millisecond): the sequence of keys must match, and within a run of
 *    equal keys any order is accepted.
 *
 * Path patterns: dot-separated keys, "[]" for "any array index", "*" for "any key"; "" is the whole answer.
 *   "data[].billingAddress._id", "[]._id", "data"
 *
 * The result keeps only a COUNT and the first few differences, each with its path and a short, masked summary of
 * the two values: never a whole payload, and never the value of a secret field (password, PIN, token, bank account,
 * IFSC, PAN, Aadhaar, GSTIN ...).
 */
import { normalize } from "./masters-map";

export interface CompareOptions {
  ignorePaths?: string[];
  unorderedPaths?: string[];
  tieOrder?: Array<{ path: string; key: (el: any) => unknown }>;
  /**
   * Values that equal "missing" at a path: when one side lacks the field and the other holds exactly this value,
   * that is no difference. For D1 columns that cannot be absent (a boolean is 0/1, so an old document without the
   * field reads `false`), e.g. { "data[].isSerialized": false }.
   */
  defaultsWhenMissing?: Record<string, unknown>;
  /**
   * Text compared without regard to capitals at these paths. Only for values whose capitalisation depends on an
   * order MongoDB does not define (e.g. which spelling of "LG" / "lg" is met first in a find() without sort).
   */
  foldCasePaths?: string[];
  /** Relative tolerance for numbers (default 1e-9). */
  tolerance?: number;
  /** How many differences to keep as samples (default 3). The count covers all of them. */
  maxSamples?: number;
}

export interface DiffSample {
  path: string;
  mongo: string;
  d1: string;
}

export interface CompareResult {
  equal: boolean;
  diffCount: number;
  diffs: DiffSample[];
}

type Seg = string | number;
type Pattern = string[];

/** Keys whose values are never written into a diff sample. */
export const SECRET_KEY =
  /pass(word)?|^pin$|pinhash|^pin_|token|secret|otp|apikey|accountnumber|account_no|acno|ifsc|^pan$|pannumber|aadha+r|cardnumber|cvv|gstin|gstnumber|^bank_|bankdetails/i;

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

function stripNulls(v: any): any {
  if (Array.isArray(v)) return v.map(stripNulls);
  if (v && typeof v === "object") {
    const out: Record<string, any> = {};
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (x === null || x === undefined) continue;
      out[k] = stripNulls(x);
    }
    return out;
  }
  return v;
}

/**
 * The value as it would reach the user, in a stable form: what JSON.stringify would give (toJSON honoured, so
 * ObjectId / Date / mongoose documents turn into what the API returns), then null-valued keys removed and keys
 * sorted. Exported for tests and for routes that want to compare whole responses.
 */
export function canonicalize(value: unknown): any {
  if (value === undefined) return undefined;
  // Through JSON first: that is exactly what NextResponse.json sends (ObjectId.toJSON -> hex, Date -> ISO,
  // a hydrated mongoose document -> its plain fields). normalize() then sorts keys and drops undefined.
  let json: any;
  try {
    const text = JSON.stringify(value);
    json = text === undefined ? undefined : JSON.parse(text);
  } catch {
    json = normalize(value);
  }
  return stripNulls(normalize(json));
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

function parsePattern(p: string): Pattern {
  if (!p) return [];
  const out: string[] = [];
  for (const part of p.split(".")) {
    const m = part.match(/^([^[\]]*)((?:\[\])*)$/);
    if (!m) {
      out.push(part);
      continue;
    }
    if (m[1]) out.push(m[1]);
    for (let i = 0; i < m[2].length / 2; i++) out.push("[]");
  }
  return out;
}

function matches(pattern: Pattern, path: Seg[]): boolean {
  if (pattern.length !== path.length) return false;
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    const s = path[i];
    if (p === "[]") {
      if (typeof s !== "number") return false;
    } else if (p === "*") {
      if (typeof s !== "string") return false;
    } else if (p !== s) {
      return false;
    }
  }
  return true;
}

export function pathText(path: Seg[]): string {
  let out = "";
  for (const s of path) out += typeof s === "number" ? `[${s}]` : out ? `.${s}` : s;
  return out || "(root)";
}

// ---------------------------------------------------------------------------
// Masked summaries
// ---------------------------------------------------------------------------

function isSecretPath(path: Seg[]): boolean {
  return path.some((s) => typeof s === "string" && SECRET_KEY.test(s));
}

/** A short description of a value, safe to store: no secrets, no payloads. */
export function summarize(path: Seg[], v: unknown): string {
  if (v === undefined) return "(missing)";
  if (isSecretPath(path)) return "***";
  if (Array.isArray(v)) return `[array of ${v.length}]`;
  if (v && typeof v === "object") return `{object with ${Object.keys(v).length} keys}`;
  if (typeof v === "string") return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  return String(v);
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

class Walker {
  diffCount = 0;
  diffs: DiffSample[] = [];
  private ignore: Pattern[];
  private unordered: Pattern[];
  private ties: Array<{ pattern: Pattern; key: (el: any) => unknown }>;
  private defaults: Array<{ pattern: Pattern; json: string }>;
  private foldCase: Pattern[];
  private tol: number;
  private maxSamples: number;

  constructor(opts: CompareOptions) {
    this.ignore = (opts.ignorePaths || []).map(parsePattern);
    this.unordered = (opts.unorderedPaths || []).map(parsePattern);
    this.ties = (opts.tieOrder || []).map((t) => ({ pattern: parsePattern(t.path), key: t.key }));
    this.defaults = Object.entries(opts.defaultsWhenMissing || {}).map(([p, v]) => ({ pattern: parsePattern(p), json: JSON.stringify(canonicalize(v) ?? null) }));
    this.foldCase = (opts.foldCasePaths || []).map(parsePattern);
    this.tol = opts.tolerance ?? 1e-9;
    this.maxSamples = opts.maxSamples ?? 3;
  }

  private add(path: Seg[], a: unknown, b: unknown) {
    this.diffCount++;
    if (this.diffs.length < this.maxSamples) this.diffs.push({ path: pathText(path), mongo: summarize(path, a), d1: summarize(path, b) });
  }

  /** The value with every ignored path below `path` removed (so unordered / tie matching ignores them too). */
  prune(path: Seg[], v: any): any {
    if (Array.isArray(v)) return v.map((x, i) => (this.isIgnored([...path, i]) ? undefined : this.prune([...path, i], x)));
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v)) {
        if (this.isIgnored([...path, k])) continue;
        out[k] = this.prune([...path, k], v[k]);
      }
      return out;
    }
    return v;
  }

  isIgnored(path: Seg[]): boolean {
    return this.ignore.some((p) => matches(p, path));
  }

  private numEqual(a: number, b: number): boolean {
    if (a === b) return true;
    return Math.abs(a - b) <= this.tol * Math.max(1, Math.abs(a), Math.abs(b));
  }

  walk(path: Seg[], a: any, b: any) {
    if (this.isIgnored(path)) return;
    if (a === undefined || b === undefined) {
      if (a === b) return;
      const present = JSON.stringify(a === undefined ? b : a);
      if (this.defaults.some((d) => d.json === present && matches(d.pattern, path))) return;
      this.add(path, a, b);
      return;
    }
    if (typeof a === "number" && typeof b === "number") {
      if (!this.numEqual(a, b)) this.add(path, a, b);
      return;
    }
    const aArr = Array.isArray(a);
    const bArr = Array.isArray(b);
    if (aArr || bArr) {
      if (!(aArr && bArr)) return this.add(path, a, b);
      return this.walkArray(path, a, b);
    }
    const aObj = a !== null && typeof a === "object";
    const bObj = b !== null && typeof b === "object";
    if (aObj || bObj) {
      if (!(aObj && bObj)) return this.add(path, a, b);
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of Array.from(keys).sort()) this.walk([...path, k], a[k], b[k]);
      return;
    }
    if (a === b) return;
    if (typeof a === "string" && typeof b === "string" && this.foldCase.some((p) => matches(p, path)) && a.toLowerCase() === b.toLowerCase()) return;
    this.add(path, a, b);
  }

  private walkArray(path: Seg[], a: any[], b: any[]) {
    let left = a;
    let right = b;
    const tie = this.ties.find((t) => matches(t.pattern, path));
    if (tie) {
      // The order of the sort keys must match; equal keys may come in any order.
      const ka = a.map((x) => canonicalize(safeKey(tie.key, x)));
      const kb = b.map((x) => canonicalize(safeKey(tie.key, x)));
      this.walkPlain([...path, "(sort key)"], ka, kb);
      left = sortForMatch(this.prune(path, a), (x, i) => JSON.stringify(ka[i] ?? null));
      right = sortForMatch(this.prune(path, b), (x, i) => JSON.stringify(kb[i] ?? null));
    } else if (this.unordered.some((p) => matches(p, path))) {
      left = sortForMatch(this.prune(path, a), () => "");
      right = sortForMatch(this.prune(path, b), () => "");
    }
    if (left.length !== right.length) this.add([...path, "length"], left.length, right.length);
    const n = Math.min(left.length, right.length);
    for (let i = 0; i < n; i++) this.walk([...path, i], left[i], right[i]);
  }

  /** Element-by-element, no ignore / unordered rules (used for the list of sort keys). */
  private walkPlain(path: Seg[], a: any[], b: any[]) {
    if (a.length !== b.length) return this.add([...path, "length"], a.length, b.length);
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (typeof x === "number" && typeof y === "number" ? !this.numEqual(x, y) : JSON.stringify(x ?? null) !== JSON.stringify(y ?? null)) {
        this.add([...path, i], x, y);
      }
    }
  }
}

function safeKey(fn: (el: any) => unknown, el: any): unknown {
  try {
    return fn(el);
  } catch {
    return undefined;
  }
}

/**
 * A deterministic order for matching: by group (sort key), then by _id, then by the canonical text compared
 * without capitals first (so values that only differ in capitals still line up for foldCasePaths), then exactly.
 */
function sortForMatch(list: any[], group: (x: any, i: number) => string): any[] {
  const withKeys = list.map((x, i) => {
    const t = JSON.stringify(x ?? null);
    return { x, g: group(x, i), id: x && typeof x === "object" && x._id !== undefined ? String(x._id) : "", l: t.toLowerCase(), t };
  });
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  withKeys.sort((p, q) => cmp(p.g, q.g) || cmp(p.id, q.id) || cmp(p.l, q.l) || cmp(p.t, q.t));
  return withKeys.map((w) => w.x);
}

/**
 * Compare MongoDB's answer with D1's. Both can be raw (lean documents with ObjectId / Date) or already JSON.
 * Never throws.
 */
export function compareResults(mongo: unknown, d1: unknown, opts: CompareOptions = {}): CompareResult {
  const w = new Walker(opts);
  try {
    w.walk([], canonicalize(mongo), canonicalize(d1));
  } catch (e) {
    w.diffCount++;
    w.diffs.push({ path: "(comparator)", mongo: "", d1: `comparator failed: ${e instanceof Error ? e.message.slice(0, 100) : "?"}` });
  }
  return { equal: w.diffCount === 0, diffCount: w.diffCount, diffs: w.diffs };
}
