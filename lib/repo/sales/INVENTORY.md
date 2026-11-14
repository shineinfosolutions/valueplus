# SALES & MONEY reads: inventory (D1 migration stage B2)

Every MongoDB read on the GET paths of the sales and money area, with its D1 replacement. Collections: `invoices`, `payment_transactions`, `customer_advances`, `estimates`, `sales_orders`, `deleted_invoices`, `delivery_challans`, `eway_bills`, `finance_transactions`, `extended_warranties`, `discountapprovals`, `store_activity_approvals`, `billing_companies`.

- **Code:** `lib/repo/sales/`.
  - `invoices.ts`, `money.ts`, `documents.ts` and `approvals.ts` hold one `mongo…` function per read (the current query, moved, not changed) and one `d1…` function (the same result from D1).
  - `d1-docs.ts` rebuilds the documents.
  - `registry.ts` exports `SALES_READS` (key → `{ mongo, d1, unordered? }`; both functions take the same arguments).
  - `db.ts` selects the D1 database.
- **Proof:** `tests/d1-sales-reads.test.ts`. It runs every registry entry with 1 to 72 argument combinations, twice (after the full copy, then after changes and an incremental copy), and checks `JSON.stringify` equality. The only normalisation is sorting object keys.
- **Not wired yet:** no route calls these functions yet. The wiring step swaps each call site for the registry entry through the shadow framework (`lib/d1/read-source.ts` / `lib/d1/shadow.ts`, built separately).

Legend: **lean** = `.lean()` (plain objects). **doc** = mongoose documents; the route serialises them with `toJSON`, so the D1 side applies mongoose's `minimize`. Sort ties are listed where they matter.

## Invoices (`invoices` + `invoiceItems`, `invoicePayments`, `invoiceFinance`, `invoiceDelivery`)

| Key | Used by | Mongo query | Result |
|---|---|---|---|
| `invoices.byNumber` | `GET /api/invoices?invoiceNumber=` | `Invoice.findOne({ invoiceNumber }).lean()` | one bill or null |
| `invoices.list` | `GET /api/invoices` (type, includeEstimates, warehouse/location) | `countDocuments({ ...typeFilter, $or: locationClause })`, then `find(query).sort({ createdAt: -1 }).lean()`. typeFilter is `{ type }` or `{ type: { $nin: ["sales-order"(, "proforma")] } }`. locationClause is the showroom regex / missing / "" / null warehouse, or `^name$`/i on `warehouse` / `branchName` | `{ invoices: bill[], warehouseScoped }` |
| `orders.list` | `GET /api/orders` (type, staff) | `find({ type or type $in [sales-order, tax-invoice], $or: 6 unescaped /staff/i, /firstName/i on salesExecutive, createdBy, salesperson }).sort({ createdAt: -1 }).lean()` | bill[] |
| `payments.paidInvoices` | `GET /api/payments` (legacy-receipt backfill) | `find({ (customerId), paidAmount: { $gt: 0 } }).lean()` (no sort) | bill[] |
| `nextNumber.invoiceNumbers` | `GET /api/invoices/next-number` | `find({}, { invoiceNumber: 1 }).lean()` | `{ _id, invoiceNumber }[]` |
| `nextNumber.proformaNumbers` | same, `type=estimate` | `find({ type: "proforma" }, { invoiceNumber: 1 }).lean()` | `{ _id, invoiceNumber }[]` |
| `warranty.invoices` | `GET /api/warranty` | `find({ type: { $ne: "proforma" } }).lean()` | bill[] (only totals are used) |
| `vendorsLedger.customerInvoices` | `GET /api/vendors/ledger?party=customer(&id=)` | `find({ (customerId), type: { $ne: "proforma" } }).lean()` | bill[] |
| `track.invoice` | `GET /api/track/[id]` | `findOne({ $or: [{ invoiceNumber: id }, { invoiceNumber: /^id$/i (unescaped) }, { deliveryChallanNo: id }] }).lean()` | one bill or null |
| `salesOut.invoices` | `GET /api/reports/sales-out` | `find({ type $nin [sales-order, proforma], date range, paymentMode = bank / $or regex(bank) on financeProvider, paymentMode, balanceAmount > 0, salesExecutive, customerName regex }).sort({ date: -1, createdAt: -1 }).lean()` | bill[] |
| `gstr.hsnInvoices` | `GET /api/gstr-reports?type=HSN_SUMMARY` | `find({ type $in [tax-invoice, credit-note], status $ne cancelled }).sort({ date: 1 }).lean()` | bill[]; ties on date: createdAt asc, then reverse stored order (index `{date:-1,createdAt:-1}` read backwards) |
| `gstr.b2bInvoices` | `?type=GSTR1_B2B / GSTR1_B2C` | `find({ type: "tax-invoice", status $ne cancelled }).sort({ date: 1 }).lean()` | same |
| `gstr.gstr1Invoices` | `?type=GSTR1` | `find({ type: "tax-invoice" }).sort({ date: 1 }).lean()` | same |
| `profitLoss.invoices` | `GET /api/reports/profit-loss` | `find({ status $nin [cancelled, draft], type $ne proforma, date range, "branch.name" }).lean()` (no sort) | bill[] |
| `dashboard.invoiceSummary` | `GET /api/dashboard/stats` | `find({}, INVOICE_SUMMARY_FIELDS).sort({ createdAt: -1 }).lean()` | projected bill[] (incl. `payments`, `printLogs`, legacy `warehouse` / `branchName`) |
| `dashboard.invoicesByIds` | dashboard, `loadComplete(Invoice, rows)` | `aggregate([{ $match: { _id: { $in: ids } } }])` | bill[] in _id order |
| `cashRegister.cashInvoices` | `lib/cashRegister.ts` (`GET /api/cash-register`, `/api/admin-cash`, `/api/day-close`…) | `find({ type: tax-invoice, $or: [paymentMode Cash / cash, "payments.mode" /cash/i], status $ne cancelled }).sort({ createdAt: -1 })` | **doc** bill[] |
| `cashRegister.financeLinkedInvoices` | same | `find({ invoiceNumber: { $in } }, { invoiceNumber: 1, financeDownPaymentMode: 1 }).lean()` (`[]` for no numbers) | projected[] |
| `cashRegister.dueCashBills` | same | `find({ type: tax-invoice, status $ne cancelled, paymentMode /due\|credit/i, dueAdvanceMode /cash/i, paidAmount > 0 }, {6 fields}).lean()` | projected[] |
| `staffIncentive.bills` | `lib/staff-incentive.ts` loadIncentiveBook (`GET /api/staff/overview`, `/my-incentive`, `/incentive-payout`) | `find({ type $nin [proforma, sales-order, credit-note], status $ne cancelled }, { 7 fields + 6 "items.x" }).sort({ date: -1, createdAt: -1 }).lean()` | projected[]; lines hold only the 6 sub-fields (no line _id) |
| `staffBrandSales.bills` | `lib/staff-brand-sales.ts` (`GET /api/staff/brand-sales`) | `find({ type $nin [...], status $ne cancelled, date range }, { salesExecutive, items, date }).lean()` | projected[] |
| `deliveryReminders.dueInvoices` | `lib/delivery-reminders.ts`, run from `GET /api/notifications` | `find({ expectedDeliveryDate $nin ["", null] and <= until, deliveryStatus $ne delivered, status $ne cancelled, deliveryReminderSentAt $exists false }, {7 fields}).limit(50).lean()` | projected[] |

