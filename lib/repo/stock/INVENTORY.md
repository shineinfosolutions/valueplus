# Stock, purchase and cash reads — inventory (D1 stage B2)

Every MongoDB read of the 25 collections of `d1/migrations/0003_stock_cash.sql` made by a GET route, by the purchase
serial / import preview, or by a lib helper the routes share. Each one is an entry of `STOCK_READS`
(`lib/repo/stock/index.ts`): `mongo(args)` runs the query exactly as the code runs it today, `d1(args, db?)` returns
the same documents from D1. Parity: `tests/d1-stock-reads.test.ts`.

Files: `purchases.ts`, `inventory.ts`, `vendors.ts`, `cash.ts`; shared row → document code in `d1-doc.ts`.
The routes call them through `readStock(name, args)` (`shadow-read.ts`: the `read:stock` switch, with the comparison
rules per read). Test of the wiring: `tests/d1-wiring-stock-staff.test.ts`.

Left on MongoDB on purpose (a read that decides a WRITE, or works on mongoose documents): `purchaseEntries.byBillNo`
and `serialNumbers.byNumbers` (POST serials, PUT / DELETE purchase entries, change requests), the serial-number
reconcile's `purchaseEntries.allNatural` (it upserts serials from what it reads), `dayCloses.latest` in POST
/api/day-close (which day it is about to close), `dayCloses.allAsc` (recompute writes), `bankAccounts.legacy` (the
one-off clean-up script, which deletes), and the bank-accounts default / IFSC back-fill path (the list itself is
switched; when it needs a write it reads MongoDB again). The reads of lib/cashRegister.ts, dashboard/stats,
profit-loss, product-ledger, gstr-reports are wired by their own owner.

## What "the same" means

