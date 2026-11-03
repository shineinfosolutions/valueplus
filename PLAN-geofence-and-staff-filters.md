# Plan — Geofence "time outside the store" + Staff filters

> Status: **analysis only, nothing built yet.** Date: 2026-11-03.
> Requests:
> 1. When a staff member leaves the store area, record how long they were away (geofencing).
> 2. Dashboard → *Lead Pipeline & Conversion*: a filter button to see leads staff-name-wise.
> 3. Staff panel: a staff filter button there too.

---

## 1. Geofencing — how long a staff member was outside the store

### 1.1 What exists today

| Piece | Where | What it does |
|---|---|---|
| Store point + radius | `lib/store-location.ts` | `STORE = 26.7464624, 83.4141547`, `STORE_RADIUS_M = 100`, `MAX_GPS_ERROR_M = 150`, `distanceM()` (haversine), `checkAtStore()` |
| Check-in | `app/api/staff/attendance/route.ts` (~line 149) | Check-in only accepted inside 100 m. Saves `checkInLat/Lng/DistanceM` on `Attendance` |
| Break return | `app/api/staff/break/route.ts` | "I am back" only accepted inside the store (`breakReturnedAt`) |
| Break-over alert | `lib/attendance-alerts.ts` `breakOverAlerts()` | Cron (every 5 min): break ended and not back → Manager + Admin alerted, repeated every 5 min |
| Location in UI | `AttendanceCheckInDialog`, `AttendancePunchWidget`, `BreakControl` | Location is read only at the moment of check-in / "I am back" |
| Report | `staff/member/[id]` + `/api/staff/member-activity` | Shows the check-in distance (`distanceM`) per day |

**Gap:** the location is checked only at check-in and when returning from a break. Between those moments nobody knows whether the person is in the store. Nothing records "left at 12:10, came back at 12:55".

### 1.2 The hard limit: the browser / APK cannot track in the background

The Android app is a **TWA**: a full-screen Chrome page, not a native app. A web page:
- **Can** follow the location while the app is **open on screen**. It uses `navigator.geolocation.watchPosition`: the phone reports movement on its own, with no timer.
- **Cannot** read the location when the app is closed, in the background, or the screen is locked. Android/Chrome stop it. No web API does background geofencing.

So a web-only geofence can only say "outside / inside **while the app was open**". When the app is closed, the honest answer is **"location unknown"**.

A real geofence that also works with the app closed needs a **native Android app**: Capacitor or a small Kotlin wrapper using Android's Geofencing API. That needs:
- the "background location" permission;
- a Play Store declaration, or an APK install with "Allow all the time";
- battery-saver exceptions on some phones.

That is a separate, bigger project (see Phase 2).

### 1.3 Recommended approach — Phase 1 (web, no polling)

**Idea:** while a person is checked in (and not checked out), the open app watches the phone's location. It tells the server only when the person **crosses the store boundary** (exit / enter). The server keeps a list of "away periods" per person per day.

#### Client — new `components/shared/GeofenceWatcher.tsx`
- Mounted in `app/(dashboard)/layout.tsx`. Active only for staff roles, only when today's attendance is checked-in and not checked-out. Admin is excluded.
- Uses `watchPosition` with `{ enableHighAccuracy: true, maximumAge: 30000 }`. **No `setInterval`**: the phone calls back when it moves. This follows the "no polling" rule (memory.md section 30).
- **Hysteresis**, so GPS jitter at the door does not create fake exits:
  - **Exit** = distance > **150 m** (100 m radius + 50 m buffer), with accuracy ≤ 150 m, for **2 readings at least 60 s apart**.
  - **Enter** = distance ≤ **100 m** with accuracy ≤ 150 m (one good reading is enough).
  - Readings worse than 150 m accuracy are ignored.
- On a state change → `POST /api/staff/presence { event: "exit" | "enter", lat, lng, accuracy }`.
- Remembers the last state in `localStorage`, so a page reload does not send a duplicate.
- When the app **goes to the background** (`visibilitychange` → hidden), it sends `event: "hidden"`. When it comes back it sends `"visible"` plus a fresh reading. The server can then mark that stretch as **"app closed — location unknown"** instead of guessing.

