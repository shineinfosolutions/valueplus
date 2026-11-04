# ValuePlus ERP — Bugs found in the current app

> Review date: 3 Nov 2026. Read-only code review of the live version (`eef92a4f`) across billing, payments, staff, stock, reports and security.
> **✔ = checked again by hand in the code.** The rest were traced in the code by the reviewer, but not tested in the running app.
> Severity: **High** = money, stock, salary or data wrong, someone can do what they shouldn't, or work is blocked. **Medium** = wrong numbers on screen or confusing. **Low** = small or cosmetic.

**Fix first:** section 1 (security), then the money bugs in section 2, then the rest.

---

## 0. Already fixed

| # | Bug | Where | Status |
|---|-----|-------|--------|
| 0.1 | ✔ **The bill form crashes once the Onsitego PDF is uploaded.** The plans API left out the product type, plan kind and VP Code, so matching a product to its plans failed while the form was showing. | `app/api/onsitego/plans/route.ts:17`, `lib/onsitego.ts` | **Fixed and live (version `2e6d7cd5`, 3 Nov 2026).** The PDF can be uploaded now. |

---

## 1. Security and access (High)

| # | Bug | Where | What happens | Fix |
|---|-----|-------|--------------|-----|
| 1.1 | ✔ **Master passwords at login** | `lib/authOptions.ts:204-218` | `123456`, plus a fixed default password for each role (`admin123`, `store123` …), signs in as **any** user of that role, even after they changed their password. The stored password hash also works as a password. | Remove the whole fallback block; keep only `bcrypt.compare`. Then change every staff password. |
| 1.2 | ✔ **Any logged-in user can create an Admin or reset passwords** | `app/api/users/route.ts:8-14` | Only the Manager is blocked. A salesman, driver, cashier or the supplier login can add a user with role `admin`, or change the Admin's password. | Allow add, change and delete of users only for `admin`. |
| 1.3 | ✔ **Database password written in the code** | `lib/db.ts:17` | The full MongoDB address, including user and password, is the fallback in the source. Anyone with the code can open the live database. | Change the Atlas password now, remove the fallback, and stop with an error if `MONGODB_URI` is missing. |
| 1.4 | **Demo accounts re-create themselves** | `lib/authOptions.ts:177-194` | If a demo user (admin, driver …) is renamed or deleted, typing its username at login creates it again with its known password. Typing `admin` always maps to the super-admin demo account. | Remove the demo list from login. |
| 1.5 | ✔ **Public tracking page shows the delivery OTP** | `app/api/track/[id]/route.ts:56`, regex at `:24` | Anyone with an invoice number (numbers run in order) sees the customer's phone, address and **OTP**. `/api/track/.*` returns some bill. Deliveries can then be marked done without the customer. | Do not return the OTP or phone; match the exact number only. |
| 1.6 | ✔ **The delivery screen gets the OTP too** | `app/api/delivery/verify-otp/route.ts:61`; driver page loads full `/api/invoices` | "Out for delivery" sends the OTP back to the delivery boy. There is no limit on wrong tries of the 4-digit code. | Never send the OTP to staff; lock after 5 wrong tries. |
| 1.7 | **Money, salary and stock APIs with no role check** (only "signed in") | `staff/salary`, `bank-accounts`, `expenses`, `items/delete`, `customers` DELETE, `warehouses` DELETE, `inventory/*`, `stock-transfers`, `finance`, `accounting/*`, `purchase-orders`, `suppliers`, `serial-numbers`, `day-close`, `reports/*` | A salesman, driver or the supplier login can see all salaries and mark them paid, delete a product, delete a customer, move stock, close the day … | Add a role or permission check to each route (best: a default "deny" per `/api` area in `middleware.ts`). |
| 1.8 | **Everyone can read every user's salary, bank and ID details** | `app/api/users` GET, `app/api/orders` GET | Any login, the supplier included, gets salary, bank account, IFSC, ID-proof numbers, and every invoice with the customer's phone and OTP. | Limit by role; send only the fields each screen needs. |
| 1.9 | **Attendance can be changed for anyone** | `app/api/staff/attendance/route.ts:261` (check-out), `:339`, `:390`, `:487` (DELETE) | Only check-in uses the login. A salesman can mark himself Present for a missed day, check out a colleague, or delete any attendance record. | Check-out uses the login's own name; manual entry, bulk and delete only for Admin, Manager and HR. |
| 1.10 | **Task API has no role check** | `app/api/staff/tasks/route.ts:84, 145, 209`, `SalesmanDashboardView.tsx:168` | A salesman can mark his own **sales target** Completed or change its progress numbers. | Staff may only change the status of their own non-target tasks; target progress is set by the server only. |
| 1.11 | **Deactivated staff keep access for 30 days** | `lib/authOptions.ts:196-252` | Login never checks `status`, and the role sits in a 30-day token. A fired employee, or one whose role was lowered, keeps access. | Refuse inactive users at login; re-read status and role every few minutes. |
| 1.12 | **Shared fallback PIN** | `lib/securityPin.ts:19` | Anyone without a personal Security PIN can authorise cancel, edit and delete with the old shared PIN. | Refuse when no personal PIN is set; make everyone set one. |
| 1.13 | **Shared counter phone shows the last user's data** | `public/sw.js:39-51`, `lib/offline-storage.ts`, logout in `lib/push-client.ts:120` | Pages and offline data are kept after logout. The next person on the same phone sees them, and can even sync the previous person's offline bills under their own name. | Clear the caches and offline data at logout. |
| 1.14 | **Advance refund: anyone, no PIN, no log** | `app/api/crm/advances/route.ts:161-201` | Any login can refund any customer advance in full. Only a note is left. | Put it through the Security PIN + Admin approval flow and log it. |
| 1.15 | **Search boxes build a pattern from what is typed** | `api/search:21`, `orders:18`, `items:47`, `purchase-entries:269`, `suppliers:29`, `invoices:846` and others | A name with `(` or `.*` gives an error or matches everything. Example: supplier "Samsung India (P) Ltd" never matches itself, so a duplicate supplier is created. | Escape the text (`escapeRegex`, already in `lib/notify.ts`). |
| 1.16 | **If `NEXTAUTH_SECRET` is ever missing, logins can be forged** | `lib/authOptions.ts:269`, `middleware.ts` | Falls back to a fixed string. | Stop with an error when it is not set. |
| 1.17 | **Any file of the Cloudinary account can be opened by any login** | `app/api/upload/view/route.ts` (added today), `app/api/upload/route.ts` | Whoever has a file link can open it, which bypasses the Documents roles. | Check the link against a stored record (finance DO) and its role. |

