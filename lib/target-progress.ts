/**
 * How a bill counts towards a salesman's Sales Target task (memory.md §22): used live on every new tax invoice
 * (app/api/invoices/route.ts) and by "Recount from date" (app/api/staff/tasks/recount/route.ts), so both count the
 * same way.
 *
 * Matching a product / brand name against a bill line:
 *   - spaces, dashes and other punctuation are ignored, so "V guard", "V-GUARD" and "VGUARD" are the same;
 *   - a short name (up to 3 letters, e.g. "LG") must be a whole word of the line, so it is not found inside another
 *     word or model number; a longer name may also be found inside a word (e.g. "Haier" in "HAIER-AC").
 */

const norm = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s: any) => String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Does `name` appear in `text` (see the rules above)? An empty name matches nothing. */
export function nameMatches(text: any, name: any): boolean {
  const want = norm(name);
  if (!want) return false;
  const w = words(text);
  // Whole words, or several neighbouring words written together ("v" + "guard" = "vguard").
  for (let i = 0; i < w.length; i++) {
    let joined = "";
    for (let j = i; j < w.length && joined.length < want.length; j++) {
      joined += w[j];
      if (joined === want) return true;
    }
  }
  return want.length > 3 && norm(text).includes(want);
}

/** Does this bill line belong to the target's product / brand? */
export function lineMatchesTarget(line: any, targetProduct: any, targetBrand: any): boolean {
  const name = line?.itemName || "";
  const category = line?.category || "";
  const brand = line?.brand || "";
  if (norm(targetProduct) && (nameMatches(name, targetProduct) || nameMatches(category, targetProduct))) return true;
  if (norm(targetBrand) && (nameMatches(brand, targetBrand) || nameMatches(name, targetBrand))) return true;
  return false;
}

/**
 * What one bill adds to a target. A target on a product / brand counts only the matching lines (units and their
 * line amount); a target with no product counts every unit and the whole bill total.
 */
export function billCountsForTarget(
  task: { targetProduct?: any; targetBrand?: any },
  invoice: { items?: any[]; total?: any; netAmount?: any }
): { matched: boolean; qty: number; amount: number } {
  const items = invoice.items || [];
  if (norm(task.targetProduct) || norm(task.targetBrand)) {
    let matched = false;
    let qty = 0;
    let amount = 0;
    for (const line of items) {
      if (!lineMatchesTarget(line, task.targetProduct, task.targetBrand)) continue;
      matched = true;
      qty += Number(line.quantity || line.qty || 1);
      amount += Number(line.amount) || (Number(line.rate) || 0) * (Number(line.quantity || line.qty) || 1);
    }
    return { matched, qty, amount };
  }
  return {
    matched: true,
    qty: items.reduce((acc: number, it: any) => acc + (Number(it.quantity || it.qty) || 1), 0),
    amount: Number(invoice.total || invoice.netAmount || 0),
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is a bill by this salesman one that counts for a task given to `assignedStaff` (same rule as the live count)? */
export function billIsForAssignee(salesExecutive: any, assignedStaff: any): boolean {
  const assignee = String(assignedStaff || "");
  if (assignee === "All Staff" || assignee === "Sales Staff") return true;
  const person = String(salesExecutive || "").trim();
  if (!person) return false;
  const first = person.split(" ")[0];
  return new RegExp(escapeRe(person), "i").test(assignee) || new RegExp(escapeRe(first), "i").test(assignee);
}
