/**
 * What changed in an edited bill, worked out from one audit-trail entry (`invoice.edit` or `invoice.details.edit`).
 * Both kinds keep `metadata.before` and `metadata.after`: the first a summary of the whole bill (lib/invoice-full-edit.ts
 * `summariseInvoice`), the second only the fields that were corrected. A field whose value is the same in both is left out.
 */

const LABELS: Record<string, string> = {
  customer: "Customer",
  salesExecutive: "Sales executive",
  customerName: "Customer name",
  customerPhone: "Mobile",
  customerAltPhone: "Alternate mobile",
  customerEmail: "Email",
  customerGST: "GST number",
  customerAddress: "Billing address",
  customerCity: "City",
  customerState: "State",
  customerPin: "Pin code",
  placeOfSupply: "Place of supply",
  shippingAddress: "Shipping address",
  vehicleNumber: "Vehicle number",
  driverName: "Driver",
  driverPhone: "Driver mobile",
  driverVehicleNo: "Driver vehicle",
  deliveryNote: "Delivery note",
  expectedDeliveryDate: "Delivery date",
  items: "Products",
  discount: "Discount",
  taxableAmount: "Taxable amount",
  totalGST: "GST",
  total: "Bill total",
  paid: "Paid",
  balance: "Balance due",
  paymentMode: "Payment mode",
  payments: "Payments",
  dueDate: "Due date",
  date: "Bill date",
  notes: "Notes",
};

/** Fields that hold rupees (shown with the ₹ sign). */
export const MONEY_FIELDS = new Set(["total", "paid", "balance", "discount", "taxableAmount", "totalGST"]);

export interface EditChange {
  field: string;
  label: string;
  /** A list for the lines of the bill / the payments, text for everything else ("—" when it was empty). */
  before: string | string[];
  after: string | string[];
}

const prettify = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
const same = (a: any, b: any) => JSON.stringify(a ?? "") === JSON.stringify(b ?? "");
const show = (v: any): string | string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (v === undefined || v === null || v === "") return "—";
  return String(v);
};

export function describeEdit(metadata: any): EditChange[] {
  const before = metadata?.before || {};
  const after = metadata?.after || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const out: EditChange[] = [];
  for (const k of keys) {
    if (same(before[k], after[k])) continue;
    out.push({ field: k, label: LABELS[k] || prettify(k), before: show(before[k]), after: show(after[k]) });
  }
  return out;
}
