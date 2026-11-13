import { canonicalJson, toBool, toDate, toJson, toReal, toText, type ChildSpec, type MasterSpec, type SqlValue } from "../masters-map";

/**
 * D1 copy specs for the SALES & MONEY area (docs/D1_MIGRATION_PLAN.md §4.3, §4.5; tables in
 * d1/migrations/0002_sales.sql). Picked up by lib/d1/registry.ts, so the copy job (lib/d1/sync.ts) copies them with
 * no other change.
 *
 * Lossless by construction:
 *  - every top-level field is a column, a child table, or (when the spec does not know it) the `extra` JSON;
 *  - every array that became a child table keeps each element's unknown keys in that child row's own `extra`
 *    column, an element that is not an object as `{"$value": ...}` in `extra`, and a field that should be an array
 *    but is not (legacy data) as one row with idx -1 and `{"$raw": ...}` in `extra`;
 *  - Mongo String fields stay verbatim text (type "text"), only Mongo Date fields are normalised to ISO (type "date").
 *
 * Invoice has ~130 top-level fields, over D1's 100 columns, so (plan §4.3) it is split into `invoices` (lists,
 * filters, totals), `invoiceFinance` and `invoiceDelivery` (1:1, written only when the bill has any of their
 * fields), `invoiceItems` (lines) and `invoicePayments` (split payments).
 */

type ColType = "text" | "real" | "int" | "bool" | "date" | "json";
type Column = MasterSpec["columns"][number];
type FieldDef = [field: string, type: ColType];

function convert(type: ColType, v: unknown): SqlValue {
  switch (type) {
    case "text":
      return toText(v);
    case "real":
      return toReal(v);
    case "int": {
      const n = toReal(v);
      return n === null ? null : Math.trunc(n);
    }
    case "bool":
      return toBool(v);
    case "date":
      return toDate(v);
    case "json":
      return toJson(v);
  }
}

const col = ([field, type]: FieldDef): Column => ({ col: field, type, get: (d) => d?.[field] });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.prototype.toString.call(v) === "[object Object]" && !(v as any)._bsontype;

/** A flat collection: one column per field, named as the field. */
function flat(collection: string, table: string, fields: FieldDef[], extraColumns: Column[] = []): MasterSpec {
  return { collection, table, columns: [...fields.map(col), ...extraColumns], known: fields.map(([f]) => f) };
}

/**
 * An array field -> child rows (parentCol, idxCol, [id], ...fields, extra). `id` holds the element's own `_id` when
 * the subdocuments have one; anything else the element carries goes to the row's `extra`.
 */
function arrayChild(o: { table: string; parentCol: string; idxCol: string; field: string; withId?: boolean; fields: FieldDef[] }): ChildSpec {
  const names = o.fields.map(([f]) => f);
  const known = new Set(o.withId ? ["_id", ...names] : names);
  const columns = [...(o.withId ? ["id"] : []), o.parentCol, o.idxCol, ...names, "extra"];
  const blank = (id: string, idx: number, extra: unknown): SqlValue[] => [
    ...(o.withId ? [null] : []),
    id,
    idx,
    ...o.fields.map(([, t]) => (t === "bool" ? 0 : null)),
    canonicalJson(extra),
  ];
  return {
    table: o.table,
    parentCol: o.parentCol,
    columns,
    rows: (doc: any, id: string) => {
      const list = doc?.[o.field];
      if (list === undefined || list === null) return [];
      if (!Array.isArray(list)) return [blank(id, -1, { $raw: list })];
      return list.map((e: any, i: number) => {
        if (!isPlainObject(e)) return blank(id, i, { $value: e === undefined ? null : e });
        const rest: Record<string, unknown> = {};
        for (const k of Object.keys(e)) if (!known.has(k) && e[k] !== undefined) rest[k] = e[k];
        return [
          ...(o.withId ? [e._id === undefined ? null : toText(e._id)] : []),
          id,
          i,
          ...o.fields.map(([f, t]) => convert(t, e[f])),
          Object.keys(rest).length ? canonicalJson(rest) : null,
        ];
      });
    },
  };
}

