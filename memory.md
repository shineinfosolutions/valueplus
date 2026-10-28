# Developer Memory & Notes

> **Rule:** Whenever anything is added or changed in this project (feature, fix, config, deployment, APK), add it to the relevant section below **and** add a dated line to the **Change Log** at the bottom.

## 1. Sidebar Configuration & Navigation
- **Showroom Identity**: M/S ASHOKA ENTERPRISES (Value Plus Showroom), H. No. 116, Deoria Rd, Kunraghat, Gorakhpur (09), GSTIN: `09ANHPJ7242D1Z2`, Phone: `9140860604`.
- **Navigation Groups**: Located in `constants/navigation.ts`.
- **Hidden Modules**: `Banking`, `Accounting`, and `Marketing` are currently hidden from the sidebar navigation.
- **How to Unhide**: To restore them, open `constants/navigation.ts` and remove the `/* ... */` block comments surrounding their entries in the `NAV_GROUPS` array.

---

## 2. Dashboard Universal Filter & Data Sync
- **File**: `app/(dashboard)/dashboard/page.tsx`.
- **Universal Filter**: Handled by `handleUniversalFilterChange(val, customStart, customEnd)` which:
  1. Resolves start/end dates via `resolveDateRange()`.
  2. Updates `dateFilter`, `startDate`, `endDate`, and all `widgetFilters`.
  3. Invokes `loadAllDashboardData(s, e, val)`.
- **Offline-First Hydration**: `hydrateFromCache(s, e)` instantly renders from localStorage if cache exists for the requested date key. Avoid fallback to "Today" to prevent race condition overwrites when choosing past date presets.

---

## 3. Stock 4 Master Data & Direct Brand Products Catalog Navigation
- **Source File**: `Stock4_Cleaned_Brand_Model_Extraction.json`.
- **Direct Brand Products Catalog Navigation (`/masters/brands`)**:
  - Clicking any brand card immediately opens that brand's full product catalog with live inventory and pricing.
  - Features Category filter pills (`All Products`, `Air Conditioners`, `Refrigerators & Freezers`, `Televisions`, etc.) right on the page for instant sub-filtering.
  - Features stock filters (`In Stock`, `Low Stock`, `All`) and instant keyword search.
  - Table displays Product Name, VP Code, SKU, Category, HSN, GST %, Purchase Rate, Showroom Selling Price, MRP, Live Stock.
  - **"Bill Now" Direct Action**: 1-click opens the full `InvoiceCreationModal` directly inside the brand view so staff/admin can generate GST tax invoices, record customer details, finance/payment modes, and print bills on the spot.
  - Fixed badge spacing & padding (`gap-1.5`, `min-w-[280px]`) eliminating any text squishing or overlapping.
- **Official Brand Logos (Vector SVG Engine)**:
  - Implemented via `components/shared/brand-logo.tsx` (`BrandLogo` component).
  - Standalone, crisp SVG vector emblems and official wordmarks for all 27 showroom partner brands (`SAMSUNG`, `LG`, `DAIKIN`, `VOLTAS`, `VOLTASBEKO`, `HAVELLS`, `WHIRLPOOL`, `HAIER`, `LLOYD`, `BAJAJ`, `CARRIER`, `AISEN`, `PANASONIC`, `EUREKA FORBES`, `FABER`, `JBL`, `LUMINOUS`, `MAHARAJA WHITELINE`, `OPPO`, `REALME`, `VIVO`, `V-GUARD`, `SUNFLAME`, `TCL`, `SAFESTAB`, `HAPIPOLA`, `KRATOS`, etc.).
  - 100% offline-ready, 0ms load time, zero broken image icons.
- **Alphabetical Sorting (A-Z)**:
  - `app/api/brands/route.ts` sorts brands alphabetically using `.collation({ locale: "en", strength: 2 }).sort({ name: 1 })`.
  - Master pages and dropdown selectors render brands in strict A to Z alphabetical order (AISEN ➡️ BAJAJ ➡️ CARRIER ... ➡️ WHIRLPOOL).
- **Core Entities Synchronized**:
  1. **Items**: 350 valid active products with clean `VP-...` item codes, model numbers, HSN codes, GST rates, purchase prices, selling prices, MRPs, opening stocks, and current stocks.
  2. **Brands**: 27 active showroom partner brands.
  3. **Categories**: 9 intelligent consumer electronics categories.
  4. **Stock In & Out Ledger**: Date-stamped inward purchase entries (`VP-INW-2026-...`) & stock journals created with suppliers, inward quantities, and rates for seamless tracking on `/inventory/stock-flow`.

