/**
 * Test data for the dashboard stats golden test. Written straight into the collections (not through the models) so
 * the stored shape is exactly what is listed here — including legacy rows the current schemas would not produce
 * (missing payment mode, no bill date, warehouse tags, a "Finance Disbursement" receipt …).
 *
 * Every _id is fixed, so the JSON the route returns is the same on every run. "Now" is frozen at
 * 13 Nov 2026 15:30 India time (tests/helpers/fixed-clock.ts).
 */
import mongoose from "mongoose";

const { ObjectId } = mongoose.Types;
let nextId = 1;
const oid = () => new ObjectId((nextId++).toString(16).padStart(24, "0"));
/** A moment in India time. */
const at = (day: string, time = "12:00") => new Date(`${day}T${time}:00+05:30`);

// ─── invoices ────────────────────────────────────────────────────────────────

function line(itemName: string, quantity: number, rate: number, extra: Record<string, any> = {}) {
  const taxableAmount = rate * quantity;
  return {
    itemId: `ITM-${itemName.length}`,
    itemName,
    itemCode: "8471",
    description: `${itemName} with standard warranty`,
    quantity,
    unit: "Pcs",
    rate,
    discount: 0,
    discountType: "amount",
    taxableAmount,
    gstRate: 18,
    cgst: taxableAmount * 0.09,
    sgst: taxableAmount * 0.09,
    igst: 0,
    amount: taxableAmount * 1.18,
    serialNumbers: [`SN-${itemName.slice(0, 3).toUpperCase()}-${quantity}`],
    ...extra,
  };
}

function invoice(no: string, day: string, time: string, total: number, extra: Record<string, any> = {}) {
  return {
    _id: oid(),
    invoiceNumber: no,
    type: "tax-invoice",
    customerId: `CUST-${no.slice(-3)}`,
    customerName: "Walk-in Customer",
    customerPhone: "9800000000",
    customerAddress: "Golghar, Gorakhpur",
    customerCity: "Gorakhpur",
    customerState: "Uttar Pradesh",
    placeOfSupply: "Uttar Pradesh(09)",
    billingEntity: "valueplus",
    date: day,
    dueDate: day,
    status: "paid",
    items: [line("Generic Product", 1, Math.round(total / 1.18))],
    subtotal: total,
    discount: 0,
    taxableAmount: Math.round(total / 1.18),
    cgst: 0,
    sgst: 0,
    igst: 0,
    totalGST: total - Math.round(total / 1.18),
    extendedWarrantyTotal: 0,
    roundOff: 0,
    total,
    paidAmount: total,
    balanceAmount: 0,
    paymentMode: "Cash",
    payments: [],
    paymentTerms: "Net 30",
    dueAdvanceAmount: 0,
    dueAdvanceMode: "Cash",
    deliveryStatus: "delivered",
    salesExecutive: "Amit Singh",
    reprintCount: 0,
    printLogs: [],
    createdAt: at(day, time),
    updatedAt: at(day, time),
    __v: 0,
    ...extra,
  };
}