---

## 2. Billing, payments and advances

| # | Sev | Bug | Where | What happens | Fix |
|---|-----|-----|-------|--------------|-----|
| 2.1 | High | ✔ **Receive Payment turns into a Refund by itself** | `components/PaymentModal.tsx:92-104` | Pick a customer who already has an advance (negative balance): the type switches to "Refund / Pay to Customer" and their whole credit is filled in. If the cashier only types the reason and saves, a **refund** is recorded instead of a receipt. | Always start as "Receive Payment (In)" with an empty amount; make refund a separate, deliberate choice. |
| 2.2 | High | ✔ **Partly used advance hidden on the next bill** | `InvoiceCreationModal.tsx:583` (`status=Available`) | After a bill uses part of an advance, its status is "Partially Used", and the bill form only asks for "Available". The rest (e.g. ₹4,000 of ₹10,000) never shows, so the customer pays again. | Ask for both "Available" and "Partially Used". |
| 2.3 | High | **The same advance can be used on two bills** | `app/api/invoices/route.ts:929-973` | The server accepts the advance amount the form sends. Two bills made one after the other (or on two counters) can both take the same ₹10,000; the second one is saved as paid. | The server checks the real advance and credit left, and refuses more. |
| 2.4 | High | **Cancel / delete a bill does not give back the advance or free the serial number** | `app/api/invoices/route.ts:1244-1283`, `:1462-1485` | Advance Booking money used on the bill is lost. Cancel also keeps the Receive-Payment credit. The serial / IMEI stays SOLD, so the returned unit can't be billed again. Warranties stay Active. | On cancel and delete: return the advance and credit, set serials AVAILABLE, void warranties. |
| 2.5 | High | **A salesman's bill can be invoiced twice** | `app/api/invoices/route.ts:164-187` | The popup shows on Cashier and Manager screens. If both press "Make Invoice", two invoices are saved, and stock and money are counted twice. | Refuse when the estimate is already "Converted" (check-and-mark in one step). |
| 2.6 | High | **Bill's due shows wrong after collecting due on a bill that used an advance** | `invoices/route.ts:1141`, `payments/route.ts:142`, `lib/payment-change.ts:190` | Balance is computed as total − paid, without the advance. Example: ₹50,000 bill, ₹10,000 advance; after clearing the ₹35,000 due, the bill still shows ₹10,000 due for ever. | Use total − advance − paid in all three places. |
| 2.7 | High | **Delivery challan number clash makes later bill steps silently skip** | `invoices/route.ts:639`, catch at `:989` | Challan number = count + 1. After one challan is deleted every new number already exists. The error is hidden, so finance DO, advance deduction, lead conversion and target progress are **skipped**, yet the bill shows success. Every Bajaj bill makes a challan, so all of them are hit. | Next number from the highest existing one; do the money steps first, each with its own error handling. |
| 2.8 | High | **New customer from the bill can get a code that already exists** | `invoices/route.ts:299-301`, `lib/invoice-full-edit.ts:305` | Codes are sorted as text ("CUST-999" > "CUST-1773"), so the next code already exists. The bill is then saved against a random customer id, and its due is invisible in khata. | Take the numeric maximum (as `api/customers` already does). |
| 2.9 | High | **New-customer Advance Booking fails after saving, and a retry saves it twice** | `app/api/crm/advances/route.ts:89, 132` | The advance is saved first, then the customer code clashes and an error shows. The cashier saves again: two receipts, and the next bill takes off double. | Create the customer first (numeric-max code), then the advance. |
| 2.10 | High | **Advance on an estimate is posted before the estimate is saved, and again on each retry** | `InvoiceCreationModal.tsx:1677-1694` | An estimate refused once (locked price, discount approval) and saved again gives two advance receipts. If the advance call fails, the estimate still says "advance paid". | Post the advance after the estimate is saved, check the answer, and use the estimate number as a one-time key. |
| 2.11 | High | **Product incentive is taken from the browser as sent** | `invoices/route.ts:482`, `lib/invoice-full-edit.ts:512` | Only the Onsitego 10% is worked out on the server. The product incentive is whatever the form sends, so a crafted request can set any amount, and payouts trust it. | Work out the line incentive on the server from the item's settings. |
| 2.12 | High | **Cash register and advances** | `lib/cashRegister.ts:120-124` | Advance Booking cash and advance refunds never show in the cash register. A cash bill fully paid by advance counts its whole total as cash sales that day. | Count `paidAmount` as it is; add advance receipts and refunds as cash in and out. |
| 2.13 | Medium | **Onsitego plan stays at the old price slab after the rate or discount changes** (built today) | `InvoiceCreationModal.tsx` (plan block), `lib/onsitego.ts` | A plan picked at ₹38,000 stays when the discount brings the price to ₹29,500: wrong SKU sold. The server pays 10% on any amount marked "Onsitego". | Clear or flag the plan when the price leaves the slab, and check it again before saving. |
| 2.14 | Medium | **"Custom Provider & Price" quick plan does nothing** | `InvoiceCreationModal.tsx:2760` | It makes four separate updates and each overwrites the last; the amount stays 0. | Make it one update. |
| 2.15 | Medium | **Receive Payment accepts any date, even a future one**; **clear-due** has no role check, takes "cleared by" from the form, and dates the receipt in UTC | `payments/route.ts`, `invoices/route.ts:1146, 1177` | Wrong dates in the cash book; anyone can clear a due. | Refuse future dates; take the person from the login; use India time. |
| 2.16 | Medium | **Advance Booking page "Total Refunded" too high** | `sales/advances/page.tsx:80` | It counts the full advance, including the part already used on bills. | Count only the refunded part. |
| 2.17 | Low | Bill prints the newest advance receipt number while the server uses the oldest; the edit banner says the bill date can be changed but the server refuses | `InvoiceCreationModal.tsx:1667, 1900` | Confusing. | Show the receipt actually used; fix the text. |