---

## 4. Admin & Staff Task Delegation System
- **Model**: `models/StaffTask.ts`.
- **API**: `app/api/staff/tasks/route.ts` (GET, POST, PUT, DELETE).
- **Dedicated Page**: `app/(dashboard)/staff/tasks/page.tsx`.
- **Core Features**:
  - Tasks can be assigned to **Admin (Self)** or any **Staff Member** (e.g., Amit Singh, Rahul Verma, Priya Sharma, etc.).
  - Priority levels: `Low`, `Medium`, `High`, `Urgent`.
  - Status lifecycle: `Pending` ➡️ `In Progress` ➡️ `Completed`.
  - 1-click completion toggle and quick task modal integrated both on dashboard and detailed hub.

---

## 5. Lead Pipeline & Automated Customer Conversion Engine
- **Model**: `models/Lead.ts`.
- **API**: `app/api/crm/leads/route.ts` (GET, POST, PUT, DELETE).
- **Dedicated Page**: `app/(dashboard)/marketing/leads/page.tsx`.
- **Automated Purchase Conversion**:
  - Whenever an invoice is generated via `app/api/invoices/route.ts`, the backend matches customer phone/name against active leads.
  - Automatically updates matching Lead status to `Converted`, records `convertedInvoiceNumber`, and pushes an audit timeline entry.

---

## 6. Product Floor Price (Admin PIN) & Target-Based Salesperson Incentive System
- **Product Floor Price (`minSellingPrice`)**:
  - Configurable per item on `/masters/items`.
  - Stored in MongoDB `Item.ts` (`minSellingPrice`).
  - During billing (`InvoiceCreationModal.tsx`), entering a price lower than `minSellingPrice` requires the Supervisor Admin PIN (`1234`).
  - Once verified, the special price is unlocked and marked as `adminApprovedRate: true`.
- **Target-Based Salesperson Incentive (Fixed ₹ / Percentage %)**:
  - Configured per product: `incentiveTargetAmount` (Target Selling Rate), `incentiveType` (`fixed` | `percentage` | `none`), and `incentiveValue`.
  - When salesperson sells at or above the target rate (`rate >= incentiveTargetAmount`):
    - **Fixed ₹**: `incentiveValue * quantity` (e.g. ₹500/piece)
    - **Percentage %**: `taxableAmount * (incentiveValue / 100)` (e.g. 2% or 5% of sale)
  - If sold below target rate (discounted), incentive is ₹0.
- **Salesperson Incentive Ledger (`/staff/incentives`)**:
  - Live commission leaderboard of all sales executives.
  - Invoice-level commission ledger and CSV export.

---

## 7. Cloudflare Deployment (Workers + OpenNext)
- **Live site**: https://valuplus.shineinfosolutions.in — Worker `valueplus-erp` (custom domain).
- **Staging (test copy)**: https://valueplus-erp-staging.shineinfosolutions1.workers.dev — Worker `valueplus-erp-staging`. Uses its **own test database `valueplus_staging`** (secret `MONGODB_DB=valueplus_staging`), so testing there never touches live data.
- **Refresh the staging data**: `node scripts/copy-db-to-staging.mjs` (drops and re-copies `valueplus` → `valueplus_staging`; never writes to live). In the staging copy the `admin` user's own Security PIN is cleared so the old shared test PIN works.
- **Database name**: `lib/db.ts` reads `MONGODB_DB` (default `valueplus`). Production secret `MONGODB_DB=valueplus` was set explicitly on 2026-10-26.
- **Cloudflare account**: shineinfosolutions1@gmail.com, **Workers Paid plan required** (bundle is ~4.8 MB gzip; Free plan limit is 3 MB).
- **Adapter**: `@opennextjs/cloudflare` (needs Next.js >= 15.5.28; project is on `next@15.5.28`).
- **Config files**:
  - `wrangler.jsonc` — top level = production (custom domain route, `NEXTAUTH_URL`), `env.staging` = staging (`routes: []` so it can never take the live domain).
  - `open-next.config.ts` — OpenNext config.
  - `worker.ts` — Worker entry: wraps `.open-next/worker.js`, blocks maintenance routes, closes the per-request DB client, and exports a stub `AppServer` Durable Object (kept only because an older deployment used it; removing it breaks deploys/rollback).
