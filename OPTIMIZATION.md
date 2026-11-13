# ValuePlus ERP — Speed and Cost Optimization Plan

> Research date: 12 Nov 2026, on the current code (`main`, commit `1b6a7dc`).
> Sources: a fresh production build (`next build`), reading the code, and measurements noted earlier in `memory.md` (section 8 and 12).
> Nothing has been changed yet; this file is the plan.

---

## 0. Which database does the app use? (checked 12 Nov 2026)

**MongoDB Atlas, not Cloudflare D1 (SQL).**

- The live Worker `valueplus-erp` has `MONGODB_URI` and `MONGODB_DB` set as secrets.
- `wrangler.jsonc` has no D1 binding. The Cloudflare account has 9 D1 databases (`hotel-erp`, `taj-db`, `moka` …), but **none for ValuePlus**.
- 211 files use mongoose / `connectToDatabase()`, and there is no D1 / SQL code anywhere.

What *is* on Cloudflare:
- the app itself (Worker);
- delivery photos and selfies in **R2**;
- live updates in a **Durable Object** (its storage type is SQLite, but it stores nothing);
- static files.

Office documents and DO attachments are on Cloudinary.

**Option: move the data to Cloudflare D1.** This removes the two biggest delays at the root: the slow Atlas link (~100 KB/s) and the new connection on every request. A D1 binding needs no network connection to set up, and the data sits next to the Worker.

- **Cost:** D1 is included in Workers Paid up to a generous read / write / storage allowance.
- **Effort:** it is a **rewrite of the data layer**: 61 mongoose models and ~210 files become SQL tables and queries, plus a one-time data migration, about 3–6 weeks with careful testing.

Recommended path: do the quick wins and A1 / A2 / A3 below first (they help whichever database is used), then decide on D1 with real numbers.

---

## 1. Where the time goes when someone opens a page

```
Phone / PC opens a page
  │
  ├─ 1. Downloads the page's JavaScript ........ average 357 kB (compressed), dashboard 689 kB
  │       (Excel + PDF libraries ride along on ~75 pages even if nobody exports)
  │
  ├─ 2. Asks who is logged in (session) ........ 1 request
  │
  ├─ 3. Fires its data requests ................ dashboard ≈ 20, other pages 3–8,
  │       + 8–10 more from components on EVERY page (bell, pop-ups, attendance, offline cache …)
  │       + the WHOLE product list and WHOLE customer list on every app open
  │
  └─ 4. Each request on Cloudflare:
          opens a brand-new MongoDB connection ...... ≈ 0.35 s before any query runs
          reads the WHOLE collection (no paging) .... e.g. 446 products = 380 KB
          Atlas sends it at ≈ 100 KB/s .............. ≈ 4 s for the product list
          the Worker decodes and sums it in code .... CPU time = Cloudflare bill
```

**In short:** the app moves far too much data, too many times, over a slow database link, and opens a new database connection for every request. The JavaScript is also about twice as heavy as it needs to be.

---

## 2. What was measured

