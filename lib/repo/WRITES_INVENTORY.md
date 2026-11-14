# Write paths inventory (Stage D roadmap)

Every place the app writes MongoDB, grouped by the cutover unit it moves with (docs/D1_MIGRATION_PLAN.md §6.6,
§6.8a). "Done" means: the route has a D1 path behind `getWriteMode(<area>)` (lib/d1/write-mode.ts) and its collections
are listed in `WRITE_AREA_COLLECTIONS` (lib/d1/write-areas.ts). Everything else still writes MongoDB first and is copied
into D1 by the write-through (lib/d1/write-through.ts), whatever the switches say.

**The rule for adding a collection to a write area:** EVERY writer of that collection must have a D1 path first. In
'd1' mode the write-through skips the area's collections, so a MongoDB write left behind by an unwired route would
never reach D1, and the reverse mirror would later overwrite it in MongoDB with D1's older copy. That is why a route's
unit below is the LATEST unit among all the collections it writes, and why some §6.6 "U1" collections are listed
under a later unit.

Built from a scan of `app/api/**/route.ts` and `lib/*.ts` (model write calls, `.save()` on loaded documents, raw
`collection(x)` writes, and the lib helpers each route calls), checked by hand. Collections are MongoDB collection
names. `*` = written through `.save()` on a document the route loaded.

## Counts

| Unit | Write paths | Done | Left |
|---|---|---|---|
| U1 master and settings | 15 | 6 | 9 (2 of them a script / local-only tools) |
| U2 logs and notifications | 6 | 0 | 6 |
| U3 people and HR | 14 | 0 | 14 |
| U4 CRM and pre-sale | 9 | 0 | 9 |
| U5 money and stock | 61 | 0 | 61 |
| **Total** | **105** | **6** | **99** |

A "write path" is one route file (all its write methods together) or one shared lib writer / cron.

## U1 master and settings (write area `masters`, switch `write:masters`)

| # | Route / file | Methods | Collections written | Status |
|---|---|---|---|---|
| 1 | app/api/brands | POST, PUT, DELETE | brands | **done** (lib/repo/masters/writes.ts) |
| 2 | app/api/categories | POST, PUT, DELETE | categories | **done** |
| 3 | app/api/units | POST, DELETE | units | **done** |
| 4 | app/api/variants | POST, DELETE | variants (read area `stock`) | **done** |
| 5 | app/api/warehouses | GET (first-run defaults), POST, PUT, DELETE | warehouses (DELETE also reads items in MongoDB: stock is U5) | **done** |
| 6 | app/api/product-reference | POST | product_catalog_references (read area `stock`) | **done** |
| 7 | app/api/documents/folders | POST, PUT, DELETE | document_folders (read area `crm`) | not done |
| 8 | app/api/documents | POST, PUT, DELETE | stored_documents (+ Cloudinary file; read area `crm`) | not done |
| 9 | app/api/onsitego/plans (+ lib/onsitego-server.ts) | POST | onsitego_plans (replace all), stored_documents, document_folders | not done |
| 10 | app/api/staff/shifts (+ lib/shift-settings.ts default row) | POST | shift_settings (read area `staff`) | not done |
| 11 | app/api/roles | PUT, DELETE | role_permissions (read area `staff`) | not done |
| 12 | app/api/whatsapp/settings | PUT | whatsapp_settings (read area `crm`) | not done |
| 13 | app/api/price-lock/pin (+ lib/priceLock.ts) | PUT | price_unlock_settings, audit_logs (U2) | not done: needs U2 (its audit row) |
| 14 | lib/legacy-rows.ts via scripts/cleanup-legacy-bank-warehouse.ts | script | warehouses, bank_accounts | script: run only while `write:masters` = 'mongo' |
| 15 | app/api/seed, app/api/admin/import-stock, app/api/admin/import-stock4 | POST | brands, categories, units, variants, items, purchase_entries, stock_journals, ... | local-only tools (blocked on the deployed Worker by worker.ts BLOCKED_API_PREFIXES); never run against a D1-owned area |

Out of the U1 write area on purpose (§6.6 lists some of them under U1, but other units write them):