/** 1:1 side table keyed by the parent id; a row only when the document has at least one of its fields. */
function sideTable(table: string, parentCol: string, fields: FieldDef[]): ChildSpec {
  return {
    table,
    parentCol,
    columns: [parentCol, ...fields.map(([f]) => f)],
    rows: (doc: any, id: string) =>
      fields.some(([f]) => doc?.[f] !== undefined) ? [[id, ...fields.map(([f, t]) => convert(t, doc?.[f]))]] : [],
  };
}

// ---------------------------------------------------------------------------
// Invoice
// ---------------------------------------------------------------------------

export const INVOICE_FIELDS: FieldDef[] = [
  ["invoiceNumber", "text"],
  ["type", "text"],
  ["customerId", "text"],
  ["customerName", "text"],
  ["customerGST", "text"],
  ["customerPAN", "text"],
  ["customerCompanyName", "text"],
  ["customerPhone", "text"],
  ["customerAltPhone", "text"],
  ["customerEmail", "text"],
  ["customerAddress", "text"],
  ["customerCity", "text"],
  ["customerState", "text"],
  ["customerPin", "text"],
  ["placeOfSupply", "text"],
  ["vehicleNumber", "text"],
  ["shippingAddress", "text"],
  ["warehouseId", "text"],
  ["billingEntity", "text"],
  ["date", "text"],
  ["dueDate", "text"],
  ["status", "text"],
  ["subtotal", "real"],
  ["discount", "real"],
  ["taxableAmount", "real"],
  ["cgst", "real"],
  ["sgst", "real"],
  ["igst", "real"],
  ["totalGST", "real"],
  ["extendedWarrantyTotal", "real"],
  ["roundOff", "real"],
  ["total", "real"],
  ["paidAmount", "real"],
  ["balanceAmount", "real"],
  ["paymentMode", "text"],
  ["paymentTerms", "text"],
  ["cashReceivedBy", "text"],
  ["upiTxnId", "text"],
  ["onlineTxnId", "text"],
  ["onlineGateway", "text"],
  ["financeProvider", "text"],
  ["financeDoId", "text"],
  ["financeApprovalStatus", "text"],
  ["downPayment", "real"],
  ["downPaymentMode", "text"],
  ["shippingCharges", "real"],
  ["freightCharges", "real"],
  ["freightPaidBy", "text"],
  ["dueAdvanceAmount", "real"],
  ["dueAdvanceMode", "text"],
  ["dueClearedAt", "text"],
  ["dueClearedMode", "text"],
  ["dueClearedBy", "text"],
  ["dueClearedNotes", "text"],
  ["dueClearedTxnId", "text"],
  ["dueClearedBankAccountId", "text"],
  ["dueClearedBankAccount", "text"],
  ["advanceAdjusted", "real"],
  ["advanceReceiptNo", "text"],
  ["advanceTransactionId", "text"],
  ["creditAdjusted", "real"],
  ["dispatchType", "text"],
  ["deliveryStatus", "text"],
  ["expectedDeliveryDate", "text"],
  ["deliveredAt", "date"],
  ["backdateStatus", "text"],
  ["backdateRequestedBy", "text"],
  ["backdateMadeOn", "text"],
  ["deliveryChallanNo", "text"],
  ["creditNoteRef", "text"],
  ["notes", "text"],
  ["salesExecutive", "text"],
  ["salesExecutiveIncentive", "real"],
  ["onsitegoIncentive", "real"],
  ["adminOverridePinUsed", "bool"],
  ["reprintCount", "real"],
  ["lastPrintedAt", "text"],
  ["printLogs", "json"],
  ["lastModifiedReason", "text"],
  ["cancelledAt", "text"],
  ["cancelledBy", "text"],
  ["cancelReason", "text"],
  ["offlineId", "text"],
];

export const INVOICE_FINANCE_FIELDS: FieldDef[] = [
  ["cardCategory", "text"],
  ["cardAmount", "real"],
  ["cardType", "text"],
  ["cardTxnId", "text"],
  ["cardLast4", "text"],
  ["cardMdrPercent", "real"],
  ["cardMdrAmount", "real"],
  ["cardNetSettlement", "real"],
  ["financeAppId", "text"],
  ["financeGrossLoan", "real"],
  ["financeNetLoan", "real"],
  ["financeMarginMoney", "real"],
  ["financeDownPayment", "real"],
  ["financeDownPaymentMode", "text"],
  ["financeDealerSubsidy", "real"],
  ["financeExpectedDisbursement", "real"],
  ["financeActualDisbursement", "real"],
  ["financePdfUrl", "text"],
  ["financePdfUrls", "json"],
  ["financeDos", "json"],
  ["financeApprovedBy", "text"],
  ["financeApprovalDate", "text"],
  ["financeBankRef", "text"],
  ["financeBankAccountId", "text"],
  ["financeBankAccount", "text"],
  ["financePayoutDate", "text"],
  ["financeTenureMonths", "real"],
  ["financeSchemeType", "text"],
  ["financeInterestRate", "real"],
  ["monthlyEMI", "real"],
  ["totalInterest", "real"],
];

