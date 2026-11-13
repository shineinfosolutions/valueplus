# CRM, documents & accounting — read inventory (D1 stage B2)

Every read of the collections in `lib/d1/maps/crm-docs.ts` (leads + leadFollowUps / leadCalls / leadShares,
walk_in_queries, customer_complaints, whatsapp_messages, whatsapp_settings, stored_documents, document_folders,
onsitego_plans, gstr_reports, journal_entries + journalEntryLines, accounts), and its D1 implementation in
`lib/repo/crm/*.ts`. `CRM_READS` (`lib/repo/crm/index.ts`) pairs each `mongo` (the current query, copied verbatim)
with its `d1`. Both take one argument object; `d1(args, db?)` defaults to the Worker's `DB` binding.
Proof: `tests/d1-crm-reads.test.ts` (every entry, several argument sets, before and after an incremental copy).

Nothing calls these yet; no route was changed.

## GET reads covered

| CRM_READS key | Mongo read (where) | Used by | Mongo shape | D1 |
|---|---|---|---|---|
| `leads.list` | `Lead.find(filter).sort({ createdAt: -1 })` — `app/api/crm/leads/route.ts` GET | leads page + Staff Activity tab (computed client-side from this list), `LeadsLoginPopup`, `SalesmanDashboardView`, billing form mobile lookup (`?mobile=`) | hydrated | SQL filter; hydrated via `Lead.hydrate` |
| `leads.shareInbox` | `Lead.find({ sharedWith: { $elemMatch: { staffId, status: "pending" } } }).sort({ updatedAt: -1 }).lean()` — same route `?shareInbox=1` | `LeadShareInbox`, `/api/me/summary` `leadShareInbox` | lean | `EXISTS` on leadShares |
| `leads.search` | `Lead.find({ $or: [leadId, customerName, mobile] /q/i }).limit(5)` — `app/api/search/route.ts` | global search | hydrated | LIKE for a literal `q`, same JS RegExp otherwise |
| `leads.staffOverview` | `Lead.find({}, { customerName, status, assignedStaff, estimatedValue }).lean()` — `app/api/staff/overview/route.ts` | staff profile overview | lean, projection | projection in JS, no child tables read |
| `walkIn.list` | `WalkInQuery.find({date?, status?, mobile?}).sort({ createdAt: -1 })` — `app/api/crm/walk-in/route.ts` GET | walk-in page | hydrated | equality SQL |
| `complaints.list` | `CustomerComplaint.find(filter).sort({ createdAt: -1 }).lean()` — `app/api/crm/complaints/route.ts` GET | complaints page | lean | equality SQL; `staff` / `search` raw regexes: LIKE for literals, same JS RegExp otherwise |
| `whatsapp.outbox` | `WhatsAppMessage.find(filter).sort({ createdAt: -1 }).limit(n).lean()` + 3× `countDocuments({ status })` — `app/api/whatsapp/route.ts` GET | WhatsApp outbox page | `[rows, pending, sent, failed]` | LIKE (q is escaped by the route); one `SUM(status = …)` query |
| `whatsapp.settings` | `WhatsAppSetting.findOne({})` (token `select: false`) — `getWhatsAppSettings()` in `lib/whatsapp/notify.ts` | `GET /api/whatsapp/settings`, every `notifyWhatsApp`, settings PUT, outbox retry | hydrated, **no token** | token column never SELECTed; hydrated with `{ "cloudApi.accessToken": 0 }` |
| `whatsapp.settingsWithToken` | `WhatsAppSetting.findById(id).select("+cloudApi.accessToken")` — `notify.ts` `queueMessage`, `lib/whatsapp/retry.ts`, settings PUT | sending / retrying a Cloud API message, provider switch check | hydrated, **with token** | the only D1 read of `cloudApi_accessToken` |
| `documents.list` | `StoredDocument.find({folderId?}).sort({ date: -1, createdAt: -1 }).lean()` — `app/api/documents/route.ts` GET (`folderId` = On Site Go for salesmen / cashiers) | documents page | lean | |
| `documents.byId` | `StoredDocument.findById(id).lean()` — `app/api/documents/file/route.ts` | opening a file | lean | same ObjectId cast (invalid id throws) |
| `documents.countInFolder` | `StoredDocument.countDocuments({ folderId })` — `app/api/documents/folders/route.ts` GET (On Site Go only roles) | folders panel | number | `COUNT(*)` |
| `documents.folderCounts` | `StoredDocument.aggregate([{ $group: { _id: "$folderId", count } }])` — folders GET | folders panel | rows (unordered) | `GROUP BY folderId` (missing → `_id: null`, `""` kept apart) |
| `documentFolders.list` | `DocumentFolder.find({}).sort({ nameKey: 1 }).lean()` — folders GET | folders panel | lean | |
| `documentFolders.byNameKey` | `DocumentFolder.findOne({ nameKey }).lean()` — `getOnsitegoFolder()` in `lib/onsitego-server.ts` | documents GET, folders GET, file GET, onsitego POST | lean / null | null = fall back to Mongo (which creates the folder) |
| `onsitego.plans` | `OnsitegoPlan.find({}, {11 fields}).sort({ minPrice: 1, price: 1 }).lean()` — `app/api/onsitego/plans/route.ts` GET | bill form, Incentive Plan | lean, projection | |
| `accounts.list` | `Account.find({}).sort({ code: 1 })` — `app/api/accounting/accounts/route.ts` GET | accounting pages | hydrated | |
| `journal.list` | `JournalEntry.find({ "lines.accountId"? }).sort({ date: -1, createdAt: -1 })` — `app/api/accounting/journal/route.ts` GET | journal / ledger | hydrated | `EXISTS` on journalEntryLines; same ObjectId cast (invalid id throws) |