| Area | Finding | Source |
|---|---|---|
| Page JavaScript | 89 pages: **average 357 kB**, dashboard **689 kB**, billing pages 486–501 kB. Pages without the Export button: 103–130 kB. | `next build` today |
| Big chunks | Charts (recharts) **111 kB**; PDF (jspdf + html2canvas) **104 kB**, plus another 45 kB of html2canvas; Excel (xlsx) **93 kB**; react-dom 54 kB (normal). Sizes are compressed. | `.next/static/chunks` |
| Export button | `components/shared/ExportMenu.tsx` imports the Excel and PDF libraries directly. It is used on **~75 pages**, so every one of them downloads ~200 kB it rarely needs. | code |
| Every page | The sidebar and bottom bar import **framer-motion**, so it is on every page. 20 components are mounted on every page (bell, 5 pop-ups, day-close gate, finance reminder, geofence, offline sync …). Each fetches on open. | `app/(dashboard)/layout.tsx`, `app/layout.tsx` |
| App open | `components/shared/offline-sync-provider.tsx:99-109` downloads **all products and all customers** on every app open, on every phone and every role, even on the login page. The effect can also run again whenever `syncNow` changes. | code |
| Dashboard | 26 `fetch` calls in the page (no caching). On open: `dashboard/stats`, `reports/stock` (all items), `inventory/audit`, `warranty`, `reports/performance`, `staff/tasks`, `crm/leads` (all), `invoices` (all), due invoices … | `app/(dashboard)/dashboard/page.tsx` |
| Dashboard stats API | Loads **9 whole collections** each time (all invoices, customers, items, suppliers, expenses, payments, purchases, POs, finance), then filters and adds up in JavaScript (1,743 lines). Later in the same request it loads vendors, vendor bills, vendor payments and purchases again. | `app/api/dashboard/stats/route.ts:65-75, 1281, 1359` |
| List APIs | `invoices`, `items`, `customers`, `payments`, `estimates`, `crm/leads`, `purchase-entries`: **no paging (no `.limit`)**; `items`, `leads`, `purchase-entries` send every field. | code |
| Same list, many places | `/api/items` is fetched from **23** files, `/api/invoices` from 18, `/api/customers` and `/api/users` from 10, `/api/purchase-entries` from 10. | code |
| Refetching | After **any** save, `QueryProvider` refreshes **every** list on screen (`invalidateQueries()` with no filter), and every list refetches when the window regains focus (`refetchOnWindowFocus: true`, `staleTime` 15 s). | `components/providers/QueryProvider.tsx:58-85` |
| Database link | Atlas sends ~**100 KB/s** (446 items = 380 KB = 3.9 s, even on plain Node). It looks like free/shared-tier throttling. | `memory.md` §12 |
| Connection | On Cloudflare every request opens its own MongoDB client: ≈ **0.35 s** extra per API call, plus DNS SRV lookup and TLS each time. | `memory.md` §8, `lib/db.ts` |
| Indexes | On Workers, mongoose `autoIndex` is **off** (`lib/db.ts`). Indexes written in the models are only created if someone ran the app on Node against the live database. They may be missing on live: **must be checked in Atlas.** | code |
| Pages | 95 of 96 pages are browser-only ("use client"), so nothing shows until JavaScript, then session, then data arrive, one after another. | code |
| Fonts | Inter is loaded from Google Fonts with a `<link>` in `<head>` (an extra outside server; it blocks the first paint). | `app/layout.tsx` |
| Images | `public/bglogo.png` 76 KB, `icon-512.png` 81 KB, PNG not WebP; 8 `<img>` tags, no `next/image`. | `public/` |
| Side effects | Opening Bank Accounts or Warehouses **deletes rows** (`deleteMany` inside GET): an extra database write on every open. | `app/api/bank-accounts/route.ts:53`, `app/api/warehouses/route.ts:10` |

---

## 3. What costs money on Cloudflare (and what doesn't)

Workers Paid plan: **$5/month base**, which includes 10 million requests and 30 million CPU-milliseconds a month. Above that: about **$0.30 per extra million requests** and **$0.02 per extra million CPU-ms**. (Check the current Cloudflare pricing page; these were the published rates.)