export const INVOICE_DELIVERY_FIELDS: FieldDef[] = [
  ["isShippingSameAsBilling", "bool"],
  ["shippingStreet", "text"],
  ["shippingCity", "text"],
  ["shippingState", "text"],
  ["shippingPin", "text"],
  ["deliveryOtp", "text"],
  ["deliveryNote", "text"],
  ["deliveryReminderSentAt", "date"],
  ["driverName", "text"],
  ["driverPhone", "text"],
  ["driverVehicleNo", "text"],
  ["deliveryProofKey", "text"],
  ["deliveryProofKeys", "json"],
  ["receivedBySelf", "bool"],
  ["receivedBySelfBy", "text"],
  ["deliverySerial", "text"],
  ["deliverySerialMatched", "bool"],
  ["deliveryProofAt", "date"],
  ["deliveryProofBy", "text"],
  ["storeExit", "json"],
];

export const INVOICE_ITEM_FIELDS: FieldDef[] = [
  ["itemId", "text"],
  ["itemName", "text"],
  ["itemCode", "text"],
  ["vpCode", "text"],
  ["description", "text"],
  ["hsn", "text"],
  ["quantity", "real"],
  ["unit", "text"],
  ["rate", "real"],
  ["minSellingPrice", "real"],
  ["costPrice", "real"],
  ["adminOverrideRate", "bool"],
  ["incentiveTargetAmount", "real"],
  ["incentiveAmount", "real"],
  ["incentiveType", "text"],
  ["incentiveValue", "real"],
  ["incentiveEarned", "real"],
  ["incentiveRules", "json"],
  ["salesExecutive", "text"],
  ["discount", "real"],
  ["discountType", "text"],
  ["taxableAmount", "real"],
  ["gstRate", "real"],
  ["cgst", "real"],
  ["sgst", "real"],
  ["igst", "real"],
  ["amount", "real"],
  ["serialNumber", "text"],
  ["batchNumber", "text"],
  ["extendedWarrantyProvider", "text"],
  ["extendedWarrantyPlan", "text"],
  ["extendedWarrantyAmount", "real"],
  ["extendedWarrantyDuration", "real"],
  ["extendedWarrantyPolicyNo", "text"],
  ["stockWarehouseId", "text"],
];

export const INVOICE_PAYMENT_FIELDS: FieldDef[] = [
  ["mode", "text"],
  ["amount", "real"],
  ["txnId", "text"],
  ["reference", "text"],
  ["receivedBy", "text"],
  ["notes", "text"],
];

const invoiceSpec: MasterSpec = {
  collection: "invoices",
  table: "invoices",
  columns: INVOICE_FIELDS.map(col),
  known: [...INVOICE_FIELDS, ...INVOICE_FINANCE_FIELDS, ...INVOICE_DELIVERY_FIELDS].map(([f]) => f).concat("items", "payments"),
  children: [
    arrayChild({ table: "invoiceItems", parentCol: "invoiceId", idxCol: "lineNo", field: "items", withId: true, fields: INVOICE_ITEM_FIELDS }),
    arrayChild({ table: "invoicePayments", parentCol: "invoiceId", idxCol: "idx", field: "payments", fields: INVOICE_PAYMENT_FIELDS }),
    sideTable("invoiceFinance", "invoiceId", INVOICE_FINANCE_FIELDS),
    sideTable("invoiceDelivery", "invoiceId", INVOICE_DELIVERY_FIELDS),
  ],
};

// ---------------------------------------------------------------------------
// Estimate
// ---------------------------------------------------------------------------