---

## 3. Staff, attendance, tasks, incentive

| # | Sev | Bug | Where | What happens | Fix |
|---|-----|-----|-------|--------------|-----|
| 3.1 | High | ✔ **"Request Advance" (salary) adds the money at once, to any name** | `app/api/staff/attendance/route.ts:465-473` | No approval, no notification; the name comes from the request. Settings → Users shows it as an advance already given. | Save a pending request, notify the Admin, add only on approval (by user id). |
| 3.2 | High | **Auto check-out at 9 PM pays better than checking out yourself** | `lib/attendance-alerts.ts:130-137`, `attendance/route.ts:306-316` | Someone who left at 6 PM without checking out is closed at 9 PM as Present. Someone checking out properly at 8:55 PM becomes Half-Day. A Half-Day for coming after 12:00 turns into Present at auto check-out. Time outside the store is not subtracted. | Keep a late Half-Day; for auto check-out use the last time seen inside (geofence) or mark it "not verified". |
| 3.3 | High | **Below the half-day hours still gives Half-Day** (the settings say "Absent") | `attendance/route.ts:301-305`, `attendance-alerts.ts:136` | 1 hour of work gives Half-Day. | Below `minHoursForHalfDay` → Absent, in both places. |
| 3.4 | High | **Godown and delivery staff can't check in, but are reported late every day** | `attendance/route.ts:152`, `attendance-alerts.ts:13` | Check-in needs to be within 100 m of the showroom. Godown staff are at the godown, and drivers have no check-in button. The Manager still gets "late" alerts for them every 15 minutes, 10:00–12:00. | Give the godown its own location; take drivers out of the late alert (or give them a way to check in). |
| 3.5 | High | ✔ **Sales target counts the same bill for people with a similar name** | `app/api/invoices/route.ts:838-850` | It matches on the first name (unanchored), so a bill by Amit Singh also counts on Amit Verma's target; "Ram" matches "Ramesh". With today's "one task for several people", this matters more. | Match by the person's user id. |
| 3.6 | Medium | **Target progress is never taken back** | `invoices/route.ts:835` | Cancelling or editing a bill, or a credit note, leaves the target counted (and Completed). | Record each bill's share on the task and take it back. |
| 3.7 | Medium | ✔ **Salesman dashboard counts incentive twice** | `components/dashboard/SalesmanDashboardView.tsx:159-160` | The period card adds the line incentives **and** the bill total of the same incentive: ₹200 shows as ₹400. (The new Incentive card is right.) | Drop the line-incentive term. |
| 3.8 | Medium | **Salesman dashboard period figures include cancelled bills, estimates and sales orders** | `SalesmanDashboardView.tsx:102-120` | Sales, target % and incentive are too high, and disagree with the "today" tiles. | Use the same exclusions as `lib/staff-incentive.ts`. |
| 3.9 | Medium | **Sales Incentives page totals don't match the payout balance; a salesman sees other people's bills** | `staff/incentives/page.tsx:51-60, 92-107` | Cancelled bills are counted. "Amit" also sees "Amit Verma". "Rahul" and "Rahul (Sales Executive)" show as two rows. | Use the same name rule and exclusions as the incentive book. |
| 3.10 | Medium | **Two staff with the same name share attendance and incentive** | `lib/staff-incentive.ts:47, 63`, `attendance/route.ts:165`, `attendance-alerts.ts:40` | The second "Rahul Kumar" gets "already checked in today"; both see the combined incentive. Renaming a user splits their history. | Key on user id (already stored), with the name only as a fallback. |
| 3.11 | Medium | ✔ **"Break over" alert repeats every day for ever** | `lib/attendance-alerts.ts:71-77`, `app/api/staff/break/route.ts:28` | If someone forgets "I am back", the Manager and Admin get an alert every 5 minutes, 9 AM–10 PM, every day, and the break can't be closed later. | Only today's breaks; close the break at check-out or when the geofence sees them inside. |
| 3.12 | Medium | **Attendance page "In shift" counts people on leave** | `staff/attendance/page.tsx:231` | Leave rows have check-in "--", which counts as checked in. | Also require a real check-in and not On Leave. |
| 3.13 | Low | **Task page totals ignore the new staff filter** | `staff/tasks/page.tsx:212-215` | The list changes, but the number tiles don't. | Count from the filtered list. |

