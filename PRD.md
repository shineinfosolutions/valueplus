# ValuePlus ERP - Product Requirement Document (PRD)

> **Version:** 1.0.0  
> **Status:** Active / Living Document  
> **Project Name:** ValuePlus ERP (`valueplus-erp`)  
> **Target Market:** Indian Micro, Small, and Medium Enterprises (MSMEs), Retailers, Wholesalers, Distributors & Enterprise Accounting.

---

## 1. Executive Summary & Vision

**ValuePlus ERP** is a modern, enterprise-grade Enterprise Resource Planning (ERP) application engineered specifically for the Indian business ecosystem. It brings together end-to-end sales lifecycle, procurement management, multi-warehouse inventory tracking, double-entry accounting, banking, GST compliance, marketing automation, and AI-driven business intelligence into a single intuitive interface.

### Key Objectives
* **Streamline Operations:** Eliminate manual bookkeeping and disconnected spreadsheets by providing a unified workspace.
* **GST & Tax Compliance:** Full support for Indian GST rules, automated HSN/SAC tax engine, CGST/SGST/IGST auto-calculation, and GSTR report generation.
* **Real-time Inventory Control:** Multi-warehouse tracking, stock journals, adjustments, stock transfers, and Bill of Material (BOM) assembly.
* **AI-Assisted Operations:** Integrated ValuePlus Assistant and AI Insights for automated sales forecasts, stock reorder alerts, and quick querying.
* **Scalable Tech Stack:** Built with Next.js 15, React 19, TypeScript, and Tailwind CSS for blazingly fast, responsive performance.

---

## 2. Technology Stack & Architecture

| Layer | Technology / Library | Version / Details |
| :--- | :--- | :--- |
| **Framework** | Next.js (App Router with Turbopack) | `15.3.6` |
| **UI Core** | React | `^19.0.0` |
| **Language** | TypeScript | `^5.0.0` |
| **Styling** | Tailwind CSS + `tailwindcss-animate` | `^3.4.1` |
| **Component Primitives** | Radix UI / Shadcn UI | Accordion, Dialog, Popover, Select, Tabs, Toast, etc. |
| **Icons** | Lucide React | `^0.446.0` |
| **State & Data Fetching** | TanStack Query (React Query) | `^5.56.2` |
| **Data Tables** | TanStack Table (React Table) | `^8.20.5` |
| **Form & Validation** | React Hook Form + Zod + `@hookform/resolvers` | Zod `^3.23.8`, RHF `^7.53.0` |
| **Visualizations & Charts** | Recharts | `^3.1.0` |
| **Animations** | Framer Motion | `^11.9.0` |
| **Notifications** | Sonner | `^1.5.0` |

---

## 3. User Roles & Permission Matrix

ValuePlus ERP supports role-based access control (RBAC) to ensure security across departments:

1. **Administrator:** Full access to all modules, system configurations, user management, and company settings.
2. **Finance / Accountant:** Access to Accounting (Journal, Ledger, Trial Balance, P&L, Balance Sheet), Banking, GST Reports, and Invoicing.
3. **Sales Manager / Rep:** Access to Masters (Customers, Items), Sales (Estimates, Orders, Invoices, Delivery Challans, Credit Notes, Payments).
4. **Purchase Manager:** Access to Suppliers, Purchase Orders, Purchase Entries, Debit Notes, and Expenses.
5. **Inventory / Warehouse Manager:** Access to Warehouse masters, Stock Adjustments, Transfers, Journals, Requests, Returns, and BOM.
6. **Marketing Executive:** Access to Customer Loyalty programs, WhatsApp campaigns, and Customer master.

---

## 4. Comprehensive Module Breakdown