export function smallDataset() {
  nextId = 1;
  const invoices = [
    // Plain paid bills across October and November, every mode.
    invoice("VP-001", "2026-10-20", "11:05", 15000, { customerName: "Ravi Kumar", items: [line("LG 43 inch LED TV", 1, 12712)] }),
    invoice("VP-002", "2026-10-26", "13:40", 24500, { customerName: "Sunita Devi", paymentMode: "UPI", items: [line("Samsung Galaxy S24", 1, 20763)] }),
    invoice("VP-003", "2026-10-31", "18:10", 32000, { customerName: "Ravi Kumar", paymentMode: "Card (POS)", items: [line("Daikin 1.5 Ton Split AC", 1, 27119)] }),
    invoice("VP-004", "2026-11-01", "10:15", 8999, { customerName: "Mohd Arif", paymentMode: "NEFT", items: [line("boAt Airpods style Buds", 2, 3813)], billingAddress: { city: "Deoria" } }),
    invoice("VP-005", "2026-11-03", "16:45", 45500, {
      customerName: "Priya Singh",
      paymentMode: "Multiple",
      payments: [
        { mode: "Cash", amount: 10000, txnId: "", reference: "" },
        { mode: "UPI", amount: 35500, txnId: "UPI-5511", reference: "" },
      ],
      items: [line("Whirlpool Washing Machine 7kg", 1, 22000), line("Haier Refrigerator 260L", 1, 16559)],
    }),
    // Finance sale, payout still pending.
    invoice("VP-006", "2026-11-04", "12:30", 60000, {
      customerName: "Deepak Yadav",
      paymentMode: "Bajaj Finance",
      financeProvider: "Bajaj",
      financeDoId: "DO-7781",
      financeDownPayment: 12000,
      financeDownPaymentMode: "Cash",
      paidAmount: 12000,
      balanceAmount: 48000,
      status: "partial",
      items: [line("iPhone 15 128GB", 1, 50847)],
    }),
    // Finance sale with split payments; payout received (FinanceTransaction "Disbursed").
    invoice("VP-007", "2026-11-05", "15:00", 72000, {
      customerName: "Neha Gupta",
      paymentMode: "Multiple",
      payments: [
        { mode: "UPI", amount: 12000, txnId: "UPI-7001" },
        { mode: "HDB Finance", amount: 60000, reference: "DO-HDB-1" },
      ],
      paidAmount: 12000,
      balanceAmount: 60000,
      status: "partial",
      financeCompany: "HDB",
      items: [line("Sony Bravia 55 OLED TV", 1, 61017, { extendedWarrantyAmount: 2500, extendedWarrantyPlan: "2 Years" })],
    }),
    // Khata (due) sale with an advance; part cleared later through TXN-DUE.
    invoice("VP-008", "2026-11-06", "11:20", 20000, {
      customerName: "Rakesh Verma",
      paymentMode: "Due",
      dueAdvanceAmount: 5000,
      dueAdvanceMode: "UPI",
      paidAmount: 5000,
      balanceAmount: 15000,
      status: "partial",
      dueDate: "2026-11-20",
      items: [line("Voltas Air Cooler", 2, 8474)],
    }),
    // Pending bill (nothing paid).
    invoice("VP-009", "2026-11-07", "19:30", 12000, {
      customerName: "Rakesh Verma",
      paymentMode: "Credit Bill",
      paidAmount: 0,
      balanceAmount: 12000,
      status: "pending",
      items: [line("Panasonic Microwave Oven", 1, 10169)],
    }),
    // Cancelled bill.
    invoice("VP-010", "2026-11-08", "10:05", 18000, {
      customerName: "Kavita Sharma",
      status: "cancelled",
      cancelReason: "Customer changed mind",
      cancelledBy: "Store Manager",
      cancelledAt: "2026-11-08T12:00:00.000Z",
      lastModifiedReason: "cancel",
      items: [line("HP Laptop 15s", 1, 15254)],
    }),
    // Discounted, edited ("content-edit"), round-off, reprinted with logs.
    invoice("VP-011", "2026-11-09", "14:10", 27999, {
      customerName: "Anil Mishra",
      discount: 1500,
      roundOff: -0.4,
      lastModifiedReason: "content-edit",
      reprintCount: 2,
      lastPrintedAt: "2026-11-12T10:00:00.000Z",
      printLogs: [
        { printedAt: "2026-11-10T09:00:00.000Z", printedBy: "Cashier" },
        { printedAt: "2026-11-12T10:00:00.000Z", printedBy: "Admin" },
      ],
      items: [line("OnePlus Nord CE 4", 1, 23728, { extendedWarrantyPlan: "1 Year Onsitego" })],
    }),
    // Old bill reprinted inside the range (legacy: lastPrintedAt only, no logs).
    invoice("VP-012", "2026-09-15", "12:00", 9500, { customerName: "Old Customer", reprintCount: 3, lastPrintedAt: "2026-11-11T08:00:00.000Z" }),
    // Back-dated: entered on 13 Nov, dated 5 Nov.
    invoice("VP-013", "2026-11-05", "12:00", 14000, {
      customerName: "Back Dated Buyer",
      createdAt: at("2026-11-13", "11:00"),
      updatedAt: at("2026-11-13", "11:00"),
      paymentMode: "UPI",
      items: [line("Realme Narzo 70", 2, 5932)],
    }),
    // Delivery challan / shifted, sales order and credit note, proforma (estimate).
    invoice("VP-014", "2026-11-10", "17:00", 5600, { customerName: "Shift Co", deliveryChallanNo: "DC-55", notes: "Shift to Kunraghat" }),
    invoice("SO-001", "2026-11-10", "17:30", 41000, { type: "sales-order", customerName: "Order Person", paymentMode: "Unclassified", paidAmount: 0, balanceAmount: 41000, status: "pending" }),
    invoice("CN-001", "2026-11-11", "10:30", -3000, { type: "credit-note", customerName: "Ravi Kumar", creditNoteRef: "VP-001", paymentMode: "Cash", paidAmount: 0, balanceAmount: 0 }),
    invoice("PF-001", "2026-11-11", "11:30", 99000, { type: "proforma", customerName: "Quote Person", paymentMode: "Bajaj Finance", financeProvider: "Bajaj", paidAmount: 0, balanceAmount: 99000, status: "sent" }),
    // Today's bills (single-day view), different hours.
    invoice("VP-015", "2026-11-13", "09:40", 3200, { customerName: "Today Early", items: [line("Philips Iron", 1, 2712)] }),
    invoice("VP-016", "2026-11-13", "13:10", 54000, {
      customerName: "Today Split",
      paymentMode: "Multiple",
      payments: [
        { mode: "Card", amount: 20000 },
        { mode: "Cash", amount: 14000 },
        { mode: "Due / Credit", amount: 20000 },
      ],
      paidAmount: 34000,
      balanceAmount: 20000,
      status: "partial",
      items: [line("Samsung 8kg Front Load Washing Machine", 1, 45763)],
    }),
    invoice("VP-017", "2026-11-13", "20:15", 1999, { customerName: "Today Late", paymentMode: "", paidAmount: 1999 }),
    // A bill with no date (legacy) — its createdAt decides the day.
    invoice("VP-018", "", "16:00", 4100, { customerName: "No Date", createdAt: at("2026-11-12", "16:00") }),
    // Warehouse-tagged bills.
    invoice("VP-019", "2026-11-02", "12:00", 26000, { customerName: "Branch Buyer", warehouse: "Main Branch", paymentMode: "UPI" }),
    invoice("VP-020", "2026-11-02", "12:30", 31000, { customerName: "Ashoka Buyer", warehouse: "Ashoka Enterprises (Kunraghat Showroom)", paymentMode: "Cash" }),
    invoice("VP-021", "2026-11-03", "12:45", 7000, { customerName: "Branch Name Buyer", branchName: "main branch", paymentMode: "Card" }),
    // Paid bill whose upfront money is receipted separately (a PaymentTransaction against it).
    invoice("VP-022", "2026-11-12", "12:00", 11000, { customerName: "Receipted Buyer", paymentMode: "Cash" }),
    // Old finance bill (September) settled by a "Finance Disbursement" receipt in November.
    invoice("VP-023", "2026-09-20", "12:00", 40000, {
      customerName: "Old Finance",
      paymentMode: "TVS Credit",
      financeProvider: "TVS",
      paidAmount: 0,
      balanceAmount: 0,
      status: "paid",
    }),
    // Finance sale whose payout has not arrived (no finance record, no receipt).
    invoice("VP-025", "2026-11-08", "13:00", 38000, {
      customerName: "Waiting Payout",
      paymentMode: "IDFC First EMI",
      financeDownPayment: 8000,
      financeDownPaymentMode: "Card",
      paidAmount: 8000,
      balanceAmount: 30000,
      status: "partial",
      items: [line("Vivo V30", 1, 32203)],
    }),
    // Bill edited (audit log) outside the range but edited inside it.
    invoice("VP-024", "2026-10-28", "12:00", 16500, { customerName: "Edited Later" }),
  ];

  const customers = Array.from({ length: 6 }, (_, i) => ({
    _id: oid(),
    code: `CUST-${100 + i}`,
    name: `Customer ${i}`,
    phone: `98000000${10 + i}`,
    billingAddress: { line1: "Street", city: "Gorakhpur", state: "Uttar Pradesh", pincode: "273001", country: "India" },
    outstandingBalance: i % 2 === 0 ? 1500 * i : 0,
    status: "active",
    createdAt: at("2026-10-01", `1${i}:00`),
  }));

  const items = [
    { name: "LG 43 inch LED TV", code: "ITM-1", currentStock: 2, reorderLevel: 3, warehouse: "Ashoka Enterprises (Kunraghat Showroom)" },
    { name: "Samsung Galaxy S24", code: "ITM-2", currentStock: 20, reorderLevel: 3 },
    { name: "Daikin AC", code: "ITM-3", currentStock: 7, reorderLevel: 2, warehouse: "Main Branch" },
    { name: "iPhone 15", code: "ITM-4", currentStock: 0, reorderLevel: 0, warehouse: "Main Branch" },
    { name: "Iron", code: "ITM-5", currentStock: "4", reorderLevel: "1" },
    { name: "No stock fields", code: "ITM-6" },
    { name: "Haier Fridge", code: "ITM-7", currentStock: 30, reorderLevel: 5, warehouse: "GIDA Warehouse" },
  ].map((it, i) => ({
    _id: oid(),
    ...it,
    vpCode: `VP${1000 + i}`,
    stockByWarehouse: [{ warehouse: it.warehouse || "Ashoka Enterprises (Kunraghat Showroom)", qty: Number(it.currentStock) || 0 }],
    sellingPrice: 1000 * (i + 1),
    createdAt: at("2026-09-01", `1${i}:00`),
  }));

  const supplierA = oid();
  const supplierB = oid();
  const supplierC = oid();
  const suppliers = [
    { _id: supplierA, code: "SUP-1", name: "Gupta Electronics", phone: "9811111111", createdAt: at("2026-08-01") },
    { _id: supplierB, code: "SUP-2", name: "A.B. Traders (P) Ltd", phone: "9822222222", createdAt: at("2026-08-02") },
    { _id: supplierC, code: "SUP-3", name: "Zero Dues Co", phone: "9833333333", createdAt: at("2026-08-03") },
    { _id: oid(), code: "SUP-4", name: "  ", phone: "9844444444", createdAt: at("2026-08-04") },
  ];

  const expenses = [
    { expenseNo: "EXP-1", category: "Rent", description: "Shop rent", amount: 25000, date: "2026-11-01", paymentMode: "Bank Transfer", createdAt: at("2026-11-01", "10:00") },
    { expenseNo: "EXP-2", category: "Tea", description: "Tea", amount: 120, date: "2026-11-13", paymentMode: "Cash", createdAt: at("2026-11-13", "10:30") },
    { expenseNo: "EXP-3", category: "Fuel ", description: "Delivery fuel", amount: 800, date: "2026-11-13", paymentMode: "PhonePe UPI", createdAt: at("2026-11-13", "17:20") },
    { expenseNo: "EXP-4", category: "Repairs", description: "AC repair", amount: 1500, date: "2026-11-05", paymentMode: "Debit Card", createdAt: at("2026-11-05", "12:00"), warehouse: "Main Branch" },
    { expenseNo: "EXP-5", category: "Rent", description: "Oct rent", amount: 25000, date: "2026-10-01", paymentMode: "NEFT", createdAt: at("2026-10-01", "10:00") },
    { expenseNo: "EXP-6", category: "", description: "Misc", amount: 300, date: "2026-10-28", paymentMode: "", createdAt: at("2026-10-28", "15:00"), branchName: "Main Branch" },
  ].map((e) => ({ _id: oid(), status: "paid", ...e }));

  const pay = (p: Record<string, any>) => ({
    _id: oid(),
    partyId: "CUST-X",
    partyType: "Customer",
    partyName: "Someone",
    receivedBy: "Cashier",
    type: "received",
    bankAccountId: "",
    bankAccountRef: "",
    bankTxnRef: "",
    editCount: 0,
    ...p,
  });
  const payments = [
    // Receipt taken at billing for VP-022 (so the bill's own collection is suppressed).
    pay({ transactionId: "TXN-1001", partyName: "Receipted Buyer", amount: 11000, paymentMode: "Cash", date: "2026-11-12", referenceId: "VP-022", createdAt: at("2026-11-12", "12:01") }),
    // Khata cleared on VP-008, in UPI and cash.
    pay({ transactionId: "TXN-DUE-2001", partyName: "Rakesh Verma", amount: 5000, paymentMode: "UPI", date: "2026-11-10", referenceId: "VP-008", notes: "Part due", createdAt: at("2026-11-10", "16:00") }),
    pay({ transactionId: "TXN-DUE-2002", partyName: "Rakesh Verma", amount: 2000, paymentMode: "Cash", date: "2026-11-13", referenceId: "VP-008", createdAt: at("2026-11-13", "18:30") }),
    // Finance payout for VP-023 (old bill) — a settlement, not revenue.
    pay({ transactionId: "TXN-3001", partyName: "Old Finance", amount: 40000, paymentMode: "Finance Disbursement", date: "2026-11-06", referenceId: "VP-023", bankAccountRef: "HDFC 1234", bankTxnRef: "UTR998", createdAt: at("2026-11-06", "11:00") }),
    // TXN-FIN payout for VP-006 without a bank account (falls back to finance record, which has none).
    pay({ transactionId: "TXN-FIN-3002", partyName: "Deepak Yadav", amount: 47000, paymentMode: "NEFT", date: "2026-11-12", referenceId: "VP-006", createdAt: at("2026-11-12", "15:00") }),
    // Standalone receipts: card, unknown mode, missing mode, ISO date string, no date.
    pay({ transactionId: "TXN-4001", partyName: "Advance Guy", amount: 3000, paymentMode: "Swipe Machine", date: "2026-11-11", createdAt: at("2026-11-11", "10:00") }),
    pay({ transactionId: "TXN-4002", partyName: "Mystery", amount: 750, paymentMode: "Cheque", date: "2026-11-09", createdAt: at("2026-11-09", "21:30") }),
    pay({ transactionId: "TXN-4003", partyName: "No Mode", amount: 1250, date: "2026-11-13", createdAt: at("2026-11-13", "08:15") }),
    pay({ transactionId: "TXN-4004", partyName: "Iso Date", amount: 999, paymentMode: "GPay", date: "2026-11-02T10:00:00.000Z", createdAt: at("2026-11-02", "15:30") }),
    pay({ transactionId: "TXN-4005", partyName: "Zero", amount: 0, paymentMode: "Cash", date: "2026-11-05", createdAt: at("2026-11-05", "09:00") }),
    pay({ transactionId: "TXN-4006", partyName: "Old Receipt", amount: 4500, paymentMode: "Cash", date: "2026-10-27", referenceId: "VP-002", createdAt: at("2026-10-27", "13:00") }),
    // Supplier payments: by supplier _id, by supplier code, refunds, one referencing a purchase bill.
    pay({ transactionId: "TXN-S-1", partyType: "Supplier", partyId: String(supplierA), partyName: "Gupta Electronics", type: "paid", amount: 30000, paymentMode: "NEFT", date: "2026-11-02", referenceId: "PB-1", createdAt: at("2026-11-02", "11:00") }),
    pay({ transactionId: "TXN-S-2", partyType: "Supplier", partyId: "SUP-2", partyName: "A.B. Traders (P) Ltd", type: "paid", amount: 4000, paymentMode: "Cash", date: "2026-11-08", createdAt: at("2026-11-08", "11:00") }),
    pay({ transactionId: "TXN-S-3", partyType: "Supplier", partyId: String(supplierA), partyName: "Gupta Electronics", type: "received", amount: 1000, paymentMode: "UPI", date: "2026-11-09", createdAt: at("2026-11-09", "11:00") }),
    pay({ transactionId: "TXN-S-4", partyType: "Supplier", partyId: String(supplierC), partyName: "Zero Dues Co", type: "paid", amount: 2000, paymentMode: "Cash", date: "2026-10-15", createdAt: at("2026-10-15", "11:00") }),
  ];

  const financeTxns = [
    { _id: oid(), invoiceNumber: "VP-007", customerName: "Neha Gupta", customerMobile: "9800000007", doId: "DO-HDB-1", approvalStatus: "Disbursed", financeProvider: "HDB Financial", bankAccountRef: "ICICI 5678", transactionRef: "UTR-HDB-77", paymentReceivedDate: "2026-11-07", actualReceivedAmount: 59500, loanAmount: 60000, createdAt: at("2026-11-05", "15:05") },
    { _id: oid(), invoiceNumber: "VP-006", customerName: "Deepak Yadav", customerMobile: "9800000006", doId: "DO-7781", approvalStatus: "Approved", financeProvider: "Bajaj Finserv", createdAt: at("2026-11-04", "12:35") },
  ];

  const bill = (b: Record<string, any>) => ({
    _id: oid(),
    supplierGST: "",
    type: "entry",
    billingEntity: "valueplus",
    items: [{ itemId: "I1", name: "Stock", quantity: 2, rate: 1000, gstRate: 18, hsn: "", serialNumbers: [] }],
    subtotal: 0,
    gst: 0,
    paid: 0,
    balance: 0,
    status: "pending",
    ...b,
  });
  const purchaseEntries = [
    bill({ billNo: "PB-1", supplierName: "Gupta Electronics", supplierId: supplierA, billDate: "2026-11-01", dueDate: "2026-11-15", total: 50000, createdAt: at("2026-11-01", "10:00") }),
    bill({ billNo: "PB-2", supplierName: "gupta electronics ", billDate: "2026-11-05", dueDate: "2026-11-06", total: 12000.5, paid: 2000, paymentMode: "Cash", status: "partial", createdAt: at("2026-11-05", "10:00") }),
    bill({ billNo: "PB-3", supplierName: "A.B. Traders (P) Ltd", billDate: "2026-10-20", dueDate: "2026-10-30", total: 8000, createdAt: at("2026-10-20", "10:00") }),
    bill({ billNo: "PB-4", supplierName: "A.B. Traders (P) Ltd", billDate: "2026-11-07", total: 3000, type: "debit-note", createdAt: at("2026-11-07", "10:00") }),
    // Cancelled: left out of the purchase KPI, but (known quirk) still counted in the supplier outstanding.
    bill({ billNo: "PB-5", supplierName: "Gupta Electronics", supplierId: supplierA, billDate: "2026-11-09", total: 7000, status: "cancelled", cancelReason: "Wrong bill", createdAt: at("2026-11-09", "10:00") }),
    bill({ billNo: "PB-6", supplierName: "Zero Dues Co", supplierId: supplierC, billDate: "2026-10-10", total: 2000, paid: 2000, status: "paid", createdAt: at("2026-10-10", "10:00") }),
    bill({ billNo: "PB-7", supplierName: "Unknown Supplier", date: "2026-11-12", billDate: "", total: 4400, createdAt: at("2026-11-12", "10:00") }),
  ];

  const purchaseOrders = [
    { _id: oid(), poNo: "PO-1", supplierName: "Gupta Electronics", date: at("2026-11-03"), totalAmount: 9000, status: "sent", items: [], createdAt: at("2026-11-03") },
    { _id: oid(), poNo: "PO-2", supplierName: "Gupta Electronics", date: at("2026-11-04"), totalAmount: 50000, status: "received", items: [], createdAt: at("2026-11-04") },
    { _id: oid(), poNo: "PO-3", supplierName: "A.B. Traders (P) Ltd", date: at("2026-10-29"), totalAmount: 6100, status: "partial", items: [], createdAt: at("2026-10-29") },
  ];

  const vendorA = oid();
  const vendorB = oid();
  const vendors = [
    { _id: vendorA, code: "VEN-1", name: "Mobile Repair Hub", phone: "9700000001", openingBalance: 2000, openingBalanceDate: "2026-10-01", status: "active", createdAt: at("2026-10-01") },
    { _id: vendorB, code: "VEN-2", name: "Scrap Buyer", phone: "9700000002", openingBalance: 0, openingBalanceDate: "", status: "active", createdAt: at("2026-10-02") },
    { _id: oid(), code: "VEN-3", name: "Idle Vendor", phone: "9700000003", status: "active", createdAt: at("2026-10-03") },
  ];
  const vendorBills = [
    { _id: oid(), billNo: "VB-1", vendorId: String(vendorA), vendorName: "Mobile Repair Hub", date: "2026-10-20", dueDate: "2026-10-30", total: 5000, status: "open", items: [{ name: "Service", quantity: 1, rate: 5000, amount: 5000 }] },
    { _id: oid(), billNo: "VB-2", vendorId: String(vendorA), vendorName: "Mobile Repair Hub", date: "2026-11-10", dueDate: "2026-11-25", total: 3000, status: "cancelled" },
    { _id: oid(), billNo: "VB-3", vendorId: String(vendorB), vendorName: "Scrap Buyer", date: "2026-11-02", dueDate: "2026-11-05", total: 1200, status: "open" },
  ];
  const vendorPayments = [
    { _id: oid(), paymentId: "VP-PAY-1", vendorId: String(vendorA), vendorName: "Mobile Repair Hub", date: "2026-11-03", amount: 2500, mode: "UPI", type: "received", refNo: "" },
    { _id: oid(), paymentId: "VP-PAY-2", vendorId: String(vendorA), vendorName: "Mobile Repair Hub", date: "2026-11-13", amount: 500, mode: "Cash", type: "paid", refNo: "" },
    { _id: oid(), paymentId: "VP-PAY-3", vendorId: String(vendorB), vendorName: "Scrap Buyer", date: "2026-10-25", amount: 1200, mode: "NEFT", type: "received", refNo: "N1" },
  ];

  const auditLogs = [
    {
      _id: oid(),
      action: "invoice.edit",
      entityType: "invoice",
      entityRef: "VP-024",
      reason: "Wrong rate entered",
      performedBy: "Store Manager",
      performedByRole: "manager",
      usedLegacyPin: false,
      metadata: { before: { total: 16000, discount: 0 }, after: { total: 16500, discount: 0 } },
      createdAt: at("2026-11-12", "10:00"),
    },
    {
      _id: oid(),
      action: "invoice.details.edit",
      entityType: "invoice",
      entityRef: "VP-024",
      reason: "",
      performedBy: "Admin",
      performedByRole: "admin",
      usedLegacyPin: true,
      metadata: { before: { customerPhone: "9800000000" }, after: { customerPhone: "9800000999" } },
      createdAt: at("2026-11-12", "11:00"),
    },
    {
      _id: oid(),
      action: "invoice.edit",
      entityType: "invoice",
      entityRef: "VP-011",
      reason: "Discount corrected",
      performedBy: "Admin",
      performedByRole: "admin",
      metadata: { before: { discount: 1000 }, after: { discount: 1500 } },
      createdAt: at("2026-11-09", "15:00"),
    },
    // An edit of a bill that no longer exists, and an unrelated action.
    { _id: oid(), action: "invoice.edit", entityType: "invoice", entityRef: "VP-GONE", reason: "x", performedBy: "Admin", createdAt: at("2026-11-11", "15:00") },
    { _id: oid(), action: "payment.edit", entityType: "payment", entityRef: "TXN-1001", reason: "x", performedBy: "Admin", createdAt: at("2026-11-11", "15:00") },
  ];

  const deletedInvoices = [
    {
      _id: oid(),
      invoiceNumber: "VP-099",
      docType: "Invoice",
      customerName: "Deleted Person",
      total: 5500,
      deletedAt: at("2026-11-12", "18:00"),
      deletedBy: "Admin",
      deletedByRole: "admin",
      deleteReason: "Duplicate bill",
      usedLegacyPin: false,
      snapshot: { invoiceNumber: "VP-099", date: "2026-11-01", paymentMode: "Cash", total: 5500, items: [{ itemName: "Thing", quantity: 1 }] },
    },
    {
      _id: oid(),
      invoiceNumber: "PF-077",
      docType: "Estimate",
      customerName: "Old Quote",
      total: 1000,
      deletedAt: at("2026-10-26", "18:00"),
      deletedBy: "Manager",
      deleteReason: "Expired",
      snapshot: { invoiceNumber: "PF-077" },
    },
  ];

  return {
    invoices,
    customers,
    items,
    suppliers,
    expenses,
    payment_transactions: payments,
    finance_transactions: financeTxns,
    purchase_entries: purchaseEntries,
    purchase_orders: purchaseOrders,
    vendors,
    vendor_bills: vendorBills,
    vendor_payments: vendorPayments,
    audit_logs: auditLogs,
    deleted_invoices: deletedInvoices,
  };
}

