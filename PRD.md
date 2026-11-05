# ValuePlus ERP — Product Requirement Document (PRD)

**As built and live, 3 November 2026**

| Item | Details |
|---|---|
| **Business** | M/S Ashoka Enterprises (Value Plus Showroom), H. No. 116, Deoria Road, Kunraghat, Gorakhpur (UP) · GSTIN 09ANHPJ7242D1Z2 · Ph 9140860604 |
| **Billing companies** | Value Plus and Ashoka Enterprises (a bill is raised under one of them) |
| **Live site** | https://valuplus.shineinfosolutions.in |
| **Test copy (staging)** | https://valueplus-erp-staging.shineinfosolutions1.workers.dev (its own test database) |
| **Android app** | `valuplus.shineinfosolutions.in/downloads/valueplus.apk` (opens the live site full-screen, with phone notifications) |
| **What it is** | One system for the showroom's billing, payments, finance (EMI) sales, stock and godown, purchases, delivery, staff attendance and incentives, customer leads, GST reports and profit. |

---

## 1. Users and what each one sees

Every staff member signs in with email / mobile and password. Each role has its own **panel address** (e.g. `/salesman`, `/cashier`) and lands on its own home screen. The menu shows only that role's pages.

| Role | Panel | Main work |
|---|---|---|
| **Super Admin (Owner)** | `/admin` | Everything. Approves the Store Manager's changes, discounts over 12%, leaves; sees all money, profit, staff and reports. |
| **Store Manager** | `/manager` | Every page, but changes to bills, payments, stock and masters go to the Admin for approval. Approves breaks and discounts of 10–12% (and the Cashier's 5–10% band). |
| **Cashier** | `/cashier` | Approves discounts above 5% and below 10%; sets product incentives. Tax invoices (POS), receive payments, advances, expenses, estimates from salesmen, day-close cash audit, purchase entry. |
| **Salesman** | `/salesman` | Own dashboard, leads and follow-ups, estimates and "bills" for the cashier, stock check, GIDA warehouse orders, own incentive and the product-wise **Incentive Plan**, Onsitego plans. Gives discounts up to 5% without approval. |
| **Accounts** | `/accounts` | Finance ledger, payouts, GST and P&L reports, supplier ledgers, documents. |
| **HR & Payroll** | `/hr` | Attendance, leave, salary, staff profiles. |
| **Godown Incharge** | `/warehouse` | Godown hub, stock flow, transfers, dispatch, challans, e-way bills, audit. |
| **Delivery Boy** | `/driver` | His assigned deliveries (OTP + 3 photos), salary and advance, profile and vehicle. |
| **Supplier** | `/supplier` | Purchase orders and debit notes (outside supplier login). |

**Security PIN and approvals (all roles):** cancelling or deleting a bill, editing a saved payment or bill, and back-dated entries need the person's own **Security PIN + a reason**. The Admin's change is applied at once and logged; the Store Manager's change waits for the Admin (**Store Activity Approvals**, showing every field Before → After).

---

## 2. Dashboard (Overview)

**Admin / Manager / Cashier / Accounts dashboard**

- Universal date filter (Today, Yesterday, 7 days, Month, custom) that updates every widget.
- Revenue, collections, dues, expenses, profit cards; payment-mode split; category and brand stock (**Brand → Category → Products** drill-down with quantity and value).
- **Profit & Loss** summary card and the **Audit** button (Mobile phones only / All products).
- **Lead Pipeline & Conversion** card with date filter, **Staff filter** (lead counts per salesperson), New / Follow-up / Converted tabs, quick status change, "Open Full CRM Leads".
- **Task delegation** card, **Staff leaderboard** (top 4 + View all).
- **Bills from salesmen** (waiting to be invoiced), **Cash Available** card (cash in register, cash with Admin, deposited in bank, total given by cashier by period), **Stock order requests**, **Outside the store now** (geofence).
- **Cash with the Cashier**: cash to collect since the last handover; Supplier ledger summary.
- Check-in card at the top for Manager, Cashier and Accounts.

**Salesman dashboard (phone first)**

- Name, full-width **Check In / Check Out**, Apply Leave, break control.
- **Today's follow-ups** with one-tap Call; tiles for sales today, revenue today, my leads, pending tasks.
- **Incentive** card (Earned / Received / To receive; tap for every bill, the Onsitego part and payouts).
- **Incentive Plan** card: tap to see every product with a running incentive, its rules (₹ per piece and/or %, minimum price, last date) and what one piece earns at the selling price; search, brand filter, sort by highest ₹ or %, in-stock only.
- Target progress (by product units and by amount), Stock orders card, own brand vs other brands sales, quick actions (New Estimate, New Bill, New Lead, Stock, New Stock).
- Period tabs (Today / Week / Month / custom) with own invoices, estimates and deals closed.

---

## 3. Sales & Billing

### 3.1 Tax Invoices (POS)

- **Billing form:** customer by mobile (auto-fill from the customer master, or added as a new customer on save); billing company (Value Plus / Ashoka); warehouse; product search by name / VP code; serial / IMEI pick from available stock; qty, rate (GST-inclusive), discount, GST rate per line; HSN.
- **Sales Executive is compulsory.** It fills by itself from the customer's open lead or the salesman's bill.
- **Payment modes:** Cash, UPI, Card, Due (credit), Finance (Bajaj, HDB, IDFC, TVS, Kotak … with down payment, DO details, DO / approval attachment upload) and **Split** payment.
- **Advance and credit:** the customer's advance booking receipts and money already received through Receive Payment are shown ("Payment Already Received"), with a tick box to use them on this bill.
- **Extended warranty per line:** OneAssist, **Onsitego**, Zopper and others; plan, years, amount, policy number. **Onsitego plans are shown automatically for each product**, grouped (EW / ADLD / AMC / LTC), with price and VP Code, according to the product type and price slab; one tap adds the plan.
- **Price control:**
  - **discount bands** (how far below the selling price): up to 5% the salesman gives it himself; above 5% and below 10% needs the **Cashier**; 10–12% the **Store Manager**; above 12% **only the Admin**. Each role gives its own band and below without asking, and the counter waits with a live popup;
  - a price below the product's **floor / locked minimum price** needs a PIN.
- **Delivery:** counter handover or later delivery; expected delivery date; **Driver / Vehicle** drop-down (fills the driver's name, phone and vehicle); vehicle number compulsory for **Bajaj Finance** bills; delivery challan made automatically.
- **Bill date is always today** (no back-dating); offline bills keep their own date when they sync.
- **On save:** stock goes down per warehouse, serials become SOLD, customer balance and khata update, leads convert, sales-target tasks move, the finance DO is created, the salesman's incentive is worked out on the server from the product's incentive rules (frozen on the bill line) and recorded (+10% of Onsitego plans).
- **Print / share:** GST tax invoice (A4), WhatsApp share; delivery photos viewable on the bill.
- **Invoice list:** search, date filter, Paid / Balance (advance shown), "Delivered" badge, delivery photos, export to Excel / PDF; phone card view.
- **Edit a saved bill (full edit):** same form, Security PIN + reason; stock, serials, balance, receipt, warranty, challan and finance DO are redone. The Manager's edit waits for the Admin, who sees every change.
- **Cancel / delete** with PIN + reason; deleted bills are archived (who, when, why).
- **GSTIN bills keep real GST.** An Admin-only tool fixes old 0% GSTIN bills.

### 3.2 Receive Payment (Counter)

- Type-to-search customer, or **add a new customer right there** (name, mobile, address, GSTIN, credit limit …).
- Receive (In) or Refund (Out); amount, date, mode, reference / UTR.
- **Reason is compulsory** for customer payments.
- After saving, a **payment receipt** opens: receipt no., customer, reason, mode, received by, amount in words, and **"Advance with us ₹X — will be taken off the next bill"** / still due / settled. It can be printed or sent on WhatsApp. Every past payment has a **Receipt** button.
- Money received without a bill becomes the customer's credit, used on the next bill (and given back if that bill is deleted).
- Editing or deleting a payment needs PIN + reason (Manager → Admin approval). Supplier payouts are on the same screen.

### 3.3 Customer Advances (Advance Booking / Token)

- Customer, mobile, amount, mode, ref, product booked, brand, **reason (compulsory)**, remarks.
- Receipt `ADV-YYYY-####` with reason and received by, in India time; **print (receipt only)** and WhatsApp.
- Status: Available → Partially Used → Fully Adjusted / Refunded; refund with notes.
- The bill form finds the advance by mobile and deducts it.

### 3.4 Estimates / Quotes and salesman "Bills"

- **Estimate** = quotation for the customer (print / WhatsApp), no approval needed.
- **Bill (salesman):** a sale the salesman makes when the customer is buying now. It goes to the Cashier / Manager / Admin with a **popup and phone notification**; the cashier presses **Make Invoice**, confirms payment and delivery, and the invoice is made under the salesman's name. The salesman is told when it is invoiced or rejected.
- **Deal amount** recorded for the salesman; **locked minimum price** per product; below it needs the Admin's **Price Unlock PIN** (a salesman can never go below it).
- Advance can be taken on an estimate (makes an advance receipt).

### 3.5 Other sales pages

- **Credit Notes:** sales returns and adjustments.
- **Sales Orders:** customer orders.
- **GIDA WAREHOUSE ORDER:**
  - Admin / Manager / Cashier upload the supplier warehouse's daily stock sheet; products show NEW and +N markers;
  - salesmen pick quantities and send an order request (`SO-YYYY-####`);
  - the Admin approves or rejects it and sends the products list on WhatsApp to the supplier;
  - only today's sheet is used.
- **Order Dispatch & Deliveries:** bills waiting for delivery, out for delivery, delivered, with OTP and photos.
- **Delivery Challan:** tabs Delivery Challans / Pending Delivery / Delivered; return and transfer challans.
  - **Defective returns (CR / PR):** a *Supplier Return* challan sends a defective product back to the supplier (stock goes out, serial RETURNED); a *Customer Return* challan takes a customer's defective product back (it comes into stock with its serial DEFECTIVE). The claim stays **Pending** until the result comes, then is settled:
    - **CR (credit)** — supplier only: the supplier gave money. A **debit note** is raised in the supplier's name for that amount; it sits in his ledger as credit and comes off the next purchase bill.
    - **PR (replacement)** — from the supplier: the new product comes into stock with its serial; to the customer: the new product goes out of stock and its serial is SOLD to him.
    - A pending claim can be **cancelled** (stock and serial go back). Settling / cancelling: Admin, Store Manager, Godown Incharge, Accounts. Challans no longer make customer credit notes by themselves.
- **E-Way Bills:** prepare e-way bill details for consignments over ₹50,000.
- **Finance DO** page.

---

## 4. Purchase & Expenses

- **Purchase Entry (GRN / supplier bills):**
  - manual entry, or **import from the supplier's PDF / Excel invoice** (products matched by VP code / model, serials read from the PDF, supplier details read from the letterhead);
  - warehouse, GST, payment made at entry, due date;
  - stock and the supplier balance go up; serial numbers saved.
- **Add Serial Numbers** later (paste a list; replace if wrong); the Admin can correct a line rate.
- **Purchase bill correction** (date, due date, GSTIN) with PIN + reason; cancel / delete with PIN (Manager → Admin approval); record a bill payment.
- **Purchase Orders** to suppliers (the supplier login can see them); **Debit Notes & Return Claims**.
- **Low Stock / Auto Reorder:** items below their reorder level.
- **Expenses (Petty Cash):** expense heads, GST, mode, analytics; counted in the cash register and P&L.

---

## 5. Products & Masters

- **Items (Master Stock):**
  - VP code, model, brand, category, HSN, GST, purchase price, selling price, MRP, **VSP**, floor price, **incentive rules** — any number per product, ₹ per piece and/or % of taxable, each with an optional minimum price and from/to dates; all running rules add up. Admin, Store Manager and Cashier can set them (🎁 button on the list, or in the item form);
  - stock per warehouse (showroom / godown);
  - Product Ledger (every purchase and sale with profit; invoice links);
  - price-sheet (V+NLC / VSP) upload by brand with a sample sheet; bulk incentive (add a rule to, or replace the rules of, every product in a category / brand); assign brands; GST and purchase-GST fix tools (Admin);
  - phone view: compact list with role-based detail.
- **Stock Report (Price & VSP):** brand, product type, stock filter, search; stock value at selling price and VSP; export.
- **Categories, Brands** (brand → product catalog with "Bill Now"), **Units, Warehouses & Godowns, Customers** (GSTIN, credit limit, balance / khata, ledger), **Suppliers**.

---

## 6. Finance & EMI Hub

- **Customer Dues & Overdue:** pending dues and EMIs, WhatsApp reminders, collect payment.
- **Monthly EMI Cycles:** repayment schedules, due dates, progress, counter / auto-debit payments.
- **Finance Ledger & Delivery Orders:**
  - finance company, DO / DA numbers, down payment, disbursement;
  - the uploaded **DO attachment (PDF / image) opens** through the app.
- **Bank NACH & Payouts:** finance payouts, bank account and UTR entry; reminders until the UTR is filled in.

---

## 7. Suppliers & Ledgers

- **Supplier Master** and supplier profile.
- **All Ledgers:** every supplier's purchases, payments and balance, with statements to print / export.
- **Supplier Payments.**
- **Outstanding & Ageing:** what is owed and for how long.

---

## 8. Godown & Logistics Hub

- **Godown Master Hub:** inward (GRN), serial tracking, transfers, dispatch, audits in one place, with check-in for godown staff.
- **Stock Flow (In / Out):** every stock movement by date.
- **Stock Transfer:** inter-godown / showroom transfers (in transit → received). The Manager's transfer waits for the Admin.
- **Live Audit (daily):**
  - count every product (or phones only: **Mobile Audit**); several people count at the same time, each count saved live with who counted;
  - finalise only when all are counted; history with differences, export;
  - click a product for its full history;
  - Admin decides who may audit.
- **Dispatch, Delivery Challan, E-Way Bills** (as in section 3).

---

## 9. Delivery Boy Portal

- **My Assigned Deliveries:** expected date (overdue / today), customer and address; **Out for delivery → OTP from the customer → Delivered** with **3 compulsory photos from the in-app camera** (no gallery); the photos are viewable by the Admin / Manager.
- **My Salary & Advances**, **My Profile & Vehicle**.

---

## 10. CRM & Customer Service

- **Sales Leads:**
  - customer, mobile, product(s), value, source, assigned salesman (a salesman's own leads only), status;
  - follow-ups with notes and next date; **every Call press recorded** (who / when) and shown per day; history cannot be edited;
  - WhatsApp; leads pop-up at sign-in; phone cards view;
  - **Staff filter**; Admin **Staff Activity** (calls and follow-ups per salesman per day);
  - a lead converts automatically when the customer is billed.
- **Customer Queries (walk-in enquiries)** and **Customer Complaints** (tickets: product issues, transit damage, staff conduct).
- **On Site Go (Plans):** the Onsitego folder for every staff member (see section 13).
- **WhatsApp notifications** outbox page (customer messages and their status).

---

## 11. Staff & Attendance

- **Check-in / Check-out:**
  - only **inside the store (within 100 m)**, with a **selfie** and location;
  - shift 10:00 AM – 9:00 PM; late minutes recorded; Late / Half-Day rules;
  - **automatic check-out at 9:00 PM**;
  - "Office time has started" notification at 10:00.
  - Late alerts to the Manager and Admin: one per person, every 15 minutes, 10:00–12:00.
- **Geofence (time outside the store):** while the staff app is open it records when the person leaves (over 150 m) and comes back, how long and how far. Breaks are counted separately, and app-closed time is shown as "unknown". **After 15 minutes outside, the Manager and Admin are alerted.**
  - Shown on: the dashboard "Outside the store now", Staff Directory "Away today", the staff member page, and the attendance page.
- **Daily Attendance & Shifts:** day / staff / date filter, selfie view, manual entry, shift settings.
- **Leave & Breaks:**
  - Weekly Off, Leave, Emergency Leave, Break;
  - approval popup for the Admin / Manager;
  - approved history with period filter;
  - break timer with "I am back" (checked inside the store) and a break-over alert.
- **Staff Tasks Delegation:**
  - general tasks and **sales targets** (by product / brand units and / or by amount, with progress bars that move automatically on every bill);
  - **one task to several people at once** (each gets their own copy);
  - "Read by", priority, due date, notifications.
- **Staff Directory (Admin / Manager):** each person's bills, **incentive earned / paid / to pay**, payouts, away today; the member page shows attendance, time off, away time and sales by month.
- **Staff Leaderboard:** ranking by sales, bills, units, collected, average bill and share.
- **Sales Incentives:** per-bill incentive ledger; **10% of every Onsitego plan sold** is added automatically to the bill's salesman.
- **Salary & Payroll:** monthly salary, incentives, deductions, payment.
- **Staff filter** on Tasks, Leave & Breaks, Leaderboard, Salary and Directory.
- **My Profile & KYC.**

---

## 12. GST & Financial Reports

- **Profit & Loss:**
  - opens on Today; sales and purchases GST included; product-wise profit using the cost frozen on each bill line;
  - "GST this period (not part of profit)" box;
  - expenses; A4 print.
- **GST Reports:** GSTR-1 (B2B / B2C), GSTR-2, GSTR-3B, HSN tab; Excel export.
- **HSN Summary Report** (GSTR-1 Table 12): B2B and B2C, by HSN + rate, drill-down to bills, 2-sheet Excel in portal format.
- **Sales Out Report:** sales register with dues, payment modes, finance status.
- **All Reports & Analytics**, **Documents**.

---

## 13. Documents and On Site Go

- **Documents:**
  - office documents (PDF / photos) with date and narration, in **folders** (Admin / Manager create; the Admin deletes empty folders);
  - files open only through the app (private storage).
- **On Site Go folder (always present):**
  - the Admin / Manager upload Onsitego material;
  - **every staff role can open it**;
  - **uploading Onsitego's price list PDF reads all plans** (e.g. 153 plans: SKU name, VP Code, price slab, price) and replaces the old list; the bill then shows these plans per product;
  - a newer PDF replaces the plans automatically.

---

## 14. Store Profile & Settings

- **Store Activity Approvals:** every change waiting for the Admin, with Before → After and Approve / Reject (phone card view).
- **Users & Staff KYC Master:** logins, roles, KYC, salary, advance, brand (vehicle number for delivery staff).
- **Role Permissions:** who can open ledgers, record payments, cancel / delete.
- **Security PIN** (each person's own), **Price Locks**, **Price Unlock PIN**.
- **Company / Store Profile:** GSTIN, address, bank accounts on invoices.
- **Bank Accounts Master & Cash Register:**
  - showroom cash register with daily in / out;
  - **Daily Cash Audit (day-close)** with notes count; Sales and Cash pages lock until the previous day is closed;
  - Admin "Set actual cash" and "Recalculate old audits".
- **Admin Cash Book:** cash received from the cashier (handover confirmed by the Admin), deposits, cash with the Admin.
- **System Settings.**

---

## 15. Across the whole app

- **Live updates:** every screen refreshes the moment its data changes anywhere (WebSocket), with no repeated polling: lighter and faster.
- **Notifications:** bell + **phone push notifications even when the app is closed** (approvals, tasks, bills from salesmen, leaves, discounts, late / away alerts), with sound; unread popup once per device; one popup at a time.
- **Phone-first design:** bottom bar, Menu as tiles, card layouts for tables, 44 px buttons, Android app (APK).
- **Offline billing:** bills can be made without internet and sync later.
- **Exports:** Excel / PDF on most lists; WhatsApp sharing for bills, receipts, reminders.
- **Audit trail:** cancels, deletes, edits, payment changes, price locks and more are logged with who and why.
- **External portals:** Value Plus Retail customer portal (embedded) and Gmail.

---

## 16. Built pages not in the menu (kept hidden)

These pages exist and can be switched on later:

- Journal Entries, General Ledger, Trial Balance, Balance Sheet, Cash Flow;
- Bank Receipts / Payments;
- Loyalty Program;
- Variants, Bill of Material;
- Stock Adjustment, Stock Journal, Stock Request, Stock Return.

---

## 17. Technology and hosting

- **Next.js 15 + React 19 + TypeScript**, Tailwind / shadcn UI; **MongoDB Atlas** (Mumbai) database.
- Hosted on **Cloudflare Workers** (custom domain), with a separate staging copy and database.
- Files: Cloudinary (documents, DO attachments) and Cloudflare R2 (delivery photos, selfies).
- Live updates: Cloudflare Durable Object (WebSocket hub).
- A background job runs every 5 minutes (late, break and away alerts, auto check-out).

---

## 18. Known issues and next steps

A full code review on 3 November 2026 listed the open bugs in **BUGS.md** and the improvement ideas for each user in **SUGGESTIONS.md**. The most important:

1. **Security:** remove the master passwords at login; only the Admin may create users or change passwords; take the database password out of the code; hide the delivery OTP from the tracking page and the delivery screen; role checks on salary / stock / money APIs.
2. **Money:**
   - Receive Payment must not switch to "Refund" by itself;
   - a partly used advance must show on the next bill;
   - cancelling a bill must return its advance and free its serial numbers;
   - a salesman's bill must not be invoiced twice.
3. **Reports:** leave cancelled bills out of the dashboard, Sales-out and GST reports, and subtract credit notes.
4. **Staff:** a salary advance request needs approval; check-in for godown staff at the godown; sales targets matched by the person, not the first name.