- **Secrets** (set with `npx wrangler secret bulk <file.json>` [`--env staging`]): `MONGODB_URI`, `MONGODB_DB`, `NEXTAUTH_SECRET`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Values come from `.env.local` — **strip the surrounding quotes** (quoted values broke `MONGODB_URI` once).
- **Local Workers preview**: `.dev.vars` (copy of `.env.local`, gitignored) then `npx wrangler dev`.
- **Deploy steps (always staging first)**:
  1. `npx opennextjs-cloudflare build`
  2. `npx opennextjs-cloudflare deploy --env staging` → test login + main APIs on staging
  3. `npx opennextjs-cloudflare deploy --env=""` → production
  4. Rollback if needed: `npx wrangler rollback --name valueplus-erp`

## 8. MongoDB on Cloudflare (per-request connection)
- **Problem**: Workers cannot reuse a socket opened by an earlier request; a cached mongoose connection makes the next request hang.
- **Fix** (`lib/db.ts`): on Workers only, every request opens its own `MongoClient`; mongoose's default connection `db`/`client` point to it, so models/routes need no changes. `worker.ts` closes it after the response. Local `npm run dev` / `next start` still use the normal pooled connection.
- **Cost**: ~0.35 s extra per API request on Cloudflare (new connection each time).
- **Database**: MongoDB Atlas, cluster in Mumbai, db `valueplus`.

## 9. PDF Purchase Import on Cloudflare
- `lib/purchase-import/pdf-env.ts` provides a pure-JS `DOMMatrix` and an in-process pdfjs worker (the native `@napi-rs/canvas` cannot run on Workers).
- `lib/purchase-import/pdf.ts` loads `pdf-parse` lazily (`await import`) after that setup. Output verified identical to the old Node + canvas version.
- `next.config.mjs` `serverExternalPackages`: `pdf-parse`, `pdfjs-dist`, `@napi-rs/canvas`.

## 10. Security
- **Blocked on Cloudflare (404)** via `BLOCKED_API_PREFIXES` in `worker.ts`: `/api/seed` (wipes DB), `/api/auth/seed` (resets demo accounts to default passwords), `/api/install-deps`, `/api/test-login`, `/api/fix-invoices`, `/api/db-check`, `/api/admin/import-stock`, `/api/admin/import-stock4`, `/api/admin/debug-stock`. They still work in local dev.
- **API login required**: `middleware.ts` `apiGate()` returns 401 JSON for every `/api/*` call without a session, except `/api/auth/*` (NextAuth, login) and `/api/track/*` (public order tracking page). `app/api/auth/seed/route.ts` itself requires an admin.
- **Known gaps (not fixed yet)**: middleware checks only "signed in", not role (e.g. a salesman can call `/api/users`); `/api/track/[id]` shows customer phone/address/OTP to anyone with an invoice number; `lib/db.ts` still has a hardcoded fallback MongoDB URI.
- **Demo accounts** (admin@, warehouse@, salesman@, cashier@, accounts@, hr@, storeincharge@, supplier@valueplus.in) have default passwords from `app/api/auth/seed/route.ts` — change them in Settings → Users.

## 11. Android App (APK / TWA)
- **Download link**: https://valuplus.shineinfosolutions.in/downloads/valueplus.apk (file: `public/downloads/valueplus.apk`; `public/_headers` forces download + `no-cache`).
- **Type**: Trusted Web Activity (opens the website full-screen). Package `app.vercel.valuplserpsystem.twa` (old name kept so installed apps update in place).
- **Signing key**: `android-apk/package/signing.keystore` + `signing-key-info.txt` (keep safe, never commit). SHA-256 fingerprint must match `public/.well-known/assetlinks.json`.
- **Versions**: v1 (`android-apk/valueplus-v1-vercel-old.apk`) opened the dead Vercel URL. v2.0.0 (versionCode 2, minSdk 24 / Android 7+) opens valuplus.shineinfosolutions.in, location delegation on, notifications off.
- **Rebuild**: project in `android-apk/twa/` (`twa-manifest.json`). Needs JDK 17 + Android SDK (build-tools 36.1.0, legacy `sdk/tools` layout) + `@bubblewrap/cli`. Bump `appVersionCode`, run `bubblewrap update --skipVersionUpgrade` then `bubblewrap build` with `BUBBLEWRAP_KEYSTORE_PASSWORD` / `BUBBLEWRAP_KEY_PASSWORD` set, and with `NoDefaultCurrentDirectoryInExePath` unset (else `gradlew.bat` is not found). Copy `app-release-signed.apk` to `public/downloads/valueplus.apk` and redeploy.