// ─── a bigger, generated data set for timings ──────────────────────────────────

/** Small deterministic PRNG (mulberry32) so the "big" data set is the same on every run. */
function prng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PRODUCTS = [
  "LG 43 inch LED TV", "Samsung Galaxy S24", "Daikin 1.5 Ton Split AC", "iPhone 15 128GB", "Whirlpool Washing Machine 7kg",
  "Haier Refrigerator 260L", "Sony Bravia 55 OLED TV", "Voltas Air Cooler", "Panasonic Microwave Oven", "HP Laptop 15s",
  "OnePlus Nord CE 4", "Realme Narzo 70", "Philips Iron", "Havells Geyser 15L", "boAt Soundbar",
];
const MODES = ["Cash", "UPI", "Card", "NEFT", "Bajaj Finance", "Due", "PhonePe", "Cheque"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * About a year of a busy store: `invoiceCount` bills (Jan–Nov 2026) with 1–4 lines each, receipts, expenses,
 * purchases, suppliers, customers and items. Values are random but fixed by the seed.
 */
export function bigDataset(invoiceCount = 4000) {
  nextId = 1_000_000;
  const rnd = prng(20261113);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const dayOf = (i: number, n: number) => {
    // Spread evenly from 1 Jan to 13 Nov 2026 (316 days), oldest first.
    const d = new Date(Date.UTC(2026, 0, 1) + Math.floor((i / n) * 316) * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };

  const invoices: any[] = [];
  for (let i = 0; i < invoiceCount; i++) {
    const day = dayOf(i, invoiceCount);
    const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => line(pick(PRODUCTS), 1 + Math.floor(rnd() * 2), 1000 + Math.floor(rnd() * 40000)));
    const total = Math.round(lines.reduce((s, l) => s + l.amount, 0));
    const mode = pick(MODES);
    const r = rnd();
    const extra: Record<string, any> = { customerName: `Customer ${Math.floor(rnd() * 900)}`, paymentMode: mode, items: lines };
    if (mode === "Bajaj Finance") Object.assign(extra, { financeProvider: "Bajaj", financeDownPayment: Math.round(total * 0.2), paidAmount: Math.round(total * 0.2), balanceAmount: r < 0.5 ? total - Math.round(total * 0.2) : 0, status: r < 0.5 ? "partial" : "paid" });
    if (mode === "Due") Object.assign(extra, { dueAdvanceAmount: Math.round(total * 0.3), paidAmount: Math.round(total * 0.3), balanceAmount: total - Math.round(total * 0.3), status: "partial" });
    if (r > 0.97) Object.assign(extra, { status: "cancelled", cancelReason: "test" });
    if (r > 0.9 && r <= 0.93) extra.discount = 500;
    if (r > 0.85 && r <= 0.87) extra.type = "proforma";
    if (r > 0.8 && r <= 0.81) Object.assign(extra, { reprintCount: 1, lastPrintedAt: `${dayOf(Math.min(invoiceCount - 1, i + 30), invoiceCount)}T10:00:00.000Z`, printLogs: [{ printedAt: `${dayOf(Math.min(invoiceCount - 1, i + 30), invoiceCount)}T10:00:00.000Z`, printedBy: "Cashier" }] });
    if (r < 0.2) extra.payments = [{ mode: "Cash", amount: Math.round(total / 2) }, { mode: "UPI", amount: total - Math.round(total / 2) }];
    const hour = 9 + Math.floor(rnd() * 12);
    invoices.push(invoice(`BIG-${String(i).padStart(5, "0")}`, day, `${pad(hour)}:${pad(Math.floor(rnd() * 60))}`, total, extra));
  }
  // Stored in insertion order = createdAt order, like real data; give each a unique second so sorts are stable.
  invoices.forEach((inv, i) => {
    inv.createdAt = new Date(inv.createdAt.getTime() + (i % 60) * 1000);
    inv.updatedAt = inv.createdAt;
  });

  const payments: any[] = [];
  for (let i = 0; i < Math.floor(invoiceCount * 0.6); i++) {
    const day = dayOf(i, Math.floor(invoiceCount * 0.6));
    const ref = invoices[Math.floor(rnd() * invoices.length)].invoiceNumber;
    payments.push({
      _id: oid(),
      transactionId: `${rnd() < 0.3 ? "TXN-DUE-" : "TXN-"}${i}`,
      partyId: "CUST",
      partyType: rnd() < 0.1 ? "Supplier" : "Customer",
      partyName: `Party ${i % 50}`,
      amount: 500 + Math.floor(rnd() * 20000),
      paymentMode: pick(MODES),
      date: day,
      referenceId: rnd() < 0.7 ? ref : undefined,
      type: rnd() < 0.85 ? "received" : "paid",
      receivedBy: "Cashier",
      bankAccountRef: "",
      bankTxnRef: "",
      notes: rnd() < 0.2 ? "Paid at counter" : undefined,
      createdAt: new Date(`${day}T10:00:00+05:30`).getTime() + i * 1000,
    });
    payments[payments.length - 1].createdAt = new Date(payments[payments.length - 1].createdAt);
  }

  const customers = Array.from({ length: 1700 }, (_, i) => ({
    _id: oid(),
    code: `CUST-${i}`,
    name: `Customer ${i}`,
    phone: `9${String(100000000 + i)}`,
    billingAddress: { line1: "Street", city: "Gorakhpur", state: "Uttar Pradesh", pincode: "273001", country: "India" },
    shippingAddress: { line1: "Street", city: "Gorakhpur", state: "Uttar Pradesh", pincode: "273001", country: "India" },
    outstandingBalance: Math.floor(rnd() * 5000),
    status: "active",
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
  }));
  const items = Array.from({ length: 450 }, (_, i) => ({
    _id: oid(),
    code: `ITM-${i}`,
    vpCode: `VP${i}`,
    name: `${pick(PRODUCTS)} v${i}`,
    description: "A product description that is long enough to look like a real catalogue entry.",
    currentStock: Math.floor(rnd() * 20),
    reorderLevel: Math.floor(rnd() * 5),
    warehouse: rnd() < 0.5 ? "Ashoka Enterprises (Kunraghat Showroom)" : "GIDA Warehouse",
    stockByWarehouse: [{ warehouse: "Ashoka Enterprises (Kunraghat Showroom)", qty: 3 }, { warehouse: "GIDA Warehouse", qty: 2 }],
    sellingPrice: 1000 + Math.floor(rnd() * 50000),
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
  }));
  const suppliers = Array.from({ length: 60 }, (_, i) => ({
    _id: oid(),
    code: `SUP-${i}`,
    name: `Supplier ${i}`,
    phone: `97${String(10000000 + i)}`,
    address: { city: "Lucknow", state: "Uttar Pradesh", pincode: "226001" },
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000),
  }));
  const purchaseEntries = Array.from({ length: 800 }, (_, i) => {
    const s = suppliers[Math.floor(rnd() * suppliers.length)];
    const day = dayOf(i, 800);
    return {
      _id: oid(),
      billNo: `PB-${i}`,
      supplierName: rnd() < 0.5 ? s.name : s.name.toUpperCase(),
      supplierId: rnd() < 0.5 ? s._id : undefined,
      billDate: day,
      dueDate: day,
      type: rnd() < 0.05 ? "debit-note" : "entry",
      status: rnd() < 0.05 ? "cancelled" : "pending",
      items: Array.from({ length: 3 }, (_, k) => ({ itemId: `I${k}`, name: pick(PRODUCTS), quantity: 2, rate: 5000, gstRate: 18, serialNumbers: ["A", "B"] })),
      total: 1000 + Math.floor(rnd() * 80000),
      paid: rnd() < 0.3 ? 1000 : 0,
      createdAt: new Date(`${day}T11:00:00+05:30`).getTime() + i * 1000,
    };
  }).map((p) => ({ ...p, createdAt: new Date(p.createdAt) }));
  const expenses = Array.from({ length: 600 }, (_, i) => {
    const day = dayOf(i, 600);
    return { _id: oid(), expenseNo: `EXP-${i}`, category: pick(["Rent", "Tea", "Fuel", "Salary advance"]), description: "Expense", amount: 100 + Math.floor(rnd() * 5000), date: day, paymentMode: pick(MODES), status: "paid", createdAt: new Date(new Date(`${day}T13:00:00+05:30`).getTime() + i * 1000) };
  });
  const purchaseOrders = Array.from({ length: 150 }, (_, i) => ({ _id: oid(), poNo: `PO-${i}`, supplierName: "S", date: new Date(`${dayOf(i, 150)}T12:00:00+05:30`), totalAmount: 5000 + i, status: pick(["sent", "received", "partial"]), items: [], createdAt: new Date(`${dayOf(i, 150)}T12:00:00+05:30`) }));

  return {
    invoices,
    customers,
    items,
    suppliers,
    expenses,
    payment_transactions: payments,
    finance_transactions: [],
    purchase_entries: purchaseEntries,
    purchase_orders: purchaseOrders,
    vendors: [],
    vendor_bills: [],
    vendor_payments: [],
    audit_logs: [],
    deleted_invoices: [],
  };
}

export async function seed(data: Record<string, any[]>) {
  for (const [collection, docs] of Object.entries(data)) {
    if (docs.length) await mongoose.connection.collection(collection).insertMany(docs as any[]);
  }
}
