# API calls on app open — before / after (F6, F7, F9)

Counted by reading the code: what the root layout (`app/layout.tsx` providers) and the dashboard layout
(`app/(dashboard)/layout.tsx` and what it mounts) call when a signed-in user opens any dashboard page.
The page's own calls (e.g. the dashboard's 26 fetches) are not counted. Neither is NextAuth's
`/api/auth/session`, nor the `/realtime` WebSocket upgrade (both unchanged).

## Per role

| Call | Who calls it | Admin before | Admin after | Cashier before | Cashier after | Salesman before | Salesman after |
|---|---|---|---|---|---|---|---|
| `GET /api/items` | OfflineSyncProvider | 1 | 0 (1 at most every 12 h) | 1 | 0 (1 at most every 12 h) | 1 | 0 |
| `GET /api/customers` | OfflineSyncProvider | 1 | 0 (1 at most every 12 h) | 1 | 0 (1 at most every 12 h) | 1 | 0 |
| `GET /api/warehouses` | BranchProvider (not in scope) | 1 | 1 | 1 | 1 | 1 | 1 |
| `GET /api/notifications` | NotificationBell | 1 | – | 1 | – | 1 | – |
| `GET /api/notifications` | UnreadNotificationPopup | 1 | – | 1 | – | 1 | – |
| `GET /api/approvals?status=pending` | NotificationBell (admin) | 1 | – | – | – | – | – |
| `GET /api/estimates?approval=pending` | PendingEstimatePopup | 1 | – | 1 | – | – | – |
| `GET /api/staff/leave-requests?status=pending&decidable=1` | PendingLeavePopup | 1 | – | – | – | – | – |
| `GET /api/discount-approvals?status=pending` | PendingDiscountPopup | 1 | – | 1 | – | – | – |
| `GET /api/day-close` | DayCloseGate (cashier, accounts) | – | – | 1 | – | – | – |
| `GET /api/finance/reminders` | FinancePayoutReminder (admin, manager, accounts) | 1 | – | – | – | – | – |
| `GET /api/crm/leads?shareInbox=1` | LeadShareInbox (salesman) | – | – | – | – | 1 | – |
| `GET /api/crm/leads` | LeadsLoginPopup (salesman) | – | – | – | – | 1 | 1 until closed in this sign-in, then 0 |
| `GET /api/staff/attendance?date=…` | GeofenceWatcher (cashier, salesman …; shared with the punch widget) | – | – | 1 | 1 | 1 | 1 |
| **`GET /api/me/summary`** | all of the above pop-ups + bell | – | **1** | – | **1** | – | **1** |
| **Total** | | **10** | **2** | **9** | **3** | **8** | **4 → 3** |

So a page open goes from 10 → 2 (admin), 9 → 3 (cashier), 8 → 3–4 (salesman). A billing role's
first open in 12 hours adds the 2 offline-list downloads back (they used to come on *every* open, for
every role, including the login screen).

## Knock-on calls that also go away

- **Push sign-up storm.** A device that allowed notifications calls `GET /api/push/key` +
  `POST /api/push/subscribe` on every open (lib/push-client.ts, unchanged). That POST used to go
  through the fetch wrapper and refresh **every** query on screen (`invalidateQueries()` with no
  filter) — the pop-up queries and the page's own lists all fetched a second time. `/api/push/*`
  is now ignored by the wrapper, as the Worker already ignores it for live updates.
- **After a save** (e.g. a bill): before, every mounted query refetched. Now only queries whose
  `meta.live` paths match the written path, plus queries without `meta.live` (unchanged for those).
  E.g. a cashier saving a bill no longer refetches the day-close / estimates / discounts checks.
- **On return to the tab**: before, every stale query refetched, and the bell fetched
  notifications (+ approvals) on every visibility change. Now queries with `meta.live` are not
  refetched on focus (the socket keeps them current), and the bell refreshes the summary only when
  its answer is more than 15 s old: at most 1 call instead of 2–7.

## Trade-off

A live change to any path the summary watches refreshes the whole summary (one call that runs the
role's parts on the server) rather than only the one pop-up that cared. For an admin that includes
`/api/invoices` (the finance reminder watched it before). Fewer Worker runs overall, slightly more
database work per such change.