## 12. Performance Notes
- Heavy APIs: `/api/items`, `/api/reports/stock`, `/api/dashboard/stats` take ~4-5 s, **also on plain Node** — not a Cloudflare problem.
- Cause: MongoDB Atlas sends data at only ~100 KB/s (query runs in 0 ms on the server; 446 items = 380 KB = 3.9 s). Looks like Atlas free/shared-tier throttling (10 GB/week transfer limit). Compression did not help.
- Fix options: upgrade the Atlas cluster (Flex/M10), and/or send only needed fields + caching in the heavy APIs.

## 13. GST — HSN Summary Report (GSTR-1 Table 12)
- **Where**: Sidebar → GST & Financial Reports → **HSN Summary Report** (`/gst/hsn-summary`, right below "GST Reports"), and also the **HSN Summary** tab inside GST Reports (`/gst/reports`). Month selector at top.
- **Shared code**: `components/gst/hsn-summary.tsx` (`useHsnSummary`, `HsnSummaryView`, `HsnTable`, `exportHsnSummaryExcel`, `hsnExportRows`) is used by both places. Menu entry is in `constants/navigation.ts`.
- **API**: `GET /api/gstr-reports?type=HSN_SUMMARY&month=<0-11>&year=<yyyy>` (`app/api/gstr-reports/route.ts`) → `data: { b2b, b2c }`, `meta: { linesByRow, missingHsnLines, creditNotes }`.
- **Rules**:
  - Counts `tax-invoice` (+ `credit-note` as negative), skips `cancelled`.
  - B2B = customer has a valid 15-character GSTIN (same test as the GSTR-1 B2B/B2C tabs); everything else is B2C.
  - One row per **HSN + GST rate**, built from each bill's line items (qty, taxable, CGST/SGST/IGST).
  - HSN comes from the bill line; if blank, falls back to the product master; else shown as "HSN missing" with a warning.
  - Description = categories of the products actually sold in that row. UQC mapped from the line unit (PCS → `PCS-PIECES`, unknown → `OTH-OTHERS`). Cess is always 0 (not tracked).
- **UI** (`components/gst/hsn-summary.tsx`): summary cards (taxable, GST, B2B and B2C cards each show "Taxable" and "GST" on separate labelled lines, HSN count), separate B2B and B2C tables with totals row, click a row to see its bill lines.
- **Export**: "HSN Excel (B2B + B2C)" button → one .xlsx with `hsn(b2b)` and `hsn(b2c)` sheets in portal column order (`exportSheetsToExcel` in `lib/export/excel.ts`); the normal Export menu gives one combined table with a Section column (Excel/PDF).
- **Check**: Oct 2026 HSN B2C total = GSTR-1 B2C tab total (₹8,19,999.14 taxable, ₹1,47,599.84 GST; 1 paisa rounding difference because HSN sums line-wise).
- The sample `Assets/hsnsumm (3).XLS` is only an Excel web-page shell; its data folder `hsnsumm (3)_files/` was not included.

## 14. Receive Payment credit used on the next bill
- **Receive Payment** (`/sales/payments`, `components/PaymentModal.tsx`, `POST /api/payments`) with no bill number only lowers the customer's `outstandingBalance` (it goes negative = money on account). It does **not** create an Advance Booking (`customer_advances`) record.
- **Bill form** (`components/InvoiceCreationModal.tsx`): available advance = Advance Booking receipts (`/api/crm/advances`, by phone) **+** the customer's credit (`-outstandingBalance` when negative). Banner shows "Payment Already Received" (or both parts). Booking receipts are used first, then the credit; the credit part is sent as `creditAdjusted`.
- **Server** (`app/api/invoices/route.ts`, step 7.9): caps `creditAdjusted` at the customer's real credit and at `advanceAdjusted`, adds it back to `outstandingBalance`, saves it on the invoice (`Invoice.creditAdjusted`). Only the rest of the advance is taken from Advance Booking receipts.
- **Bill delete** gives the credit back (`outstandingBalance -= creditAdjusted`).