const ESTIMATE_FIELDS: FieldDef[] = [
  ["estimateNumber", "text"],
  ["date", "date"],
  ["expiryDate", "date"],
  ["customerName", "text"],
  ["customerPhone", "text"],
  ["customerAddress", "text"],
  ["customerGST", "text"],
  ["customerCompanyName", "text"],
  ["salesExecutive", "text"],
  ["salesperson", "text"],
  ["status", "text"],
  ["subTotal", "real"],
  ["taxTotal", "real"],
  ["total", "real"],
  ["notes", "text"],
  ["convertedInvoiceNumber", "text"],
  ["kind", "text"],
  ["approvalStatus", "text"],
  ["approvedBy", "text"],
  ["approvedAt", "date"],
  ["rejectedBy", "text"],
  ["rejectedAt", "date"],
  ["rejectReason", "text"],
  ["dealAmount", "real"],
  ["dealSalesperson", "text"],
  ["advanceAmount", "real"],
  ["advanceMode", "text"],
  ["advanceTxnRef", "text"],
  ["financeProvider", "text"],
  ["financeDoId", "text"],
  ["financeAppId", "text"],
  ["financeDownPayment", "real"],
  ["financeTenureMonths", "real"],
  ["financeInterestRate", "real"],
  ["financePdfUrl", "text"],
  ["financePdfUrls", "json"],
  ["financeDoData", "json"],
  ["priceUnlock", "json"],
];