---

## 4. Stock, purchase, delivery

| # | Sev | Bug | Where | What happens | Fix |
|---|-----|-----|-------|--------------|-----|
| 4.1 | High | ✔ **Deleting a stock transfer never puts the stock back** | `app/api/stock-transfers/route.ts:142` | The quantity left the source when the transfer was made; deleting an in-transit transfer loses it. | Cancel instead of delete, and reverse the stock. |
| 4.2 | High | **Some stock changes are erased by the next sale** | `inventory/return/route.ts:33-41`; moves with no warehouse (`lib/stock.ts:28`, `journal/route.ts:32`, `purchase-entries/route.ts:340`) | A customer return of +2 goes only into the total; the next sale of that item re-adds showroom + godown and wipes the +2. | Always move stock through `applyStockMovement` with a real warehouse. |
| 4.3 | High | **Cancelled / deleted purchase bill leaves its IMEIs "available"** | `purchase-entries/route.ts:462-499, 629-639` | Stock is reversed, but the serials can still be picked and sold. | Mark that bill's unsold serials void. |
| 4.4 | High | **Stock APIs are open to every role except the Manager** | `lib/deferred-actions.ts:103` | A Manager's stock change waits for the Admin, but a salesman, driver or cashier calling the same API goes straight through. Transfer "received", journal and return have no check at all. | Add a permission check to each. |
| 4.5 | High | **Live Audit compares one location's count with total stock** | `app/api/inventory/audit/route.ts:191, 199, 141` | 5 in showroom + 10 in godown: counting the showroom's 5 shows "−10 missing". A second location re-opens the first location's audit. | Expected = that location's stock; one audit per location per day. |
| 4.6 | Medium | **Stock report location filter uses where the item was first created** | `app/api/reports/stock/route.ts:34-66, 95` | The "Godown" view shows showroom units, and moved items stay under their old place. | Use the stock of the chosen location. |
| 4.7 | Medium | **Supplier name with brackets creates a duplicate supplier**; cancel then reverses the balance on the wrong copy | `purchase-entries/route.ts:269, 474, 623`, `serials/route.ts:140` | Supplier balances split and drift. | Escape the name; use the supplier id. |
| 4.8 | Medium | **Cancelled bills still show for dispatch and delivery** | `driver/deliveries/page.tsx:80`, `sales/dispatch/page.tsx:87`, `verify-otp` | Goods for a cancelled bill can be sent out. | Leave out cancelled bills; refuse them in verify-otp. |