## 15. Full Invoice Edit (billing form)
- **Where**: Tax Invoices → row "⋯" → **Edit Invoice**. A tax invoice opens in the same billing form (`components/InvoiceCreationModal.tsx`, prop `editInvoice`), filled with the bill. Credit notes / other documents still use the small details-only dialog in `app/(dashboard)/sales/invoices/page.tsx`.
- **Fixed on an edited bill**: number, company (billing entity), warehouse, and any advance already deducted (Advance Booking / Receive Payment credit — banner says "stays as it was").
- **Bill Date can be changed while editing** (same rule as a new bill): Admin or Store Manager only; never a future date. Admin back-date → `backdateStatus: approved`. Manager back-date → `pending` + an Admin approval request (`store_activity_approvals`, kind `backdated_invoice`; a rejection restores the date the bill had before the edit). Setting the date back to today clears the back-date flags. The bill's receipt, extended-warranty dates, serial `soldDate` and finance DO date follow the new date.
- **Save**: "Save Changes" → Security PIN + reason (`AuthorizePinDialog`) → `PUT /api/invoices` with `action: "full-edit"` → `lib/invoice-full-edit.ts`. Permission `invoice.edit` (admin always; manager by default, but managers have a stored permission override, so the Admin must tick it in Role Permissions).
- **Server re-does**: stock (net difference per product, same warehouse), serial numbers (removed → AVAILABLE, added → SOLD; a serial sold on another bill is refused), customer balance (old due undone, new due added; customer change moves later receipts too), the bill's "Initial payment" receipt (updated/removed/created; split bills keep rows on the invoice), extended warranties, delivery challan, finance DO (product/price). Audit log `invoice.edit` with before/after.
- **Refused**: cancelled bills; non tax-invoices; new total below money already received (billing receipt + later collections + advance) → make a Credit Note; Due/Finance/Split paid-at-billing + later > payable; switching to/from Finance; moving a bill with an advance to another customer; products of the other company.
- **Money collected later** (due clearances, receipts naming the bill) stays; Cash/UPI/Card mode on edit means "rest paid now".
- **Tested** on staging (37 API checks + browser edit): qty/rate change, product swap, Due, later collection, Due→Cash, advance bill, wrong PIN, refusals, delete restores stock, live DB untouched. Serial-number swap not tested (no serial records in the data).

