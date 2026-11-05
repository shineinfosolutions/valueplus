/**
 * Salesman incentive rules on a product.
 *
 * A product can carry several rules at once — for example "₹500 per piece" and "2% of the taxable amount" — and
 * every rule that is running adds to the salesman's incentive. A rule can be limited to:
 *   - a minimum price: earned only when the piece is sold at that price or above (after the line discount);
 *   - a date range: earned only on bills dated inside it ("ongoing" schemes).
 *
 * Older products carry a single rule in the flat fields incentiveType / incentiveValue / incentiveAmount /
 * incentiveTargetAmount; `rulesOf` reads those as one rule, so nothing set before this change is lost.
 *
 * Kept free of imports so the billing form, the server and the salesman's plan screen all use the same maths.
 */

/** Who may set a product's salesman incentive rules. */
export const INCENTIVE_SETTER_ROLES = ["admin", "superadmin", "manager", "cashier"];

export type IncentiveRuleType = "fixed" | "percentage";

export interface IncentiveRule {
  type: IncentiveRuleType;
  /** ₹ per piece (fixed) or % of the line's taxable amount (percentage). */
  value: number;
  /** GST-inclusive price per piece the product has to be sold at (or above). 0 = any price. */
  minPrice?: number;
  /** Free text the salesman sees, e.g. "Diwali brand scheme". */
  label?: string;
  /** YYYY-MM-DD, inclusive. Empty = no limit. */
  startDate?: string;
  endDate?: string;
  active?: boolean;
}

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (v: any) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : "");

/** Today's date in India as YYYY-MM-DD (bills are dated in IST). */
export function todayIST(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

/** Cleans one rule from a form or the database; null when it is not a usable rule. */
export function cleanRule(raw: any): IncentiveRule | null {
  if (!raw || typeof raw !== "object") return null;
  const type: IncentiveRuleType = raw.type === "percentage" ? "percentage" : "fixed";
  const value = num(raw.value);
  if (!(value > 0)) return null;
  if (type === "percentage" && value > 100) return null;
  return {
    type,
    value: r2(value),
    minPrice: Math.max(0, r2(num(raw.minPrice))),
    label: String(raw.label || "").trim().slice(0, 80),
    startDate: day(raw.startDate),
    endDate: day(raw.endDate),
    active: raw.active !== false,
  };
}

export function cleanRules(list: any): IncentiveRule[] {
  return (Array.isArray(list) ? list : []).map(cleanRule).filter(Boolean) as IncentiveRule[];
}

/** Every rule set on a product (or on a bill line that copied them), including the older single-rule fields. */
export function rulesOf(item: any): IncentiveRule[] {
  if (!item) return [];
  const own = cleanRules(item.incentiveRules ?? item.incentives);
  // Saving rules always rewrites the flat fields too (see flatFieldsFor), so falling back to them is safe.
  if (own.length > 0) return own;
  const type = String(item.incentiveType || "");
  const value = num(item.incentiveValue) || num(item.incentiveAmount);
  if (type === "none" || !(value > 0)) return [];
  const legacy = cleanRule({
    type: type === "percentage" ? "percentage" : "fixed",
    value,
    minPrice: num(item.incentiveTargetAmount),
  });
  return legacy ? [legacy] : [];
}

/** Is the rule running on this date (YYYY-MM-DD)? */
export function isRuleLive(rule: IncentiveRule, onDate: string = todayIST()): boolean {
  if (rule.active === false) return false;
  if (rule.startDate && onDate < rule.startDate) return false;
  if (rule.endDate && onDate > rule.endDate) return false;
  return true;
}

export function liveRulesOf(item: any, onDate: string = todayIST()): IncentiveRule[] {
  return rulesOf(item).filter((r) => isRuleLive(r, onDate));
}

export interface IncentiveLineInput {
  /** GST-inclusive rate per piece, before the line discount. */
  rate: number;
  /** Discount per piece, in rupees. */
  discount?: number;
  qty?: number;
  /** GST % on the line, used to work out the taxable amount when it is not given. */
  gstRate?: number;
  /** The line's taxable amount (all pieces), when already worked out. */
  taxable?: number;
}

/** What one rule pays on a line (0 when its minimum price is not met). */
export function ruleIncentive(rule: IncentiveRule, line: IncentiveLineInput): number {
  const qty = num(line.qty) || 1;
  const pricePerPiece = num(line.rate) - num(line.discount);
  if ((rule.minPrice || 0) > 0 && pricePerPiece + 0.005 < (rule.minPrice || 0)) return 0;
  if (rule.type === "fixed") return rule.value * qty;
  const taxable =
    line.taxable !== undefined && line.taxable !== null
      ? num(line.taxable)
      : (pricePerPiece * qty) / (1 + num(line.gstRate) / 100);
  return taxable * (rule.value / 100);
}

/** The salesman's incentive on one bill line: every running rule added together. */
export function lineIncentive(rules: IncentiveRule[], line: IncentiveLineInput, onDate: string = todayIST()): number {
  return r2(rules.filter((r) => isRuleLive(r, onDate)).reduce((s, r) => s + ruleIncentive(r, line), 0));
}

/**
 * The flat single-rule fields to save next to a product's rule list, so older screens and reports that read only
 * incentiveType / incentiveValue still see something sensible (the first rule), and an empty list clears them.
 */
export function flatFieldsFor(rules: IncentiveRule[]) {
  const first = rules[0];
  return first
    ? { incentiveType: first.type, incentiveValue: first.value, incentiveAmount: first.value, incentiveTargetAmount: first.minPrice || 0 }
    : { incentiveType: "none" as const, incentiveValue: 0, incentiveAmount: 0, incentiveTargetAmount: 0 };
}

/** One rule in words: "₹500 / pc" or "2%". */
export function ruleText(rule: IncentiveRule): string {
  return rule.type === "percentage" ? `${rule.value}%` : `₹${rule.value.toLocaleString("en-IN")} / pc`;
}