const estimateSpec: MasterSpec = {
  ...flat("estimates", "estimates", ESTIMATE_FIELDS),
  known: [...ESTIMATE_FIELDS.map(([f]) => f), "items"],
  children: [
    arrayChild({
      table: "estimateItems",
      parentCol: "estimateId",
      idxCol: "idx",
      field: "items",
      fields: [
        ["itemCode", "text"],
        ["name", "text"],
        ["quantity", "real"],
        ["rate", "real"],
        ["discount", "real"],
        ["itemId", "text"],
        ["tax", "real"],
        ["amount", "real"],
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// FinanceTransaction
// ---------------------------------------------------------------------------

const FINANCE_FIELDS: FieldDef[] = [
  ["financeProvider", "text"],
  ["customerName", "text"],
  ["customerId", "text"],
  ["customerMobile", "text"],
  ["deliveryAddress", "text"],
  ["invoiceNumber", "text"],
  ["atosDealId", "text"],
  ["doId", "text"],
  ["date", "text"],
  ["assetCategory", "text"],
  ["oemCategory", "text"],
  ["manufacturer", "text"],
  ["brand", "text"],
  ["productModel", "text"],
  ["eanNumber", "text"],
  ["schemeCode", "text"],
  ["productPrice", "real"],
  ["grossLoanAmount", "real"],
  ["netLoanAmount", "real"],
  ["marginMoney", "real"],
  ["advanceEmi", "real"],
  ["serviceCharge", "real"],
  ["upfrontInterest", "real"],
  ["dealerInterestSubsidy", "real"],
  ["dealerSubsidyPercent", "real"],
  ["mbdFromDealer", "real"],
  ["cardCharges", "real"],
  ["creditSurakshaFees", "real"],
  ["healthCardCharges", "real"],
  ["totalEmi", "real"],
  ["totalGst", "real"],
  ["convenienceFee", "real"],
  ["cashback", "real"],
  ["customerDownPayment", "real"],
  ["totalDeductions", "real"],
  ["netDisbursement", "real"],
  ["tenureMonths", "real"],
  ["monthlyEmiAmount", "real"],
  ["totalPaidEmiAmount", "real"],
  ["balanceDueAmount", "real"],
  ["approvalStatus", "text"],
  ["uploadedPdfUrl", "text"],
  ["uploadedPdfUrls", "json"],
  ["approvedBy", "text"],
  ["approvalDate", "text"],
  ["actualReceivedAmount", "real"],
  ["bankAccountRef", "text"],
  ["bankAccountId", "text"],
  ["transactionRef", "text"],
  ["paymentReceivedDate", "text"],
  ["remarks", "text"],
  ["deliveryInstructions", "text"],
];

const financeSpec: MasterSpec = {
  ...flat("finance_transactions", "financeTransactions", FINANCE_FIELDS),
  known: [...FINANCE_FIELDS.map(([f]) => f), "emiSchedule", "linkedInvoices"],
  children: [
    arrayChild({
      table: "financeEmiInstallments",
      parentCol: "financeId",
      idxCol: "idx",
      field: "emiSchedule",
      fields: [
        ["installmentNumber", "real"],
        ["dueDate", "text"],
        ["amount", "real"],
        ["status", "text"],
        ["paidDate", "text"],
        ["paymentChannel", "text"],
        ["paymentMode", "text"],
        ["collectedBy", "text"],
        ["bankRef", "text"],
        ["receiptNumber", "text"],
        ["bounceReason", "text"],
        ["penaltyAmount", "real"],
        ["notes", "text"],
      ],
    }),
    arrayChild({
      table: "financeLinkedInvoices",
      parentCol: "financeId",
      idxCol: "idx",
      field: "linkedInvoices",
      fields: [
        ["invoiceNumber", "text"],
        ["amount", "real"],
        ["linkedAt", "date"],
      ],
    }),
  ],
};

// ---------------------------------------------------------------------------
// The flat ones
// ---------------------------------------------------------------------------

const paymentTransactionSpec = flat("payment_transactions", "paymentTransactions", [
  ["transactionId", "text"],
  ["partyId", "text"],
  ["partyType", "text"],
  ["partyName", "text"],
  ["amount", "real"],
  ["paymentMode", "text"],
  ["date", "text"],
  ["referenceId", "text"],
  ["notes", "text"],
  ["receivedBy", "text"],
  ["balanceAfter", "real"],
  ["type", "text"],
  ["bankAccountId", "text"],
  ["bankAccountRef", "text"],
  ["bankTxnRef", "text"],
  ["lastEditedAt", "date"],
  ["lastEditedBy", "text"],
  ["editCount", "real"],
]);

const customerAdvanceSpec = flat("customer_advances", "customerAdvances", [
  ["receiptNumber", "text"],
  ["customerId", "text"],
  ["customerName", "text"],
  ["customerPhone", "text"],
  ["customerEmail", "text"],
  ["customerAddress", "text"],
  ["amount", "real"],
  ["paymentMode", "text"],
  ["transactionRef", "text"],
  ["productBooked", "text"],
  ["targetBrand", "text"],
  ["targetCategory", "text"],
  ["notes", "text"],
  ["reason", "text"],
  ["status", "text"],
  ["usedAmount", "real"],
  ["remainingBalance", "real"],
  ["linkedInvoiceNumber", "text"],
  ["branchName", "text"],
  ["receivedBy", "text"],
  ["date", "text"],
  ["time", "text"],
]);

const salesOrderSpec = flat("sales_orders", "salesOrders", [
  ["orderNo", "text"],
  ["date", "date"],
  ["customerName", "text"],
  ["deliveryDate", "date"],
  ["itemsCount", "real"],
  ["totalAmount", "real"],
  ["paidAmount", "real"],
  ["balanceAmount", "real"],
  ["paymentStatus", "text"],
  ["status", "text"],
]);

/** strict: false, so archived bills may carry any extra top-level field: those land in `extra`. */
const deletedInvoiceSpec = flat("deleted_invoices", "deletedInvoices", [
  ["invoiceNumber", "text"],
  ["docType", "text"],
  ["customerName", "text"],
  ["total", "real"],
  ["deletedAt", "date"],
  ["deletedBy", "text"],
  ["deletedByRole", "text"],
  ["deletedByUserId", "text"],
  ["deleteReason", "text"],
  ["pinVerified", "bool"],
  ["usedLegacyPin", "bool"],
  ["snapshot", "json"],
]);

const deliveryChallanSpec = flat("delivery_challans", "deliveryChallans", [
  ["challanNo", "text"],
  ["type", "text"],
  ["invoiceNumber", "text"],
  ["sourceParty", "text"],
  ["sourceAddress", "text"],
  ["sourcePhone", "text"],
  ["destinationParty", "text"],
  ["destinationAddress", "text"],
  ["customerPhone", "text"],
  ["itemName", "text"],
  ["vpCode", "text"],
  ["hsn", "text"],
  ["serialImei", "text"],
  ["quantity", "real"],
  ["unit", "text"],
  ["itemPrice", "real"],
  ["defectDescription", "text"],
  ["financeDoId", "text"],
  ["reason", "text"],
  ["date", "date"],
  ["vehicleNo", "text"],
  ["transporterName", "text"],
  ["driverName", "text"],
  ["driverPhone", "text"],
  ["ewayBillNo", "text"],
  ["flowType", "text"],
  ["claimStatus", "text"],
  ["settledAt", "date"],
  ["settledBy", "text"],
  ["creditAmount", "real"],
  ["replacementItemId", "text"],
  ["replacementItemName", "text"],
  ["replacementSerial", "text"],
  ["itemId", "text"],
  ["supplierId", "text"],
  ["warehouse", "text"],
  ["settlementNote", "text"],
  ["createdBy", "text"],
  ["approvalStatus", "text"],
  ["approvedAt", "date"],
  ["approvedBy", "text"],
  ["creditNoteRef", "text"],
  ["debitNoteRef", "text"],
  ["deliveryOtp", "text"],
  ["deliveredAt", "date"],
  ["deliveryProofKey", "text"],
  ["deliveryProofKeys", "json"],
  ["autoFromBill", "bool"],
  ["status", "text"],
  ["remarks", "text"],
]);

/** Lines are only printed, so they stay JSON (plan §4.3). */
const ewayBillSpec = flat("eway_bills", "ewayBills", [
  ["ewayBillNo", "text"],
  ["invoiceNumber", "text"],
  ["customerName", "text"],
  ["customerGstin", "text"],
  ["deliveryAddress", "text"],
  ["vehicleNumber", "text"],
  ["transporterName", "text"],
  ["transporterId", "text"],
  ["taxableValue", "real"],
  ["totalGst", "real"],
  ["totalAmount", "real"],
  ["status", "text"],
  ["generatedDate", "text"],
  ["validUntil", "text"],
  ["errorDetails", "text"],
  ["items", "json"],
]);

const extendedWarrantySpec = flat("extended_warranties", "extendedWarranties", [
  ["warrantyId", "text"],
  ["customerName", "text"],
  ["customerPhone", "text"],
  ["customerEmail", "text"],
  ["invoiceNumber", "text"],
  ["itemId", "text"],
  ["productName", "text"],
  ["vpCode", "text"],
  ["serialNumber", "text"],
  ["planName", "text"],
  ["durationMonths", "real"],
  ["startDate", "text"],
  ["endDate", "text"],
  ["warrantyAmount", "real"],
  ["salesStaff", "text"],
  ["status", "text"],
  ["remarks", "text"],
]);

/** The model sets no collection name, so mongoose's default plural applies. */
const discountApprovalSpec = flat("discountapprovals", "discountApprovals", [
  ["requestedBy", "text"],
  ["requestedById", "text"],
  ["requestedByRole", "text"],
  ["context", "text"],
  ["customerName", "text"],
  ["itemId", "text"],
  ["itemName", "text"],
  ["brand", "text"],
  ["sellingPrice", "real"],
  ["price", "real"],
  ["quantity", "real"],
  ["percent", "real"],
  ["tier", "text"],
  ["status", "text"],
  ["reviewedBy", "text"],
  ["reviewedAt", "date"],
  ["reviewNote", "text"],
]);

/** payloadKind / payloadTarget are read out of the payload (plan: generated columns; written by the copy instead). */
const payloadPart = (name: "kind" | "target"): Column => ({
  col: name === "kind" ? "payloadKind" : "payloadTarget",
  type: "text",
  get: (d) => (isPlainObject(d?.payload) ? d.payload[name] : undefined),
});

const storeActivitySpec = flat(
  "store_activity_approvals",
  "storeActivityApprovals",
  [
    ["activityId", "text"],
    ["storeName", "text"],
    ["storeInchargeName", "text"],
    ["storeInchargeEmail", "text"],
    ["activityType", "text"],
    ["title", "text"],
    ["description", "text"],
    ["amount", "real"],
    ["payload", "json"],
    ["status", "text"],
    ["superAdminActionAt", "date"],
    ["superAdminNotes", "text"],
  ],
  [payloadPart("kind"), payloadPart("target")]
);

const billingCompanySpec = flat("billing_companies", "billingCompanies", [
  ["gstin", "text"],
  ["companyName", "text"],
  ["pan", "text"],
  ["usageCount", "real"],
]);

export const SALES_SPECS: MasterSpec[] = [
  invoiceSpec,
  paymentTransactionSpec,
  customerAdvanceSpec,
  estimateSpec,
  salesOrderSpec,
  deletedInvoiceSpec,
  deliveryChallanSpec,
  ewayBillSpec,
  financeSpec,
  extendedWarrantySpec,
  discountApprovalSpec,
  storeActivitySpec,
  billingCompanySpec,
];