- **Shape.** `d1` rebuilds the whole Mongo document: `_id` as the 24-hex string (what the route sends after JSON),
  columns under their field names and types (text / number / boolean / Date / parsed JSON), flattened
  subdocuments folded back (`vendors.address_*` → `address`, `bank_*` → `bankDetails`, `variants.valuesJson` →
  `values`), `extra` merged back, line arrays rebuilt from the child tables in `lineNo` order (line `_id` as a
  string), `createdAt` / `updatedAt` as Date, `__v`. A projection is then applied the way MongoDB applies it (dotted
  paths into arrays keep only the array's objects, each reduced to the sub-path; `_id` kept unless `_id: 0`).
  After `JSON.stringify` both sides are equal (keys sorted).
- **Mongoose documents.** Reads without `.lean()` (`expenses.list`, `expenses.cash`, `cashTransactions.all`,
  `purchaseEntries.byBillNo`, `dayCloses.latest`, `dayCloses.allAsc`, `bankAccounts.list`, `serialNumbers.search`)
  return hydrated documents from Mongo; `d1` returns plain objects with the same JSON. A caller that uses document
  methods (`.save()` in bank-accounts' ifsc back-fill, `tx.referenceNo` getters are fine) must keep the write on Mongo.
- **Filters.** Equality, `$ne` (a missing / NULL field matches), ranges on text dates (text order = date order),
  `$in` (one bound JSON parameter, `json_each`, so no 100-parameter limit), array element matches
  (`items.itemId` → `EXISTS` on the line table; `mergedFrom $in` → `json_each`).
  **Regex → SQL** only when SQL is exact: an ASCII literal (escaped or with no regex characters) becomes
  `instr(lower(col), ?) > 0` (contains; D1 limits LIKE patterns to 50 bytes) or `lower(col) = ?` (anchored
  `^…$`); SQLite's `lower()` folds ASCII only, exactly what JS `/lit/i` does for an ASCII literal. A non-ASCII
  literal (Devanagari) or a real pattern (the serial-number list and global search build the regex from raw input,
  unescaped) is tested in JS with the same `RegExp` after the SQL filter, before the limit. An invalid pattern
  throws on both sides.
- **Order.** Each SQL `ORDER BY` is the Mongo sort plus a final tie-break. Reads with no sort return the plan's order:
  stored order (`ORDER BY id`) for a collection scan; where the filter walks an index the index order
  (`purchaseEntries.profitLoss` with a bill-date range → index `{ billDate: -1, createdAt: -1 }`;
  `serialNumbers.byNumbers` → serial-number order; `expenses.byIds` → `_id` order). `purchaseEntries.gstr2`
  (`sort billDate: 1`) is served live by that index read backwards, so ties come `createdAt` ascending, then newest
  stored first (`billDate, createdAt, id DESC`).

## Inventory

`S` = sort, `L` = limit, `P` = projection, "stored" = no sort (natural order). Shape: whole document unless a
projection is given; "+lines" = line array from the child table.

### Purchases (`purchases.ts`)

| Read | Used by | Mongo query | Shape |
|---|---|---|---|
| `purchaseEntries.list` | GET /api/purchase-entries[?type] | `find(type ? {type} : {type:{$ne:"debit-note"}})` S `createdAt:-1`, lean | +lines |
| `purchaseEntries.allNatural` | GET /api/serial-numbers (reconcile), GET /api/vendors/ledger?party=supplier | `find({})` stored, lean | +lines |
| `purchaseEntries.allNewestFirst` | GET /api/admin/debug-stock | `find({})` S `createdAt:-1`, lean | +lines |
| `purchaseEntries.byBillDateDesc` | GET /api/inventory/stock-flow; GET /api/reports/product-ledger (range only if both dates) | `find({billDate:{$gte,$lte}}?)` S `billDate:-1, createdAt:-1`, lean | +lines |
| `purchaseEntries.gstr2` | GET /api/gstr-reports?type=GSTR2 | `find({})` S `billDate:1`, lean | +lines |
| `purchaseEntries.agedStock` | GET /api/reports/aged-stock | `find({})` P `billDate,date,createdAt,status,type,items.itemId,items.name`, stored | projected, lines reduced |
| `purchaseEntries.dashboard` | GET /api/dashboard/stats | `find({})` P PURCHASE_FIELDS, stored | projected, no lines |
| `purchaseEntries.profitLoss` | GET /api/reports/profit-loss | `find({status:{$ne:"cancelled"}, billDate range?})` stored (index order with a range) | +lines |
| `purchaseEntries.brandInfo` | GET /api/items/brand-info | `find({type≠debit-note, status≠cancelled, $or:[items.itemId=id, items.name=name]})` P `billNo,supplierName,billDate,items` S `billDate:-1` L 5 | projected +lines |
| `purchaseEntries.byBillNo` | POST /api/purchase-entries/serials, PUT/DELETE /api/purchase-entries, lib/change-requests.ts | `findOne({billNo})` (document) | +lines |
| `deletedPurchaseEntries.audit` | GET /api/audit?view=deleted-purchase-entries | `find({deletedAt: IST day range?, $or:[billNo,supplierName,deletedBy ~ /q/i]})` S `deletedAt:-1` L limit | whole (snapshot JSON) |
| `purchaseOrders.list` | GET /api/purchase-orders | `find({})` S `createdAt:-1`, lean | items JSON |
| `purchaseOrders.dashboard` | GET /api/dashboard/stats | `find({})` P `status,date,createdAt,totalAmount` S `createdAt:-1` | projected |
| `expenses.list` | GET /api/expenses | `find({})` S `createdAt:-1` (documents) | whole |
| `expenses.dashboard` | GET /api/dashboard/stats | `find({})` P `warehouse,branchName,date,createdAt` S `createdAt:-1` | projected |
| `expenses.byIds` | GET /api/dashboard/stats (`loadComplete(Expense, rows)`) | `aggregate([{$match:{_id:{$in}}}])` | whole, `_id` order |
| `expenses.profitLoss` | GET /api/reports/profit-loss | `find({date range?})` stored, lean | whole |
| `expenses.cash` | lib/cashRegister.ts (cash register, day close, admin cash, calibrate) | `find({$or:[paymentMode Cash/cash]})` S `createdAt:-1` (documents) | whole |
| `productCatalogReferences.list` | GET /api/product-reference | `find({})` S `vpCode:1` | whole |
| `productCatalogReferences.withCategory` | POST /api/purchase-entries/import (preview) | `find({category:{$ne:""}})` P `vpCode,category,brand` | projected |
| `productCatalogReferences.groupMappings` | POST /api/product-reference/parse | `find({groupName:{$in}, category:{$ne:""}})` P `groupName,category` | projected |
| `variants.list` | GET /api/variants | `find({})` S `createdAt:-1` | `values` from `valuesJson` |
| `serialNumbers.byNumbers` | POST /api/purchase-entries/serials | `find({serialNumber:{$in}})` P `serialNumber,status,purchaseEntryId` or `serialNumber` | projected, serial order |

### Stock (`inventory.ts`)

| Read | Used by | Mongo query | Shape |
|---|---|---|---|
| `stockAdjustments.list` / `stockJournals.list` / `stockRequests.list` / `stockReturns.list` / `billOfMaterials.list` / `stockTransfers.list` | GET /api/inventory/{adjustment,journal,request,return,bom}, GET /api/stock-transfers | `find({})` S `createdAt:-1`, lean | +lines (adjustments, journals, transfers) / items, components JSON |
| `stockTransfers.byDateDesc` | GET /api/inventory/stock-flow | `find({})` S `date:-1, createdAt:-1` | +lines |
| `productLedger.movements` | GET /api/reports/product-ledger | raw driver `db.collection(c).find({}).toArray()` for stock_adjustments, stock_returns, stock_journals, stocktransfers | whole, stored |
| `inventoryAudits.forDay` | GET /api/inventory/audit?checkPending (and POST start) | `findOne({auditDate, kind: "mobile" / {$ne:"mobile"}})` S `createdAt:-1` | +lines (≈450) |
| `inventoryAudits.byId` | GET /api/inventory/audit?id= | `findById` | +lines |
| `inventoryAudits.list` | GET /api/inventory/audit[?date] | `aggregate($match, $sort auditDate:-1 createdAt:-1, $limit 200, $addFields total/counted, $project items:0)` | no lines, `total`, `counted` from the line table |
| `serialNumbers.list` | GET /api/serial-numbers | `find({status?, vpCode?, itemId?, itemName ~ RegExp(raw name, "i")})` S `createdAt:-1` | history JSON |
| `serialNumbers.productLedger` | GET /api/reports/product-ledger | `find({$or:[vpCode=itemVpCode, vpCode=itemCode, itemId, itemName ~ /^name$/i]})` stored | whole |
| `serialNumbers.search` | GET /api/search | `find({$or:[serialNumber, vpCode, itemName ~ RegExp(raw q, "i")]})` L 5 (documents) | whole |
| `stockOrders.list` | GET /api/stock-orders[?status] (salesman: + his request numbers first) | `find({salespersonId},{requestNumber:1})` then `find({status?, $or:[salespersonId, mergedFrom $in mine]})` S `createdAt:-1` L 200 | items / mergedFrom JSON |
| `stockOrders.pending` | lib/stock-order-retention.ts | `find({status:"pending"})` P `requestNumber,salesperson,createdAt` S `createdAt:1` | projected |
| `supplierStock.lastUpload` | GET /api/supplier-stock | `findOne({})` S `createdAt:-1` | whole |
| `supplierStock.items` | GET /api/supplier-stock | `find({active:true, availableStock:{$gt:0}})` S `isNewArrival:-1, brand:1, description:1` | whole |

### Vendors (`vendors.ts`)

| Read | Used by | Mongo query | Shape |
|---|---|---|---|
| `vendors.list` | GET /api/vendors[?status] | `find({status?})` S `createdAt:-1` | address / bankDetails rebuilt |
| `vendors.ledger` | GET /api/vendors/ledger | `find({_id:id})` or `find({})` stored (bad id throws CastError on both) | whole |
| `vendors.dashboard` | GET /api/dashboard/stats | `find({})` P `name,code,phone,openingBalance,openingBalanceDate` | projected |
| `vendorBills.list` | GET /api/vendors/bills[?vendorId] | `find({vendorId?})` S `date:-1, createdAt:-1` | items JSON |
| `vendorBills.ledger` | GET /api/vendors/ledger | `find({vendorId:id})` or `find({})` stored | whole |
| `vendorBills.detail` | GET /api/vendors/ledger?id= | `find({vendorId})` S `date:1` | whole |
| `vendorBills.dashboard` | GET /api/dashboard/stats | `find({status:{$ne:"cancelled"}})` P `vendorId,date,billNo,total,dueDate` | projected |
| `vendorPayments.list` | GET /api/vendors/payments | `find({vendorId?, date range?})` S `date:-1, createdAt:-1` | whole |
| `vendorPayments.ledger` / `vendorPayments.detail` / `vendorPayments.dashboard` | GET /api/vendors/ledger, GET /api/dashboard/stats | `find({vendorId:id})`/`find({})` stored; detail S `date:1` | whole |

### Cash (`cash.ts`)

| Read | Used by | Mongo query | Shape |
|---|---|---|---|
| `cashTransactions.all` | lib/cashRegister.ts (GET /api/cash-register, /api/day-close, /api/admin-cash, recompute, calibrate) | `find({})` S `createdAt:-1` (documents) | whole |
| `cashRegisterSetting.get` | lib/cashRegister.ts | `findOne({key:"cash-register"})` | whole |
| `dayCloses.latest` | GET /api/day-close (getPendingDate) | `findOne({})` S `date:-1` (document) | denominations JSON |
| `dayCloses.latestDate` | lib/day-close-pending.ts (GET /api/me/summary) | `findOne({}, {date:1})` S `date:-1` | `{_id, date}` |
| `dayCloses.history` | GET /api/day-close | `find({})` S `date:-1` L 60 | whole |
| `dayCloses.allAsc` | POST /api/day-close/recompute | `find({})` S `date:1` (documents) | whole |
| `adminCashEntries.book` | GET /api/admin-cash (buildBook) | `find({})` S `date:1, createdAt:1` | whole |
| `bankAccounts.list` | GET /api/bank-accounts | `find(NOT_LEGACY_CASH_REGISTER)` S `createdAt:-1` (documents) | whole |
| `bankAccounts.legacy` | lib/legacy-rows.ts cleanupLegacyBankWarehouse | `find(LEGACY_CASH_REGISTER)` P `name,number,type` | projected |

### Not reads of this area / left out

- `lib/ledger.ts`, `lib/purchase-payments.ts`, `lib/agedStock.ts`, `lib/supplier-stock.ts` (sheet parsing): pure
  functions, no database read; they work unchanged on what `d1` returns.
- The rest of `lib/cashRegister.ts` (invoices, finance, payments) and the item / invoice / supplier / customer reads
  in stock-flow, product-ledger, reports/stock, low stock (dashboard `lowStockItems` reads `items`): masters and sales
  areas.
- Reads made only inside writes (POST/PUT/DELETE look-ups such as `Supplier.findOne`, `BankAccount.findById` in
  admin-cash POST, `SerialNumber.findOne` in lib/invoice-full-edit.ts / lib/challan-claims.ts, counts for the next
  number): stage C (writes), except the purchase serial and import-preview reads listed above.

## Known differences (not identical, and why)

1. **Order of complete ties.** For a sort MongoDB does in memory, documents with the same sort key come back in an
   unspecified order: its sort is not stable beyond ~16 documents, and the order differs between server builds (the
   Windows test server and Linux Atlas disagree), so it cannot be reproduced. D1 returns ties in `_id` (stored)
   order, which is also what MongoDB returns for small sets and forward index scans. The test puts each run of equal
   sort keys in `_id` order on both sides (`TIE_KEYS`); the order between different keys is compared as is.
   Consequence: a `limit` that cuts through a run of equal keys (`deletedPurchaseEntries.audit`, `brandInfo` L 5,
   `stockOrders.list` L 200; not `dayCloses.history`, whose date is unique) may keep a different member of the run.
2. **Index-dependent order.** `gstr2` and `profitLoss` (with a range) reproduce the order of the production index
   `purchase_entries { billDate: -1, createdAt: -1 }` (lib/ensure-indexes.ts). Where that index is missing MongoDB
   falls back to case 1.
3. **Values the copy does not keep** (lib/d1/maps/stock-cash.ts): an explicit `null` comes back as a missing field
   (the test drops null-valued keys on both sides); a missing `__v` comes back as `0`; a value whose type differs from
   its column (a number in a text column → text, a numeric string in a real column → number, a date-like string in a
   date column → Date); a legacy plain-string vendor address comes back as `{ line1 }`; Dates inside JSON columns and
   `extra` (e.g. `SerialNumber.history[].date`) come back as ISO strings (same JSON). Missing booleans come back as
   `false` (NOT NULL columns); every model has a default for them.
4. **Mongoose defaults.** A hydrated (non-lean) read fills schema defaults for fields missing in the stored document;
   D1 returns only what was stored. Identical for documents written by the app.
5. **Stored order = `_id` order.** D1 has no record ids; natural order is taken as `_id` order, which is insertion
   order for documents created by the app (a document inserted later with an older explicit `_id` would differ).
6. **Regex flavour.** The JS post-filter uses JS regex semantics; MongoDB uses PCRE. They agree on every pattern the
   app builds (escaped literals) and on ordinary user input.