| Item | Cost driver | Status |
|---|---|---|
| **Static files** (`/_next/static`, icons, APK) | Served from Workers Static Assets: **free**, no Worker run. | ✅ OK |
| **API requests** | 1 Worker run each. ~30 per app open per person today. | ⚠ Too many; see F6, F7, F9, A6 |
| **CPU time** | Decoding whole collections from MongoDB, adding them up in code, and turning large results into JSON. Heavy routes: `dashboard/stats`, `items`, `invoices`, `reports/*`, `customers`. | ⚠ Main cost lever; see A2, A3 |
| **Page loads** | Each page open / navigation runs the Worker (middleware + page). | OK |
| **Durable Object (live updates)** | Hibernating WebSocket: idle sockets cost nothing; a ping every 45 s per open app. Very small. | ✅ OK |
| **Cron** | Every 5 minutes = 288 runs a day, each opening a DB connection. | Minor; see C5 |
| **Logs** (`observability: enabled`) | Every run is logged; a large allowance is included on Paid. | Minor; see C4 |
| **Worker size** | ~5.5 MB compressed (pdf-parse, xlsx, cloudinary, mongoose on the server). Affects cold start (~30–40 ms), not the price. | OK |
| **MongoDB Atlas (not Cloudflare)** | The slow ~100 KB/s link. Dedicated tiers also charge for data sent out, so smaller payloads save there too. | ⚠ See A1 |

**How to see the real bill:** Cloudflare dashboard → Workers & Pages → `valueplus-erp` → **Metrics** (requests, CPU time median / p99, errors), and **Billing → Usage**. Check both before and after the changes below.

---

## 4. The fixes

Effort: **S** = hours · **M** = 1–2 days · **L** = 3+ days. "Speed" and "Cost" show the expected effect.

### 4.1 Quick wins (do first, low risk)

| # | Fix | Where | Speed | Cost | Effort |
|---|---|---|---|---|---|
| **F1** | **Load the Excel and PDF libraries only when Export is pressed** (`await import("xlsx")` / `await import("jspdf")` inside the export functions). | `lib/export/excel.ts`, `lib/export/pdf.ts`, `lib/export/domToPdfBlob.ts`, `ExportMenu.tsx` | **−~200 kB on ~75 pages** (average page ~357 → ~160 kB) | — | S |
| **F6** | **Stop downloading all products and customers on every app open.** Do it only for billing roles (cashier, manager, admin), at most once a day or when the list changed (version number), and never on the login page. Fix the effect so it runs once. | `components/shared/offline-sync-provider.tsx:99-109` | Big: removes 2 of the heaviest calls from every app open | Fewer runs and much less CPU | S |
| **F7** | **Refresh only what changed.** Replace the global `invalidateQueries()` with the live-update path matching already used (`meta.live`). Turn off refetch-on-focus for heavy lists (live updates keep them current). Give master data (categories, brands, units, Onsitego plans, shift, company) a 30–60 min `staleTime`. | `components/providers/QueryProvider.tsx` | Fewer reloads after each save | Fewer runs | S |
| **A8** | **Remove the `deleteMany` from the Bank Accounts and Warehouses GET handlers** (run it once as a script). | `api/bank-accounts`, `api/warehouses` | Small | Fewer writes | S |
| **F3** | **Remove framer-motion from the sidebar and bottom bar** (CSS transitions do the same), or load it lazily. | `components/layout/sidebar.tsx`, `mobile-bottom-nav.tsx`, login page | −~30–40 kB on every page | — | S |
| **F4** | **Self-host the Inter font** with `next/font/google` and remove the Google Fonts `<link>`. | `app/layout.tsx` | Faster first paint; no outside server | — | S |
| **F5** | **Compress the images** (`bglogo.png`, icons) to WebP / smaller PNG. | `public/` | Small | — | S |
| **C5** | **Run the cron only during work hours** (`*/5 3-18 * * *` = 08:30–00:30 India time) instead of all night. | `wrangler.jsonc` | — | 288 → 192 runs a day | S |

### 4.2 The big wins (database and APIs)