```
ValuePlus ERP Architecture
 ├── 📊 Overview (Dashboard)
 ├── 📦 Masters (Items, Categories, Brands, Units, Variants, Warehouses, Customers, Suppliers)
 ├── 🛒 Sales (Estimates, Sales Orders, Challan, Invoices, Payments, Credit Notes)
 ├── 🛍️ Purchase (Purchase Orders, Purchase Entries, Debit Notes, Expenses)
 ├── 🏬 Inventory (Adjustment, Transfer, Journal, Request, Return, BOM)
 ├── 🏦 Banking (Receipts, Payments, Bank Accounts)
 ├── 📒 Accounting (Journal Entries, Ledger, Trial Balance, P&L, Balance Sheet, Cash Flow)
 ├── 🧾 GST (GSTR-1, GSTR-2, GSTR-3B Reports)
 ├── 📢 Marketing (Loyalty Program, WhatsApp Campaigns)
 ├── 📈 Reports (Custom Analytics & Downloads)
 ├── 🤖 AI Features (AI Insights, ValuePlus Assistant)
 └── ⚙️ Settings (Company, Users, Profile, General Settings)
```

### Module Details

#### 4.1 Overview & Dashboard (`/dashboard`)
* **Key Metrics Widgets:** Total Revenue, Expenses, Net Profit, Outstanding Receivables, Outstanding Payables.
* **Interactive Charts:** Revenue vs Expense monthly comparison, Sales trends, Inventory distribution.
* **Action Launcher & Alerts:** Low stock notifications, pending approvals, recent transaction logs.

#### 4.2 Masters Management (`/masters/*`)
* **Items Master (`/masters/items`):** Item code, name, category, brand, unit, HSN/SAC code, GST rate (0%, 5%, 12%, 18%, 28%), purchase price, selling price, MRP, opening stock, current stock, reorder level, warehouse assignment.
* **Categories (`/masters/categories`):** Hierarchical category & subcategory management.
* **Brands (`/masters/brands`):** Brand list with logo uploading and brand-wise reporting.
* **Units of Measurement (`/masters/units`):** Unit definitions (Pcs, Kg, Ltr, Mtr, Box, etc.) classified by type.
* **Variants (`/masters/variants`):** Attribute sets (Size, Color, Material) for product variant generation.
* **Warehouses (`/masters/warehouses`):** Multi-location storage tracking with address, pincode, state, contact person, default status.
* **Customers (`/masters/customers`):** Customer directory with GSTIN, PAN, billing/shipping addresses, credit limit, credit days, outstanding balance, loyalty points.
* **Suppliers (`/masters/suppliers`):** Supplier directory with GSTIN, PAN, bank details (IFSC, Account Number), credit terms, outstanding payables.

#### 4.3 Sales Cycle (`/sales/*`)
* **Estimates / Quotations (`/sales/estimates`):** Quotation creation with expiry dates, line item tax calculations, and status tracking (Draft, Sent, Accepted, Rejected, Expired).
* **Sales Orders (`/sales/orders`):** Confirmed customer orders linked to warehouse inventory.
* **Delivery Challan (`/sales/challan`):** Goods dispatch note with vehicle & driver details.
* **Tax Invoices (`/sales/invoices`):** GST compliant tax invoice generation, Proforma invoice support, auto-calculation of CGST, SGST, IGST based on customer state vs company state.
* **Payment Receipts (`/sales/payments`):** Collection logging via Cash, Bank Transfer, UPI, Cheque, Card. Auto-reconciliation with unpaid invoices.
* **Credit Notes (`/sales/credit-notes`):** Sales return and invoice adjustments with reason recording.

#### 4.4 Purchase Cycle (`/purchase/*`)
* **Purchase Orders (`/purchase/orders`):** Procurement orders sent to suppliers with expected delivery dates.
* **Purchase Entries / Bills (`/purchase/entries`):** Inward bill entries updating stock and supplier accounts payable.
* **Debit Notes (`/purchase/debit-notes`):** Purchase returns and bill reductions.
* **Expenses (`/purchase/expenses`):** Operational expenses logging categorized by expense heads with GST taxability support.

#### 4.5 Inventory & Stock Control (`/inventory/*`)
* **Stock Adjustment (`/inventory/adjustment`):** Quantity additions or reductions due to physical audit, damage, or discrepancy.
* **Stock Transfer (`/inventory/transfer`):** Inter-warehouse inventory movement tracking (Draft -> In-Transit -> Received).
* **Stock Journal (`/inventory/journal`):** Automated ledger for all stock movements.
* **Stock Request (`/inventory/request`):** Internal requisition requests from store managers.
* **Stock Return (`/inventory/return`):** Stock returns handling.
* **Bill of Materials (BOM) (`/inventory/bom`):** Assembly and manufacturing recipe definitions for composite items.

