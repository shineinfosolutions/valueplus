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
- **Fixed on an edited bill**: number, date, company (billing entity), warehouse, and any advance already deducted (Advance Booking / Receive Payment credit — banner says "stays as it was").
- **Save**: "Save Changes" → Security PIN + reason (`AuthorizePinDialog`) → `PUT /api/invoices` with `action: "full-edit"` → `lib/invoice-full-edit.ts`. Permission `invoice.edit` (admin always; manager by default, but managers have a stored permission override, so the Admin must tick it in Role Permissions).
- **Server re-does**: stock (net difference per product, same warehouse), serial numbers (removed → AVAILABLE, added → SOLD; a serial sold on another bill is refused), customer balance (old due undone, new due added; customer change moves later receipts too), the bill's "Initial payment" receipt (updated/removed/created; split bills keep rows on the invoice), extended warranties, delivery challan, finance DO (product/price). Audit log `invoice.edit` with before/after.
- **Refused**: cancelled bills; non tax-invoices; new total below money already received (billing receipt + later collections + advance) → make a Credit Note; Due/Finance/Split paid-at-billing + later > payable; switching to/from Finance; moving a bill with an advance to another customer; products of the other company.
- **Money collected later** (due clearances, receipts naming the bill) stays; Cash/UPI/Card mode on edit means "rest paid now".
- **Tested** on staging (37 API checks + browser edit): qty/rate change, product swap, Due, later collection, Due→Cash, advance bill, wrong PIN, refusals, delete restores stock, live DB untouched. Serial-number swap not tested (no serial records in the data).

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