| # | Fix | Where | Speed | Cost | Effort |
|---|---|---|---|---|---|
| **A1** | **Check and upgrade the MongoDB Atlas tier.** The ~100 KB/s link is the single biggest delay (4 s for the product list). A paid tier (Flex, or M10 dedicated, Mumbai) removes the throttling. Check the current tier first: Atlas → Database → Cluster → tier. | Atlas console | **Biggest single gain**: lists in < 0.5 s instead of 3–5 s | Atlas bill goes up (Flex ≈ $8–30/month, M10 ≈ $60/month; check Atlas pricing) | S (no code) |
| **A4** | **Make sure the indexes exist on live.** `autoIndex` is off on Workers, so create them once with a script (`Model.syncIndexes()` from a laptop) and check in Atlas → Collections → Indexes / Performance Advisor. Key ones: invoices `{date}`, `{invoiceNumber}`, `{customerPhone}`, `{type, status, date}`; items `{code}`, `{vpCode}`; attendance `{staffName, date}`; payments `{date}`, `{partyId}`; leads `{assignedStaff, status}`; notifications `{recipientId, readAt, createdAt}`; estimates `{approvalStatus}`. | script + Atlas | Faster filtered queries as data grows | Less CPU | S |
| **A2** | **Send only what each screen needs.** (a) **Projections** on list APIs (e.g. the product picker needs name, code, price, stock, not the whole document). (b) **Paging / date range** on invoices, payments, leads, purchases (default: this month, "Load more"). (c) **Search on the server** for product and customer pickers (type 2–3 letters → `/api/items/search?q=`) instead of sending the full list to the phone. | `api/items`, `api/invoices`, `api/customers`, `api/payments`, `api/crm/leads`, `api/purchase-entries`, the pickers | Lists 5–20× smaller | **Less CPU** (main cost lever) | M |
| **A3** | **Rewrite the dashboard stats** as MongoDB aggregations for the chosen date range (`$match` on date + `$group`), instead of loading 9 whole collections and adding up in code. Even better: store a **daily summary** (sales, cash, dues, profit per day) updated on each bill, and read that. | `app/api/dashboard/stats/route.ts` | Dashboard from several seconds to well under 1 s | **Large CPU saving** on the most-opened page | L |
| **F8** | **Dashboard page: one data call and lazy widgets.** Move its 26 fetches to React Query (cached, de-duplicated), stop loading **all invoices** in the browser (`fetchTasksAndLeads`, due invoices: let the server filter), and load lower widgets (leaderboard, stock modal, charts) only when scrolled to or opened. Split the 6,200-line page into widget files loaded with `next/dynamic`. | `app/(dashboard)/dashboard/page.tsx` | Dashboard JS 689 kB → ~250 kB; fewer calls | Fewer runs | L |
| **F9** | **One "my status" call instead of ~8 on every page.** The bell, the pending estimate / discount / leave pop-ups, day-close, finance reminder and attendance each fetch on open. Combine them into `/api/me/summary` (counts plus today's items), refreshed by live updates. | `app/(dashboard)/layout.tsx` and those components | Faster page open, especially on phones | **~7 fewer runs per page open** | M |
| **F2** | **Load the billing form only when it opens** (`next/dynamic` for `InvoiceCreationModal`, ~4,000 lines; it is imported by dashboard, invoices, estimates, orders, credit notes and brands), and the charts (recharts) only where they show. | those pages | −~100–150 kB on those pages | — | S–M |
| **A6** | **Cache read-mostly data at Cloudflare.** Product catalog, categories, brands, units, Onsitego plans, company profile: keep a "version" number (bumped on each write; the live-update hub already sees every write), and serve the list from Cloudflare's cache for that version. Most opens then never touch MongoDB. | API routes + `worker.ts` | Catalog in milliseconds | **Fewer DB reads and much less CPU** | M |

### 4.3 Deeper changes (after the above)

| # | Fix | Speed | Cost | Effort |
|---|---|---|---|---|
| **A5** | **Cut the per-request connection cost.** Steps, in order:<br>1. Use a standard (non-SRV) connection string to skip the DNS SRV lookups, and set `maxPoolSize: 1` with fewer monitoring connections.<br>2. **Test** whether the current Workers runtime lets a client be reused across requests (it used to hang, `memory.md` §8). If it does, reuse it.<br>3. If not, keep one warm connection in a Durable Object and send queries to it, or run a small Node API in Mumbai next to Atlas.<br>Note: Cloudflare **Hyperdrive does not support MongoDB**, and the Atlas **Data API has been retired**, so neither is an option. | −0.2 to −0.35 s on **every** API call | Less CPU (TLS setup each time) | M–L |
| **R1** | **Server-render the first view of key pages** (dashboard summary, invoice list), so the numbers arrive with the page instead of after three round trips. | Faster first paint on phones | — | L |
| **C4** | **Logs:** keep observability, but remove noisy `console.log` / `console.warn` in hot paths, and set a sampling rate in `wrangler.jsonc` (`observability.head_sampling_rate`) if log volume passes the included amount. | — | Small | S |
| **P1** | **Heavy server libraries** (pdf-parse, xlsx, cloudinary) only load in the routes that use them (already mostly lazy). Keep it that way when adding features. | Cold start | — | — |

---

## 5. What to expect

| | Today | After quick wins (4.1) | After big wins (4.2) |
|---|---|---|---|
| JavaScript per page (average) | ~357 kB | **~150–170 kB** | ~130–150 kB |
| Dashboard JavaScript | 689 kB | ~450 kB | **~250 kB** |
| Requests when the app opens (cashier) | ~30 | ~25 | **~8–10** |
| Product list load | 3–5 s | 3–5 s (only when needed) | **< 0.5 s** (Atlas tier + projection / cache) |
| Dashboard data | several seconds | several seconds | **< 1 s** (aggregation / daily summary) |
| Worker CPU per day | high (whole collections) | lower | **much lower** (main Cloudflare saving) |

(Estimates from the measured sizes; confirm with the before / after checks in section 7.)

---

## 6. Order of work (checklist)

**Week 1: quick wins, no behaviour change**
- [ ] F1 Export libraries load on demand
- [ ] F6 Stop the product and customer preload on every app open
- [ ] F7 Targeted refresh, master-data `staleTime`, no refetch-on-focus for heavy lists
- [ ] F3 framer-motion out of the sidebar and bottom bar
- [ ] F4 Self-hosted font, F5 compressed images
- [ ] A8 Remove `deleteMany` from GET handlers
- [ ] C5 Cron only in work hours
- [ ] A4 Check / create indexes on live (script + Atlas Performance Advisor)
- [ ] A1 Check the Atlas tier and decide on the upgrade (owner)

**Week 2–3: data size and request count**
- [ ] A2 Projections + paging + server search (items, invoices, customers, payments, leads, purchases)
- [ ] F2 Billing form and charts loaded on demand
- [ ] F9 One `/api/me/summary` call for the layout pop-ups and bell
- [ ] A6 Versioned Cloudflare cache for the catalog and master data

**Week 3–4: dashboard and connection**
- [ ] A3 Dashboard stats as aggregations / daily summary
- [ ] F8 Dashboard page split into lazy widgets on React Query
- [ ] A5 Connection cost: non-SRV string first, then test reuse / Durable Object

Test every step on **staging** first (as usual), then deploy to live.

---

## 7. How to measure before and after

1. **Page weight:** `npx next build` prints "First Load JS" per page. Note the numbers in section 2 and compare.
2. **Phone speed:** Chrome DevTools → Lighthouse (Mobile) on `/login` and the dashboard; record LCP and Total Blocking Time. Use the Network tab ("Slow 4G") to count requests and transferred KB when the app opens.
3. **API time:** Network tab → time for `/api/items`, `/api/dashboard/stats`, `/api/invoices`. Optionally add a `Server-Timing` header in `worker.ts` (DB connect / query / total) to see where each request spends its time.
4. **Cloudflare:** Workers → `valueplus-erp` → Metrics (requests per day, CPU time median and p99) and Billing → Usage, one week before and one week after.
5. **Atlas:** Metrics → Network (bytes out), Opcounters, and Performance Advisor (missing indexes, slow queries).
