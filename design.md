# Value Plus Master ERP — System Architecture & Design Specification

---

## 🔑 1. Ready-to-Use User Accounts & Login Credentials

All demo accounts are seeded and ready for login via NextAuth (`/login`):

| Role & Title | Login Email (User ID) | Default Password | Authority & Access Scope |
|---|---|---|---|
| 👑 **Super Admin** | `admin@valueplus.in` | `admin123` | **Master Omni-Access:** Full control across all showrooms, godowns, financial P&L, system settings, and approving Store Incharge activity requests. |
| 🏬 **Store Incharge / Branch Admin** | `storeincharge@valueplus.in` | `store123` | **Store Operations Head:** Full control of assigned store. Major transactions (Discounts, Expenses, Advances, Stock Transfers) trigger Super Admin notifications for sign-off. |
| 🏢 **Godown Incharge** | `warehouse@valueplus.in` | `warehouse123` | **Logistics Hub:** Central Godown live stock, Inward GRN with PO matching, Inter-godown transfers, Barcode/Serial tracking, and Audits. |
| 👔 **Sales Executive (Salesman)** | `salesman@valueplus.in` | `salesman123` | **Sales Panel:** Product catalog, real-time showroom stock, Estimates/Quotations, Sales orders, CRM leads, and Shift punch attendance. |
| 💳 **POS Cashier** | `cashier@valueplus.in` | `cashier123` | **Counter Billing:** POS Tax invoicing, Multi-mode payment collection (Cash/UPI/Card/Finance), and Due clearances. |
| 📊 **Chief Accountant** | `accounts@valueplus.in` | `accounts123` | **Financials & GST:** GST Returns (GSTR-1/2/3B), Sales Out reports, Bank accounts master, and Ledger reconciliations. |
| 👥 **HR & Payroll** | `hr@valueplus.in` | `hr123` | **HR Operations:** Staff KYC directory, Attendance logs, Shift hours, Incentives, and Monthly payroll generation. |
| 🏭 **Supplier Portal** | `supplier@valueplus.in` | `supplier123` | **Vendor Portal:** Purchase Orders (PO), Inward GRN consignment status, and Debit notes. |

---

## 👔 2. Sales Executive Personalized Workspace (`SalesmanDashboardView.tsx`)

When logging in as a **Sales Executive (`salesman@valueplus.in`)**, all irrelevant modules (HR Payroll, Staff KYC, Godown Logistics, System Settings, GST Accounting) are completely hidden. The dashboard renders a dedicated personal sales cockpit:
1. ⏱️ **Universal Attendance Punch & Shift Timer:** Live Check-in / Check-out with shift duration tracker.
2. 🎯 **Monthly Target vs Achievement Progress Meter:** Month-to-date sales progress bar against ₹5 Lakh target.
3. 💰 **Live Earned Incentives Wallet:** Fixed ₹ and % commissions earned on sold appliances.
4. 👥 **Assigned Hot Leads to Follow-up:** 1-click **Call** and **WhatsApp Chat** buttons.
5. 📝 **Created Estimates & Quotes Pipeline:** Quotations tracking and conversion funnel.
6. ✅ **My Daily Tasks Checklist:** Interactive checkboxes for store duties.
7. 🛡️ **My Personal Profile & KYC Hub (`/staff/profile`):** Verified Staff badge, Monthly Salary (Fixed + Incentive), Total Working Days & Hours logged, Leave balance & Leaves taken, Advance loan balance, and Bank A/C particulars.
8. ⚡ **Quick CTAs:** `[ My Profile & KYC ]`, `[ + Create Estimate ]`, `[ + New Lead ]`, `[ 🔍 Check Live Stock ]`.

---

## 🎨 3. Brand & Color Tokens

### Primary Palette (Value Plus Brand)
- **Brand Navy / Royal Blue**: `#30539C` (Sidebar, Primary Brand Headers, Gradients)
- **Accent Interactive Blue**: `#3F63AD` (Badges, Active Tabs, Highlights)
- **Value Plus Green**: `#76C043` (Growth metrics, Success indicators, "+ New Bill" CTA, Paid badges)
- **Hover Green**: `#60A82C`
- **Surface Navy Dark**: `#1B2537` / `#2C3E5A` (Modal Headers, Audit dialogs)

### Status & Semantic Colors
- **Success / Completed / Converted**: Emerald (`#10B981`, `bg-emerald-50`, `text-emerald-800`, `border-emerald-200`)
- **Warning / Pending / Follow-up**: Amber (`#F59E0B`, `bg-amber-50`, `text-amber-800`, `border-amber-200`)
- **Danger / Overdue / High Priority**: Rose / Red (`#EF4444`, `bg-rose-50`, `text-rose-800`, `border-rose-200`)
- **Info / In-Progress / Processing**: Blue (`#3B82F6`, `bg-blue-50`, `text-blue-800`, `border-blue-200`)
- **Admin / Self Priority**: Purple / Indigo (`#8B5CF6`, `bg-purple-50`, `text-purple-800`, `border-purple-200`)

---

## 🏬 3. Multi-Warehouse Data Isolation & Location Switcher

### Dynamic Location Switcher
- Managed via `BranchContext.tsx` and placed prominently at the top of the Sidebar.
- Switches active context between Showrooms and Godowns:
  - 🏬 **Ashoka Enterprises (Kunraghat Showroom)**
  - 🏬 **Value Plus (Deoria Road Branch)**
  - 🏢 **Gorakhpur Central Godown & Logistics Hub**
  - 🏢 **GIDA Industrial Area Godown**