#### Server — new `app/api/staff/presence/route.ts`
- `POST` (the signed-in user only; name and id come from the session, never the form):
  - **Re-checks the distance itself** with `distanceM()`. The client's "exit/enter" is a hint; the server decides from lat/lng/accuracy.
  - `exit` → opens an away period `{ leftAt, leftDistanceM, maxDistanceM }`.
  - `enter` → closes it: `backAt`, `minutes`.
  - `hidden` / `visible` → records an "unknown" period.
  - Ignored when not checked in, after check-out, or when no change.
- `GET ?date=&staff=` (Admin / Manager / HR) → away periods plus totals per person.
- Every write is announced on the live-update socket (worker.ts already does this for `/api/*`). The dashboard card and the directory update instantly.

#### Data — extend `models/Attendance.ts` (no new collection needed)
```ts
awayPeriods: [{
  leftAt: Date, backAt?: Date, minutes?: number,
  leftDistanceM: number, maxDistanceM: number,
  kind: "away" | "break" | "unknown",   // break = inside an approved break, unknown = app was closed
}],
totalAwayMinutes: number,      // only kind "away" (not breaks)
lastPresence: { state: "in" | "out" | "unknown", at: Date, distanceM?: number },
```
- **Approved breaks:** an exit during an approved break (`LeaveRequest.kind = "break"`, between `breakStartedAt` and `breakEndsAt`) is stored as `kind: "break"`. It is **not** counted in `totalAwayMinutes`. Once the break time is over, the rest counts as "away". The existing break-over alert stays as it is.
- **Check-out / auto check-out at shift end** (`autoCheckOut` in `lib/attendance-alerts.ts`) closes any open away period at the check-out time.

#### Alerts — reuse the 5-minute cron (`lib/attendance-alerts.ts`)
- New check `awayTooLongAlerts()`: an open away period (no `backAt`) older than **N minutes** (suggest **15**, set by the Admin) → bell + phone alert to Manager + Admin.
  - Example: "Rahul Verma left the store 18 min ago (about 650 m away)".
  - Repeated every 15 min while still away, like the break-over alert.
- Optional: tell the staff member on their own phone "You are outside the store" when they leave without a break.

#### Where it shows
| Place | What |
|---|---|
| Dashboard (Admin / Manager) | New small card **"Outside the store now"**: name, since when, distance. It updates live over the socket. |
| Staff Directory (`/staff/directory`) | Column "Away today": count and total minutes, for example "3× · 47 min" |
| Staff member page (`/staff/member/[id]`) | Day-wise timeline: "12:10 – 12:55 outside (45 min, ~650 m)", break periods shown apart, "app closed" stretches in grey. Month total. |
| Attendance page (`/staff/attendance`) | Extra column "Away (min)" |
| Export | The Away columns are added to the existing Excel/PDF export |

#### Edge cases / honesty rules
- **App closed** → shown as "unknown", never as "inside". The report states clearly that tracking works only while the app is open.
- **Weak GPS indoors**: a reading with accuracy worse than 150 m is ignored. A person standing inside a concrete showroom can show 50–200 m error. The 2-reading, 150 m exit rule avoids false "left" marks.
- **Fake-GPS apps**: a web page cannot detect them (a native app can). The server sanity-checks for impossible jumps (for example 2 km in 10 s) and ignores those.
- **Battery**: `watchPosition` with high accuracy uses GPS while the app is open. That is acceptable for a shift, but it is mentioned to staff.
- **Privacy**: the location is only used between check-in and check-out, and only the store distance and points at exit/enter are stored. There is no full route tracking.

### 1.4 Phase 2 (optional, later) — native background geofence
- Wrap the app with **Capacitor** (Android), or add a Kotlin service to the TWA project.
- Register an Android **Geofence** (store point, 100–150 m). The OS wakes the app on ENTER / EXIT even when it is closed, and it calls the same `POST /api/staff/presence`.
- Needs "Allow location all the time", a Play policy declaration (or a sideloaded APK as today), and per-phone battery settings.
- Phase 1's API and data stay the same, so Phase 2 only adds a better data source.

### 1.5 Effort (Phase 1)
About 2–3 days. Then test on staging with 2 real phones: walk out and back, a break, app closed, weak indoor GPS.

---

## 2. Dashboard → Lead Pipeline: staff filter