#### 4.6 Banking & Cash (`/banking/*`)
* **Bank Accounts (`/banking/accounts`):** Registry of Current, Savings, and Cash accounts with real-time balance.
* **Receipts & Payments (`/banking/receipts`, `/banking/payments`):** Direct bank ledger credits and debits.

#### 4.7 Accounting & Financial Statements (`/accounting/*`)
* **Journal Entries (`/accounting/journal`):** Double-entry accounting system with automated Debit/Credit balancing.
* **General Ledger (`/accounting/ledger`):** Account-wise transaction history.
* **Trial Balance (`/accounting/trial-balance`):** Debit vs Credit verification report.
* **Profit & Loss Statement (`/accounting/profit-loss`):** Income vs Expense statement for financial periods.
* **Balance Sheet (`/accounting/balance-sheet`):** Assets, Liabilities, and Equity overview.
* **Cash Flow (`/accounting/cash-flow`):** Operating, investing, and financing cash movement tracking.

#### 4.8 GST Compliance (`/gst/*`)
* **GSTR-1 Reports:** Outward supplies summary categorized by B2B, B2C Large, B2C Small, HSN Summary.
* **GSTR-2 Reports:** Inward supplies and Input Tax Credit (ITC) tracking.
* **GSTR-3B Summary:** Monthly consolidated tax liability statement.

#### 4.9 Marketing & Retainership (`/marketing/*`)
* **Loyalty Program (`/marketing/loyalty`):** Points accrual, redemption rules, and customer tiers.
* **WhatsApp Integration (`/marketing/whatsapp`):** Automated WhatsApp notifications for order confirmation, invoice PDFs, and payment reminders.

#### 4.10 AI-Powered Features (`/ai/*`)
* **AI Insights (`/ai/insights`):** Smart anomaly detection, low-stock reorder forecasts, slow-moving item alerts.
* **ValuePlus Assistant (`/ai/assistant`):** Natural Language conversational AI bot for instant reporting, creation shortcuts, and queries.

#### 4.11 System Settings & Admin (`/settings/*`)
* **Company Profile (`/settings/company`):** Business Name, Legal Name, GSTIN, PAN, CIN, Address, State Code, Financial Year, Logo upload.
* **User Management (`/settings/users`):** System user creation, role assignment, status toggle.
* **User Profile (`/settings/profile`):** Personal profile management.

---

## 5. Indian Business Localization & Rules

1. **GST Calculation Engine:**
   * **Intra-State Sale (Same State):** split GST equally into **CGST** and **SGST** (e.g., 18% GST -> 9% CGST + 9% SGST).
   * **Inter-State Sale (Different State):** apply **IGST** (e.g., 18% GST -> 18% IGST).
   * Standard GST Slab rates: `[0%, 5%, 12%, 18%, 28%]`.
2. **Currency Formatting:**
   * INR (`₹`) symbol.
   * Indian Numbering System (`1,00,000` for 1 Lakh, `1,00,00,000` for 1 Crore).
3. **Financial Year Cycle:**
   * Defaults to April 1st to March 31st (e.g., FY 2026-27).
4. **State Code Mapping:**
   * Pre-configured lookup for all 36 Indian States & Union Territories.

---

## 6. Non-Functional Requirements (NFRs)

* **Performance:** Page load under 1.5 seconds, optimized with Next.js Turbopack and client-side caching.
* **Responsiveness:** Dynamic fluid layouts that work seamlessly on Desktop, Tablet, and Mobile screens.
* **Security:** Input validation using Zod schemas, standard HTTP security headers, role-based protection.
* **Data Integrity:** Strict mathematical checks for line items, invoice totals, tax calculations, and round-offs.

---

## 7. Future System Enhancements Roadmap

- [ ] Real-time Database Persistence (Prisma ORM + PostgreSQL / Supabase).
- [ ] Direct GST Portal Sync (NIC E-Way Bill & E-Invoice API Integration).
- [ ] Payment Gateway Integration (Razorpay, Cashfree, PhonePe Payment Gateway).
- [ ] Offline-first POS (Point of Sale) terminal support.
- [ ] Multi-currency support for export/import trade.

---
*End of PRD*