- **Isolation Rule (0 Data Rule):**
  - Only **Ashoka Enterprises** holds the initial live products, stock quantities, and invoice history.
  - All other warehouses start with **`0` Stock, `₹0` Valuation, and `No Data Found`** until items are inwarded or transferred into them.

---

## 🔄 4. Inter-Godown Stock Transfer & Exchange Engine

```
[ Central Godown (Source) ]  ────── Transfer Dispatched ─────►  [ In-Transit (UP 53 BT 9090) ]
        │                                                                   │
   Stock -10 PCS                                                     Driver / Vehicle
                                                                            │
                                                                   Status: "Received"
                                                                            ▼
                                                                [ Deoria Road Branch (Dest) ]
                                                                        Stock +10 PCS
```

1. **Dispatch Stage (`in-transit`):** Decrements stock from source godown in MongoDB and creates a `StockTransfer` document with status `"in-transit"`.
2. **Receipt Stage (`received`):** Destination branch clicks **"Receive Stock"**, which updates the status to `"received"` and automatically credits the inventory into the destination warehouse's MongoDB collection.

---

## 🛡️ 5. Store Incharge Control & Super Admin Approvals Workflow

```
[ Store Incharge performs Major Activity ]
  (e.g., Discount Override, Store Expense, Advance Salary, Credit Limit)
                  │
                  ▼
[ Activity Request Created in MongoDB ] ───► Status: "Pending Super Admin Review"
                  │
                  ▼
[ Live Alert Broadcast to Super Admin ]
  • Topnav Notification Bell Pulses with Red Counter
  • Instant Popup Card in Topnav Dropdown
                  │
                  ▼
[ Super Admin Reviews in Approvals Center ] (/admin/approvals)
       ┌───────────────────────────┴───────────────────────────┐
       ▼                                                       ▼
 [ Approve Request ]                                    [ Reject Request ]
  • Status ➔ "Approved"                                  • Status ➔ "Rejected"
  • Action Auto-Executes (e.g. Expense logged)           • Rejection reason sent back
```

---

## 📦 6. Godown & Logistics Hub (7 Connected Modules)

| # | Module / Route | MongoDB Model | Purpose & Features |
|---|---|---|---|
| **1** | [**Godown Master Hub**](/warehouse) | `Item`, `StockTransfer`, `DeliveryChallan`, `SerialNumber` | Live physical stock, Stock Valuation, Inward GRN with PO matching, Barcode scanner & Audit. |
| **2** | [**Stock Flow (In/Out)**](/inventory/stock-flow) | `StockTransfer`, `Invoice`, `PurchaseEntry` | Real-time movement ledger tracking every Purchase Inward, Customer Outward & Inter-Godown Transfer. |
| **3** | [**Stock Transfer**](/inventory/transfer) | `StockTransfer`, `Item` | Real-time source deduction (`-Stock`), in-transit tracking, and one-click **"Receive Stock"** button. |
| **4** | [**Daily Physical Audit**](/inventory/audit) | `InventoryAudit`, `Item` | Compares physical box count against system records per warehouse and logs discrepancy history. |
| **5** | [**Stock Discrepancy**](/inventory/discrepancies) | `StockDiscrepancy`, `Item` | Shortage, damage & breakage reporting with write-off approvals. |
| **6** | [**Delivery Challan**](/sales/challan) | `DeliveryChallan`, `Invoice` | Official dispatch slips with vehicle/driver details, gate passes & automated credit notes upon approval. |
| **7** | [**E-Way Bills**](/sales/eway-bill) | `EWayBill`, `Invoice` | Statutory GST movement clearance for dispatches over ₹50,000. |

---

## ⏱️ 7. Universal Shift Attendance & Performance Widget
- Embedded across dashboards and warehouse portals via `components/shared/AttendancePunchWidget.tsx`.
- Features:
  - **One-Click Check-In & Check-Out:** Captures exact timestamp and calculates shift working hours in minutes.
  - **Leave Application Modal:** Submit Casual, Sick, or Paid leave requests.
  - **Advance Salary Loan Request:** Request emergency advance loans directly from the widget.

---

## 👥 8. Staff KYC & Onboarding Master (`/settings/users`)
- 3-Tab Onboarding Modal:
  1. **Login & Role:** Name, Email, Bcrypt Password, Role selection, Branch / Godown assignment.
  2. **Personal & KYC Proof:** Mobile, Avatar photo, Address, ID Proof (Aadhaar Card, PAN Card, Voter ID #).
  3. **Salary & Advance Loans:** Base Monthly Salary, Salary Type (Fixed / Incentive), Bank A/C & IFSC, Opening Advance Loan Balance, Monthly EMI Deduction.

---

## 🔐 9. Minimum Floor Price & Salesperson Incentive System

### 1. Minimum Selling Price (Floor Price Protection)
- Admin can set a `minSellingPrice` for every product.
- If a rate below `minSellingPrice` is entered, Supervisor PIN (`1234`) is required to authorize the override.

### 2. Target-Based Salesperson Incentive Architecture
- Fixed ₹ or Percentage % incentive earned when `sellingRate >= incentiveTargetAmount`.
- Live leaderboard ranking staff in `/staff/incentives`.
