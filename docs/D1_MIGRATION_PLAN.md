> **Status (13 Nov 2026):** Phase 1 (masters: schema, full copy, 5-minute incremental copy, nightly comparison) is **live**. First copy: 484 items, 458 stock rows, 9 categories, 30 brands, 24 units, 5 warehouses, 158 customers, 6 suppliers, 0 errors. MongoDB is still the source of truth. Next: shadow reads for masters.
>
> **Status (14 Nov 2026):** Stage A (all 69 collections copied), B1 (write-through) and B2 (shadow reads in all five areas) are live. **Stage C (the automatic read cutover) is built, not yet deployed:** see §6.7a.

# ValuePlus ERP: MongoDB Atlas to Cloudflare D1, a zero-downtime migration plan

> Written 13 Nov 2026 against `main` (commit `aa735c7`). Nothing has been changed, deployed or connected to; this file is the plan only.
> Inputs: `OPTIMIZATION.md` (section 0 and the measurements in sections 2 to 5), `memory.md` (sections 7, 8, 30, plus the business flows in 4 to 38), all 69 files in `models/`, `lib/db.ts`, `lib/stock.ts`, `worker.ts`, `wrangler.jsonc`, `app/api/invoices/route.ts`, `lib/offline-storage.ts`, and the official Cloudflare docs listed in **Appendix A**.
> Items marked **(verify)** have not been confirmed against the live system or the current docs. Check them before relying on them.

---

## Contents

