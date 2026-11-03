/**
 * The text the Admin sends to the supplier on WhatsApp: just the products and quantities,
 * one block per product (no title, order number or closing line):
 *
 *   1. AISEN A32HDS623 (VP0000164)
 *       AISEN · PANEL · 32"
 *       Qty: 1
 *
 * Kept free of any heavy import so the browser can build the same text.
 */
export function buildOrderMessage(order: { items: any[] }) {
  return order.items
    .map((it, i) => {
      const detail = [it.brand, it.productDesc, it.charDesc].filter(Boolean).join(" · ");
      return `${i + 1}. ${it.description} (${it.itemCode})${detail ? `\n    ${detail}` : ""}\n    Qty: ${it.quantity}`;
    })
    .join("\n");
}
