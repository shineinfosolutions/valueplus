# IST vs UTC audit — 13 Nov 2026

Read-only check of the whole code. **Nothing was changed.**

The server (Cloudflare) runs on **UTC**; Value Plus works in **IST (UTC+5:30)**. Code that takes "today" or "this hour" from the server clock is wrong:
- between **00:00 and 05:30 IST**, when "today" in UTC is still yesterday;
- or by **5:30 hours** when it reads the hour.

**Totals:** 31 places — **9 High** (money / attendance / salary / serial dates), **9 Medium** (dashboard and report ranges, day-close), **13 Low** (notes, document-number year on 1 Jan, defaults).

Most of the app already uses India time correctly (billing date, attendance, cash register, advances, cron). The gaps are below.

## High — wrong date stored on money / records

| # | Where | What | Wrong case |
|---|---|---|---|
| 1 | `app/api/invoices/route.ts:1311` | Date of the payment when a **due is cleared** | Due collected at 01:00 IST on the 14th is dated the 13th → lands in the 13th's cash register / day-close |
| 2 | `lib/financeSettlement.ts:88` | Finance payout / bank credit date (when not given) | Payout at 01:00 IST dated previous day |
| 3 | `app/api/approvals/route.ts:154` | Expense created when an expense approval is approved | Approved at 02:00 IST → expense on previous day (cash, P&L) |
| 4 | `app/api/staff/salary/route.ts:56, 63` | **Salary payment date** | Paid 00:30 IST on 1 Dec → recorded 30 Nov (wrong month) |
| 5 | `app/api/finance/route.ts:161` | EMI instalment paid date (when not given) | EMI collected 01:00 IST → yesterday's cash |
| 6 | `app/api/invoices/route.ts:606` | First payment of a new bill (when no date sent) | 00:00–05:30 IST → yesterday |
| 7 | `app/api/vendors/payments/route.ts:66`, `vendors/bills/route.ts:64-69` | Vendor payment / bill / due date (when not given) | Vendor ledger and due date one day off |
| 8 | `app/api/dashboard/stats/route.ts:1738, 1811` | Quick bill / receipt from the dashboard (when no date sent) | Same as #6 |
| 9 | `app/api/serial-numbers/route.ts:177` | **Serial SOLD date** (warranty start) | Sold 00:30 IST → yesterday |

## Medium — wrong range / view

| # | Where | What | Wrong case |
|---|---|---|---|
| 10 | `app/api/day-close/route.ts:7-8, 22`, `lib/day-close-pending.ts:12, 20` | Pending day-close and the Sales / Cash lock | 00:00–05:30 IST: the day that just ended can't be closed; the lock waits until 05:30 |
| 11 | `app/api/dashboard/stats/route.ts:95-116` | Dashboard default month / day range | 00:00–05:30 IST on the 1st still shows last month |
| 12 | `app/api/dashboard/stats/route.ts:137, 300-320` | Deleted / back-dated / reprinted bill cards | A bill deleted or reprinted at 01:00 IST shows under the previous day |
| 13 | `app/api/dashboard/stats/route.ts:723, 728, 908, 1157` | **Hourly sales / payments / expense chart** | Always 5:30 h early (an 11 AM sale shows in the 5–6 AM slot) |
| 14 | `app/api/reports/performance/route.ts:19-72` | Staff performance: Today / Yesterday / 7 days / months | 00:00–05:30 IST "Today" = yesterday |
| 15 | `app/api/audit/route.ts:37-38` | Audit log date filter | Misses 00:00–05:30 IST of the start day |
| 16 | `app/api/inventory/stock-flow/route.ts:27-30` | Stock in / out for a period | Movement at 01:00 IST falls in the previous day |
| 17 | `app/api/warranty/route.ts:60-63` | Warranty "today / this month" counts | Wrong 00:00–05:30 IST |
| 18 | `app/api/orders/route.ts:46` | Sales order date (when not given) | Yesterday in 00:00–05:30 IST |

## Low

| # | Where | What |
|---|---|---|
| 19 | `crm/advances:193, 233` | Date text in refund / cancel notes |
| 20 | `finance/route.ts:12, 86` | EMI schedule start near midnight |
| 21 | `models/FinanceTransaction.ts:119`, `models/User.ts:84`, `users/route.ts:100` | Default DO date / joining date |
| 22 | `models/CashTransaction.ts:55`, `models/InventoryAudit.ts:78` | Default time without India zone (not reached today; the routes set IST) |
| 23 | `staff/attendance:23, 37`, `staff/tasks:96`, `StaffTask.ts:48` | Fallback only if the India-time formatter fails |
| 24 | `reports/profit-loss:92, 197`, `reports/product-ledger:152, 198, 248` | Day of old rows that have no date field |
| 25 | `lib/agedStock.ts:33-44` | Stock age 1 day short near midnight |
| 26 | `invoices:1472`, `lib/estimate-diff.ts:11` | Date-changed check (only for Date objects) |
| 27 | ~20 routes: `XX-${new Date().getFullYear()}-…` | Document numbers made 00:00–05:30 IST on **1 Jan** get last year's prefix |
| 28 | `purchase-orders:20`, `PurchaseCreationModal.tsx:638` | Default PO expected date can be 1 day early |
| 29 | `InvoiceCreationModal.tsx:4172` | Date-picker upper limit 1 day short near midnight |
| 30 | `import-stock4`, `track/[id]:49`, `estimates:237` | Cosmetic dates |
| 31 | `warehouse/page.tsx:279`, `SalesmanDashboardView.tsx:132, 146` | Only wrong for full timestamps (fine for stored dates) |

## Already correct (use these to fix)

- `lib/today.ts` `todayInIndia()` — standard "today" in India.
- `lib/cashRegister.ts` `istDay()`, `momentOf()`; attendance route `getISTDate()` / `getISTTime()`.
- Hour in India: `lib/attendance-alerts.ts:20`, `lib/office-reminder.ts:7` (pattern for #13).
- Range bounds: `` new Date(`${day}T00:00:00+05:30`) `` (already used in `dashboard/stats:118-119`) — pattern for #11, #12, #14, #15, #16.
- `components/shared/date-range-filter.tsx` (`addDaysIST`, `resolveDateRange`).

## Note

Since Value Plus closes at 10 PM, most of the "00:00–05:30 IST" cases happen only if someone works after midnight (or for jobs that run then). Still wrong, regardless of hours:
- **#13** — the hourly chart is wrong at every hour;
- **#4** — salary paid just after midnight on the 1st;
- **#27** — numbers made on the night of 1 January.