### 2.1 What exists
- Widget: `app/(dashboard)/dashboard/page.tsx`, the "COLUMN 3: LEAD PIPELINE & CONVERSION FUNNEL" block (~line 3794).
- Data: `fetchTasksAndLeads()` (~line 729) loads `GET /api/crm/leads` into `leads`.
- Filters today: a date range (`leadDateFilter` / `leadDateRange`) and tabs (`leadTabFilter`: All / New / Follow-up / Converted). The summary strip (~3841) and the list (~3912) each filter `leads` separately.
- Each lead has `assignedStaff` (a **name string**; the model default is "Amit Singh", "Sales Team" is used for unassigned). There is no staff id on the lead.
- The API already supports `?staff=` (exact match) and already limits a salesman to their own leads plus "Sales Team".

### 2.2 Plan
- Add a **Staff dropdown** next to the date filter. It shows only for Admin / Manager / Cashier, because a salesman already sees only their own leads.
  - Options: **All staff** · each salesperson (from `/api/users`, active salesman/sales roles) · **Unassigned / Sales Team**.
  - Each option shows its lead count, for example "Rahul Verma (12)".
- Filter on the client (leads are already loaded). One shared helper `leadMatchesFilters(lead)` is used by **both** the summary strip and the list, so the totals, conversion %, pipeline ₹ and the list always agree. Today the date check is repeated in 3 places; this also fixes that.
- Name matching: compare case-insensitively with the "(Sales Executive)"-style suffix removed. The same rule is already used elsewhere (`normName` in `lib/staff-incentive.ts`).
- The choice is kept in the URL (`?leadStaff=`) or localStorage, so it survives a refresh.
- "Open Full CRM Leads" passes the staff on: `/marketing/leads?staff=<name>`. The leads page reads it, so the full list opens already filtered.

### 2.3 Effort
About half a day.

---

## 3. Staff panel: staff filter

### 3.1 Which page is "Staff panel"? (needs your confirmation)
The sidebar group **Staff & Attendance** has these pages. Current state of a staff filter on each:

| Page | Path | Staff filter today |
|---|---|---|
| Daily Attendance & Shifts | `/staff/attendance` | **Yes** (`selectedStaff`) |
| Sales Incentives | `/staff/incentives` | Partly |
| Staff Tasks Delegation | `/staff/tasks` | **No** |
| Staff Directory | `/staff/directory` | No (search box only) |
| Staff Leaderboard | `/staff/leaderboard` | No |
| Leave & Breaks | `/staff/leave-requests` | No |
| Salary & Payroll | `/staff/salary` | No |

There is also the **salesman's own dashboard** (`components/dashboard/SalesmanDashboardView.tsx`), which some people call the "staff panel". There it would only make sense for the Admin viewing a chosen salesman's dashboard.

### 3.2 Plan
- Make **one reusable component** `components/shared/StaffFilter.tsx`:
  - a dropdown of active staff from `/api/users`, with an "All staff" option and a search box in the list;
  - an optional role filter (Sales / Cashier / Godown / Delivery …);
  - shown only to Admin / Manager / HR (other roles see only their own data anyway);
  - the value is kept in the URL (`?staff=`).
- Add it to the pages that lack it:
  - **Tasks**: filter by "Assigned to" (`assignee` / `assigneeId`).
  - **Leave & Breaks**: by `staffName`.
  - **Leaderboard**: highlight or show only that person.
  - **Salary**: by employee. `/api/staff/salary` already accepts `employeeId`.
  - **Directory**: the dropdown alongside the search box.
- Use the same component for the dashboard lead filter (section 2), so it looks the same everywhere.
- Where an API already filters by staff (salary `employeeId`, leads `staff`, attendance `staff`), filter on the server. Otherwise filter on the client.

### 3.3 Effort
About 1 day for all the pages listed above.

---

## 4. Suggested order
1. **Staff filter component + dashboard lead filter** (sections 2 & 3): small, low risk, visible at once.
2. **Geofence Phase 1** (section 1): bigger. Test on staging with real phones before production.
3. Geofence Phase 2 (native), only if Phase 1's "app closed = unknown" is not good enough.

## 5. Questions to decide before building
1. **Away alert threshold**: after how many minutes outside should the Manager / Admin be alerted? (Suggested: 15 min.)
2. **Exit distance**: keep the store circle at 100 m, with an exit only beyond 150 m? (The showroom building size and the GPS quality inside matter.)
3. **Who is tracked**: all staff except Admin? Should **delivery boys** (always outside) and **Godown** staff (at another address) be left out, or get their own location?
4. **Staff panel**: which pages exactly? Are all the pages in 3.1 fine, or only Tasks / Directory / Leaderboard?
5. **Phase 2 (native app)**: is "tracking only while the app is open" enough for now?
