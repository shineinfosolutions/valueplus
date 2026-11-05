/**
 * The text the Admin sends to the supplier on WhatsApp: for each product only its model number, VP code and
 * quantity (no brand, category, title, order number or closing line):
 *
 *   1. Model: HRD-2061SBRA-N
 *      VP Code: VP0011392
 *      Qty: 2
 *
 * The same VP code from two warehouses of the sheet is one product to the supplier, so its quantities are added.
 * Kept free of any heavy import so the browser can build the same text.
 */
export function buildOrderMessage(order: { items: any[] }) {
  const byCode = new Map<string, { model: string; code: string; quantity: number }>();
  for (const it of order.items || []) {
    const code = String(it.itemCode || "").trim();
    const key = code || String(it.description || "");
    const row = byCode.get(key) || { model: String(it.description || "").trim(), code, quantity: 0 };
    row.quantity += Number(it.quantity) || 0;
    byCode.set(key, row);
  }
  return [...byCode.values()]
    .map((r, i) => `${i + 1}. Model: ${r.model}\n   VP Code: ${r.code}\n   Qty: ${r.quantity}`)
    .join("\n\n");
}