`/api/me/summary` reads leads only through `GET /api/crm/leads?shareInbox=1` (= `leads.shareInbox`, then
`lib/me-summary.ts` shapes it). `LeadsLoginPopup` and `LeadShareInbox` are client components: their server reads
are `leads.list` and `leads.shareInbox`. The Staff Activity tab of the leads page has no read of its own.

## Reads NOT moved (and why)

- **gstr_reports**: no read anywhere. `app/api/gstr-reports/route.ts` builds the reports from invoices / purchase
  entries / e-way bills / items; `GSTRReport` is only written by `app/api/seed/route.ts`.
- **Read-modify-write inside a write** (stay on Mongo, they must see the row they are about to change):
  leads PUT `Lead.findOne(identifier)` (share request / respond / follow-up) and `.lean()` before-image;
  `Lead.countDocuments()` for the next leadId (leads POST, walk-in POST/PUT, estimates POST); walk-in PUT
  `findById`; complaints POST `countDocuments`, PUT before-image; journal POST `countDocuments` and
  `Account.findById` per line; whatsapp PUT `find({ _id: { $in } })`; documents POST / PUT
  `DocumentFolder.exists`, PUT/DELETE `findById`; folders POST / PUT `findOne({ nameKey })` clash checks, DELETE
  `countDocuments({ folderId })`; `lib/staff-rename.ts` (updates only).
- The **create** halves of `getWhatsAppSettings()` and `getOnsitegoFolder()` stay on Mongo: their D1 read returns
  null when the document is missing, and the caller falls back.

## How D1 rebuilds a document (`rebuild.ts`)

Columns → fields (NULL = absent; bool 0/1 → boolean; JSON parsed; dates → `Date`), `cloudApi_*` → `cloudApi`, child
tables → arrays in `idx` order (`lineId` → `_id`, element `extra` merged, `{"$value"}` restored), the row's `extra`
applied last, `v` → `__v`, `_id` = 24-hex text (serialises exactly like an ObjectId). Reads whose Mongo query is
not `.lean()` return documents hydrated through the same Mongoose model (`Model.hydrate`, no database involved), so
casting, schema defaults for absent fields and `toJSON` are those of the Mongo read. Projections are applied in JS.
Ties in a sort are broken by `id ASC` (ObjectIds grow with insertion, which is how Mongo returned them).

Regexes: a literal pattern → `LIKE '%…%' ESCAPE '\'` (with `%`, `_`, `\` escaped); the salesman name match
`/^\s*NAME\s*$/i` → `TRIM(assignedStaff, <ASCII whitespace>) LIKE 'NAME'`; `/^sales team$/i` → `LIKE 'sales team'`;
the mobile lookup `{ $regex: "<10 digits>$" }` → `LIKE '%<10 digits>'`; a user-typed pattern with a regex
metacharacter (search, complaints `staff` / `search`) → the same JS `RegExp` on the rebuilt documents.

## Known differences (not seen in app-written data; none occurs in the tests)

1. **Stored `null` vs missing field**: both are NULL in D1 and read back as absent. A lean read would then omit a
   field Mongo returns as `null`, and a hydrated read would apply the schema default where Mongo keeps `null`.
   The app never writes `null` into these fields (fix if needed: have the map keep explicit nulls in `extra`).
2. **Missing child array**: a document without `followUps` / `calls` / `sharedWith` / `lines` reads back with `[]`
   (the models always write `[]`, so this only affects legacy rows, and only in lean reads).
3. **Missing `__v` / `createdAt` / `updatedAt`** on a legacy document: D1 holds `v = 0` and the ObjectId time, so
   D1 returns them where Mongo returns nothing.
4. **Case-insensitivity**: SQLite `LIKE` / `TRIM` are ASCII-only (`É` ≠ `é`, NBSP is not trimmed); Mongo's `/i` and
   `\s` are Unicode. JS RegExp vs PCRE differ on rare syntax (e.g. possessive quantifiers).
5. **Type mixing**: a value of the wrong BSON type (a number in a string field, an ObjectId stored as a string in
   `lines.accountId`, a non-string `mobile`) is matched by its text in D1 but not by Mongo's typed equality /
   regex. Sorting such a value follows the column type, not BSON order.
6. **Natural order** (`findOne({})`, `find().limit(5)` with no sort, the overview list): D1 returns id order, which is
   insertion order for documents the app created.
7. **`WalkInQuery.time`** default is "now": a legacy walk-in without `time` gets a different default each read, in
   Mongo and D1 alike.
8. **Decimal128 / other BSON types** in unknown fields: D1 `extra` holds their normalised text; Mongoose would
   serialise `{ "$numberDecimal": … }`.
9. **Secrets**: `whatsapp.settings` keeps the token out even when `cloudApi` was copied whole into `extra`
   (legacy shape). Note the current settings GET reports `hasAccessToken` from the deselected document, i.e. always
   false; D1 reproduces that as it is.

## Test normalisation (applied to both sides)

`JSON.parse(JSON.stringify(x))`, then object keys sorted recursively (key order is not data). For
`documents.folderCounts` the `$group` rows are also sorted by `_id` (Mongo's output order is unspecified; the route
only builds a Map). A read that throws must throw on both sides (invalid ObjectId, invalid regex).