## payment_transactions

| Key | Used by | Mongo query | Result |
|---|---|---|---|
| `payments.list` | `GET /api/payments` (partyId, partyType) | `find({ partyId?, partyType? }).sort({ date: -1 }).lean()` | payment[]; ties on date in stored order (index `{date:-1}`) |
| `dashboard.supplierPayments` | dashboard (khata cards) | `find({ partyType: "Supplier" }, {7 fields}).lean()` | projected[] |
| `dashboard.paymentSummary` | dashboard | `find({}, PAYMENT_SUMMARY_FIELDS).sort({ createdAt: -1 }).lean()` | projected[] |
| `dashboard.paymentsByIds` | dashboard, `loadComplete(PaymentTransaction, …)` | `aggregate([{ $match: { _id: { $in: ids } } }])` | payment[] |
| `cashRegister.cashReceipts` | `lib/cashRegister.ts` | `find({ partyType: Customer, type: received, paymentMode /^cash/i }, {7 fields}).lean()` | projected[] |
| `vendorsLedger.payments` | `GET /api/vendors/ledger` (`"Supplier"` / `"Customer"`) | `find({ partyType }).lean()` | payment[] |

## customer_advances, finance_transactions, deleted_invoices, billing_companies

| Key | Used by | Mongo query | Result |
|---|---|---|---|
| `advances.list` | `GET /api/crm/advances` (phone, status, search) | `find({ customerPhone?, status?, $or: unescaped /search/i on 5 fields }).sort({ createdAt: -1 }).lean()` | advance[] |
| `finance.list` | `GET /api/finance` (invoiceNumber, doId, status, provider) | `find(filter).sort({ createdAt: -1 })` | **doc** finance[] with `emiSchedule`, `linkedInvoices` |
| `finance.reminders` | `GET /api/finance/reminders`, `/api/me/summary` | `find({ approvalStatus $in [Disbursed, Reconciled], $or: bankAccountRef / transactionRef $in ["", null] }, {10 fields}).sort({ paymentReceivedDate: 1 }).lean()` | projected[] |
| `dashboard.financeSummary` | dashboard | `find({}, {8 fields}).lean()` | projected[] |
| `cashRegister.financeRecords` | `lib/cashRegister.ts` | `find({}).sort({ createdAt: -1 })` | **doc** finance[] |
| `dashboard.deletedInRange` | dashboard | `DeletedInvoice.find({ deletedAt: { $gte, $lte } }).sort({ deletedAt: -1 }).lean()` | deleted[] (`snapshot` and unknown fields included: strict:false) |
| `nextNumber.deletedNumbers` | `GET /api/invoices/next-number` | `DeletedInvoice.find({}, { invoiceNumber: 1 }).lean()` | `{ _id, invoiceNumber }[]` |
| `billingCompanies.list` | `GET /api/billing-companies` | `find({}).sort({ usageCount: -1, companyName: 1 }).lean()` | company[] |