1. [Why do it, what it gains and costs, go / no-go](#1-why-do-it-what-it-gains-and-costs-go--no-go)
2. [D1 facts that shape the design](#2-d1-facts-that-shape-the-design)
3. [Mongo features the app relies on, and their SQLite replacements](#3-mongo-features-the-app-relies-on-and-their-sqlite-replacements)
4. [Inventory: every model mapped to tables](#4-inventory-every-model-mapped-to-tables)
5. [Data access layer (repository) strategy](#5-data-access-layer-repository-strategy)
6. [The zero-downtime procedure, step by step](#6-the-zero-downtime-procedure-step-by-step)
7. [Testing plan](#7-testing-plan)
8. [Risks and mitigations](#8-risks-and-mitigations)
9. [Timeline, effort and checklist](#9-timeline-effort-and-checklist)
- [Appendix A: sources](#appendix-a-sources)
- [Appendix B: sample DDL for the hot tables](#appendix-b-sample-ddl-for-the-hot-tables)

---

## 1. Why do it, what it gains and costs, go / no-go

### 1.1 The problem today

These figures come from `OPTIMIZATION.md` and `memory.md` §8 and §12.

| Today (MongoDB Atlas, Mumbai) | Figure | Source |
|---|---|---|
| New MongoClient per request on Workers (DNS SRV + TLS + handshake) | **≈ 0.35 s added to every API call** | OPTIMIZATION §2 "Connection", memory §8 |
| Atlas link throughput (looks like shared/free-tier throttling) | **≈ 100 KB/s**: 446 items = 380 KB = **3.9 s** | OPTIMIZATION §2, memory §12 |
| Heavy APIs (`/api/items`, `/api/reports/stock`, `/api/dashboard/stats`) | 4 to 5 s each, also on plain Node | memory §12 |
| Dashboard stats | loads 9 whole collections and adds them up in JS (1,743 lines) | OPTIMIZATION §2 |
| Indexes on live | `autoIndex` is off on Workers, so indexes may never have been built on live **(verify in Atlas)** | OPTIMIZATION §2, `lib/db.ts` |
| Cron | 288 runs a day, each opening a DB connection | OPTIMIZATION §3 |
| Hyperdrive | does not support MongoDB; the Atlas Data API has been retired | OPTIMIZATION A5 |

### 1.2 What D1 changes

| | MongoDB Atlas today | D1 after migration |
|---|---|---|
| Connection set-up per request | ≈ 350 ms (new client) | **0**: a binding, no socket or TLS |
| Moving 380 KB (item list) | ≈ 3.9 s at 100 KB/s | tens of ms inside Cloudflare's network **(verify on staging)** |
| Query round trip from an Indian PoP | Worker to Atlas Mumbai, plus the connect | Worker to the D1 primary (location hint `apac`; the exact city is Cloudflare's choice). Expect roughly 20 to 80 ms per round trip **(verify: measure on staging)**. Read replicas plus the Sessions API can put a replica nearer. |
| Multi-statement atomicity | none used (0 `startSession` / `withTransaction` in the code) | `batch()` is all-or-nothing, so a bill's stock, balance and receipt can commit together |
| Bill | Atlas tier (unknown: free or shared now; Flex ≈ $8 to 30, M10 ≈ $60 per month per OPTIMIZATION A1) | Included in Workers Paid ($5 base, already paid): 25 bn rows read, 50 M rows written and 5 GB storage a month (§2). Expected extra cost **≈ $0**. |
| Worker bundle | mongoose plus the mongodb driver ride in the ~5.5 MB Worker | both removed. Smaller bundle, slightly faster cold start. |

**Expected end-to-end effect** (estimate, to confirm with the measurements in OPTIMIZATION §7): typical API calls go from 0.5 to 5 s to **50 to 300 ms**. The dashboard can go well under 1 s once its stats run as SQL `GROUP BY` queries sent in one `batch()` round trip (this replaces OPTIMIZATION A3). Worker CPU drops because the app no longer decodes whole collections in JS.

**What it does not fix on its own:** JavaScript weight (F1 to F4), refetch storms (F7) and the whole-list preload (F6). Those quick wins are independent of the database and should ship first.

### 1.3 What it costs

- **Engineering:** about **61 to 69 developer-days** across about 12 to 14 calendar weeks for a safe zero-downtime path (§9). OPTIMIZATION §0 estimated 3 to 6 weeks for a straight rewrite with a cut-over. Zero downtime adds the mirror, shadow reads, the per-domain flags and the reverse mirror.
- **Risk:** a data-layer rewrite of about 150 to 210 files touching money and stock. That risk is controlled by the parity tests and the per-domain flags.
- **Capabilities lost:**
  - flexible schema (every new field becomes a migration);
  - interactive transactions (D1 has only `batch()`, with no read-then-decide inside it);
  - the Atlas UI and Performance Advisor;
  - a hard **10 GB** cap per database;
  - a single-threaded database (one query at a time per database).

### 1.4 Go / no-go checklist (all must be "yes" before Phase 3 starts)

- [ ] **Quick wins done first:** OPTIMIZATION F1, F6, F7, A2 and A4 are live and measured. If, after A1 (Atlas tier upgrade) and A2, the product list is under 0.5 s and the owner is happy, **reconsider whether D1 is still worth 2 to 3 months**.
- [ ] **Real data size measured** (Step 0.2) and projected under 2 GB at 5 years. The estimate in §8 is about 150 to 250 MB a year.
- [ ] **D1 latency measured from India** on a scratch database with a realistic query mix: p50 under 80 ms and p95 under 200 ms per round trip.
- [ ] **Staging is back:** `env.staging` with its own Worker, own Mongo DB (`valueplus_staging`) and own D1 DB. memory §7 says staging was removed on 2026-11-05, and today's `wrangler.jsonc` has no `env.staging`.
- [ ] One developer owns the migration end to end, and the owner agrees to a feature freeze on the domain being cut over during its cutover week.
- [ ] The Admin accepts a **write fence** of up to about 60 s at the money cutover, scheduled after shop close (shift ends 09:00 PM IST, memory changelog 2026-11-03). Writes wait during the fence; they do not fail.
- [ ] The Atlas cluster stays paid up for at least 30 days after the final cutover (rollback window).

**No-go triggers:**
- data projected to exceed 5 GB within 3 years;
- p95 D1 latency from India above 250 ms;
- the parity suite cannot reach zero unexplained diffs on the money domain within 2 weeks of shadow reads.

---

## 2. D1 facts that shape the design

These come from the official docs, fetched 13 Nov 2026; Appendix A has the URLs.

| Topic | Fact | Design consequence |
|---|---|---|
| Database size | **10 GB max per database on Paid** ("cannot be further increased"); 500 MB on Free. 1 TB per account. | One DB is plenty (§8). Prune notifications and logs anyway. |
| Statement length | 100 KB max per SQL statement | Bulk loads use multi-row INSERTs of about 50 to 250 rows, never one giant statement. |
| **Bound parameters** | **100 max per query** | A full invoice row cannot be inserted with more than 100 `?`. Multi-row inserts must keep `rows × columns ≤ 100`. |
| **Columns per table** | **100 max** | `Invoice` has **132 top-level fields** (+ id, createdAt, updatedAt, __v), so it **must be split** (§4.3). |
| Row / string / BLOB size | 2 MB max (2,000,000 bytes) | `AuditLog.metadata` (before/after), `DeletedInvoice.snapshot` and `StoreActivityApproval.payload` must stay well under it. The backfill flags rows over 1 MB, which go to R2. |
| **LIKE / GLOB pattern** | **50 bytes max** | Search must not build long LIKE patterns. Use `instr(lower(col), lower(?)) > 0` or FTS5 (§3). |
| Arguments per SQL function | 32 | Watch `json_object(...)` with many keys and `COALESCE` chains. |
| Query duration | 30 s per query, and **per whole `batch()`** | Backfill batches must stay small. Reports must use indexes. |
| Queries per invocation | 1,000 (Paid); a `batch()` counts as one | Fine. Batch the dashboard's queries. |
| Result size | 50 MB max per query result (effective 2026-11-04) | Fine. List APIs should page anyway (OPTIMIZATION A2). |
| Concurrency | **Each DB is single-threaded.** A 1 ms query allows ≈ 1,000 q/s; a 100 ms query ≈ 10 q/s. Over the queue: "overloaded" error. | Every hot query must be indexed and fast. No full-table JS-side scans like today's dashboard. Retry "overloaded" with backoff. |
| Simultaneous connections | 6 per Worker invocation | Do not `Promise.all` dozens of queries. Use `batch()`. |
| `batch()` | Statements run sequentially; "Batched statements are SQL transactions": if one fails, the whole sequence is aborted or rolled back | Unit of atomicity for every money or stock write (§5.4). |
| Interactive transactions | Not documented. Third-party reports say `BEGIN TRANSACTION` is rejected (Drizzle issue #2463) **(verify on staging)** | Design for **read, then compute in JS, then one atomic `batch()` with guards**. |
| Foreign keys | **Enforced by default** in queries and migrations; `PRAGMA defer_foreign_keys = on` for migrations | Declare FKs only where the app owns both sides (parent to child line tables). Legacy cross-entity references are indexed TEXT without an FK (§4.1). |
| Extensions | FTS5, JSON functions, math functions | `json_extract`, `json_each` and FTS5 are available. |
| Types | JS number to REAL or INTEGER, string to TEXT, boolean to INTEGER 0/1 (read back as number), ArrayBuffer to BLOB, `null` to NULL; **`undefined` gives `D1_TYPE_ERROR`; BigInt is not supported; there is no Date type** | The repository must convert `undefined` to `null`, booleans back from 0/1, and Dates to ISO strings. |
| Read replication | Opt-in (dashboard or REST `read_replication.mode = "auto"`); works **only through the Sessions API**: `env.DB.withSession("first-primary" \| "first-unconstrained" \| bookmark)`, `session.getBookmark()`. Gives sequential consistency within a session. No extra cost. Replicas in ENAM, WNAM, WEUR, EEUR, APAC, OC. | Phase 2 option, after cutover. Pass the bookmark in an `x-d1-bookmark` header, or store it in a cookie, so a user's reads after a write never go backwards. |
| Time Travel | Restore to **any minute in the last 30 days** (Paid); `wrangler d1 time-travel info` / `restore --timestamp` / `--bookmark`. In-place and destructive, but undoable (it returns the previous bookmark). Cancels in-flight queries. No extra charge. | Backup and restore drill (§7.5). Plus a nightly export to R2 for history past 30 days. |
| Export | `wrangler d1 export <db> --remote --output=...`, with `--table`, `--no-data`, `--no-schema`. **A running export blocks other DB requests.** FTS5 virtual tables cannot be exported. | Nightly export only in the night window, or on a Time-Travel-restored copy **(verify)**. Avoid FTS5 unless needed, or drop and recreate it around exports. |
| Import | `wrangler d1 execute <db> --remote --file=x.sql` (up to 5 GiB). Split "Statement too long" inserts. Remove `BEGIN` / `COMMIT`. Mind FK order. | Initial bulk load via generated `.sql` files (§6, Phase 2). |
| Migrations | `wrangler d1 migrations create / list / apply`; `migrations_dir` (default `migrations/`) and `migrations_table` (default `d1_migrations`) in the binding config; applied in filename order | Schema lives in git. Applied to staging first, then prod. `--remote` and `--env staging` flags **(verify: not on the migrations page; they exist on other wrangler d1 commands)**. Whether a failed migration rolls back is not documented **(verify)**, so write small, expand-only migrations. |
| Pricing (Paid) | Rows read: 25 bn/month included, then $0.001 per million. Rows written: 50 M/month included, then $1.00 per million. Storage: 5 GB included, then $0.75 per GB-month. Each **scanned** row counts as read. Index updates add a written row. Dashboard and wrangler queries are billable. | Even 1 bn rows read a month costs $0. The thing to watch is unindexed scans in hot paths (latency, not money). |
| Location | `wrangler d1 create <name> --location=apac` (a hint, not a guarantee). Jurisdiction is set only at creation. | Create both DBs with `--location=apac`. |
| OpenNext binding | `getCloudflareContext().env.DB` in route handlers; `getCloudflareContext({ async: true })` for SSG / top-level. Types via `npx wrangler types --env-interface CloudflareEnv`. | `lib/d1.ts` exports `getDb()`. `lib/db.ts` already uses `getCloudflareContext()`. |

---

## 3. Mongo features the app relies on, and their SQLite replacements

These counts come from a grep of `app/`, `lib/` and `models/` on 13 Nov 2026.

| Mongo feature (usage) | Where | D1 / SQLite replacement | Care needed |
|---|---|---|---|
| **ObjectId `_id`** (every collection). Many references are stored as **String** (`Invoice.customerId`, line `itemId`, `SerialNumber.itemId`), some as **ObjectId** (`Invoice.warehouseId`, `Item.stockByWarehouse.warehouseId`, `PurchaseEntry.supplierId`, `StockJournal.items.itemId`) | all | `id TEXT PRIMARY KEY` holding the **same 24-hex string**. All reference columns are TEXT. New ids from a 24-hex ObjectId-compatible generator (`bson`'s `ObjectId`, pure JS, or a 12-byte timestamp + random + counter helper), so ids stay time-sortable and URLs, links and cached ids in the browser all survive. | `String(x)` everywhere. Comparisons that relied on ObjectId vs string equality in JS (`String(e.warehouseId) === ...`) already stringify. |
| **Nested arrays / subdocuments**: invoice `items[]`, `payments[]`, `financeDos[]`, `printLogs[]`, `storeExit`; item `stockByWarehouse[]`, `incentives[]`, `warrantyPlans[]`, `supplierCodes[]`; attendance `awayPeriods[]`, `lastPresence`; lead `followUps[]`, `calls[]`, `sharedWith[]`, `timeline[]`, `items[]`; task `seenBy[]`; audit `metadata` (before/after); customer `billingAddress` / `shippingAddress` | models | **Per field:** a child table if it is queried, aggregated or updated element-by-element; a JSON TEXT column if it is always read and written with its parent. A 1:1 subdocument is flattened. The decision for each field is in §4. | Replace the whole child set atomically in one `batch()` (DELETE children + INSERT children + UPDATE parent). |
| **`$inc` atomic counters** (36 hits in 16 files): customer / supplier `outstandingBalance`, `BankAccount.balance`, `User.advanceBalance`, `Lead.callCount`, `reprintCount`, `usageCount`, `editCount`, `failCount`; stock in `lib/stock.ts` | invoices, payments, purchase-entries, financeSettlement, payment-change, invoice-full-edit, admin-cash, attendance, challan-claims | `UPDATE t SET col = col + ? WHERE id = ?`, inside the same `batch()` as the document write. Per-warehouse stock uses `INSERT ... ON CONFLICT(itemId, warehouseId) DO UPDATE SET qty = qty + excluded.qty`. | Never read, add in JS and write back. |
| **Positional `$` / `arrayFilters` / `$push` / `$pull` / `$elemMatch`** (`stockByWarehouse.$.qty`, inventory-audit counts `items.$[it]`, `lib/staff-rename.ts` on `items.$[l].salesExecutive` and `sharedWith.$[s].staff`) | `lib/stock.ts`, `api/inventory/audit`, `lib/staff-rename.ts`, leads, tasks | Child tables make these plain `UPDATE child SET ... WHERE parentId = ? AND key = ?`. For JSON columns: read, modify, write with an `updatedAt` guard (§5.4). | Inventory-audit counts by several people at once must be a child table (row-level updates), not JSON. |
| **`$regex` / `new RegExp`** (89 + 65 hits in about 35 files): search boxes, name matching ignoring case and a "(Sales Executive)" suffix, series prefix scans (`nextNumberInSeries`), staff rename | items, invoices, leads, search, staff, vendors, suppliers, warranty, track, reports... | Prefix: `col LIKE ? || '%'` (pattern ≤ 50 bytes; escape `%` `_` with `ESCAPE '\'`). Contains: `instr(lower(col), lower(?)) > 0` (no pattern limit). Exact case-insensitive match: `col = ? COLLATE NOCASE`. Name normalisation such as `normName` / `sameStaff`: store a normalised `staffKey` column, filled by the repository, and index it. Multi-field search (items, customers, leads): start with `instr` over a small set of columns (450 items and a few thousand customers make a scan cheap). Move to **FTS5** only if p95 exceeds 100 ms. | SQLite `LIKE` is case-insensitive **only for ASCII**, as is `NOCASE`. Hindi or other non-ASCII names need `lower()` on both sides, and even `lower()` is ASCII-only in core SQLite, so store a JS-lowercased `nameLower` column **(verify behaviour with Devanagari input)**. |
| **Collation** `{ locale: "en", strength: 2 }` (brands A to Z) | `api/brands` | `ORDER BY name COLLATE NOCASE` | Same caveat: ASCII only. |
| **Unique indexes** (about 45 declared) | models | `UNIQUE` / `CREATE UNIQUE INDEX`. Mongo's "sparse-like" behaviour for missing fields maps to SQLite NULLs, which are always distinct. | `autoIndex` is off on Workers, so **live data may already break declared uniques** (for example `Customer.code`: memory §18 says codes used to be a random 4-digit number that "could collide"). The backfill pre-checks every unique (Step 2.3) and fixes duplicates in Mongo first. |
| **Aggregation** (4 `aggregate()` calls: document folder counts, inventory audit history, items pending delivery, warranty revenue) plus a lot of JS-side aggregation (dashboard, P&L, GSTR, HSN, incentives) | as listed | `SELECT ... GROUP BY`, `SUM(...)`, `json_each()` when a JSON array must be unnested. The JS-side aggregation can stay as-is first (parity) and move into SQL per report later. | Port the JS logic first, unchanged, and prove parity before rewriting it into SQL. |
| **`countDocuments`** (44), `distinct` (1), `bulkWrite` (11), `insertMany` (21), `findOneAndUpdate` (53) | | `SELECT COUNT(*)`, `SELECT DISTINCT`, `batch()`, multi-row INSERT (≤ 100 params), `UPDATE ... RETURNING *` **(verify RETURNING on D1; SQLite has it since 3.35)** | `findOneAndUpdate({upsert})` maps to `INSERT ... ON CONFLICT DO UPDATE ... RETURNING *`. |
| **Dates.** Business dates are strings `YYYY-MM-DD` (IST), for example `Invoice.date`, `dueDate`, `Attendance.date`, `CashTransaction.date`. Real `Date` values: `createdAt`, `updatedAt`, `deliveredAt`, `Estimate.date`, `PurchaseOrder.date`, `DeliveryChallan.date`, `awayPeriods.leftAt`. Some fields are **`Date \| string`** (`deliveryProofAt`, `deliveredAt`, `storeExit.completedAt`). | everywhere | Keep business dates as TEXT `YYYY-MM-DD` exactly. Store every `Date` as TEXT **ISO-8601 UTC with milliseconds** (`2026-11-13T04:30:00.000Z`) so text order is time order. IST day of a timestamp: `date(createdAt, '+5 hours', '+30 minutes')`. | Normalise the mixed `Date \| string` fields to ISO in the transform. `Estimate.date` is a Date but `Invoice.date` is a string, so reports joining them must convert. |
| **Mongoose defaults** (many), including **function defaults**: `CashTransaction.time` and `InventoryAudit.completionTime` use `toLocaleTimeString("en-IN")` **without a timeZone**, which gives UTC on Workers (an existing bug); `StaffTask.assignedDate` uses IST; `User.joiningDate` and `FinanceTransaction.date` use a UTC date | models | Put static defaults in SQL `DEFAULT`. Put **function defaults in the repository's `create()`**, ported 1:1 (keep the UTC quirk for parity; fix it later as a separate, announced change). | A missing default becomes a NULL that breaks a report. The parity tests compare created documents field by field. |
| **Setters / casting**: `Item.gstRate` setter `allowedGstRate`; `uppercase` / `trim` / `lowercase` on `BillingCompany.gstin`, `ProductCatalogReference.vpCode`, `RolePermission.role` | models | Apply the same functions in the repository `create` / `update`. | |
| **`select: false`** (`User.securityPin`, `pinFailCount`, `pinLockedUntil`, `unlock*`; `WhatsAppSetting.cloudApi.accessToken`) | User, WhatsAppSetting | The repository's default column list excludes them; an explicit `withSecrets` option includes them. | Do not leak through `SELECT *`. Consider moving the WhatsApp access token into a Worker secret. |
| **`strict: false`** collections (`deleted_invoices`, `deleted_purchase_entries`) | | Known columns plus `snapshot` JSON plus an `extra` JSON for unknown keys. | |
| **Hooks / virtuals / populate** | none: 0 `.pre(` / `.post(`, 0 `virtual(`, 0 `.populate(` | nothing to port | This makes the port much easier. |
| **Transactions** | none (0 `startSession` / `withTransaction`) | `batch()` gives *more* atomicity than today | Per-domain cutover never makes atomicity worse than today. |
| **Raw driver access** | `app/api/reports/product-ledger/route.ts` reads `db.collection(name).find({})` | port to the repository | |
| **Collections without an explicit name** (mongoose pluralises the model name) | `DiscountApproval` → `discountapprovals`, `Expense` → `expenses`, `LeaveRequest` → `leaverequests`, `StockTransfer` → `stocktransfers` | Use the real collection names in the backfill. | **Verify** with `listCollections` on live. |
| **`__v` version key** | all | Keep a `v INTEGER` column (not used for logic). Use `updatedAt` as the optimistic-concurrency token, as `lib/change-requests.ts` `baseVersion` already does. | |

---

## 4. Inventory: every model mapped to tables

### 4.1 Conventions (all tables)

- **Column names keep the Mongo field names (camelCase).** `_id` becomes `id`. This makes the transform, the parity diff and the repository mapping almost 1:1. SQLite identifiers are case-insensitive; no model has two fields differing only in case (checked).
- Every table has `id TEXT PRIMARY KEY` (24-hex), `createdAt TEXT NOT NULL`, `updatedAt TEXT NOT NULL` and `v INTEGER NOT NULL DEFAULT 0`.
- **Money** is `REAL` (Mongo stores doubles), so reports match to the paisa during parity. A later, separate change can move to integer paise.
- **Booleans** are `INTEGER NOT NULL DEFAULT 0` (0/1).
- **Enums** are `TEXT` with **no CHECK constraint** at first. Legacy rows may hold off-enum values such as `backdateStatus = ""`. Validate in the repository (zod). Add CHECKs after cutover once the data is clean.
- **JSON** columns are `TEXT` holding JSON (`json_valid` can be checked in reconciliation), named exactly as the Mongo field.
- **Foreign keys** are declared **only from child line tables to their parent** (`ON DELETE CASCADE`), because the app owns both sides. Cross-entity references (`customerId`, `itemId`, `warehouseId`, `supplierId`, `staffId`, `userId`...) are **indexed TEXT without an FK**: legacy data has free-text and dangling ids (walk-in customers, merged items with `mergedIntoItemId`, deleted users), and D1 enforces FKs by default. A nightly orphan report replaces them.
- Indexes copy the Mongo index list, plus what the SQL hot paths need, nothing more. Each index adds a written row per write.
- `[HOT]` marks tables on hot paths: called on every app open or on every bill, per OPTIMIZATION §2 (`/api/items` from 23 files, `/api/invoices` from 18, `/api/customers` and `/api/users` from 10, the dashboard stats, presence posts and the bell).

**Cutover units** (§6.6), in order: **U1** master and settings, **U2** logs and notifications, **U3** people and HR, **U4** CRM and pre-sale, **U5** money and stock (sales, purchases, stock, payments, cash, finance, vendors). Each table below is tagged with its unit.

### 4.2 Master data and settings (U1)

| Model → table | Columns (beyond id/createdAt/updatedAt/v) | Child / JSON decisions | Indexes / uniques |
|---|---|---|---|
| `Item` → **`items`** [HOT] (U5, see note) | code, vpCode, name, description, category, brand, unit, hsnCode, gstRate REAL, purchasePrice, purchaseIncludesGst INT, sellingPrice, vsp, vspUpdatedAt, vspUpdatedBy, vspUpdatedFrom, billingEntity, minSellingPrice, lockedMinPrice, priceLockedBy, priceLockedAt, maxDiscountPercent, maxDiscountAmount, incentiveTargetAmount, incentiveAmount, incentiveType, incentiveValue, mrp, openingStock, currentStock, showroomStock, godownStock, reorderLevel, warehouse, mergedIntoItemId, status, imageUrl, isSerialized INT, isBatchTracked INT, batchNumber, **incentives JSON**, **warrantyPlans JSON**, nameLower (search helper) | `stockByWarehouse[]` goes to child table **`itemStock`** (atomic per-warehouse `qty`, see below). `supplierCodes[]` goes to child table **`itemSupplierCodes(itemId, code)`**, because the purchase-PDF import looks items up by supplier code. `incentives[]` and `warrantyPlans[]` are JSON (always read with the item, never queried alone). | UNIQUE(code); (vpCode); (category, brand); (status, warehouse); (currentStock DESC, name); (billingEntity) |
| `stockByWarehouse` → **`itemStock`** [HOT] (U5) | itemId TEXT, warehouseId TEXT, qty REAL | PRIMARY KEY (itemId, warehouseId). FK itemId → items ON DELETE CASCADE. | (warehouseId) |
| (new) **`stockMovements`** (U5) | id, itemId, warehouseId, delta, refType (invoice / purchase / transfer / adjustment / journal / challan / audit), refId, at, by | **New append-only ledger**, written in the same batch as each `itemStock` change. It makes stock auditable and lets aggregates be recomputed. It is not in Mongo, so it is only filled after U5 cutover; the backfill seeds one "opening" row per itemStock row. | (itemId, at); (refType, refId) |
| `Warehouse` → `warehouses` (U1) | name, code, type (showroom / godown), address, city, state, pincode, contactPerson, phone, email, status, isDefault INT | flat | UNIQUE(code) |
| `Brand` → `brands` (U1) | name, description, status | | UNIQUE(name COLLATE NOCASE) **(verify no case-duplicates first)** |
| `Category` → `categories` (U1) | name, description, parentId, status | | (parentId) |
| `Unit` → `units` (U1) | name, shortName, type, status | | UNIQUE(name), UNIQUE(shortName) |
| `Variant` → `variants` (U1) | name, values JSON, status | JSON: a tiny list | UNIQUE(name) |
| `BillingCompany` → `billingCompanies` (U1) | gstin (uppercased, trimmed), companyName, pan, usageCount | `usageCount` is an atomic `+1` | UNIQUE(gstin) |
| `ProductCatalogReference` → `productCatalogReferences` (U1) | vpCode (uppercased), description, brand, groupName, category, productDesc, charDesc | | UNIQUE(vpCode) |
| `OnsitegoPlan` → `onsitegoPlans` (U1) | category, device, kind, vpCode, minPrice, maxPrice, planName, years, price, sourceDocId, sourceFileName | A PDF upload **replaces all rows**: one `batch()` of DELETE + INSERTs (atomic, unlike today). | (category, device) |
| `DocumentFolder` → `documentFolders` (U1) | name, nameKey, createdBy, createdByUserId | | UNIQUE(nameKey) |
| `StoredDocument` → `storedDocuments` (U1) | docNo, date, narration, fileUrl, filePublicId, fileResourceType, fileFormat, fileDeliveryType, fileName, fileType, fileSize, folderId, uploadedBy, uploadedByUserId, uploadedByRole | files stay on Cloudinary; only metadata moves | UNIQUE(docNo); (date); (folderId) |
| `ShiftSetting` → `shiftSettings` (U1) | shiftName, startTime, endTime, lateGraceMinutes, halfDayLateCutoff, minHoursForFullDay, minHoursForHalfDay, allowEarlyCheckoutWithoutPenalty INT, branchName, updatedBy | singleton-ish | |
| `CashRegisterSetting` → `cashRegisterSettings` (U5) | key, openingCash, countedCash, calibratedBy, calibratedAt | singleton | UNIQUE(key) |
| `PriceUnlockSetting` → `priceUnlockSettings` (U1) | key, pinHash, updatedBy | singleton; secret column | UNIQUE(key) |
| `RolePermission` → `rolePermissions` (U1) | role (lowercased), permissions JSON, updatedBy | JSON: read whole per role | UNIQUE(role) |
| `WhatsAppSetting` → `whatsappSettings` (U1) | provider, enabled INT, adminNumbers JSON, notifyCustomer INT, events JSON, businessName, cloudApi_phoneNumberId, cloudApi_accessToken (secret), cloudApi_apiVersion, cloudApi_templateName, cloudApi_templateLanguage, updatedBy | `cloudApi` is flattened; `events` and `adminNumbers` are JSON | |
| `ScheduledRun` → `scheduledRuns` (U3) | key, ranAt | used by cron "once a day" guards: `INSERT ... ON CONFLICT(key) DO NOTHING` + check `changes` | UNIQUE(key) |
| `Account` → `accounts` (U5, hidden module) | code, name, type, description, balance | | UNIQUE(code), UNIQUE(name) |
| `BankAccount` → `bankAccounts` (U5) | name, bank, number, ifsc, branch, type, status, balance | `balance` is an atomic `+= ?` | (status) |

> `items` is master data, but its stock columns change on every bill, so its **writes** move with **U5** (money and stock). Its **reads** (catalog, picker) can be read-cut-over early (state `d1-read`, §6.6) because the mirror keeps them current.

### 4.3 Sales (U5): the hottest domain

**`Invoice`** has 132 top-level fields, over the 100-column limit, so it is split by how the fields are used:

| Table | Columns | Why |
|---|---|---|
| **`invoices`** [HOT] (about 75 columns) | invoiceNumber, type, customerId, customerName, customerGST, customerPAN, customerCompanyName, customerPhone, customerAltPhone, customerEmail, customerAddress, customerCity, customerState, customerPin, placeOfSupply, vehicleNumber, shippingAddress, warehouseId, billingEntity, date, dueDate, status, subtotal, discount, taxableAmount, cgst, sgst, igst, totalGST, extendedWarrantyTotal, roundOff, total, paidAmount, balanceAmount, paymentMode, paymentTerms, cashReceivedBy, upiTxnId, onlineTxnId, onlineGateway, financeProvider, financeDoId, financeApprovalStatus, downPayment, downPaymentMode, shippingCharges, freightCharges, freightPaidBy, dueAdvanceAmount, dueAdvanceMode, dueClearedAt, dueClearedMode, dueClearedBy, dueClearedNotes, dueClearedTxnId, dueClearedBankAccountId, dueClearedBankAccount, advanceAdjusted, creditAdjusted, dispatchType, deliveryStatus, expectedDeliveryDate, deliveredAt, backdateStatus, backdateRequestedBy, backdateMadeOn, deliveryChallanNo, creditNoteRef, notes, salesExecutive, salesExecutiveIncentive, onsitegoIncentive, adminOverridePinUsed INT, reprintCount, lastPrintedAt, lastModifiedReason, cancelledAt, cancelledBy, cancelReason, **offlineId** (new, see §6.8), **printLogs JSON** | Everything lists, filters, totals and reports read: dashboard, P&L, GSTR, HSN, dues, incentives, delivery panel. |
| **`invoiceFinance`** (1:1, PK = invoiceId, FK CASCADE) | cardCategory, cardAmount, cardType, cardTxnId, cardLast4, cardMdrPercent, cardMdrAmount, cardNetSettlement, financeAppId, financeGrossLoan, financeNetLoan, financeMarginMoney, financeDownPayment, financeDownPaymentMode, financeDealerSubsidy, financeExpectedDisbursement, financeActualDisbursement, financePdfUrl, financePdfUrls JSON, financeDos JSON, financeApprovedBy, financeApprovalDate, financeBankRef, financeBankAccountId, financeBankAccount, financePayoutDate, financeTenureMonths, financeSchemeType, financeInterestRate, monthlyEMI, totalInterest | Card and finance detail, read on the bill view and the finance ledger. `financeProvider`, `financeDoId` and `financeApprovalStatus` stay on `invoices` because lists filter on them. |
| **`invoiceDelivery`** (1:1, PK = invoiceId, FK CASCADE) | isShippingSameAsBilling INT, shippingStreet, shippingCity, shippingState, shippingPin, deliveryOtp, deliveryNote, deliveryReminderSentAt, driverName, driverPhone, driverVehicleNo, deliveryProofKey, deliveryProofKeys JSON, receivedBySelf INT, receivedBySelfBy, deliverySerial, deliverySerialMatched INT, deliveryProofAt, deliveryProofBy, **storeExit JSON** | The delivery workflow (OTP, proofs, store exit). `deliveryOtp` is out of the main row, which helps the `/api/track` exposure noted in memory §10. |
| **`invoiceItems`** [HOT] (child, FK CASCADE) | id (keep the subdocument `_id`; line items have `_id`), invoiceId, lineNo, itemId, itemName, itemCode, vpCode, description, hsn, quantity, unit, rate, minSellingPrice, costPrice, adminOverrideRate INT, incentiveTargetAmount, incentiveAmount, incentiveType, incentiveValue, incentiveEarned, incentiveRules JSON, salesExecutive, discount, discountType, taxableAmount, gstRate, cgst, sgst, igst, amount, serialNumber, batchNumber, extendedWarrantyProvider, extendedWarrantyPlan, extendedWarrantyAmount, extendedWarrantyDuration, extendedWarrantyPolicyNo, stockWarehouseId | **Child table**: HSN summary, P&L COGS, product ledger, staff brand sales, incentives, task-target progress and staff rename all query or update lines. `lineNo` keeps array order, which `storeExit.lines[].lineIndex` refers to. |
| **`invoicePayments`** (child, FK CASCADE) | invoiceId, idx, mode, amount, txnId, reference, receivedBy, notes (subdocument has `_id: false`, so the PK is (invoiceId, idx)) | **Child table**: cash-register and mode-wise totals aggregate split payments by date. |

Indexes on `invoices`: UNIQUE(invoiceNumber); UNIQUE(offlineId) WHERE offlineId IS NOT NULL; (customerId); (customerPhone); (customerName COLLATE NOCASE); (date DESC, createdAt DESC); (type, createdAt DESC); (status); (billingEntity); (warehouseId); (financeDoId); (expectedDeliveryDate); (dueDate); partial (deliveryStatus) WHERE dispatchType = 'delayed_delivery'.
Indexes on `invoiceItems`: (invoiceId, lineNo); (itemId); (serialNumber) WHERE serialNumber <> ''; (salesExecutive).

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `Customer` → **`customers`** [HOT] (U5) | code, name, nameLower, email, phone, gstNumber, panNumber, billing_line1, billing_line2, billing_city, billing_state, billing_pincode, billing_country, shipping_line1 ... shipping_country, creditLimit, creditDays, **outstandingBalance** (atomic `+=`), advanceBalance, loyaltyPoints, customerGroup, status | Addresses are 1:1, so **flattened** (filtered by state and city in GST B2B logic) | UNIQUE(code) **(dedupe first)**; (phone); (name COLLATE NOCASE) |
| `CustomerAdvance` → `customerAdvances` (U5) | receiptNumber, customerId, customerName, customerPhone, customerEmail, customerAddress, amount, paymentMode, transactionRef, productBooked, targetBrand, targetCategory, notes, reason, status, usedAmount, remainingBalance, linkedInvoiceNumber, branchName, receivedBy, date, time | flat. Adjusting an advance on a bill is a guarded UPDATE in the bill's batch. | UNIQUE(receiptNumber); (customerPhone, status); (date DESC, createdAt DESC); (linkedInvoiceNumber) |
| `PaymentTransaction` → **`paymentTransactions`** [HOT] (U5) | transactionId, partyId, partyType, partyName, amount, paymentMode, date, referenceId, notes, receivedBy, balanceAfter, type, bankAccountId, bankAccountRef, bankTxnRef, lastEditedAt, lastEditedBy, editCount | flat | UNIQUE(transactionId); (partyId, date); (date); (referenceId) |
| `Estimate` → `estimates` (U4) | estimateNumber, date (ISO; Date in Mongo), expiryDate, customerName, customerPhone, customerAddress, customerGST, customerCompanyName, salesExecutive, salesperson, status, subTotal, taxTotal, total, notes, convertedInvoiceNumber, kind, approvalStatus, approvedBy, approvedAt, rejectedBy, rejectedAt, rejectReason, dealAmount, dealSalesperson, advanceAmount, advanceMode, advanceTxnRef, financeProvider, financeDoId, financeAppId, financeDownPayment, financeTenureMonths, financeInterestRate, financePdfUrl, financePdfUrls JSON, **financeDoData JSON**, **priceUnlock JSON** | `items[]` goes to child **`estimateItems`** (estimateId, idx, itemCode, name, quantity, rate, discount, itemId, tax, amount), because "same lines" diffing and conversion read lines | UNIQUE(estimateNumber); (approvalStatus); (salesperson); (customerPhone) |
| `SalesOrder` → `salesOrders` (U5) | orderNo, date, customerName, deliveryDate, itemsCount, totalAmount, paidAmount, balanceAmount, paymentStatus, status | | UNIQUE(orderNo) |
| `DeletedInvoice` → `deletedInvoices` (U5) | invoiceNumber, docType, customerName, total, deletedAt, deletedBy, deletedByRole, deletedByUserId, deleteReason, pinVerified INT, usedLegacyPin INT, **snapshot JSON**, extra JSON | snapshot is a whole old bill (about 5 to 30 KB) | (invoiceNumber); (deletedAt DESC) |
| `ExtendedWarranty` → `extendedWarranties` (U5) | warrantyId, customerName, customerPhone, customerEmail, invoiceNumber, itemId, productName, vpCode, serialNumber, planName, durationMonths, startDate, endDate, warrantyAmount, salesStaff, status, remarks | | UNIQUE(warrantyId); (invoiceNumber); (customerPhone); (vpCode) |
| `DiscountApproval` → `discountApprovals` (U4) (collection `discountapprovals`) | requestedBy, requestedById, requestedByRole, context, customerName, itemId, itemName, brand, sellingPrice, price, quantity, percent, tier, status, reviewedBy, reviewedAt, reviewNote | | (requestedById); (tier, status) |
| `EWayBill` → `ewayBills` (U5) | ewayBillNo, invoiceNumber, customerName, customerGstin, deliveryAddress, vehicleNumber, transporterName, transporterId, taxableValue, totalGst, totalAmount, status, generatedDate, validUntil, errorDetails, **items JSON** | low volume, lines only printed | UNIQUE(ewayBillNo); (invoiceNumber); (status) |
| `DeliveryChallan` → `deliveryChallans` (U5) | challanNo, type, invoiceNumber, sourceParty, sourceAddress, sourcePhone, destinationParty, destinationAddress, customerPhone, itemName, vpCode, hsn, serialImei, quantity, unit, itemPrice, defectDescription, financeDoId, reason, date (ISO), vehicleNo, transporterName, driverName, driverPhone, ewayBillNo, flowType, claimStatus, settledAt, settledBy, creditAmount, replacementItemId, replacementItemName, replacementSerial, itemId, supplierId, warehouse, settlementNote, createdBy, approvalStatus, approvedAt, approvedBy, creditNoteRef, debitNoteRef, deliveryOtp, deliveredAt, deliveryProofKey, deliveryProofKeys JSON, autoFromBill INT, status, remarks | flat (one product per challan) | UNIQUE(challanNo); (invoiceNumber); (flowType); (claimStatus); (approvalStatus) |
| `SerialNumber` → **`serialNumbers`** (U5) | serialNumber, itemId, vpCode, itemName, batchNo, status, warehouse, purchaseEntryId, invoiceId, invoiceNumber, customerName, customerPhone, soldDate, price, **history JSON** | history is only displayed, so JSON. Status flips (AVAILABLE ↔ SOLD) are guarded UPDATEs in the bill batch (`WHERE status = 'AVAILABLE'`). | UNIQUE(serialNumber); (itemId); (vpCode); (status); (invoiceNumber) |
| `StoreActivityApproval` → `storeActivityApprovals` (U5) | activityId, storeName, storeInchargeName, storeInchargeEmail, activityType, title, description, amount, **payload JSON**, status, superAdminActionAt, superAdminNotes, plus **generated columns** `payloadKind = json_extract(payload,'$.kind')` and `payloadTarget = json_extract(payload,'$.target')` **(verify D1 generated-column support)** | payload holds `{kind, target, before, after, data, baseVersion}` | UNIQUE(activityId); (status); (activityType); **partial UNIQUE(payloadTarget) WHERE status = 'pending'**, which enforces memory §17's "one waiting request per target" in the database |

### 4.4 Purchasing, vendors, stock documents (U5)

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `PurchaseEntry` → **`purchaseEntries`** | billNo, supplierName, supplierGST, supplierId, warehouse, warehouseId, linkedPoNo, noPoReason, type, billingEntity, billDate, dueDate, subtotal, gst, total, paid, balance, status, cancelledAt, cancelledBy, cancelReason, lastModifiedReason, backdateStatus, backdateRequestedBy, backdateMadeOn | `items[]` goes to child **`purchaseEntryItems`** (id, purchaseEntryId, lineNo, itemId, name, quantity, rate, gstRate, hsn, serialNumbers JSON), because the stock flow and product ledger read lines | (billNo) (not unique in Mongo; keep it non-unique); (supplierId); (billDate); (billingEntity); (status) |
| `DeletedPurchaseEntry` → `deletedPurchaseEntries` | billNo, supplierName, total, deletedAt, deletedBy, deletedByRole, deletedByUserId, deleteReason, pinVerified, usedLegacyPin, snapshot JSON, extra JSON | | (billNo); (deletedAt DESC) |
| `PurchaseOrder` → `purchaseOrders` | poNo, supplierName, date, expectedDate, totalAmount, subtotal, gst, status, **items JSON** | low volume; lines are printed and copied into a purchase entry, never aggregated | UNIQUE(poNo) |
| `Supplier` → `suppliers` | code, name, email, phone, gstNumber, panNumber, address_line1, address_city, address_state, address_pincode, address_country, creditLimit, creditDays, **outstandingBalance** (atomic), bank_bankName, bank_accountNumber, bank_ifscCode, bank_accountType, status | flattened | UNIQUE(code); (name COLLATE NOCASE), because `serials/route.ts` updates by name |
| `SupplierStockItem` → `supplierStockItems` (U4) | itemCode, description, brand, groupName, productDesc, charDesc, warehouse, availableStock, previousStock, isNewArrival INT, active INT, uploadId | an upload replaces or updates about 527 rows: several batches with an `uploadId` marker, then flip `active` | UNIQUE(itemCode, warehouse); (active) |
| `SupplierStockUpload` → `supplierStockUploads` (U4) | fileName, uploadedBy, uploadedByRole, rowCount, newProducts, totalUnits | | (createdAt DESC) |
| `StockOrderRequest` → `stockOrderRequests` (U4) | requestNumber, status, salesperson, salespersonId, note, totalQuantity, approvedBy, approvedAt, rejectedBy, rejectedAt, rejectReason, message, sentBy, sentAt, mergedInto, **items JSON**, **mergedFrom JSON** | the lines are edited as a whole set (merge) | UNIQUE(requestNumber); (status); (salespersonId) |
| `StockTransfer` → `stockTransfers` (collection `stocktransfers`) | transferNo, fromWarehouse, toWarehouse, fromWarehouseId, toWarehouseId, totalValue, date, status | `items[]` goes to child **`stockTransferItems`** (product ledger and stock flow read it) | UNIQUE(transferNo); (date) |
| `StockAdjustment` → `stockAdjustments` | adjustmentNo, date, reason, warehouseId | child **`stockAdjustmentItems`** (itemId, itemName, quantity, type, remarks) | UNIQUE(adjustmentNo) |
| `StockJournal` → `stockJournals` | journalNumber, date, purpose | child **`stockJournalItems`** (itemId, itemName, warehouseId, quantity, type) | UNIQUE(journalNumber) |
| `StockRequest` → `stockRequests` | requestNumber, date, requestingWarehouseId, supplyingWarehouseId, status, **items JSON** | | UNIQUE(requestNumber) |
| `StockReturn` → `stockReturns` | returnNumber, date, returnType, referenceId, status, **items JSON** | | UNIQUE(returnNumber) |
| `BillOfMaterial` → `billOfMaterials` | bomNumber, finishedGoodItemId, finishedGoodName, expectedQuantity, totalCost, **components JSON** | unused module **(verify)** | UNIQUE(bomNumber) |
| `InventoryAudit` → **`inventoryAudits`** (U5) | auditDate, auditor, category, totalExpected, totalPhysical, totalDiscrepancy, status, auditorId, completedBy, completedAt, warehouse, kind, completionTime, notes | `items[]` (about 450 per audit) goes to child **`inventoryAuditItems`** (id, auditId, productId, productName, vpCode, category, expectedStock, physicalStock, difference, condition, remarks, counted INT, countedBy, countedAt). Several staff count at once, so row-level UPDATEs replace today's `arrayFilters`. The card's progress becomes `SELECT COUNT(*) ... WHERE counted = 1`. | (auditDate); (status); (kind); child UNIQUE(auditId, productId) |
| `Vendor` → `vendors` | code, name, contactPerson, email, phone, altPhone, gstNumber, panNumber, address_* (line1, line2, city, state, pincode, country), creditLimit, creditDays, openingBalance, openingBalanceDate, bank_* (bankName, accountNumber, ifscCode, accountType), notes, status | flattened | UNIQUE(code); (name); (phone) |
| `VendorBill` → `vendorBills` | billNo, vendorId, vendorName, date, dueDate, subtotal, gstRate, gstAmount, total, notes, reference, status, cancelledAt, cancelledBy, cancelReason, createdBy, **items JSON** | | UNIQUE(billNo); (vendorId, date DESC); (status) |
| `VendorPayment` → `vendorPayments` | paymentId, vendorId, vendorName, date, amount, mode, refNo, againstBillNo, receivedBy, notes, type, createdBy, createdByRole | | UNIQUE(paymentId); (vendorId, date DESC); (type) |

### 4.5 Cash, finance, accounting (U5)

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `CashTransaction` → **`cashTransactions`** [HOT] (cash card on the dashboard) | type, category, amount, date, time, referenceNo, description, partyName, targetBankAccount, handedTo, recordedBy, adminStatus, adminReviewedBy, adminReviewedAt, adminRejectReason | | (date); (category, date); (adminStatus) |
| `AdminCashEntry` → `adminCashEntries` | type, amount, date, time, bankAccountId, bankAccount, referenceNo, description, recordedBy, recordedByUserId, voided INT, voidedBy, voidedAt, voidReason | | (type); (date) |
| `DayClose` → `dayCloses` | date, openingCash, systemExpectedCash, systemOpeningCash, dayCashIn, dayCashFromInvoices, dayCashOut, originalSystemExpectedCash, originalDifference, recalculatedAt, recalculatedBy, countedCash, **denominations JSON**, coinsAmount, difference, notes, closedBy, closedByRole, closedAt | | UNIQUE(date) |
| `FinanceTransaction` → `financeTransactions` (54 fields, under the column limit) | financeProvider, customerName, customerId, customerMobile, deliveryAddress, invoiceNumber, atosDealId, doId, date, assetCategory, oemCategory, manufacturer, brand, productModel, eanNumber, schemeCode, productPrice, grossLoanAmount, netLoanAmount, marginMoney, advanceEmi, serviceCharge, upfrontInterest, dealerInterestSubsidy, dealerSubsidyPercent, mbdFromDealer, cardCharges, creditSurakshaFees, healthCardCharges, totalEmi, totalGst, convenienceFee, cashback, customerDownPayment, totalDeductions, netDisbursement, tenureMonths, monthlyEmiAmount, totalPaidEmiAmount, balanceDueAmount, approvalStatus, uploadedPdfUrl, uploadedPdfUrls JSON, approvedBy, approvalDate, actualReceivedAmount, bankAccountRef, bankAccountId, transactionRef, paymentReceivedDate, remarks, deliveryInstructions | `emiSchedule[]` goes to child **`financeEmiInstallments`** (financeId, installmentNumber, dueDate, amount, status, paidDate, paymentChannel, paymentMode, collectedBy, bankRef, receiptNumber, bounceReason, penaltyAmount, notes), because EMI cycles and overdue lists filter by due date and status. `linkedInvoices[]` goes to child **`financeLinkedInvoices`** (financeId, invoiceNumber, amount, linkedAt), because settlement (`lib/financeSettlement.ts`) looks up by invoice. | UNIQUE(doId); (invoiceNumber); (customerMobile); (approvalStatus); EMI (dueDate, status) |
| `Expense` → `expenses` (collection `expenses`) | expenseNo, category, description, amount, date, paymentMode, status | | UNIQUE(expenseNo); (date) |
| `JournalEntry` → `journalEntries` (hidden module) | entryNumber, date, description, referenceType, referenceId, totalDebit, totalCredit, **lines JSON** | the accounting module is hidden; JSON until it is used | UNIQUE(entryNumber) |
| `GSTRReport` → `gstrReports` | reportId, type, date, partyName, gstin, amount, igst, cgst, sgst, totalTax | (the GSTR pages compute from invoices; this collection may be unused **(verify)**) | (type, date) |
| `IncentivePayout` → `incentivePayouts` | userId, employeeName, amount, date, paymentMode, note, paidBy, paidByUserId | | (userId); (date) |

### 4.6 People, HR, attendance (U3)

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `User` → **`users`** [HOT] (session / NextAuth `authorize`, `/api/users` from 10 files) | name, email, password (hash), role, mobile, avatar, address, city, state, pincode, idProofType, idProofNumber, idProofDoc, designation, monthlySalary, salaryType, salaryPaymentDay, joiningDate, **advanceBalance** (atomic), monthlyAdvanceDeduction, vehicleNumber, drivingLicenseNo, bankName, bankAccountNo, bankIfsc, assignedWarehouseId, assignedWarehouseName, assignedBrand, **assignedBrands JSON**, securityPin*, pinUpdatedAt, pinFailCount*, pinLockedUntil*, unlockPinFailCount*, unlockPinLockedUntil*, liveAuditAccess INT, status (* = secret, excluded by default) | | UNIQUE(email COLLATE NOCASE) **(dedupe check)**; (role); (mobile) (login by mobile) |
| `Attendance` → **`attendance`** [HOT] (presence posts, the 5-minute cron, dashboard cards) | staffName, staffKey (normalised), staffId, staffEmail, staffRole, userId, branchId, branchName, date, checkInTime, checkOutTime, workingDurationMinutes, shiftName, isLate INT, isEarlyCheckout INT, status, leaveType, leaveStatus, leaveReason, advanceRequested, advanceStatus, notes, lateMinutes, checkInPhotoKey, checkInLat, checkInLng, checkInDistanceM, **awayPeriods JSON**, totalAwayMinutes, unknownMinutes, lastPresence_state, lastPresence_at, lastPresence_distanceM, lastPresence_lat, lastPresence_lng | **`awayPeriods` stays JSON**: one row per person per day, read and rewritten whole by `lib/presence.ts` (`recordPresence`), typically under 30 entries. Guard the write with `updatedAt` (presence posts and the cron can race). `lastPresence` is 1:1, so flattened. | **UNIQUE(staffName, date)** (as in Mongo); (date, status); (userId, date) |
| `LeaveRequest` → `leaveRequests` (collection `leaverequests`) | kind, staffName, staffId, staffRole, fromDate, toDate, days, breakMinutes, reason, status, reviewedBy, reviewedAt, reviewNote, breakStartedAt, breakEndsAt, breakReturnedAt, lastOverAlertAt | | (kind); (staffId); (status); (fromDate, toDate) |
| `Salary` → `salaries` | employeeName, employeeId, designation, monthlySalary, salaryType, joiningDate, deductions, incentives, commission, payableAmount, paymentStatus, paymentDate, paymentMode, month, year, notes | `history[]` goes to child **`salaryPayments`** (id, salaryId, date, amount, paymentMode, txnRef, notes) | (employeeId); (month, year); (paymentStatus) |
| `StaffTask` → **`staffTasks`** (dashboard, bell) | taskTitle, assignedStaff, assignedStaffId, assignedDate, dueDate, dueTime, priority, description, reminder INT, status, taskType, targetProduct, targetBrand, targetQty, targetAmount, currentQty, currentAmount, linkedInvoiceNumber, createdBy, groupId, **seenBy JSON**, completedAt, completionRemarks, notes | `seenBy` is JSON (small, displayed as "Read by"); added with a guarded read-modify-write. Target progress uses atomic `currentQty = currentQty + ?`. | (assignedStaff, status); (taskType, status); (assignedDate); (dueDate); (groupId); (assignedStaffId) |
| `PushSubscription` → `pushSubscriptions` (U2) | userId, endpoint, p256dh, auth, userAgent, failCount, lastSuccessAt | | UNIQUE(endpoint); (userId) |

### 4.7 CRM and pre-sale (U4)

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `Lead` → **`leads`** [HOT] (dashboard pipeline, leads page, bill form lookup by mobile) | leadId, customerName, mobile, email, source, walkInReason, interestedProduct, vpCode, assignedStaff, assignedStaffKey, estimatedValue, priority, status, followUpDate, lastFollowUpDate, callCount (atomic), lastCalledAt, notes, estimateNumber, estimateId, convertedInvoiceNumber, **items JSON**, **timeline JSON** | `followUps[]` goes to child **`leadFollowUps`** (leadId, date, nextDate, outcome, notes, staff, staffId, loggedAt): "follow-ups today / overdue" and Staff Activity query by date and staff. `calls[]` goes to child **`leadCalls`** (leadId, at, staff, staffId): Staff Activity counts calls per staff per day. `sharedWith[]` goes to child **`leadShares`** (leadId, staff, staffId, brand, products, note, status, requestedBy, requestedById, requestedAt, respondedAt): the staff filter and "shared with me". `timeline` and `items` stay JSON (display only). | UNIQUE(leadId); (mobile); (status); (assignedStaffKey, status); (followUpDate); (estimateNumber); children (leadId), (staffId, at), (date) |
| `WalkInQuery` → `walkInQueries` | customerName, mobile, date, time, reason, interestedProduct, category, budget, staff, notes, followUpDate, status, leadId | | (mobile); (date) |
| `CustomerComplaint` → `customerComplaints` | ticketNumber, complaintType, accusedStaffId, accusedStaffName, accusedStaffRole, accusedStaffBrand, customerName, customerPhone, customerEmail, customerAddress, productName, vpCode, serialNumber, invoiceNumber, purchaseDate, issueTitle, issueDescription, priority, status, assignedTo, assignedStaffRole, assignedDate, actionTaken, resolutionNotes, resolvedAt, resolvedBy, customerFeedback | | UNIQUE(ticketNumber); (status, priority, createdAt DESC); (complaintType, createdAt DESC); (customerPhone); (invoiceNumber) |

### 4.8 Logs, notifications, messaging (U2)

| Model → table | Columns | Child / JSON | Indexes |
|---|---|---|---|
| `AuditLog` → `auditLogs` (append-only) | action, entityType, entityRef, entityId, partyName, amount, reason, performedBy, performedByUserId, performedByRole, pinVerified INT, usedLegacyPin INT, ip, userAgent, **metadata JSON** (before/after) | Rows over 1 MB: store the metadata in R2 and keep `metadataR2Key` **(expected never; invoice before/after is about 5 to 30 KB)** | (createdAt DESC); (action, createdAt DESC); (entityType); (entityRef) |
| `Notification` → **`notifications`** [HOT] (bell on every page) | recipientId, recipientName, type, title, message, link, readAt, refType, refId, createdBy | | (recipientId, createdAt DESC); partial (recipientId) WHERE readAt IS NULL |
| `WhatsAppMessage` → `whatsappMessages` | event, audience, toNumber, toName, message, waLink, entityType, entityRef, entityId, status, provider, providerMessageId, error, attempts, sentAt, sentBy, triggeredBy | | (status, createdAt DESC); (createdAt DESC); (entityRef); (toNumber) |

### 4.9 New system tables (D1 only)

| Table | Purpose |
|---|---|
| `migrationFlags(unit PK, state, changedAt, changedBy)` | Per-unit cutover state (§6.6). Read once per request. |
| `mirrorOutbox(id, collection, docId, op, enqueuedAt, attempts, lastError)` | Reverse mirror (D1 to Mongo) after cutover. Written in the same `batch()` as the business write. |
| `mirrorState(collection PK, lastId, lastSyncedAt, rowCount, checksum)` | Backfill resume points and reconciliation results. |
| `idempotencyKeys(key PK, route, status, response JSON, createdAt)` | Offline bill replays (`offlineId`), payment POST retries. |
| `counters(name PK, value)` | Optional sequences (estimate, challan, SO-YYYY numbers). Invoice numbers keep the scan-max logic, backed by a UNIQUE index (§5.4). |
| `_guard(ok INTEGER NOT NULL CHECK (ok = 1))` | Abort helper for conditional batches (§5.4). Always empty. |
| `d1_migrations` | Created by wrangler. |

**Count:** 69 model files give **69 parent tables** (one per model; `accounts`, `journalEntries`, `billOfMaterials` and `gstrReports` may turn out unused and could be dropped, **verify**), plus **about 20 child or 1:1 tables** (including `itemStock`, `stockMovements` and `itemSupplierCodes`), plus 6 system tables.

---

## 5. Data access layer (repository) strategy

### 5.1 Shape

```
lib/repo/                       (lib/data/ already holds static data: locations.ts; use a new folder)
  d1.ts                         getDb(): getCloudflareContext().env.DB  (+ withSession later)
  flags.ts                      unitState(unit) -> 'mongo' | 'mirror' | 'shadow' | 'd1-read' | 'fence' | 'd1' | 'd1-only'
  ids.ts                        newId(): 24-hex ObjectId-compatible
  mirror.ts                     mirrorToD1(collection, ids) / mirrorToMongo(outbox) / queue on failure
  canonical.ts                  toCanonical(doc) for parity diffs (number tolerance, date normalisation)
  schema/                       Drizzle table definitions (one file per domain), the source of truth for migrations
  transform/<collection>.ts     Mongo document <-> rows (pure functions, shared by backfill, mirror and the D1 repo)
  <domain>/
    types.ts                    DTOs = today's lean() document shapes (so routes and UI do not change)
    mongo.ts                    current mongoose code moved here unchanged
    d1.ts                       the same interface on D1
    index.ts                    export const invoices = route('U5', mongoImpl, d1Impl)
```

Domains:
- `catalog` (items, itemStock, brands, categories, units, variants, warehouses, productRefs, onsitego)
- `customers`
- `sales` (invoices and children, estimates, advances, warranties, challans, eway, serials, deletedInvoices)
- `payments` (paymentTransactions, cash, adminCash, dayClose, bank)
- `purchases` (purchaseEntries, POs, suppliers, vendor*)
- `stockDocs` (transfers, adjustments, journals, requests, returns, audits)
- `finance`
- `crm` (leads, walk-ins, complaints, discountApprovals, stockOrders, supplierStock)
- `people` (users, attendance, leave, salary, tasks, incentivePayouts)
- `logs` (audit, notifications, whatsapp, push)
- `settings`

**Rule:** routes and `lib/*` call `repo.<domain>.<fn>()` and never import `models/*` or mongoose again. An ESLint `no-restricted-imports` rule blocks `@/models/*` and `mongoose` outside `lib/repo/**/mongo.ts`, so progress is measurable: about 150 files import mongoose or `connectToDatabase` today (OPTIMIZATION counted 211 including model imports).

**Functions are use-case shaped, not generic**:
- `sales.createInvoice(input, actor)`
- `sales.listInvoices({from, to, type, q, cursor, fields})`
- `catalog.listItemsForPicker()`
- `catalog.moveStock(moves[])`
- `customers.adjustBalance(id, delta)`
- `people.recordPresence(...)`

Generic `find(filter)` passthroughs would leak Mongo query syntax into the D1 implementation. The repository returns the **same DTO shape** the routes return today (`_id` kept as a field alias of `id` in the DTO) so the UI and the offline cache need no change.

### 5.2 Query builder: **Drizzle ORM** (with raw SQL for reports)

| | Drizzle (`drizzle-orm/d1`) | Kysely (+ community D1 dialect) | Raw `env.DB.prepare()` |
|---|---|---|---|
| Typed schema in TS | yes; it also generates SQL migrations (`drizzle-kit generate`) that `wrangler d1 migrations apply` can run | types only; migrations by hand | none |
| D1 `batch()` | `db.batch([...])` supported on D1 **(verify on Drizzle's D1 page; the batch-API page only shows Neon)** | via the dialect / raw | native |
| JSON columns | `text('x', { mode: 'json' }).$type<T>()` | manual | manual |
| Raw SQL escape hatch | `sql\`qty = qty + ${d}\`` | yes | it is all raw |
| Bundle on Workers | small, no native deps | small | none |
| about 90 tables of CRUD | low boilerplate | medium | high (about 3,000+ lines of SQL strings) |

**Recommendation:**
- **Drizzle** for the schema, migrations and CRUD (one schema for about 69 + 20 + 6 tables).
- **Raw prepared statements** (`env.DB.prepare(...).bind(...)`) for the heavy reports (dashboard, P&L, GSTR, HSN, incentives, product ledger), where hand-written SQL with `GROUP BY` is clearer and faster.
- Keep one schema source: the Drizzle schema files generate the migrations. Review every generated migration by hand before committing.

### 5.3 IDs

- **Keep every existing `_id` as the TEXT primary key.** Links (`/sales/invoices?q=`, approvals `target: payment:<id>`, `/api/track/[id]`), the browser's offline caches (cached products and customers keyed by `_id`) and references stored as strings in other documents all survive unchanged.
- Child line rows keep their subdocument `_id` where one exists (invoice items, timeline, salary history, serial history). Where the subdocument has `_id: false`, the child PK is (parentId, idx).
- New rows get `newId()`, a 24-hex ObjectId (4-byte seconds + 5 random + 3 counter), so ids generated on D1 look the same and sort by time. **During the reverse-mirror phase the same id is written to Mongo** as `new ObjectId(id)`, so both stores always agree.

### 5.4 Atomic stock and balance changes, without interactive transactions

**Pattern: read, decide in JS, then one atomic `batch()` with guards.**

1. **Read** what the decision needs (item rows, stock rows, customer, advance, serials, the existing invoice for an edit), with the D1 session if replication is on.
2. **Compute** in JS exactly as today (the business logic in `app/api/invoices/route.ts`, `lib/invoice-full-edit.ts`, `lib/financeSettlement.ts`, `lib/payment-change.ts` stays the same code, now producing a list of statements instead of awaiting writes one by one).
3. **Write** everything in one `env.DB.batch([...])`. If any statement fails, nothing is applied.

**Building blocks:**

```sql
-- Stock: per-warehouse delta (replaces lib/stock.ts applyStockMovement; no read needed)
INSERT INTO itemStock (itemId, warehouseId, qty) VALUES (?1, ?2, ?3)
  ON CONFLICT (itemId, warehouseId) DO UPDATE SET qty = qty + excluded.qty;
INSERT INTO stockMovements (id, itemId, warehouseId, delta, refType, refId, at, by) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
-- Re-derive the three aggregates in the same batch (replaces recomputeAggregates; SET sees old values, so do not reuse them)
UPDATE items SET
  showroomStock = (SELECT COALESCE(SUM(s.qty),0) FROM itemStock s LEFT JOIN warehouses w ON w.id = s.warehouseId
                   WHERE s.itemId = items.id AND COALESCE(w.type,'showroom') <> 'godown'),
  godownStock   = (SELECT COALESCE(SUM(s.qty),0) FROM itemStock s JOIN warehouses w ON w.id = s.warehouseId
                   WHERE s.itemId = items.id AND w.type = 'godown'),
  currentStock  = (SELECT COALESCE(SUM(s.qty),0) FROM itemStock s WHERE s.itemId = items.id),
  updatedAt = ?2
WHERE id = ?1;
-- Legacy "no warehouse" sale keeps today's behaviour exactly (only currentStock moves):
UPDATE items SET currentStock = currentStock + ?, updatedAt = ? WHERE id = ?;

-- Balances
UPDATE customers SET outstandingBalance = outstandingBalance + ?, updatedAt = ? WHERE id = ?;
UPDATE bankAccounts SET balance = balance + ?, updatedAt = ? WHERE id = ?;

-- Guard: abort the whole batch if a record changed since it was read (optimistic concurrency)
INSERT INTO _guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE id = ? AND updatedAt = ?);
-- Guard: a serial must still be AVAILABLE
INSERT INTO _guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM serialNumbers WHERE serialNumber = ? AND status = 'AVAILABLE');
-- Guard: the advance still has the balance being used
INSERT INTO _guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM customerAdvances WHERE id = ? AND remainingBalance >= ?);
```

The `_guard` insert writes zero rows when the condition holds. When it fails, it tries to insert `0`, the `CHECK (ok = 1)` fails, and the batch rolls back. The repository maps that error to `409 Conflict`, which `lib/change-requests.ts` already uses for "record changed after the request". **(verify on staging that a CHECK failure mid-batch rolls back earlier statements, as the batch docs say.)**

- **Invoice numbers:** port `nextNumberInSeries` as
  `SELECT MAX(CAST(substr(invoiceNumber, length(?1) + 1) AS INTEGER)) FROM invoices WHERE invoiceNumber LIKE ?2 ESCAPE '\'`.
  The prefix pattern is ≤ 50 bytes; today's prefixes are short, like `SVAK2026RI`. The INSERT then relies on **UNIQUE(invoiceNumber)**: on a unique-constraint error, recompute and retry (at most 3 times). This is stronger than today, where the unique index may be missing on live.
- **Idempotency:** the bill's batch includes `INSERT INTO idempotencyKeys(key, ...)` (key = `offlineId` or an `Idempotency-Key` header). A replay hits the PK conflict, and the handler returns the stored response. This is added in addition to the existing "same customer, same total, same date" check (memory §15, route lines 340 to 368), not instead of it.
- **Statement budget:** a typical bill is 1 invoice row + 2 one-to-one rows + N lines + payments + 3N stock statements + customer + advance + serials + lead + tasks + audit + notifications ≈ 20 to 60 statements, one `batch()`. That is far under 1,000 queries and 30 s. Each statement must keep ≤ 100 bound params (the invoice row has about 80).
- **Side effects outside the DB** (push, WhatsApp, realtime publish, R2) run **after** the batch commits, as today.

### 5.5 Reads, consistency and the bookmark

- **Before read replication is enabled:** all queries hit the primary, which is strongly consistent and simple. **Keep it that way through the migration.**
- **After cutover (optional):** enable replication.
  - Every request does `env.DB.withSession(bookmarkFromCookie ?? "first-unconstrained")`.
  - After a write, return `session.getBookmark()` in a `d1-bookmark` cookie.
  - The realtime refetch then reads at least that version.
  - Money screens and approvals use `"first-primary"`.

---

## 6. The zero-downtime procedure, step by step

### 6.0 Principles

1. **Mongo remains the source of truth until a unit's flag says otherwise.** Every phase is reversible by flipping a flag; only the final decommission is not.
2. **Expand, then contract.** D1 schema changes are additive until the very end. A Worker rollback (`wrangler rollback`) never needs a schema rollback.
3. **One code path for transforms.** The backfill, the mirror, the reconciliation and the D1 repository all use `lib/repo/transform/*`. A bug shows up as a diff, never as silent divergence.
4. **Staging first, always.** Every step below runs on staging (own Mongo `valueplus_staging`, own D1 `valueplus-staging`, own Worker) at least once, with the scripted checks green, before production.
5. **Deploys are atomic.** A Workers deploy switches new requests to the new version while in-flight requests finish on the old one. **Do not use gradual (percentage) version rollouts during this project.** Two versions with different flag logic must never serve together. Flags live in D1 so every isolate sees the same state.

### Phase 0: preparation (no production change)

**0.1 Restore staging.** Re-add `env.staging` to `wrangler.jsonc` (Worker `valueplus-erp-staging`, R2 `valueplus-delivery-proofs-staging`, `MONGODB_DB=valueplus_staging`), plus a D1 binding per environment:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "valueplus", "database_id": "<prod-id>", "migrations_dir": "db/migrations" }
],
"env": {
  "staging": {
    "name": "valueplus-erp-staging",
    "d1_databases": [
      { "binding": "DB", "database_name": "valueplus-staging", "database_id": "<staging-id>", "migrations_dir": "db/migrations" }
    ]
    // plus the staging vars, r2 bucket, durable objects, services as before
  }
}
```

Create the databases with:

```
npx wrangler d1 create valueplus-staging --location=apac
npx wrangler d1 create valueplus --location=apac
```

Then refresh staging data with `node scripts/copy-db-to-staging.mjs`.

**0.2 Measure the live data (read-only script, run by the team).** For each collection record:
- `countDocuments`
- `collStats` (`size`, `avgObjSize`, `storageSize`)
- the largest document (`$bsonSize`)
- whether the declared unique keys hold: a `$group` by key with `count > 1`
- off-enum values
- docs missing required fields
- the real collection names (`listCollections`)

Write the results to `docs/d1-data-profile.json`. This replaces the estimates in §8.1.

**0.3 Verify indexes on live** (OPTIMIZATION A4) and run the duplicate report. Fix duplicates **in Mongo** (with the Admin; for example re-number colliding `CUST-` codes) before anything else.

**0.4 Measure D1 latency from India.** Deploy a tiny probe route on staging. For one week, log p50/p95 of a single indexed SELECT, a 10-statement batch and a 450-row read.

**0.5 Security housekeeping.**
- Remove the hard-coded fallback MongoDB URI (with a password) in `lib/db.ts` (memory §10 "Known gaps").
- **Rotate the Atlas password.** It sits in git history.
- The D1 mirror endpoints (below) are internal-only and protected by a secret header, like the cron's `x-cron-key`.

### Phase 1: schema (staging, then prod)

**1.1** Write the Drizzle schema (`lib/repo/schema/*`), then run `drizzle-kit generate` into `db/migrations/0001_init.sql` ... Review the SQL by hand: column names, NULLability, defaults, indexes, partial indexes and generated columns.

**1.2** Apply the migrations:
- `npx wrangler d1 migrations apply valueplus-staging --remote --env staging` (**verify flags**)
- then `npx wrangler d1 migrations apply valueplus --remote`

The production DB is unused at this point, so this is zero-risk.

**1.3** Check the result with `PRAGMA table_list`, `PRAGMA index_list(<t>)` and `PRAGMA foreign_key_list(<t>)`, compared against a checked-in expected list (a CI script).

### Phase 2: backfill (bulk copy; Mongo is still the only thing the app uses)

**2.1 Tool:** `scripts/d1-backfill.mjs` (Node, run from a laptop or a CI runner).
- Reads Mongo with a cursor sorted by `_id`, in pages of 500.
- Transforms with `lib/repo/transform` (compiled TS).
- Writes **`.sql` files**: multi-row `INSERT ... ON CONFLICT(id) DO UPDATE` with ≤ 100 params per statement and statements < 100 KB.
- Splits files at about 50 MB each.
- Writes a resume checkpoint per collection (`lastId`) to a local JSON file, so a crash resumes where it stopped.

**2.2 Load:** `npx wrangler d1 execute valueplus --remote --file=out/0007_invoices_part3.sql` for each file, in dependency order (parents before children). Run `PRAGMA defer_foreign_keys = on` first if a file mixes them.

**2.3 Pre-flight checks inside the tool** (the run fails on any of these):
- unique-key duplicates;
- rows over 1 MB (for AuditLog / snapshots: move them to R2, or report);
- `undefined` values (converted to NULL);
- unparseable dates;
- NaN numbers;
- off-enum values (reported, not blocked).

**2.4 Mark the start time.** Record `T_backfill_start` (Mongo `operationTime`) **before** reading the first page. Everything written after it is re-copied by the catch-up (2.6) and the mirror (Phase 3).

**2.5 Checksums per table**, saved to `mirrorState`:

| Table | Checks |
|---|---|
| all | `COUNT(*)` |
| invoices | `SUM(total)`, `SUM(balanceAmount)`, `SUM(paidAmount)`, count by `type` and `status` |
| invoiceItems | `COUNT(*)`, `SUM(quantity)`, `SUM(taxableAmount)` |
| items | `SUM(currentStock)`, `SUM(showroomStock)`, `SUM(godownStock)`; itemStock `SUM(qty)` per warehouse |
| customers / suppliers | `SUM(outstandingBalance)` |
| paymentTransactions | `SUM(amount)` by `type` |
| cashTransactions | `SUM(amount)` by `category` |

Plus a **per-row hash**: SHA-256 of the canonical JSON per id, compared in ranges of 500 ids (hash of hashes) so a mismatch is found in a few round trips.

**2.6 Catch-up:** re-copy every document with `updatedAt ≥ T_backfill_start − 10 min` (all models have `timestamps: true`), then run 2.5 again. Expected result: counts equal, sums equal to ±0.01, zero row-hash mismatches.

Effort: the tool takes about 4 days. A full run takes minutes (estimated well under 100 MB of data).

### Phase 3: dual-write mirror (Mongo truth, D1 follows)

**3.1 Mechanism: "copy by id".** After any successful Mongo write, mirror the **current** state of each touched document from Mongo to D1:
- re-read the doc by `_id`;
- transform it;
- one `batch()`: UPSERT the parent row, `DELETE` and re-`INSERT` its child rows, or `DELETE` the parent on removal.

Copying the latest state, rather than replaying operations, makes the mirror **idempotent and order-independent**: retries, duplicates and out-of-order deliveries all converge.

**3.2 Coverage with no route rewrites yet: a global mongoose plugin** registered in `lib/db.ts` before any model compiles **(verify plugin ordering; models compile on import, so the plugin must load first, for example by importing `lib/repo/mirror-plugin` at the top of `lib/db.ts` and making every model import `lib/db`)**.

| Hook | Captured |
|---|---|
| `post('save')`, `post('insertMany')` | the `_id`s |
| `pre` + `post` on `updateOne`, `updateMany`, `findOneAndUpdate`, `deleteOne`, `deleteMany`, `findOneAndDelete`, `replaceOne` | in `pre`, `this.model.find(this.getFilter()).distinct('_id')` (one extra indexed read) to capture affected ids; in `post`, enqueue them |
| `bulkWrite` | **(verify mongoose 8 middleware support)**. Otherwise wrap the 11 call sites by hand. |
| Raw `db.collection()` writes and scripts in `scripts/` | not covered. Only the product-ledger *read* uses raw access today. After running any script, run the reconciliation for the touched collections. |

**3.3 Delivery:**
- The ids collected during a request are flushed in `ctx.waitUntil(mirror.flush())` so the user's response is never delayed.
- On failure the ids go to a **Cloudflare Queue** `d1-mirror` (verify Queues pricing on the plan; volume is tiny), or to a Mongo `mirror_retry` collection if Queues are not wanted.
- A consumer retries with backoff and alerts after 10 failures.
- The cron (every 5 min) also drains anything stuck.
- **Domains already in state `d1-read`** mirror **inline (awaited)** before the response, so a screen refetching through the realtime hub reads its own write (§6.7).

**3.4 Reconciliation job** (nightly at 01:00 IST plus on demand):
- For each table compare counts, the checksums from 2.5 and row hashes over the last 3 days of `updatedAt`, plus a full row-hash sweep weekly.
- Diffs are auto-healed by re-copying by id, and logged with the diff.
- More than 0.1% diff in any table, or any diff in money tables after healing twice, raises an Admin notification and blocks progress to the next phase.

**3.5 Soak:** run for at least 7 days with zero unexplained diffs. Effort: about 5 days of build plus the soak.

### Phase 4: repository layer refactor (per domain, still Mongo-only behaviour)

**4.1** Move each domain's mongoose code behind `lib/repo/<domain>/mongo.ts` **without changing behaviour**: same queries, same results. This is the biggest work item (about 150 files). Do one PR per domain, each deployed after the existing API checks pass.

**4.2** Write `lib/repo/<domain>/d1.ts` for the same interface. Unit-test it against a local D1 (`wrangler dev` / Miniflare, or `getPlatformProxy`) seeded from the staging export.

**4.3** Order of domains: settings → catalog → logs → people → crm → customers → purchases → stockDocs → payments → finance → **sales last**. Sales is the largest (`app/api/invoices/route.ts` alone has 1,683 lines; `lib/invoice-full-edit.ts`; `dashboard/stats` has 1,743).

### Phase 5: shadow reads (serve Mongo, compare with D1)

**5.1** In state `shadow` the repository serves the Mongo result and, in `ctx.waitUntil`, runs the D1 implementation with the same arguments, canonicalises both and diffs them.

**5.2** The diff ignores:
- documents whose `updatedAt` is younger than 10 s (mirror lag);
- number differences below 0.005;
- key order;
- `undefined` vs missing.

Diffs are written to a `shadowDiffs` D1 table (sampled at most 50 per route per hour) and summarised on an internal admin page.

**5.3** Shadow every read endpoint for **at least 7 days per domain** with real traffic, including month-end for reports. Exit criterion: zero unexplained diffs for 3 consecutive days.

**5.4** Cost: shadow reads double the read work for that domain. D1 rows read are effectively free (25 bn included). Worker CPU rises a little for a few weeks, which is acceptable.

### Phase 6: per-domain cutover behind flags

**6.6 Flag states** (table `migrationFlags`, one row per unit, read once per request; read-path states are cached per isolate for 5 s, write-path states are not cached):

| State | Reads served from | Writes go to | Mirror |
|---|---|---|---|
| `mongo` | Mongo | Mongo | off |
| `mirror` | Mongo | Mongo | Mongo → D1 async |
| `shadow` | Mongo (D1 compared) | Mongo | Mongo → D1 async |
| `d1-read` | **D1** | Mongo, then **inline** copy to D1 | Mongo → D1 sync + async retry |
| `fence` | D1 | **wait** (poll the flag every 250 ms, up to 30 s) | draining |
| `d1` | D1 | **D1** (batch); the same batch writes `mirrorOutbox` rows | **D1 → Mongo** async (reverse mirror) |
| `d1-only` | D1 | D1 | off (Mongo frozen) |

**Why not KV for flags:** KV is eventually consistent across locations. During a write flip, two PoPs could disagree about the source of truth for up to a minute **(verify current KV propagation figures)**. A D1 row is read from the primary and is strongly consistent; the cost is one extra indexed read per request.

**Unit order (read-only and master data first, money last):**

| Unit | Contents | Why this order | Notes |
|---|---|---|---|
| **U1 master and settings** | brands, categories, units, variants, warehouses, billing companies, product refs, Onsitego plans, document folders and stored documents, shift / price-unlock / WhatsApp settings, role permissions | rarely written, no money | Read cutover of `items` for the catalog and pickers can happen here as `d1-read` (writes stay with U5). This alone removes the 3.9 s product list. |
| **U2 logs and notifications** | auditLogs, notifications, whatsappMessages, pushSubscriptions | append-only, so dual-writing is trivially safe | The bell (on every page) becomes fast. |
| **U3 people and HR** | users, attendance, leaveRequests, salaries, staffTasks, incentivePayouts, scheduledRuns | independent of money except `User.advanceBalance` (attendance route) | **NextAuth `authorize` (`lib/authOptions.ts`) moves here.** Test logins for all 12 roles. Presence posts and the cron are the hot writers. |
| **U4 CRM and pre-sale** | leads (+3 children), walkInQueries, customerComplaints, estimates (+items), discountApprovals, stockOrderRequests, supplierStock* | estimates and leads are written by the invoice POST (conversion, target progress) | While U5 is still Mongo-truth, those cross-writes go through the repository to D1. They are no less atomic than today (Mongo uses no transactions). |
| **U5 money and stock** (one flip) | items writes / itemStock / stockMovements, invoices (+4), customers, customerAdvances, paymentTransactions, cash*, dayCloses, bankAccounts, adminCash, financeTransactions (+2), purchaseEntries (+items), purchaseOrders, suppliers, vendors / vendorBills / vendorPayments, serialNumbers, deliveryChallans, ewayBills, extendedWarranties, salesOrders, stock documents and inventory audits, expenses, storeActivityApprovals, deleted*, accounts / journal | a single bill writes about 12 of these tables, so they flip together to get `batch()` atomicity | Do it last, after shop close. |

**Per unit:** `mongo → mirror → shadow → d1-read → (fence) → d1 → (N days) → d1-only`.

**6.7 Read cutover (`d1-read`)**, for each unit:
1. Preconditions: the shadow exit criterion is met; reconciliation is clean for 7 days.
2. Flip the flag. Reads come from D1 immediately.
3. Writes still go to Mongo first and are then **copied inline** to D1 before the response, so the realtime hub's refetch (published by `worker.ts` after the response) sees the change.
4. If the inline copy fails, the request still succeeds (Mongo is truth), the id is queued, and the unit's reads **fall back to Mongo for 60 s** in that isolate. An alert fires.
5. **Rollback:** flip back to `shadow` (instant; nothing to drain).

**6.7a Stage C, as built (Nov 2026): the read cutover runs by itself.** Nobody has to flip anything. The five read areas (`masters`, `crm`, `staff`, `stock`, `sales`; switches `read:<area>` in `feature_flags`) move from `shadow` to `d1` on their own and move back on their own. MongoDB stays the source of truth; every write still goes to MongoDB first and is copied into D1 in the same request (write-through, Stage B1).

- **The job.** `lib/d1/stage-c.ts` `runStageC(db, now)` runs at the end of every `/api/cron/d1-sync` (every 5 minutes, 08:30–00:25 IST), after the copy. It is capped at 8 s, never throws, and its result is only reported in the cron response (`stageC`), so it can never affect the copy. Every change is a guarded `UPDATE` (only from the value it read) plus a row in `stage_c_log` (`at, area, fromMode, toMode, reason`, migration `0009_stage_c.sql`). Running it twice changes nothing more.
- **Its own switch.** `feature_flags` row `stageC`: `auto` (seeded by 0009), `demote-only` (no promotions; demotions and the write-through guard still run: the safe pause), `off` (the job does nothing). A missing row or any other value means `off`.
- **Promotion `shadow` → `d1`**, only when all of these hold:
  - `stageC = 'auto'`, and India time is 22:00–00:25 (the shop, open 10:00–22:00, is closed);
  - `writeThrough = 'on'`, at least one write copied (`write_through_state.writes`), and no write-through failure in the last 24 h;
  - the area's D1 copy is fresh right now (freshness guard below);
  - the area's last N shop days each have shadow comparisons, at least MIN comparisons in total, and no mismatch, D1 error or fallback in those days or since; only days after the area's last demotion count. The shop day of the night window is the day that just closed (00:20 still counts the day before). N / MIN (constants `PROMOTION_RULES`): masters 1 / 30, crm 2 / 30, staff 2 / 50, stock 2 / 50, sales 3 / 100;
  - order masters → crm → staff → stock → sales: an area is promoted only after the one before it has answered from D1 for one full shop day (10:00–22:00) since its last change, and at most **one area per night**. So the earliest full rollout takes five nights.
- **Demotion `d1` → `shadow`, at any time**, when in the last 60 minutes the area had any mismatch between D1 and MongoDB (the reverse comparison below), or more than 3 D1 errors / fallbacks; or when `writeThrough` is not `on`. MongoDB answers again within a minute (the flag cache). A demotion resets the area's clean days: only days after it count.
- **Write-through guard.** A write-through failure recorded since `writeThrough` was last switched on (at most 24 h back) switches it `off` (as the one-off guard of 14 Nov did) and is logged; every `d1` area is then demoted in the same run. The job never switches the write-through back on: that is the Admin's decision after looking at the error.
- **Manual override wins.** An area set to `mongo` (or with no row) is never touched, and the areas after it in the order wait for it.
- **Freshness guard** (`lib/d1/read-source.ts`). An area set to `d1` answers from D1 only while D1 is known fresh: `writeThrough = 'on'`, no write-through failure in the last 15 minutes, and no `sync_errors` row newer than 15 minutes for one of that area's collections (`READ_AREA_COLLECTIONS` in `lib/d1/registry.ts`, i.e. the spec file a collection is declared in; an error without a collection counts for every area). Otherwise the area behaves as `shadow` (MongoDB answers). The facts come in the same once-a-minute flag read (one D1 batch of three SELECTs); if they cannot be read, no area is fresh. `getReadMode` returns this effective mode; `getConfiguredReadMode` returns the raw switch.
- **Reverse shadow** (`lib/d1/shadow.ts`). In `d1` mode the user gets D1's answer, and after the response (same sampling: at most one per read path per 10 s per isolate) the MongoDB read runs too and the two are compared and recorded in `shadow_results` / `shadow_daily` exactly like shadow mode (`kind = 'reverse'`). A MongoDB failure there is not recorded against D1. The queued work keeps the request's async context (`AsyncLocalStorage.snapshot()`), and `worker.ts` closes the request's MongoDB client only after that work.
- **Reads that never answer from D1** (`mongoOnlyInD1` in the registries): even in `d1` mode they answer from MongoDB and D1 is only compared, because a few seconds of lag could cause a wrong write. Sales: `nextNumber.invoiceNumbers`, `nextNumber.proformaNumbers`, `nextNumber.deletedNumbers`, `nextNumber.estimateNumbers` (`GET /api/invoices/next-number`), and `cashRegister.cashInvoices`, `cashRegister.financeLinkedInvoices`, `cashRegister.dueCashBills`, `cashRegister.cashReceipts`, `cashRegister.financeRecords`. Stock: `cashTransactions.all`, `cashRegisterSetting.get`, `expenses.cash` (the cash register balance in `lib/cashRegister.ts`, which validates the Admin cash payouts, the day close and calibration), `adminCashEntries.book` (the Admin's available cash: `admin-cash` POST / PATCH refuse a payout above it), `dayCloses.allAsc` (read by the day-close recompute POST), and `serialNumbers.list` when it lists `AVAILABLE` serials (what the bill and purchase forms offer to sell).
- **Admin view.** `GET /api/admin/d1-shadow-status` now also returns `stageC`: per area the switch, the effective mode, freshness and why not, clean shop days, the last hour's mismatches / errors, the next area to be promoted with what still blocks it and its earliest time, and the last 20 `stage_c_log` rows.
- **One-command controls** (remote D1 `valueplus-db`):
  - pause promotions (safety demotions keep running): `UPDATE feature_flags SET value='demote-only', updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='stageC'`; stop the job completely: `... value='off' ...`; resume: `... value='auto' ...`;
  - force an area back to MongoDB answers and keep the job away from it: `UPDATE feature_flags SET value='mongo', updatedAt=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key='read:sales'` (back under the job: set it to `shadow`);
  - force an area onto D1 by hand (the job will still demote it on a mismatch): `... value='d1' ... WHERE key='read:masters'`;
  - everything back to MongoDB at once, without D1: the env var `D1_READS=mongo`.
- **Tests:** `tests/d1-stage-c.test.ts`.

**6.7b Fixes after the first live day of shadow comparisons (14 Nov 2026), migration `0010_shadow_races_deferred_heartbeat.sql`.**
- **Non-lean reads are hydrated on the D1 side too** (`lib/d1/hydrate.ts`). A MongoDB read without `.lean()` gives mongoose documents, and mongoose fills in on load the schema defaults the stored document lacks (`bankAccounts.list`: `branch` / `ifsc`; `estimates.list`: `advanceAmount` 0, `advanceMode` / `advanceTxnRef` ""; `cashRegister.cashInvoices`: `backdate*` ""). Those values are stored nowhere, so the D1 copy was right and no re-copy is needed; the D1 twin now runs the rebuilt stored copy through `Model.hydrate` (sales and stock `findDocs(..., { hydrateWith })`; CRM already did). The read tests check that MongoDB and D1 both return documents for every read, and run every read again on older documents without their defaulted fields.
- **Staff rows rebuilt exactly** (`lib/repo/staff/rebuild.ts`). The docHash-checked search now combines an explicit null (a cleared PIN lock: `$set: { pinLockedUntil: null }`) with an absent boolean (`liveAuditAccess` on a user saved before it existed); before, that mix was never tried and `users.list` read `false` where MongoDB had nothing. All live staff rows (15 users, attendance, leave, tasks, notifications, push, audit, guards) now rebuild to their exact document.
- **Races in a comparison are not mismatches** (`lib/d1/shadow.ts`). The two answers are read at different moments; when the data changes in between (`push.subsForUsers`: the push sets `lastSuccessAt` right after reading the devices and the write-through copies it before the deferred D1 read), the side that answered first is read once more, and if it now equals the other, the run counts as a match with `raced = 1` (`shadow_results.raced`, `shadow_daily.raced`, shown in the report). A real difference stays a mismatch.
- **Deferred write-through copies are not failures** (`lib/d1/write-through.ts`). A document still changing after the 3 verify rounds (many phones claiming the day's `scheduled_runs` row at once) is counted in `write_through_state.deferred` and logged as `sync_errors` phase `write-through-deferred` (its read area answers from MongoDB for 15 minutes); the copy job's incremental pass copies it within 5 minutes. Only when the copy job would NOT pick it up (Mongo's `updatedAt` older than the watermark window, or not newer than D1's) does it stay a failure. `lib/office-reminder.ts` no longer rewrites the day's row on every poll (`timestamps: false`).
- **Stage C heartbeat** (`stage_c_state`, one row): every run writes `lastRunAt`, `lastResult` (`ok` / `error` / `off`), `lastOkAt`, `lastError`, `lastSetting`, the last changes and a run count; `stageC.heartbeat` in `GET /api/admin/d1-shadow-status` adds `minutesSinceLastRun` and `late` (no run for over 15 minutes inside the cron hours), with `writeThroughDeferred24h`. `/api/cron/d1-sync` now runs Stage C even when MongoDB is not reachable (it reads only D1).
- **Deploy order:** apply `0010` to the remote D1 BEFORE deploying the code (the new INSERTs name the new columns).

**6.8 Write cutover (`d1`): the fence protocol**, for each unit. U5 runs it at about 21:30 IST:

1. **Preconditions:**
   - `d1-read` for at least 7 days with zero inline-copy failures;
   - the reverse mirror (D1 → Mongo outbox drainer) has been deployed dormant and tested on staging;
   - reconciliation is clean;
   - a fresh Time Travel bookmark is noted (`wrangler d1 time-travel info valueplus`);
   - a Mongo snapshot exists (Atlas backup, or `mongodump` for the unit's collections).
2. Set `fence` at T0. New writes for the unit wait (poll); reads continue from D1.
3. Wait for (a) in-flight requests that started before T0 (set a 35 s ceiling), (b) the mirror queue to be empty for the unit's collections, and (c) a targeted reconciliation of everything with `updatedAt ≥ T0 − 5 min` to show zero diffs. Typical total: 30 to 60 s.
4. Set `d1`. Waiting writes resume against D1. From now on each D1 write batch also inserts `mirrorOutbox` rows. The drainer (queue consumer plus cron) copies those documents **by id** from D1 to Mongo, which keeps Mongo as an up-to-date fallback.
5. The Mongo → D1 mirror for this unit is switched off (the plugin checks the flag), so nothing flows back over D1's newer data.
6. Watch for 2 hours: error rates, the outbox lag (target < 10 s), cash and stock spot checks by the Admin.

**Rollback from `d1`:** set `fence`, wait for the outbox to drain to zero, reconcile, set `d1-read` (Mongo is truth again), then `shadow`. That takes minutes and loses no data.

**Rollback of a bad write already in D1:** fix forward (a correcting change through the app), or restore that unit's rows from Mongo (the reverse mirror kept it current). **Do not use Time Travel for a partial fix: it restores the whole database** (§7.5).

**6.8a Stage D, as built (Nov 2026): the write-cutover machinery, shipped DORMANT, with U1 masters on it.** With the new switches at their defaults (no `write:<area>` row, `stageD = 'off'`) every route runs its MongoDB code exactly as before; tests prove the answers are identical. Migration `0011_stage_d.sql`.

- **Write switch per area** (`lib/d1/write-mode.ts`): feature_flags `write:<area>` = `mongo` (default; a missing row, an unknown value or no D1 binding all mean `mongo`) | `fence` | `d1`. Re-read when older than 1 s (not the 60 s of the read switches), so a flip reaches every isolate within about a second; if the row cannot be read the last value seen in the past minute is kept (a D1 hiccup must not send a `d1` area's writes to MongoDB behind D1's back). Env `D1_WRITES=mongo` forces `mongo` everywhere. A route does `const writeMode = await getWriteMode("masters"); if (writeMode !== "mongo") return mastersWrites.<op>(req, writeMode);` and keeps its MongoDB code unchanged below.
- **`d1` is honoured only while every read area serving the write area's collections answers from D1** (`getReadMode`, after the Stage C freshness guard). U1's collections sit in two read areas: brands, categories, units, warehouses in `read:masters`; variants and product references in `read:stock`. Otherwise the area writes MongoDB as before and this is logged; first the outbox is copied into MongoDB (best effort, 3 s), so the MongoDB write starts from the newest data. Why: a save on D1 followed by a read of MongoDB's older copy would look like a lost save.
- **Fence**: a write waits, re-reading the switch every 250 ms; after 30 s it answers **503** `"This data is being moved to the new database right now. Nothing was saved. Please try again in a minute."` (header `Retry-After: 30`). Nothing is written.
- **Write repository pattern** (`lib/d1/write-batch.ts`, `lib/repo/masters/writes.ts`): READ what the op needs from D1 (the stored document is rebuilt exactly, `lib/d1/stored-docs.ts`: the area rebuild plus a docHash check that tells null from absent and false from absent) -> DECIDE with the same rules (the route's payload rules copied as they are; the mongoose model still casts, applies defaults, validates and generates the ObjectId, so D1 and MongoDB hold the same `_id`; `findByIdAndUpdate` semantics: strict, `$set` of the body's keys, `createdAt` / `_id` kept, `updatedAt` = now, `__v` as given, `runValidators` where the route asks) -> ONE `batch()`: guards, the rows, and the `mirror_outbox` rows. Guards: `INSERT INTO _guard (ok) SELECT 0 WHERE NOT (condition)`: an update requires the row it read (same `updatedAt` and `docHash`), a delete requires the row to still exist, a create / rename requires its unique value to be still free (the model's unique indexes: brand / unit / variant names, unit short names, warehouse codes, VP codes). A failed guard rolls the whole batch back and answers **409**. A unique value already taken when READ answers as MongoDB's duplicate-key error does in that route (e.g. 400 "Brand name already exists"). The routes write no audit log / notification / realtime message themselves; worker.ts announces every successful write by its path in both modes alike.
- **Reverse mirror** (`lib/d1/reverse-mirror.ts`): copies outbox documents BY ID from D1 into MongoDB: the current D1 row rebuilt as the exact stored document (same `_id` as ObjectId, `createdAt`, `updatedAt`, `__v`, every field) with `replaceOne(upsert)`, or a delete when the row is gone. Never backwards: the replace applies only while MongoDB's `updatedAt` is not newer. Its MongoDB writes run inside `mirrorWriteContext`, which the write-through ignores (no bounce). Runs right after the response (the after-response queue), from `/api/cron/d1-sync` (when the outbox holds anything), from a Stage D rollback and before a fallback to MongoDB. A failed document stays pending (`attempts`, `lastError`, `lastAttemptAt`) and is logged in `mirror_failures`; the next drain retries it. Heartbeat: `mirror_drain_state`. Done rows are pruned after 7 days, failures after 14.
- **While an area is `d1`** the write-through skips its collections (`isD1OwnedCollection`, the same decision as `getWriteMode`), and the copy job (`runD1Sync({ skipCollections })`) leaves the collections of any area in `fence` or `d1` alone, so it can neither copy MongoDB over D1 nor delete D1 rows the reverse mirror has not copied yet. In `fence` the write-through still runs (writes that started in MongoDB before the fence must reach D1).
- **U1 masters wired** (write area `masters`, `lib/d1/write-areas.ts`): brands POST / PUT / DELETE, categories POST / PUT / DELETE, units POST / DELETE, variants POST / DELETE, warehouses POST / PUT / DELETE and the GET's first-run defaults, product-reference POST (the stock sheet import: all rows in one batch, bulk rows as `json_each` statements). Warehouse DELETE still reads item stock from MongoDB (items are U5).
- **Out of U1 on purpose** (they have writers in later units; see `lib/repo/WRITES_INVENTORY.md`): **items** (stock quantities by every bill / purchase / transfer, `purchasePrice` by purchase entries and orders: U5), **customers / suppliers** (balances: U5), **billing companies** (`usageCount` bumped by every bill and estimate: U5). Remaining U1 routes (documents, folders, Onsitego plans, shift settings, role permissions, WhatsApp settings, price-unlock PIN) are listed there as not done.
- **Stage D job** (`lib/d1/stage-d.ts`, `runStageD(db, now)` at the end of every `/api/cron/d1-sync`, also when MongoDB is down): switch feature_flags `stageD` = `off` (seeded) | `demote-only` | `auto`; missing or unknown = `off`. With `off` it reads one row and stops.
  - **Rollback `d1` -> `fence` -> `mongo`** (any time; also in `demote-only`): when the oldest pending outbox row is over 10 minutes old, or more than 3 documents failed to copy into MongoDB in the last hour, or a read area of the write area is no longer set to `d1` (Stage C demoted it). Fence, drain the outbox to zero, then `mongo`. If the outbox cannot be emptied in this run, the area stays fenced and the next run carries on.
  - **Promotion `mongo` -> `fence` -> `d1`** (only `auto`, only 22:00–00:25 India time, one area per night): every read area of the write area set to `d1`, fresh, and unchanged for ≥ 7 shop days; write-through `on` with no failure in 7 days; the area's outbox empty; the nightly reconciliation of each collection within 48 h and clean (0 repaired, 0 deleted); no rollback of the area in the last 7 shop days. Then in the same run: fence, wait 35 s, check the outbox is still empty and that every MongoDB document changed since 5 minutes before the fence has the docHash D1 holds, then `d1`; a failed check ABORTS back to `mongo`.
  - A fence left by an interrupted run is finished by the next run (a rollback drains on; a promotion is re-checked, else aborted). A fence set by hand is never touched. Every change is a guarded UPDATE plus a `stage_d_log` row (`kind` promote / rollback / abort) with a plain reason.
- **Admin view**: `GET /api/admin/d1-shadow-status` adds `stageD`: the switch, per write area its mode, collections, read areas (switch, since, fresh, shop days on D1), outbox (pending, oldest, lag), drain failures in the last hour, reconciliation facts, promotion blockers, rollback reasons; the drainer's last run; the last 20 `stage_d_log` rows.
- **One-command controls** (remote D1 `valueplus-db`; nothing below is run by this change):
  - by hand, after the §6.8 preconditions: fence `INSERT INTO feature_flags (key, value, updatedAt) VALUES ('write:masters', 'fence', strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`, then `... 'd1' ...` the same way;
  - back to MongoDB by hand: set `fence`, wait until `SELECT COUNT(*) FROM mirror_outbox WHERE doneAt IS NULL` is 0 (the cron drains it), then `UPDATE feature_flags SET value = 'mongo', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'write:masters'` (or `DELETE FROM feature_flags WHERE key = 'write:masters'`);
  - let the job do it: `UPDATE feature_flags SET value = 'auto', updatedAt = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = 'stageD'`; only safety rollbacks: `... 'demote-only' ...`; stop it: `... 'off' ...`;
  - emergency, without D1: env `D1_WRITES=mongo` (drain the outbox first if at all possible: the copy job resumes for those collections).
- **Deploy order**: apply `0011` to the remote D1 before switching anything on. The code is safe before it (a missing table only makes the outbox count and Stage D report an error; no write switch row means `mongo`).
- **Tests:** `tests/d1-stage-d.test.ts`.

**6.9 Final switch of the source of truth and the fallback window**
- After U5 has run in `d1` for **14 days** (covering a month-end close, GSTR filing and a salary run), everything is on D1 and Mongo is a reverse-mirrored copy.
- Keep the reverse mirror for **N = 30 days** in total, then set all units to `d1-only`. Mongo becomes read-only: revoke the app user's write role in Atlas.

**6.10 Decommission** (after 30 more days on `d1-only`, so 60 days after the U5 flip):
1. Take a final `mongodump` to R2 (cold archive) and confirm that it can be restored.
2. Remove mongoose, the mongodb driver, `lib/db.ts`, `models/`, the mirror plugin and the Mongo half of each repository; remove `closeRequestDb` from `worker.ts`.
3. Delete the `MONGODB_URI` / `MONGODB_DB` secrets.
4. Downgrade or delete the Atlas cluster (owner decision).
5. **Contract migrations:** drop shadow tables, add CHECK constraints on cleaned enums, drop unused columns.

### 6.11 Staging rehearsal (mandatory before each production phase)

| Phase | Staging rehearsal |
|---|---|
| 1 | migrations apply cleanly on an empty and on a re-applied DB |
| 2 | full backfill of `valueplus_staging`, checksums green, timing recorded |
| 3 | 3 days of mirror with scripted traffic (the existing staging API checks: 37 invoice-edit, 85 approvals, 20 push and so on, from memory §15, §17 and §19) plus reconciliation |
| 5 | shadow with the scripted checks; induce a diff on purpose (edit a D1 row) and confirm it is detected |
| 6 | **the full fence → `d1` → rollback → `d1` cycle for U5**, with bills, payments, a full edit, a cancellation, an offline bill replay and a Manager approval made *during* the fence |
| 7.5 | Time Travel restore drill |

### 6.12 Offline billing during the migration

How it works today (`lib/offline-storage.ts`, `components/shared/offline-sync-provider.tsx`):
- bills made offline are queued in localStorage with a client `offlineId` and a client-made `invoiceNumber`;
- on reconnect they are POSTed to `/api/invoices`;
- the server treats "same number + same phone + same total + same date" as already synced, and re-numbers on a collision.

`offlineId` is sent, but **`Invoice` has no `offlineId` field, so mongoose's strict mode drops it** **(verify on a live document)**.

During the migration:
1. **Keep the API contract unchanged** (same request and response JSON). The app in users' pockets (TWA APK v3) is not redeployed.
2. **Expand Mongo first:** add `offlineId` (sparse unique index) to the `Invoice` schema in Phase 0, so both stores dedupe replays by `offlineId`. In D1 it is `UNIQUE WHERE offlineId IS NOT NULL` plus an `idempotencyKeys` row.
3. **Fence:** an offline replay arriving during a fence just waits like any other write (up to 30 s). The client's existing retry covers a timeout, and idempotency makes a double POST safe.
4. **Cached product and customer lists** in the browser use `_id`s, which are preserved, so cached bills still reference valid items and customers.

### 6.13 Live-update hub (`realtime-hub.ts`) during the migration

- The hub carries **no data**, only changed API paths published by `worker.ts` after every successful non-GET `/api/*` (memory §30). It is independent of the database.
- The only risk is **read-after-write**: a screen refetches about 300 ms after the announcement. This is handled by the inline copy in `d1-read` (§6.7) and by D1 writes in `d1`. Before read replication there is no lag at all, since the primary is strongly consistent.
- The fence delays the write response, and so the announcement. Screens simply update a few seconds later.
- The cron (`/api/cron/attendance` every 5 min, office-start, stock-orders) goes through the same repository and flags. Its "once a day" guards use `scheduledRuns` (U3).

### 6.14 What users see

Nothing, except that screens get faster per unit as it reaches `d1-read`, and a possible wait of up to about 60 s on saves for the one U5 fence at night. No maintenance page, no logout (sessions are NextAuth JWT cookies **(verify the strategy in `lib/authOptions.ts`)**; the users table moves in U3 with parity-tested login).

---

## 7. Testing plan

### 7.1 Per-domain parity tests (same inputs, same outputs)

- A harness runs the **same scripted scenario** against two staging Workers (or one Worker with the flag forced per request via an internal header on staging only): flag `mongo` vs flag `d1`. Both start from the same seed (the backfill of the same staging snapshot).
- Compare every API response with `toCanonical` (ignore generated ids and timestamps, but compare references).
- After each scenario also compare the **database state**: dump the touched tables from D1 and the touched collections from Mongo, transform, diff.
- Scenarios reuse and extend the checks already written for staging:
  - invoice full edit, 37 checks (memory §15);
  - secured changes, 85 checks (§17);
  - new customer from Receive Payment (§18);
  - push, 20 checks (§19);
  - lead calls and follow-ups (§20);
  - Live Audit with concurrent counters (§21);
  - task targets (§22);
  - delivery and OTP (§25);
  - estimate / bill / price unlock (§28);
  - stock orders and GIDA merge;
  - cash handover confirm / reject;
  - geofence presence including the race of presence vs cron;
  - Onsitego plan upload replace;
  - advance with reason;
  - payment edit and delete with balances.
- **Concurrency tests:**
  - 20 parallel bills on the same item: final `itemStock` = start − 20, and the three aggregates equal the sum;
  - 2 people counting the same audit;
  - a double-submitted payment with the same idempotency key (one row);
  - two Managers requesting a change on the same target (the partial unique index refuses the second).

### 7.2 Golden reports (before / after)

Freeze a staging snapshot. Generate each report from Mongo and from D1 for **at least 3 periods** (this month, last month, all-time) and both billing entities:

| Report | Endpoint / page | Tolerance |
|---|---|---|
| Dashboard stats (all widgets, each date preset) | `/api/dashboard/stats` | exact counts; amounts ±0.01 |
| Profit & Loss (GST-included basis, §16b; `costWithGst` rules) | `/api/reports/profit-loss` | ±0.01 per line |
| GSTR-1 (B2B / B2C / credit notes) and **HSN Summary** (incl. the 1-paisa line-wise rounding noted in memory §13) | `/api/gstr-reports?type=...` | exact per HSN + rate row |
| Incentives (product + Onsitego 10%, payouts) | `lib/staff-incentive.ts` via `/api/staff/my-incentive?detail=1` and the Incentives page | exact |
| Stock report, product ledger, stock flow | `/api/reports/stock`, `/api/reports/product-ledger`, `/api/inventory/stock-flow` | exact quantities |
| Cash register, day close, dues, finance ledger, vendor ledger | respective APIs | ±0.01 |
| Sales-out, leaderboard, staff activity | respective APIs | exact |

Store the JSON outputs as golden files in `tests/golden/` (on staging data only; never commit live customer data). Run them on every PR touching `lib/repo`.

### 7.3 Load test

Use k6 or autocannon against staging in state `d1`:
- 30 concurrent users for 15 minutes (well above the shop's real peak);
- a mix of item picker search, invoice list, a bill POST every 5 s, presence posts every 30 s per user, bell polls, and dashboard open every minute.

| Pass criteria | Target |
|---|---|
| p95 API | < 300 ms |
| errors | zero |
| "overloaded" responses | none |
| D1 `rows_read` per dashboard open | < 20,000 |

Find unindexed scans with `EXPLAIN QUERY PLAN` on the top 30 queries (no `SCAN` on tables over 1,000 rows in hot paths).

### 7.4 Migration-tool tests

- Backfill re-run idempotency: running twice gives identical checksums.
- Resume after a kill mid-collection.
- The mirror under a forced 50% failure rate: everything converges after the retries.
- Reconciliation detects a deliberately corrupted row, wrong count and wrong sum.

### 7.5 Backup and restore drill with Time Travel (staging, then once on prod before U5)

1. Note the bookmark: `npx wrangler d1 time-travel info valueplus-staging`.
2. Make 10 scripted bills. Note their numbers.
3. "Disaster": delete or corrupt rows through a script.
4. Restore: `npx wrangler d1 time-travel restore valueplus-staging --timestamp=<before step 3>`. Confirm the in-flight requests error and then recover, and that the checksums match the pre-disaster values.
5. Undo the restore with the returned previous bookmark, to prove that it is reversible.
6. Record the time taken (RTO) and the data window lost (RPO = up to 1 minute).

**Lesson to write down:** Time Travel is **whole-database**. In production prefer fix-forward or a per-table re-copy from the reverse-mirrored Mongo during the fallback window. After decommission, keep a nightly `wrangler d1 export` (or REST export via a Workflow) to R2 for history past 30 days. Run it in the night window, because **exports block other requests**.

---

## 8. Risks and mitigations

### 8.1 Size estimate vs the 10 GB limit

| Data | Rows a year (estimate) | Avg row incl. children and indexes | MB a year |
|---|---|---|---|
| invoices + 1:1 + items + payments | 4,000 to 6,000 bills × about 2 lines | ≈ 6 KB per bill | 25 to 40 |
| paymentTransactions, cashTransactions, adminCash | about 15,000 | 0.5 KB | 8 |
| auditLogs (before/after on edits) | 20,000 to 40,000 | 1 to 3 KB | 40 to 100 |
| notifications | 30,000 to 60,000 | 0.4 KB | 12 to 25 (prune after 180 days) |
| attendance (about 15 staff, awayPeriods JSON) | about 5,500 | 2 KB | 11 |
| leads + calls + follow-ups | 3,000 leads, 20,000 calls | 0.3 to 2 KB | 15 |
| whatsappMessages | 10,000 | 1 KB | 10 |
| serials, warranties, challans, finance, estimates, purchases | about 10,000 | 1 to 3 KB | 20 |
| masters (450 items, a few thousand customers, settings) | static | | < 10 total |
| **Total** | | | **≈ 150 to 250 MB a year** |

So 10 GB is **about 40 years** at this rate, and 5 GB of free storage about 20 years. Replace the estimate with the Step 0.2 profile. **Risk: low.** Watch: `size_after` in query meta, and a monthly size alert at 2 GB.

### 8.2 Risk table

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | **Hidden behaviour change in the port** (defaults, rounding, regex semantics, date-string vs Date compares) | High / High | Shared transforms; parity tests; golden reports; 7-day shadow per domain; port logic unchanged first, optimise later. |
| R2 | **Legacy data breaks constraints** (duplicate codes, off-enum values, dangling ids, `Date \| string` mixes) | High / Medium | Step 0.2 profile; fix in Mongo first; no enum CHECKs and no cross-entity FKs at first; orphan report. |
| R3 | **No interactive transactions** | Certain / Medium | Read-compute-batch pattern with `_guard` aborts; optimistic `updatedAt` guards; idempotency keys; tested under concurrency (§7.1). |
| R4 | **Single-threaded DB / "overloaded"** under bursts (dashboard fan-out, presence posts) | Low / Medium | Indexes on every hot filter; `batch()` for multi-query pages; retry with jitter on overloaded; SQL aggregation instead of whole-table reads; the realtime hub already removed polling. |
| R5 | **Write limits** (50 M rows written a month included) | Very low / Low | Estimated < 1 M a month (each bill ≈ 30 to 60 rows incl. indexes). Dashboard metric watch. |
| R6 | **Consistency during dual-write** (mirror lag, lost mirror events, scripts bypassing hooks) | Medium / High | Copy-by-id (idempotent); queue + retry; inline copy for `d1-read`; nightly + targeted reconciliation; the fence for the write flip; run reconciliation after any script. |
| R7 | **Large JSON** (audit before/after, deleted snapshots, `financeDoData`, `storeExit`) near the 2 MB row limit | Low / Medium | Backfill flags rows > 1 MB; overflow to R2; keep line items in child tables. |
| R8 | **Regex to LIKE / FTS5**: the 50-byte LIKE pattern limit, ASCII-only case folding, `normName` / suffix matching | Medium / Medium | `instr(lower())` for contains; stored normalised `*Key` / `*Lower` columns filled in JS; FTS5 only if needed (and then drop / recreate it around exports); parity tests on search with Devanagari and mixed case. |
| R9 | **Collation**: brands A to Z with locale strength 2 | Low / Low | `COLLATE NOCASE`; golden test of the brand list order. |
| R10 | **India-time dates**: business dates are IST strings; timestamps are UTC; some function defaults are UTC by accident (`CashTransaction.time`, `InventoryAudit.completionTime`) | Medium / Medium | Store business dates verbatim; ISO UTC for timestamps; `date(x,'+5 hours','+30 minutes')` for IST bucketing; port defaults 1:1 (fix the UTC-time bug later as a separate change); tests around midnight IST (18:30 UTC). |
| R11 | **100-column / 100-parameter limits** (Invoice has 132 fields) | Certain / Low | The split in §4.3; the statement builder asserts params ≤ 100. |
| R12 | **Exports block the DB; FTS5 cannot be exported** | Medium / Low | Night-window exports; avoid FTS5 or recreate it. |
| R13 | **Time Travel is whole-DB and destructive** | Low / High | Drill; prefer fix-forward or per-table re-copy; keep the Mongo fallback 30 days. |
| R14 | **Mixed Worker versions or flag drift** | Low / High | No gradual rollouts; flags in D1 (strong), not KV; write-path flags not cached. |
| R15 | **Auth regression when `users` moves** (U3) | Low / High | Login parity for all 12 roles, PIN lockouts (`pinFailCount`, `unlockPinFailCount`), `select:false` secrets; U3 has its own fence. |
| R16 | **D1 latency from India worse than expected** | Medium / Medium | Measured in Phase 0 (no-go trigger); `batch()` to cut round trips; read replicas (APAC) + Sessions API after cutover. |
| R17 | **Mongoose plugin misses writes** (`bulkWrite`, raw collection writes, model compile order) | Medium / Medium | Verify on staging with a write census (count of writes per collection from Atlas metrics vs mirror events); wrap the remaining call sites by hand; reconciliation as the backstop. |
| R18 | **Credentials in git** (fallback URI in `lib/db.ts`) | Present / High | Phase 0.5: remove and rotate. |
| R19 | **Scope creep / feature work during migration** | High / Medium | Feature freeze per domain during its cutover week; new features are written against `lib/repo` only. |

---

## 9. Timeline, effort and checklist

### 9.1 Phases

| Phase | Work | Effort (dev-days) | Calendar | Automatable |
|---|---|---|---|---|
| 0 | Staging back; data profile; duplicate fixes; latency probe; remove the hard-coded URI and rotate | 4 | week 1 | profile and latency scripts |
| 1 | Drizzle schema for about 69 + 20 + 6 tables; migrations; schema check script | 5 | weeks 1 to 2 | `drizzle-kit generate`, PRAGMA diff in CI |
| 2 | Transforms (shared), backfill tool, checksums, catch-up; staging then prod load | 6 | weeks 2 to 3 | fully scripted, re-runnable |
| 3 | Mirror plugin, queue + consumer, reconciliation job, admin diff page; 7-day soak | 6 (+ soak) | weeks 3 to 4 | nightly reconciliation (cron) |
| 4 | Repository refactor of about 150 files, domain by domain (sales last), with the D1 implementations | 22 to 30 | weeks 4 to 10 (overlaps 5 and 6) | ESLint import rule tracks progress |
| 5 | Shadow reads + diff tooling; 7 days per domain | 3 (+ soak) | rolling, weeks 5 to 11 | automatic diffing |
| 6 | Cutovers U1 → U2 → U3 → U4 (`d1-read`, then `d1`), then the U5 fence at night; reverse mirror | 6 | weeks 6 to 12 | flag flips scripted (`scripts/flag.mjs <unit> <state>` with precondition checks) |
| 7 | Parity harness, golden reports, load test, Time Travel drill | 6 | built from week 3; run before every flip | yes, in CI on staging |
| 8 | 30-day fallback, `d1-only`, 30 days more, decommission, contract migrations | 3 | weeks 13 to 20 | mostly scripted |
| | **Total** | **≈ 61 to 69 dev-days** | **≈ 12 to 14 weeks to U5 cutover; Atlas off after about 20 weeks** | |

Optional after cutover:
- read replication + Sessions API (2 days);
- move dashboard stats to SQL `GROUP BY` / a daily summary table (OPTIMIZATION A3; 4 to 6 days);
- integer paise (5 days; separate project).

### 9.2 Team checklist

**Phase 0: preparation**
- [ ] `env.staging` re-added (Worker, R2, `MONGODB_DB=valueplus_staging`); `copy-db-to-staging.mjs` run
- [ ] D1 `valueplus-staging` and `valueplus` created with `--location=apac`; bindings in `wrangler.jsonc`
- [ ] Data profile `docs/d1-data-profile.json` (counts, sizes, largest doc, uniques, off-enum values, real collection names)
- [ ] Duplicates fixed in Mongo (customer codes, emails, item codes, brand names, invoice numbers)
- [ ] Latency probe one week: p50 ____ ms, p95 ____ ms (go if p95 < 200)
- [ ] Hard-coded Mongo URI removed from `lib/db.ts`; Atlas password rotated
- [ ] `offlineId` added to the Invoice schema (sparse unique) and deployed
- [ ] Go / no-go (§1.4) signed off by the owner

**Phase 1: schema**
- [ ] Drizzle schema reviewed (Invoice split, child tables, JSON columns, indexes)
- [ ] Migrations applied: staging ✔ prod ✔; PRAGMA check script green

**Phase 2: backfill**
- [ ] Staging backfill: counts ✔ sums ✔ row hashes ✔; time ____ min
- [ ] Prod backfill + catch-up: counts ✔ sums ✔ row hashes ✔

**Phase 3: mirror**
- [ ] Plugin hooks verified for every write type (write census matches)
- [ ] Queue + consumer + alerting live; forced-failure test passed
- [ ] Reconciliation nightly; 7 days clean on prod

**Phases 4 and 5: repository and shadow** (tick per domain)

| Domain | Repo (Mongo) | Repo (D1) | Shadow ≥ 7 days clean |
|---|---|---|---|
| settings | [ ] | [ ] | [ ] |
| catalog | [ ] | [ ] | [ ] |
| logs | [ ] | [ ] | [ ] |
| people (incl. auth) | [ ] | [ ] | [ ] |
| crm | [ ] | [ ] | [ ] |
| customers | [ ] | [ ] | [ ] |
| purchases | [ ] | [ ] | [ ] |
| stockDocs | [ ] | [ ] | [ ] |
| payments | [ ] | [ ] | [ ] |
| finance | [ ] | [ ] | [ ] |
| sales | [ ] | [ ] | [ ] |

- [ ] ESLint: zero imports of `@/models/*` / `mongoose` outside `lib/repo/**/mongo.ts`

**Phase 6: cutover** (each: staging rehearsal ✔ → prod)
- [ ] U1 master: `d1-read` ✔ → `d1` ✔
- [ ] Items catalog reads `d1-read` ✔ (product list < 0.5 s measured)
- [ ] U2 logs: `d1-read` ✔ → `d1` ✔
- [ ] U3 people / auth: `d1-read` ✔ → `d1` ✔ (12-role login test ✔)
- [ ] U4 CRM: `d1-read` ✔ → `d1` ✔
- [ ] U5 money: golden reports ✔, concurrency tests ✔, load test ✔, Time Travel drill ✔, Atlas snapshot ✔, bookmark noted ____ → `d1-read` ✔ → fence at 21:30 IST → `d1` ✔ → 2-hour watch ✔
- [ ] 14 days on `d1` incl. a month-end, GSTR and salary run ✔

**Phase 8: finish**
- [ ] 30-day reverse mirror → all `d1-only`; Atlas app user read-only
- [ ] Nightly D1 export to R2 scheduled (night window)
- [ ] +30 days: final `mongodump` archived and test-restored; mongoose / models / `lib/db.ts` removed; secrets deleted; Atlas downgraded or deleted
- [ ] Contract migrations (enum CHECKs, drop temporary tables); `memory.md` and `OPTIMIZATION.md` §0 updated

---

## Appendix A: sources

Official Cloudflare documentation, fetched 13 Nov 2026:
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Read replication and the Sessions API: https://developers.cloudflare.com/d1/best-practices/read-replication/
- D1Database binding API (`batch`, `exec`, `withSession`): https://developers.cloudflare.com/d1/worker-api/d1-database/
- JS ↔ D1 type conversion: https://developers.cloudflare.com/d1/worker-api/
- Prepared statements (`run` / `all` / `first` / `raw`): https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
- Import / export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Migrations: https://developers.cloudflare.com/d1/reference/migrations/
- SQL statements, extensions (FTS5 / JSON / math) and PRAGMAs: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Foreign keys (enforced by default; `defer_foreign_keys`): https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- Data location (`--location=apac`): https://developers.cloudflare.com/d1/configuration/data-location/

OpenNext:
- Bindings via `getCloudflareContext().env`: https://opennext.js.org/cloudflare/bindings

Drizzle:
- Batch API (D1 support to verify on its D1 page): https://orm.drizzle.team/docs/batch-api and https://orm.drizzle.team/docs/connect-cloudflare-d1

Third-party evidence that `BEGIN TRANSACTION` is rejected on D1 (verify on staging):
- https://github.com/drizzle-team/drizzle-orm/issues/2463

Still to verify against the docs or on staging:
- `--remote` / `--env` flags on `d1 migrations apply`;
- `RETURNING` support;
- generated columns;
- whether a failed migration rolls back;
- KV propagation time;
- Queues pricing;
- mongoose 8 `bulkWrite` middleware;
- NextAuth session strategy.

---

## Appendix B: sample DDL for the hot tables

Abbreviated. The Drizzle schema is the source of truth. The table names and the timestamp columns follow §4.1.

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, vpCode TEXT, name TEXT NOT NULL, nameLower TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '', category TEXT DEFAULT '', brand TEXT DEFAULT '', unit TEXT DEFAULT 'NOS',
  hsnCode TEXT DEFAULT '8528', gstRate REAL DEFAULT 18, purchasePrice REAL NOT NULL, purchaseIncludesGst INTEGER NOT NULL DEFAULT 0,
  sellingPrice REAL NOT NULL, vsp REAL DEFAULT 0, vspUpdatedAt TEXT, vspUpdatedBy TEXT DEFAULT '', vspUpdatedFrom TEXT DEFAULT '',
  billingEntity TEXT DEFAULT 'valueplus', minSellingPrice REAL DEFAULT 0, lockedMinPrice REAL DEFAULT 0, priceLockedBy TEXT DEFAULT '',
  priceLockedAt TEXT, maxDiscountPercent REAL DEFAULT 0, maxDiscountAmount REAL DEFAULT 0, incentiveTargetAmount REAL DEFAULT 0,
  incentiveAmount REAL DEFAULT 0, incentiveType TEXT DEFAULT 'none', incentiveValue REAL DEFAULT 0, incentives TEXT, -- JSON
  mrp REAL NOT NULL, openingStock REAL DEFAULT 0, currentStock REAL DEFAULT 0, showroomStock REAL DEFAULT 0, godownStock REAL DEFAULT 0,
  reorderLevel REAL DEFAULT 5, warehouse TEXT DEFAULT '', mergedIntoItemId TEXT, status TEXT DEFAULT 'active', imageUrl TEXT,
  isSerialized INTEGER NOT NULL DEFAULT 0, isBatchTracked INTEGER NOT NULL DEFAULT 0, batchNumber TEXT DEFAULT '',
  warrantyPlans TEXT, -- JSON
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX items_code ON items(code);
CREATE INDEX items_vpCode ON items(vpCode);
CREATE INDEX items_cat_brand ON items(category, brand);
CREATE INDEX items_status_wh ON items(status, warehouse);
CREATE INDEX items_stock_name ON items(currentStock DESC, name);
CREATE INDEX items_entity ON items(billingEntity);

CREATE TABLE itemStock (
  itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  warehouseId TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (itemId, warehouseId)
);
CREATE INDEX itemStock_wh ON itemStock(warehouseId);

CREATE TABLE itemSupplierCodes (
  itemId TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE, code TEXT NOT NULL, PRIMARY KEY (itemId, code)
);
CREATE INDEX itemSupplierCodes_code ON itemSupplierCodes(code);

CREATE TABLE invoices (
  id TEXT PRIMARY KEY, invoiceNumber TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'tax-invoice',
  customerId TEXT NOT NULL, customerName TEXT NOT NULL, customerGST TEXT DEFAULT '', customerPAN TEXT DEFAULT '',
  customerCompanyName TEXT DEFAULT '', customerPhone TEXT, customerAltPhone TEXT DEFAULT '', customerEmail TEXT,
  customerAddress TEXT, customerCity TEXT, customerState TEXT DEFAULT 'Uttar Pradesh', customerPin TEXT,
  placeOfSupply TEXT DEFAULT 'Uttar Pradesh(09)', vehicleNumber TEXT DEFAULT '', shippingAddress TEXT, warehouseId TEXT,
  billingEntity TEXT DEFAULT 'valueplus', date TEXT NOT NULL, dueDate TEXT NOT NULL, status TEXT DEFAULT 'sent',
  subtotal REAL NOT NULL, discount REAL DEFAULT 0, taxableAmount REAL NOT NULL, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0,
  igst REAL DEFAULT 0, totalGST REAL NOT NULL, extendedWarrantyTotal REAL DEFAULT 0, roundOff REAL DEFAULT 0, total REAL NOT NULL,
  paidAmount REAL DEFAULT 0, balanceAmount REAL NOT NULL, paymentMode TEXT DEFAULT 'Unclassified', paymentTerms TEXT DEFAULT 'Net 30',
  cashReceivedBy TEXT, upiTxnId TEXT, onlineTxnId TEXT, onlineGateway TEXT,
  financeProvider TEXT, financeDoId TEXT, financeApprovalStatus TEXT DEFAULT 'Pending', downPayment REAL, downPaymentMode TEXT,
  shippingCharges REAL DEFAULT 0, freightCharges REAL DEFAULT 0, freightPaidBy TEXT DEFAULT 'us',
  dueAdvanceAmount REAL DEFAULT 0, dueAdvanceMode TEXT DEFAULT 'Cash', dueClearedAt TEXT, dueClearedMode TEXT, dueClearedBy TEXT,
  dueClearedNotes TEXT, dueClearedTxnId TEXT, dueClearedBankAccountId TEXT, dueClearedBankAccount TEXT,
  advanceAdjusted REAL DEFAULT 0, creditAdjusted REAL DEFAULT 0,
  dispatchType TEXT DEFAULT 'immediate', deliveryStatus TEXT DEFAULT 'delivered', expectedDeliveryDate TEXT DEFAULT '', deliveredAt TEXT,
  backdateStatus TEXT DEFAULT '', backdateRequestedBy TEXT DEFAULT '', backdateMadeOn TEXT DEFAULT '',
  deliveryChallanNo TEXT, creditNoteRef TEXT, notes TEXT, salesExecutive TEXT DEFAULT '', salesExecutiveIncentive REAL DEFAULT 0,
  onsitegoIncentive REAL DEFAULT 0, adminOverridePinUsed INTEGER NOT NULL DEFAULT 0, reprintCount INTEGER DEFAULT 0, lastPrintedAt TEXT,
  printLogs TEXT, -- JSON
  lastModifiedReason TEXT, cancelledAt TEXT, cancelledBy TEXT, cancelReason TEXT, offlineId TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, v INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX invoices_number ON invoices(invoiceNumber);
CREATE UNIQUE INDEX invoices_offline ON invoices(offlineId) WHERE offlineId IS NOT NULL;
CREATE INDEX invoices_date ON invoices(date DESC, createdAt DESC);
CREATE INDEX invoices_type_created ON invoices(type, createdAt DESC);
CREATE INDEX invoices_customer ON invoices(customerId);
CREATE INDEX invoices_phone ON invoices(customerPhone);
CREATE INDEX invoices_status ON invoices(status);
CREATE INDEX invoices_entity ON invoices(billingEntity);
CREATE INDEX invoices_wh ON invoices(warehouseId);
CREATE INDEX invoices_do ON invoices(financeDoId);
CREATE INDEX invoices_expected ON invoices(expectedDeliveryDate);
CREATE INDEX invoices_due ON invoices(dueDate);

CREATE TABLE invoiceItems (
  id TEXT PRIMARY KEY, invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, lineNo INTEGER NOT NULL,
  itemId TEXT NOT NULL, itemName TEXT NOT NULL, itemCode TEXT NOT NULL, vpCode TEXT DEFAULT '', description TEXT, hsn TEXT DEFAULT '',
  quantity REAL NOT NULL, unit TEXT NOT NULL DEFAULT 'Pcs', rate REAL NOT NULL, minSellingPrice REAL DEFAULT 0, costPrice REAL,
  adminOverrideRate INTEGER NOT NULL DEFAULT 0, incentiveTargetAmount REAL DEFAULT 0, incentiveAmount REAL DEFAULT 0,
  incentiveType TEXT DEFAULT 'none', incentiveValue REAL DEFAULT 0, incentiveEarned REAL DEFAULT 0, incentiveRules TEXT, -- JSON
  salesExecutive TEXT DEFAULT '', discount REAL DEFAULT 0, discountType TEXT DEFAULT 'amount', taxableAmount REAL NOT NULL,
  gstRate REAL NOT NULL, cgst REAL DEFAULT 0, sgst REAL DEFAULT 0, igst REAL DEFAULT 0, amount REAL NOT NULL,
  serialNumber TEXT DEFAULT '', batchNumber TEXT DEFAULT '', extendedWarrantyProvider TEXT DEFAULT '', extendedWarrantyPlan TEXT DEFAULT '',
  extendedWarrantyAmount REAL DEFAULT 0, extendedWarrantyDuration REAL DEFAULT 0, extendedWarrantyPolicyNo TEXT DEFAULT '',
  stockWarehouseId TEXT DEFAULT ''
);
CREATE INDEX invoiceItems_invoice ON invoiceItems(invoiceId, lineNo);
CREATE INDEX invoiceItems_item ON invoiceItems(itemId);
CREATE INDEX invoiceItems_serial ON invoiceItems(serialNumber) WHERE serialNumber <> '';
CREATE INDEX invoiceItems_exec ON invoiceItems(salesExecutive);

CREATE TABLE invoicePayments (
  invoiceId TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE, idx INTEGER NOT NULL,
  mode TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, txnId TEXT DEFAULT '', reference TEXT DEFAULT '',
  receivedBy TEXT DEFAULT '', notes TEXT DEFAULT '', PRIMARY KEY (invoiceId, idx)
);
-- invoiceFinance and invoiceDelivery: 1:1 with PRIMARY KEY invoiceId REFERENCES invoices(id) ON DELETE CASCADE (columns in §4.3)

CREATE TABLE _guard (ok INTEGER NOT NULL CHECK (ok = 1));
CREATE TABLE migrationFlags (unit TEXT PRIMARY KEY, state TEXT NOT NULL, changedAt TEXT NOT NULL, changedBy TEXT NOT NULL);
CREATE TABLE mirrorOutbox (id INTEGER PRIMARY KEY AUTOINCREMENT, collection TEXT NOT NULL, docId TEXT NOT NULL, op TEXT NOT NULL,
  enqueuedAt TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, lastError TEXT);
CREATE INDEX mirrorOutbox_pending ON mirrorOutbox(enqueuedAt);
CREATE TABLE idempotencyKeys (key TEXT PRIMARY KEY, route TEXT NOT NULL, status INTEGER, response TEXT, createdAt TEXT NOT NULL);
```