## 16. Profit & Loss — purchases before GST, GST box
- **Basis**: sales (Revenue) and purchases are both shown at their ACTUAL amount, before GST. A purchase bill stores `subtotal` (taxable) and `gst` apart (`subtotal + gst = total`; the purchase form treats the rate as ex-GST), so the actual amount is read, not worked out. `/api/reports/profit-loss` uses `subtotal` (fallback `total − gst` when a bill has no subtotal); debit notes subtract; cancelled bills are skipped.
- **Profit does not change**: purchases are not deducted from profit (Profit = Revenue − COGS − Expenses). COGS = line `costPrice × qty` (cost frozen on the bill at sale time, from the item's `purchasePrice`).
- **Summary fields** (`data.summary`): `totalPurchases` (before GST), `salesGst` (Σ bill-line CGST+SGST+IGST), `purchaseGst` (Σ purchase `gst`, debit notes negative), `netGst = salesGst − purchaseGst`. `totalTaxCollected` (existing, bill-level) equals `salesGst` on current data.
- **P&L page** (`accounting/profit-loss`): card "Purchase Entries (before GST)", statement line "Purchases before GST", and a "GST this period (not part of profit)" box: GST on sales / GST on purchases / net (shows "Net GST to pay" if sales GST is more, else "Purchase GST more than sales GST"). Reports page (`/reports`) "Total Purchases (before GST)" card uses `subtotal` too.
- **Checked** (all-time, live): purchases ₹23,49,873 → ₹19,91,418; GST on purchases ₹3,58,455; GST on sales ₹1,90,281; net GST −₹1,68,174 (credit side). Gross ₹80,072 / net ₹79,538 unchanged. 32 comparisons staging vs production vs the database passed.
- **Open points**: (a) 22 products' master `purchasePrice` looks GST-inclusive (compared with their purchase bills) — would inflate COGS once sold; none sold yet. (b) P&L does not treat credit notes (type `credit-note`) as negative revenue; none exist yet. (c) Net profit only deducts the Expenses page entries (₹534 so far).

## 17. Secured changes — payments, bills, back-dates (Admin approval)
- **Rule**: changing a saved payment or bill needs the Security PIN + a reason. **Admin** → made at once and logged. **Store Manager** (`manager`) → sent as a *request*; **nothing changes until the Admin approves** on `/admin/approvals` (the Admin sees who asked, why, and each field before → after). **Everyone else** → blocked (403). Rejecting leaves everything as it was.
- **What goes through it**: supplier/customer **payment edit** (amount, mode, date, notes only) and **payment delete**; **sales bill edit** (`PUT /api/invoices` `action: "full-edit"`, runs `lib/invoice-full-edit.ts` on approval, incl. a changed bill date); **purchase bill correction** (`action: "correct"`: bill date, due date, supplier GSTIN, no-PO note); **back-dated bills** (sales and purchase): Admin → approved at once, Manager → bill is saved but flagged `backdateStatus: pending` + Admin request (reject moves the date back to the day it was entered).
- **Code**: `lib/change-requests.ts` (`authoriseChange` = role + PIN + reason → `direct`/`request`; `createChangeRequest`; `executeChangeRequest`; `auditChange`; `versionOf`), `lib/payment-change.ts` (`checkPaymentEdit`, `editPayment`, `removePayment`), `lib/purchase-correction.ts`, `lib/invoice-full-edit.ts` (has `dryRun` so a Manager is told at once if a change cannot be made), `lib/payment-rules.ts` (client-safe). Routes: `/api/payments` (POST needs `payment.record`; PUT edit; DELETE), `/api/invoices`, `/api/purchase-entries`, `/api/approvals`. UI: `components/payments/PaymentChangeControls.tsx` (used on `/sales/payments` and `/vendors/payments`), billing form edit mode, `components/purchase/PurchaseCorrectionDialog.tsx`, `components/shared/pending-changes.tsx` (pending badges), `components/shared/EditHistory.tsx` (click "Edited" → history), `ChangeDetails` on the approvals page.
- **Request storage**: `store_activity_approvals`, `payload = { kind, target, requestedBy, reason, before, after, data, baseVersion }`. `kind` ∈ `payment_edit`, `payment_delete`, `invoice_edit`, `purchase_correction`, `backdated_purchase` (+ old `backdated_invoice`). `target` e.g. `payment:<id>`, `invoice:<no>`, `purchase:<billNo>` — **one waiting request per target**. `baseVersion` = record `updatedAt`; if the record changed after the request, approving fails with 409 (reject and ask again). Approving runs the same code the Admin's direct change uses; if it cannot be applied the request stays pending with the reason.
- **Holes closed** (found 2026-10-29): plain `PUT /api/purchase-entries` and `PUT /api/invoices` let any logged-in user rewrite totals/paid/status/date with no PIN or log (now: sales bill accepts contact/delivery fields only — audited as `invoice.details.edit`; estimates (`proforma`) still editable but cannot change type; purchase bill only `cancel` / `correct`). `POST /api/payments` had no role check; `DELETE /api/payments` had no PIN/audit. `POST /api/approvals` let anyone create a request (now disabled — requests are created only by the server); `GET /api/approvals` showed everything to everyone (now Admin all, Manager own, others none). Sending an `offlineId` skipped the sales back-date rule (now an offline bill with an earlier date is flagged pending); a badly formatted date skipped it too (now 400). Purchase bills had no back-date rule at all.
- **Behaviour changes to remember**: cashier/accounts can no longer delete payments (they still record them); a purchase bill with an earlier date than today can only be entered by Admin/Manager (Manager's goes to approval); a payment made together with a bill (`Initial payment for…`, `TXN-PE-…`) is changed by editing the bill, not as a payment; purchase bill amount/product/bill number/supplier changes still mean cancel (PIN) + enter again; `invoice.edit` permission is no longer used (role decides). Tax-invoice "Edit Details" for non-Admin/Manager roles = contact/delivery fields only.
- **Audit actions**: `change.requested`, `change.approved`, `change.rejected`, `payment.edit`, `payment.delete`, `invoice.edit`, `invoice.details.edit`, `purchase-entry.correct` (read at `/api/audit?refs=<billNo>,<invoice|purchase:...>`, needs `audit.view`).
- **Tested** on staging (own DB): 85 API checks across Admin / Manager / Cashier / Salesman incl. direct bypass attempts, plus browser runs of the Admin payment edit and the Manager bill edit ("Edit pending approval" badge). Live database untouched by tests. Old-style back-dated requests still approve/reject as before.
- **Open**: 2 real back-dated sales bills (#48, #49 by Jitendra Singh, dated 2026-10-25) were already waiting for the Admin's decision on the Approvals page.

## 18. Add a new customer from Receive Payment
- **Where**: Receive Payment (Counter) → Record Payment (customer receipts; the Supplier Payout form is unchanged). `components/PaymentModal.tsx` + `components/payments/CustomerPicker.tsx`.
- **How**: the customer box is a type-to-search field (name, mobile or code). A name not on the list offers "Add “name” as a new customer" (typing a 10-digit mobile that is not on the list offers it with that mobile). It opens the same details as the Customer screen: name*, mobile* (10 digits), group, email, address, state, district/city, PIN, GSTIN, credit limit (shop defaults: Uttar Pradesh / Gorakhpur, Retail, ₹1,00,000). The customer is saved first (`POST /api/customers`), then the payment is recorded against them; the form then treats them as an existing customer, so a retry never adds them twice.
- **Guards**: a mobile that already belongs to a customer is refused with "use this customer" (and the add option is not shown); GSTIN must be 15 characters, PIN 6 digits, email must look valid; a new customer cannot be given a refund ("Refund / Pay to Customer (Out)") — only "Receive Payment (In)".
- **What the payment becomes**: a new customer starts at ₹0 due, so the receipt leaves their balance negative (money already paid); the billing form shows it as "Payment Already Received" and takes it off their next bill (see section 14).
- **API fixes** (`app/api/customers/route.ts` POST): the GSTIN typed on the Customer screen (sent as `gst`) used to be dropped — now read, and `group` is saved as `customerGroup`; the customer code is now the next free `CUST-` number (was a random 4-digit number that could collide with the unique index).
- **Tested on staging**: new customer "Sunil Test Kumar" added with every field + ₹2,500 receipt → customer saved (CUST-1773, GSTIN, address, group, credit limit), balance −₹2,500, one payment, none of it in the live database; search by name/mobile; existing customer shows its balance; a mobile already in use no longer offers "add new".
- **Status**: live on production (deployed 2026-10-29 after the Admin approved).

## 19. Push notifications (phone alerts even when the app is closed)
- **What**: every bell notification (task assigned, approvals, etc.) is also pushed to the person's phone/browser. One hook: `send()` in `lib/notify.ts` calls `pushToUsers()` (`lib/push.ts`) right after saving the bell row.
- **Pieces**: `lib/web-push.ts` (Web Push RFC 8030/8291/8292, WebCrypto only, runs on Workers; endpoint allow-list fcm.googleapis.com / mozilla / windows / apple), `models/PushSubscription.ts` (`push_subscriptions`), `app/api/push/{key,subscribe,test}`, `lib/push-client.ts`, bell footer in `components/layout/NotificationBell.tsx`, `push` + `notificationclick` handlers in `public/sw.js` (cache `valueplus-v2.5`).
- **Staff steps**: install APK v3 → open app → tap bell → "Turn on alerts on this device" → allow notifications → "Send a test". The app re-registers quietly each time it opens; logout removes the device; a shared phone sends only to whoever logged in last. App open and visible → no phone popup, bell refreshes instead.
- **Secrets** (Worker secrets, production and staging): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Private key is also kept outside the repo. If lost: generate a new P-256 pair, set the secrets, everyone taps "Turn on alerts" again (old subscriptions are replaced automatically).
- **APK v3.0.0 (versionCode 3)**: `enableNotifications: true` in `android-apk/twa/twa-manifest.json`; same signing key (SHA-256 f3ae1e16…bb4d) so it updates v2 in place; has `POST_NOTIFICATIONS`. Previous APK kept as `android-apk/valueplus-v2.apk`. Rebuild: `bubblewrap update --skipPwaValidation` then `bubblewrap build --skipPwaValidation` (needs JDK 17 with javac + Android build-tools; the AAB signing step may error, the APK is still produced).
- **Tested**: crypto cross-checked against reference code (27/27); staging API (20/20); Worker → push service request path works (fake device correctly reported gone and cleaned up). **Not tested by me**: delivery to a real Android phone — verify with "Send a test" on the new APK.
- **Limits**: battery-saver/“app sleeping” settings on some phones delay alerts; Android 13+ asks permission; iPhone needs the site added to the Home Screen (APK is Android only).
- **Status**: live on production (2026-10-29).

---

## Change Log
- **2026-10-24** — Upgraded Next.js 15.3.6 → 15.5.28; added OpenNext Cloudflare setup (`wrangler.jsonc`, `open-next.config.ts`, `worker.ts`, deploy/preview scripts).
- **2026-10-24** — `lib/db.ts`: per-request MongoDB client on Cloudflare Workers.
- **2026-10-24** — PDF import made Workers-compatible (`pdf-env.ts`, lazy `pdf-parse`).
- **2026-10-24** — Blocked maintenance/debug routes on Cloudflare (incl. `/api/seed`, `/api/auth/seed`).
- **2026-10-24** — Staging worker created; new version deployed to production (valuplus.shineinfosolutions.in).
- **2026-10-24** — APK v2.0.0 rebuilt for the new domain with the original signing key; served at `/downloads/valueplus.apk`.
- **2026-10-24** — API login required for all `/api/*` routes (`middleware.ts`), tested on staging, deployed to production.
- **2026-10-24** — Incident: `/api/auth/seed` was run twice during testing and reset the 8 demo accounts to default passwords.
- **2026-10-24** — Investigated slow admin page load: Atlas data transfer (~100 KB/s) is the bottleneck; no code change yet.
- **2026-10-24** — Added GST → GST Reports → **HSN Summary** tab (GSTR-1 Table 12, B2B + B2C, bill drill-down, 2-sheet Excel export). Tabs on that page now wrap on phone screens. Tested on staging, deployed to production.
- **2026-10-24** — Added sidebar menu item **HSN Summary Report** below GST Reports, with its own page `/gst/hsn-summary`; HSN code moved to `components/gst/hsn-summary.tsx` (shared with the GST Reports tab). Tested on staging, deployed to production.
- **2026-10-24** — HSN Summary cards: B2B/B2C now show Taxable and GST on separate labelled lines (they used to be joined with "·" and wrapped mid-amount). Deployed to production.
- **2026-10-24** — Money received through Receive Payment (without a bill) is now shown and deducted in the next bill as "Payment Already Received" (`creditAdjusted`), and returned to the customer if that bill is deleted. Deployed to production (after approval); not yet tested by saving a real bill.
- **2026-10-26** — Invoice list: Balance column now shows the bill's saved `balanceAmount` (was Total − Paid, which counted a deducted advance as due); Paid column shows "+ ₹X advance".
- **2026-10-26** — Staging now uses its own database `valueplus_staging` (`scripts/copy-db-to-staging.mjs`, `MONGODB_DB`); production `MONGODB_DB=valueplus` pinned.
- **2026-10-26** — Full invoice edit in the billing form (PIN + reason, `lib/invoice-full-edit.ts`, permission `invoice.edit`). Tested on staging, deployed to production.
- **2026-10-28** — Invoice edit: Bill Date can now be changed (back-dating) by Admin / Store Manager with the same approval rules as a new bill; linked receipt, warranty, serial and finance dates follow. Tested on staging (10 checks incl. future date refused, manager → pending approval), deployed to production.
- **2026-10-28** — P&L: purchases now shown before GST (actual amount from the bill subtotal), new "GST this period (not part of profit)" box (GST on sales, GST on purchases, net), Reports page Total Purchases before GST. Profit figures unchanged. Tested on staging (32 checks), deployed to production.
- **2026-10-29** — Secured payment / bill changes: Store Manager edits (supplier & customer payments, sales bills, purchase bill corrections) now go to the Admin and apply only when approved; Admin edits need PIN + reason; back-dated sales and purchase bills follow one rule; closed the open plain-update, payment delete/record, offlineId and approvals holes; every change is in the audit log with a clickable history. Tested on staging, deployed to production.
- **2026-10-29** — Receive Payment: customer box is now type-to-search, and a new customer can be added right there with the Customer screen's details (saved with the payment); Customer add API now keeps the GSTIN/group and picks the next free customer code. Tested on staging, deployed to production.
- **2026-10-29** — Push notifications: all bell notifications (incl. task assignment) now also arrive on the phone when the app is closed (Web Push + VAPID, bell "Turn on alerts" / "Send a test"); new APK v3.0.0 with notifications enabled, same signing key. Staging-tested, deployed to production.