| Collection | Why it waits | Moves with |
|---|---|---|
| items (create / update / delete and every items/* route) | stock quantities (`currentStock`, `showroomStock`, `godownStock`, `stockByWarehouse`) are written by every bill, purchase, transfer, adjustment (lib/stock.ts); `purchasePrice` by purchase entries and purchase orders; items are created by purchase entries and the dashboard POST. A D1 master edit and a MongoDB stock move of the same item would each overwrite the other. Money-touching item fields: `purchasePrice`, `sellingPrice`, `vsp`, `mrp`, `minSellingPrice`, `lockedMinPrice`, `maxDiscount*`, `incentive*`, `currentStock`, `openingStock`, `showroomStock`, `godownStock`, `stockByWarehouse`. | U5 |
| customers | `outstandingBalance`, `advanceBalance`, `loyaltyPoints` written by bills, payments, advances | U5 |
| suppliers | `outstandingBalance` written by purchase entries | U5 |
| billing_companies | `usageCount` is bumped (`$inc`) by every invoice and estimate save | U5 |

## U2 logs and notifications

| # | Route / file | Methods | Collections written | Status |
|---|---|---|---|---|
| 1 | lib/notify.ts (called by approvals, cash-register, crm/leads, discount-approvals, estimates, estimates/review, invoices, staff/attendance, staff/break, staff/incentive-payout, staff/leave-requests, staff/tasks, stock-orders, supplier-stock and 6 lib helpers / crons) | n/a | notifications (insertMany), push via lib/push.ts | not done |
| 2 | lib/push.ts (+ app/api/push/test) | POST | push_subscriptions (`lastSuccessAt`, dead subscriptions deleted) | not done |
| 3 | app/api/push/subscribe | POST, DELETE | push_subscriptions | not done |
| 4 | app/api/whatsapp (+ lib/whatsapp/notify.ts, lib/whatsapp/retry.ts) | POST, PUT, DELETE | whatsapp_messages | not done |
| 5 | audit_logs rows written inline by about 25 routes (`AuditLog.create`) and lib/change-requests.ts, lib/invoice-full-edit.ts | n/a | audit_logs | not done: each audit write must join its route's D1 batch, so it moves with that route's unit; U2's own switch can only go to 'd1' once every writer of audit_logs has a D1 path |
| 6 | app/api/notifications | PATCH (mark read) | notifications, staff_tasks (read receipts, U3) | not done: moves with U3 (staff_tasks) |

## U3 people and HR

| # | Route / file | Methods | Collections written | Status |
|---|---|---|---|---|
| 1 | app/api/users | POST, PUT, DELETE | users | not done |
| 2 | lib/authOptions.ts (NextAuth sign-in) | n/a | users (last login, PIN lock) | not done |
| 3 | app/api/auth/security-pin (+ lib/securityPin.ts) | PUT | users, audit_logs | not done |
| 4 | lib/priceLock.ts (PIN attempts) | n/a | users, price_unlock_settings | not done |
| 5 | app/api/staff/attendance | POST, DELETE | attendance, users (`advanceBalance`), shift_settings (default row), leaverequests (presence), notifications | not done |
| 6 | app/api/staff/attendance/photo | POST | attendance (photo URL) | not done |
| 7 | app/api/staff/break | POST | leaverequests, notifications | not done |
| 8 | app/api/staff/presence (+ lib/presence.ts) | POST | leaverequests | not done |
| 9 | app/api/staff/leave-requests | POST, PATCH | leaverequests, attendance, notifications | not done |
| 10 | app/api/staff/salary | POST, PUT | salaries | not done |
| 11 | app/api/staff/tasks | POST, PUT, DELETE | staff_tasks, notifications | not done |
| 12 | app/api/cron/attendance (lib/attendance-alerts.ts) | GET (cron) | scheduled_runs, notifications | not done |
| 13 | app/api/cron/office-start and app/api/notifications GET (lib/office-reminder.ts) | GET | scheduled_runs, notifications | not done |
| 14 | app/api/auth/seed | GET (local-only, blocked on the Worker) | users | tool |

## U4 CRM and pre-sale

| # | Route / file | Methods | Collections written | Status |
|---|---|---|---|---|
| 1 | app/api/crm/leads | POST, PUT | leads, users (assignment counters), whatsapp_messages, notifications | not done |
| 2 | app/api/crm/walk-in | POST, PUT | walk_in_queries, leads, whatsapp_messages | not done |
| 3 | app/api/crm/complaints | POST, PUT | customer_complaints, whatsapp_messages | not done |
| 4 | app/api/discount-approvals | POST, PATCH | discountapprovals, notifications | not done |
| 5 | app/api/estimates | POST, PUT, DELETE | estimates, leads, audit_logs, deleted_invoices (U5, on DELETE), billing_companies (U5, via the billing form) | not done: the DELETE part needs U5 |
| 6 | app/api/estimates/review | POST | estimates, audit_logs, notifications | not done |
| 7 | app/api/stock-orders | POST, PATCH | stock_order_requests, audit_logs, notifications | not done |
| 8 | app/api/cron/stock-orders (lib/stock-order-retention.ts) | GET (cron) | stock_order_requests, scheduled_runs, notifications | not done |
| 9 | app/api/supplier-stock | POST | supplier_stock_uploads, supplier_stock_items, audit_logs, notifications | not done |

## U5 money and stock (one flip, after shop close)

| # | Route / file | Methods | Collections written | Status |
|---|---|---|---|---|
| 1 | app/api/invoices (+ lib/invoice-full-edit.ts, lib/sale-cost.ts, lib/finance-do.ts, lib/change-requests.ts, lib/stock.ts) | POST, PUT, DELETE | invoices, customers, items (stock), customer_advances, payment_transactions, serial_numbers, estimates, leads, staff_tasks, deleted_invoices, finance_transactions, billing_companies, audit_logs, notifications, store_activity_approvals | not done |
| 2 | app/api/invoices/print | POST | invoices (print log) | not done |
| 3 | app/api/invoices/gst-fix | POST | invoices, items, audit_logs | not done |
| 4 | app/api/orders | POST | invoices / sales_orders | not done |
| 5 | app/api/payments (+ lib/payment-change.ts) | POST, PUT, DELETE | payment_transactions, invoices, customers, audit_logs, store_activity_approvals | not done |
| 6 | app/api/finance (+ lib/financeSettlement.ts) | POST, PUT | finance_transactions, invoices, bank_accounts, payment_transactions, customers | not done |
| 7 | app/api/finance/parse-do | POST | finance_transactions (DO upload) | not done |
| 8 | app/api/delivery-challans (+ lib/challan-claims.ts) | POST, PUT, DELETE | delivery_challans, serial_numbers, purchase_entries, suppliers, items | not done |
| 9 | app/api/delivery/proof | POST | delivery_challans, invoices | not done |
| 10 | app/api/delivery/store-exit | POST | invoices, delivery_challans, audit_logs | not done |
| 11 | app/api/delivery/verify-otp | POST | invoices, delivery_challans, audit_logs | not done |
| 12 | app/api/delivery/verify-serial | POST | serial_numbers / invoices | not done |
| 13 | app/api/eway-bills | POST, PUT | eway_bills | not done |
| 14 | app/api/warranty | POST | extended_warranties | not done |
| 15 | app/api/serial-numbers | POST, PUT, DELETE | serial_numbers | not done |
| 16 | app/api/billing-companies | POST | billing_companies (`$inc usageCount`) | not done |
| 17 | app/api/customers | POST, PUT, DELETE | customers | not done |
| 18 | app/api/suppliers | POST, PUT, DELETE | suppliers | not done |
| 19 | app/api/crm/advances | POST, PUT | customer_advances, customers, audit_logs | not done |
| 20 | app/api/purchase-entries (+ lib/purchase-correction.ts, lib/stock.ts) | POST, PUT, DELETE | purchase_entries, items, suppliers, serial_numbers, purchase_orders, stock_requests, staff_tasks, deleted_purchase_entries, audit_logs, store_activity_approvals | not done |
| 21 | app/api/purchase-entries/import | POST | purchase_entries / items | not done |
| 22 | app/api/purchase-entries/serials | POST | serial_numbers, suppliers, purchase_entries, items, audit_logs | not done |
| 23 | app/api/purchase-orders | POST, PUT, DELETE | purchase_orders, items (`purchasePrice`), suppliers, staff_tasks | not done |
| 24 | app/api/vendors | POST, PUT, DELETE | vendors | not done |
| 25 | app/api/vendors/bills | POST, PUT | vendor_bills | not done |
| 26 | app/api/vendors/payments | POST, DELETE | vendor_payments | not done |
| 27 | app/api/stock-transfers (+ lib/stock.ts) | POST, PUT, DELETE | stocktransfers, items | not done |
| 28 | app/api/inventory/adjustment (+ lib/stock.ts) | POST, DELETE | stock_adjustments, items | not done |
| 29 | app/api/inventory/journal (+ lib/stock.ts) | POST | stock_journals, items | not done |
| 30 | app/api/inventory/request | POST | stock_requests | not done |
| 31 | app/api/inventory/return | POST | stock_returns, items | not done |
| 32 | app/api/inventory/bom | POST | bill_of_materials | not done |
| 33 | app/api/inventory/audit | POST, PUT | inventory_audits, users | not done |
| 34 | app/api/cash-register | POST, PATCH | cash_transactions, expenses, bank_accounts, audit_logs | not done |
| 35 | app/api/cash-register/calibrate | POST | cash_register_settings, audit_logs | not done |
| 36 | app/api/day-close | POST | day_closes | not done |
| 37 | app/api/day-close/recompute | POST | day_closes, audit_logs | not done |
| 38 | app/api/admin-cash | POST, PATCH | admin_cash_entries, bank_accounts, audit_logs | not done |
| 39 | app/api/bank-accounts (+ lib/legacy-rows.ts) | POST, PUT, DELETE | bank_accounts | not done |
| 40 | app/api/expenses | POST, PUT, DELETE | expenses | not done |
| 41 | app/api/staff/incentive-payout | POST | incentive_payouts, expenses, audit_logs, notifications | not done (expenses = money) |
| 42 | app/api/staff/fix-name (+ lib/staff-rename.ts) | POST | users and the staff name on invoices / other documents | not done |
| 43 | app/api/accounting/accounts | POST | accounts | not done |
| 44 | app/api/accounting/journal | POST | journal_entries, accounts | not done |
| 45 | app/api/approvals (+ lib/change-requests.ts, lib/deferred-actions.ts) | POST, PUT | store_activity_approvals, audit_logs, notifications, and whatever the approved request's route writes | not done |
| 46 | app/api/price-lock | PUT | items (`lockedMinPrice`), audit_logs | not done |
| 47 | app/api/dashboard/stats | POST | invoices, customers, items (quick-create forms) | not done |
| 48 | app/api/items | POST, PUT, DELETE | items | not done (see "out of the U1 write area") |
| 49 | app/api/items/delete | DELETE | items | not done |
| 50 | app/api/items/assign-brands | POST | items, audit_logs | not done |
| 51 | app/api/items/bulk-incentive | POST | items | not done |
| 52 | app/api/items/gst-fix | POST | items, audit_logs | not done |
| 53 | app/api/items/incentive-rules | PUT | items | not done |
| 54 | app/api/items/purchase-gst-flag | POST | items, audit_logs | not done |
| 55 | app/api/items/supplier-codes | POST | items | not done |
| 56 | app/api/items/vp-code-backfill | POST | items | not done |
| 57 | app/api/items/vp-code-import | POST | items, audit_logs | not done |
| 58 | app/api/items/vsp-import (+ lib/sale-cost.ts) | POST | items, invoices (sale cost), audit_logs | not done |
| 59 | lib/stock.ts (applyStockMovement / recomputeAggregates) | n/a | items (stock), called by invoices, purchases, transfers, adjustments, journals | not done |
| 60 | lib/delivery-reminders.ts (from app/api/notifications GET) | n/a | invoices (reminder marks), notifications | not done |
| 61 | app/api/accounting/seed, app/api/fix-invoices | GET (local-only, blocked on the Worker) | accounts, invoices | tools |

No database write (nothing to move): app/api/upload (Cloudinary only), app/api/product-reference/parse (parses a sheet).