## estimates, delivery_challans, eway_bills, extended_warranties

| Key | Used by | Mongo query | Result |
|---|---|---|---|
| `estimates.list` | `GET /api/estimates` (phone, status, approval); `/api/me/summary` (approval=pending) | `find({ customerPhone: { $regex: digits, $options: "i" }?, status?, approvalStatus? }).sort({ createdAt: -1 })` | **doc** estimate[] (the route then keeps a salesman's own) |
| `nextNumber.estimateNumbers` | `GET /api/invoices/next-number?type=estimate` | `find({}, { estimateNumber: 1 }).lean()` | `{ _id, estimateNumber }[]` |
| `challans.list` | `GET /api/delivery-challans` (flowType, claimStatus, approvalStatus, search) | `find({ flowType (CR → $in [CR, CNR])?, claimStatus?, approvalStatus?, $or: unescaped /search/i on 7 fields }).sort({ createdAt: -1 }).lean()` | challan[] |
| `track.challan` | `GET /api/track/[id]` | `findOne({ $or: [{ challanNo: id }, { invoiceNumber: id }] }).lean()` | one challan or null |
| `ewayBills.list` | `GET /api/eway-bills` (invoiceNumber, status) | `find(filter).sort({ createdAt: -1 })` | **doc** ewayBill[] |
| `gstr.gstr1EwayBills` | `GET /api/gstr-reports?type=GSTR1` | `find({ invoiceNumber: { $in } }, { invoiceNumber, ewayBillNo, generatedDate }).lean()` (`[]` for no numbers) | projected[] |
| `warranty.list` | `GET /api/warranty` (invoiceNumber, customerPhone, vpCode, status) | `find(filter).sort({ createdAt: -1 })` | **doc** warranty[] |
| `warranty.count` | same | `countDocuments()` | number |
| `warranty.revenue` | same | `aggregate([{ $group: { _id: null, total: { $sum: "$warrantyAmount" } } }])` | `[{ _id: null, total }]`, or `[]` when empty |
| `warranty.todayCount` | same | `countDocuments({ startDate: { $gte: istToday() } })` | number |
| `warranty.monthCount` | same | `countDocuments({ startDate: { $regex: ^YYYY-MM } })` | number |

## discountapprovals, store_activity_approvals

| Key | Used by | Mongo query | Result |
|---|---|---|---|
| `discountApprovals.byIds` | `GET /api/discount-approvals?ids=` | `find({ _id: { $in: ids }, requestedById: actor.id }).lean()`; a non-ObjectId id throws a CastError (route: 500) | approval[] (D1 throws too) |
| `discountApprovals.list` | `GET /api/discount-approvals` (status; tiers from role); `/api/me/summary` | `find({ status?, tier: { $in: tiers } (fewer than 3) }).sort({ createdAt: -1 }).limit(200).lean()` | approval[] |
| `approvals.list` | `GET /api/approvals` (status, storeName; non-admin: own) | `find(query).sort({ createdAt: -1 }).lean()` + `countDocuments({ ...query, status: "pending" })`. For a non-admin, query.$or is `"payload.requestedBy.id"` = actor.id or `storeInchargeEmail` = actor.email | `{ approvals, pendingCount }` |
| `meSummary.pendingApprovals` | `GET /api/me/summary` (Admin) | `countDocuments({ status: "pending" })` | number |

**51 reads in total.**

## Notes for the wiring step

- **`GET /api/finance` writes on a GET.** After the read, the route fills a missing EMI schedule and calls `txn.save()` on the mongoose document. D1 returns plain objects, so the wiring must keep the Mongo read (or a Mongo write) for documents that need the fill. A record is created with `emiSchedule: []` and gets its schedule generated and saved on the first GET that sees it; after that the read has no side effect. While the fill exists, D1 and Mongo can differ for a record in the moment before its first fill is copied.
- **`sendDueDeliveryReminders`** (from `GET /api/notifications`) claims each bill with a Mongo update after reading it. Only the read is here.
- **Non-lean reads** (`estimates.list`, `ewayBills.list`, `warranty.list`, `finance.list`, `cashRegister.cashInvoices`, `cashRegister.financeRecords`) return mongoose documents from MongoDB, and mongoose fills in on load every schema default the stored copy lacks (an estimate saved before `advanceAmount` existed reads `advanceAmount: 0, advanceMode: "", advanceTxnRef: ""`; an older bill reads `backdateStatus / backdateRequestedBy / backdateMadeOn: ""`). The D1 side does the same with mongoose itself: `findDocs(..., { hydrateWith: Model })` hydrates the rebuilt stored copy through the same model (`lib/d1/hydrate.ts`), so defaults, casting and toJSON are identical by construction (shadow findings of 14 Nov 2026). The D1 answer is a mongoose document too, so the `finance.list` save above works on it. tests/d1-sales-reads.test.ts checks that both sides are documents and runs every read again on older documents without their defaulted fields.
- **`unordered` entries** have no `.sort()` in Mongo, so their order depends on the planner. D1 returns the order the live indexes (`lib/ensure-indexes.ts`) give today: `_id` order, or `type, createdAt desc` / `type, status, date desc` / `date desc, createdAt desc` for the type-filtered invoice reads. The test checks these orders exactly. None of their callers depends on the order: they compute a max, sums or maps, or sort again. The one exception is the payments backfill and the customer ledger: entries with the same date keep their input order. A shadow comparison may still compare them as sets, in case the planner changes.
- **`_id`** comes back from D1 as the 24-hex string. It gives the same JSON, and `String(x._id)` gives the same value. Code that calls ObjectId methods on it (`.equals`, `.getTimestamp`) would need a change; none of the listed callers does.

## Known limits (the D1 copy cannot tell these apart; none of them occurs in documents saved through the models)

1. **A field stored as `null` vs a missing field.** Both are `NULL` in D1, and the D1 read leaves the key out. A Mongo document with an explicit `null` (raw driver write, `$set: { x: null }`) shows `"x": null` from Mongo and no key from D1.
2. **A missing boolean vs `false`.** The copy stores 0 for both. Every boolean in this area has a schema default, so D1 always emits `false`/`true`; a legacy document without the field differs.
3. **A missing array vs `[]`.** No child rows means `[]` where the schema defaults to `[]` (`items`, `payments`, `emiSchedule`, estimate `items`), and no key where the default is `undefined` (`linkedInvoices`).
4. **Missing `createdAt` / `updatedAt` / `__v`.** The copy fills them in (from the ObjectId time, or 0), so D1 shows them.
5. **Values the copy converted.** A number stored as text in a number column (`"1,200"` → 1200), a non-date string in a Date column (kept as text), and Dates inside unknown (`extra`) fields or JSON columns (they come back as ISO strings). JSON output is the same except for the first case.
6. **Regex filters** run in JS with the same pattern (`new RegExp`), not in MongoDB's PCRE. They behave the same for every pattern the screens send. A pattern valid in only one engine throws on one side only.
7. **Type-strict comparisons.** Mongo does not match `{ paidAmount: { $gt: 0 } }` against a number stored as a string, nor `"payload.requestedBy.id"` against an ObjectId. D1 has already converted those values, so it would match them.

## Out of scope for this list (sales collections read elsewhere)

- **Reads on write paths** (POST / PUT / DELETE and their helpers), which move with the write cutover:
  - `nextNumberInSeries` in `app/api/invoices/route.ts` and the other reads in its POST / PUT / DELETE;
  - `lib/finance-do.ts`, `lib/financeSettlement.ts`, `lib/invoice-full-edit.ts`, `lib/payment-change.ts`, `lib/change-requests.ts`, `lib/challan-claims.ts`;
  - `lib/discount-approval.ts` `missingApprovals` (bill / estimate save);
  - `lib/sale-cost.ts` `freezeMissingLineCosts` (VSP import);
  - `app/api/invoices/print` (POST only), `app/api/estimates/review` (POST only), `app/api/invoices/gst-fix`, `app/api/fix-invoices`.
- **`sales_orders`**: only `app/api/seed` reads the SalesOrder model. "Sales orders" on screen are invoices with `type: "sales-order"` (`orders.list`).
- **GET routes not in the B2 list:** `delivery/*` (store-exit, verify-otp, proof, verify-serial, boys), `search`, `items`, `items/history`, `items/my-sales`, `serial-numbers`, `inventory/stock-flow`, `reports/product-ledger`, `reports/performance`, `audit`, `db-check/*`, `admin/debug-stock`, `finance/parse-do`. Each reads invoices or challans and needs its own entry when its area moves.
- **`lib/ledger.ts`** reads nothing; it builds ledgers from rows passed in (the reads are `vendorsLedger.*` above).