---

## 5. Dashboard, reports, GST, day-close

| # | Sev | Bug | Where | What happens | Fix |
|---|-----|-----|-------|--------------|-----|
| 5.1 | High | ✔ **Dashboard revenue counts cancelled bills, credit notes and sales orders** | `app/api/dashboard/stats/route.ts:79, 359-367` | A cancelled ₹50,000 bill stays in Total Revenue, Cash and Dues; a credit note adds revenue; net profit follows. | Count only tax invoices that are not cancelled, minus credit notes. |
| 5.2 | High | ✔ **Sales-out report includes cancelled bills** and adds credit notes | `app/api/reports/sales-out/route.ts:19-21, 81` | Totals too high. | Leave out cancelled; subtract credit notes. |
| 5.3 | High | ✔ **GSTR-1 / GSTR-2 / 3B include cancelled bills and purchases** | `app/api/gstr-reports/route.ts:369, 418` | Output GST and ITC are overstated; returns never reduce tax; all-time data is filtered in the browser. | Leave out cancelled; subtract credit/debit notes; filter the month on the server. |
| 5.4 | High | **P&L counts credit notes as revenue and includes sales orders** | `app/api/reports/profit-loss/route.ts:24-28, 101-117` | A sales order later billed is counted twice; a return raises revenue. Expenses and purchases ignore the branch filter. | Tax invoices minus credit notes; branch on expenses and purchases too. |
| 5.5 | High | **P&L profit includes GST on the margin** (from the GST-included choice in memory 16b) | `profit-loss/route.ts:108-115` | Taxable ₹100, cost ₹80 shows ₹23.60 profit instead of ₹20; the extra is GST payable. | Work out profit before GST; show GST-included totals only for display. **Owner decision needed.** |
| 5.6 | Medium | ✔ **Day-close uses UTC dates**; the closer's name comes from the browser | `app/api/day-close/route.ts:8, 22, 119` | From midnight to 5:30 AM "yesterday" is wrong, so the gate asks for the wrong day. Anyone can post a day-close as anyone. | India date; person from the login; role check. |
| 5.7 | Medium | **Dashboard "today" in UTC** | `app/api/dashboard/stats/route.ts:175-196` | Until 5:30 AM, today's bills are missing from the default view. | India date. |
| 5.8 | Medium | **Cash register can count a later due payment twice** | `lib/cashRegister.ts:~119` | A Cash bill counts its running `paidAmount`, which later Receive Payments also raise, and those receipts are counted again on their own day. A closed day's figure changes afterwards. | Count only what was paid at billing. |
| 5.9 | Medium | ✔ **Opening some pages deletes data** | `app/api/bank-accounts/route.ts:53`, `app/api/warehouses/route.ts:10` | Just loading the list removes "cash" bank accounts and some warehouse names. | Move the clean-up to a one-time script. |

---

## 6. Platform / performance (Medium)

| # | Bug | Where | What happens | Fix |
|---|-----|-----|-----|-----|
| 6.1 | **Dashboard loads every collection on every open** | `app/api/dashboard/stats/route.ts:65-73, 1229, 1307` | All invoices, customers, items, suppliers, expenses, payments and purchases are read each time: slow, and costly on Cloudflare and Atlas. The driver and dispatch pages load all invoices into the phone. | Query only the date range and the fields needed; give the driver a small "my deliveries" API. |
| 6.2 | **New database connection for every request** | `lib/db.ts` | About 0.35 s extra per call, and risk of hitting the Atlas connection limit at busy times. | Look at Cloudflare Hyperdrive or the Atlas Data API. |
| 6.3 | **Staging could write to the live database** | `wrangler.jsonc` (staging sets no `MONGODB_DB` var) | The code defaults to `valueplus` (live). memory.md says the staging secret is set; check with `npx wrangler secret list --env staging`. | Set `MONGODB_DB` as a plain var for staging too. |
