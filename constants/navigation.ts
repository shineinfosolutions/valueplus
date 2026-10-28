import {
  LayoutDashboard,
  Package,
  Tag,
  Award,
  Ruler,
  Layers,
  Warehouse,
  Users,
  Truck,
  FileText,
  ShoppingCart,
  PackageCheck,
  Receipt,
  CreditCard,
  FileMinus,
  ShoppingBag,
  ClipboardList,
  FileX,
  DollarSign,
  BarChart2,
  ArrowLeftRight,
  RefreshCw,
  RotateCcw,
  Percent,
  Hash,
  BarChart,
  UserCheck,
  CheckSquare,
  Sparkles,
  ClipboardCheck,
  AlertTriangle,
  BadgePercent,
  Clock,
  Landmark,
  BookOpen,
  Lock,
  Calendar,
  ShieldCheck,
  Building2,
  User,
  Settings,
  AlertCircle,
  TrendingUp,
  ExternalLink,
  Mail,
  type LucideIcon,
} from "lucide-react";

export type UserRole = "admin" | "warehouse" | "salesman" | "cashier" | "accounts" | "hr" | "supplier" | "manager" | "sales" | "driver";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: number;
  roles?: UserRole[];
  /** A site outside the ERP: opened in a new tab (in the app, the phone's browser). */
  external?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  roles?: UserRole[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    roles: ["admin", "warehouse", "salesman", "cashier", "accounts", "hr", "supplier", "manager", "sales"],
    items: [
      { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["admin", "warehouse", "salesman", "cashier", "accounts", "hr", "supplier", "manager", "sales"] },
    ],
  },
  {
    title: "Sales & Billing",
    roles: ["admin", "salesman", "cashier", "accounts", "manager"],
    items: [
      { title: "Tax Invoices (POS)", href: "/sales/invoices", icon: Receipt, roles: ["admin", "cashier", "accounts", "manager"] },
      { title: "Receive Payment (Counter)", href: "/sales/payments", icon: CreditCard, roles: ["admin", "cashier", "accounts", "manager"] },
      { title: "Credit Notes", href: "/sales/credit-notes", icon: FileMinus, roles: ["admin", "cashier", "accounts", "manager"] },
      { title: "Estimates / Quotes", href: "/sales/estimates", icon: FileText, roles: ["admin", "salesman", "manager"] },
      { title: "Sales Orders", href: "/sales/orders", icon: ShoppingCart, roles: ["admin", "salesman", "manager"] },
      { title: "Order Dispatch & Deliveries", href: "/sales/dispatch", icon: Truck, roles: ["admin", "manager", "warehouse", "salesman", "sales"] },
      { title: "Delivery Challan", href: "/sales/challan", icon: PackageCheck, roles: ["admin", "manager"] },
    ],
  },
  {
    title: "Purchase & Expenses",
    roles: ["admin", "warehouse", "accounts", "cashier", "supplier", "manager"],
    items: [
      { title: "Low Stock (Auto Reorder)", href: "/purchase/low-stock", icon: AlertTriangle, roles: ["admin", "warehouse", "accounts", "manager"] },
      { title: "Purchase Orders", href: "/purchase/orders", icon: ShoppingBag, roles: ["admin", "warehouse", "accounts", "supplier", "manager"] },
      { title: "Purchase Entry (GRN)", href: "/purchase/entries", icon: ClipboardList, roles: ["admin", "warehouse", "accounts", "manager"] },
      { title: "Debit Notes", href: "/purchase/debit-notes", icon: FileX, roles: ["admin", "accounts", "supplier", "manager"] },
      { title: "Expenses (Petty Cash)", href: "/purchase/expenses", icon: DollarSign, roles: ["admin", "cashier", "accounts", "manager"] },
    ],
  },
  {
    title: "Products & Masters",
    roles: ["admin", "salesman", "cashier", "accounts", "supplier", "manager"],
    items: [
      { title: "Items (VP Code & Stock)", href: "/masters/items", icon: Package, roles: ["admin", "salesman", "cashier", "accounts", "supplier", "manager"] },
      { title: "Categories", href: "/masters/categories", icon: Tag, roles: ["admin", "manager"] },
      { title: "Brands", href: "/masters/brands", icon: Award, roles: ["admin", "manager"] },
      { title: "Units", href: "/masters/units", icon: Ruler, roles: ["admin", "manager"] },
      { title: "Warehouses & Godowns", href: "/masters/warehouses", icon: Warehouse, roles: ["admin", "manager"] },
      { title: "Customers", href: "/masters/customers", icon: Users, roles: ["admin", "salesman", "cashier", "accounts", "manager"] },
    ],
  },
  {
    title: "Finance & EMI Hub",
    roles: ["admin", "cashier", "accounts", "manager"],
    items: [
      { title: "Customer Dues & Overdue", href: "/finance/dues", icon: AlertTriangle, roles: ["admin", "cashier", "accounts", "manager"] },
      { title: "Monthly EMI Cycles", href: "/finance/emi-cycles", icon: Calendar, roles: ["admin", "cashier", "accounts", "manager"] },
      { title: "Finance Ledger", href: "/finance/ledger", icon: Landmark, roles: ["admin", "accounts", "manager"] },
      { title: "Bank NACH & Payouts", href: "/finance/disbursements", icon: ShieldCheck, roles: ["admin", "accounts", "manager"] },
    ],
  },
  {
    // Suppliers are who we buy from (payable). They keep their own section
    // rather than sitting under Masters because the ledger, payments and
    // ageing screens are the point of the module, not just the party list.
    title: "Suppliers & Ledger",
    roles: ["admin", "accounts", "manager"],
    items: [
      { title: "Supplier Master", href: "/suppliers", icon: Building2, roles: ["admin", "accounts", "manager"] },
      { title: "All Ledgers", href: "/vendors/ledger", icon: BookOpen, roles: ["admin", "accounts", "manager"] },
      { title: "Supplier Payments", href: "/vendors/payments", icon: CreditCard, roles: ["admin", "accounts", "manager"] },
      { title: "Outstanding & Ageing", href: "/vendors/outstanding", icon: Clock, roles: ["admin", "accounts", "manager"] },
    ],
  },
  {
    title: "Godown & Logistics Hub",
    roles: ["admin", "warehouse"],
    items: [
      { title: "Godown Master Hub", href: "/warehouse", icon: Warehouse, roles: ["admin", "warehouse"] },
      { title: "Stock Flow (In/Out)", href: "/inventory/stock-flow", icon: ArrowLeftRight, roles: ["admin", "warehouse"] },
      { title: "Stock Transfer (Inter-Godown)", href: "/inventory/transfer", icon: ArrowLeftRight, roles: ["admin", "warehouse"] },
      { title: "Daily Physical Audit", href: "/inventory/audit", icon: ClipboardCheck, roles: ["admin", "warehouse"] },
      { title: "Order Dispatch & Deliveries", href: "/sales/dispatch", icon: Truck, roles: ["admin", "warehouse", "manager"] },
      { title: "Delivery Challan", href: "/sales/challan", icon: PackageCheck, roles: ["admin", "warehouse"] },
      { title: "E-Way Bills", href: "/sales/eway-bill", icon: Truck, roles: ["admin", "warehouse"] },
    ],
  },
  {
    title: "Delivery Boy Portal",
    roles: ["admin", "driver", "manager", "warehouse"],
    items: [
      { title: "My Assigned Deliveries", href: "/driver/deliveries", icon: Truck, roles: ["admin", "driver", "manager", "warehouse"] },
      { title: "My Salary & Advances", href: "/driver/salary", icon: DollarSign, roles: ["admin", "driver", "hr", "manager"] },
      { title: "My Profile & Vehicle", href: "/staff/profile", icon: ShieldCheck, roles: ["admin", "driver", "hr", "manager"] },
    ],
  },
  {
    title: "CRM & Customer Service",
    roles: ["admin", "salesman", "cashier", "manager", "hr", "accounts", "warehouse"],
    items: [
      { title: "Customer Queries", href: "/marketing/walk-in", icon: Users, roles: ["admin", "salesman", "cashier", "manager"] },
      { title: "Customer Complaints", href: "/marketing/complaints", icon: AlertCircle, roles: ["admin", "salesman", "cashier", "manager", "hr", "accounts", "warehouse"] },
      { title: "Sales Leads", href: "/marketing/leads", icon: Sparkles, roles: ["admin", "salesman", "manager"] },
    ],
  },
  {
    title: "Staff & Attendance",
    roles: ["admin", "hr", "salesman", "cashier", "warehouse", "accounts", "manager"],
    items: [
      { title: "My Profile & KYC", href: "/staff/profile", icon: ShieldCheck, roles: ["admin", "hr", "salesman", "cashier", "warehouse", "accounts", "manager"] },
      { title: "Daily Attendance & Shifts", href: "/staff/attendance", icon: UserCheck, roles: ["admin", "hr", "salesman", "cashier", "warehouse", "accounts", "manager"] },
      { title: "Staff Tasks Delegation", href: "/staff/tasks", icon: CheckSquare, roles: ["admin", "hr", "salesman", "manager"] },
      { title: "Sales Incentives", href: "/staff/incentives", icon: Award, roles: ["admin", "hr", "salesman", "manager", "cashier", "sales"] },
      { title: "Salary & Payroll", href: "/staff/salary", icon: DollarSign, roles: ["admin", "hr", "accounts", "manager"] },
    ],
  },
  {
    title: "GST & Financial Reports",
    roles: ["admin", "accounts", "manager"],
    items: [
      { title: "Profit & Loss (P&L)", href: "/accounting/profit-loss", icon: TrendingUp, roles: ["admin", "accounts", "manager"] },
      { title: "GST Reports (GSTR 1/2/3B)", href: "/gst/reports", icon: Percent, roles: ["admin", "accounts", "manager"] },
      { title: "HSN Summary Report", href: "/gst/hsn-summary", icon: Hash, roles: ["admin", "accounts", "manager"] },
      { title: "Sales Out Report", href: "/reports/sales-out", icon: Receipt, roles: ["admin", "accounts", "manager"] },
      { title: "All Reports & Analytics", href: "/reports", icon: BarChart, roles: ["admin", "accounts", "manager"] },
      { title: "Documents", href: "/documents", icon: FileText, roles: ["admin", "accounts"] },
    ],
  },
  {
    title: "Store Profile & Settings",
    roles: ["admin", "hr", "manager"],
    items: [
      { title: "Store Activity Approvals", href: "/admin/approvals", icon: ShieldCheck, roles: ["admin"] },
      { title: "Users & Staff KYC Master", href: "/settings/users", icon: Users, roles: ["admin", "hr"] },
      { title: "Company Profile", href: "/settings/profile", icon: Building2, roles: ["admin", "manager"] },
      { title: "Role Permissions", href: "/settings/roles", icon: ShieldCheck, roles: ["admin"] },
      { title: "Security PIN", href: "/settings/security-pin", icon: Lock, roles: ["admin", "manager", "accounts", "cashier"] },
      { title: "Bank Accounts Master", href: "/banking/accounts", icon: Landmark, roles: ["admin", "accounts", "manager"] },
      { title: "System Settings", href: "/settings", icon: Settings, roles: ["admin"] },
    ],
  },
  {
    title: "External Portals",
    roles: ["admin", "manager", "accounts"],
    items: [
      { title: "Value Plus Retail (CP)", href: "/external/valueplus-retail", icon: ExternalLink, roles: ["admin", "manager", "accounts"] },
      // Gmail cannot be shown inside another page, so it opens in its own tab. Google
      // keeps the user signed in there; this app never sees or stores the login.
      { title: "Mail (Gmail)", href: "https://mail.google.com/mail/u/0/#inbox", icon: Mail, roles: ["admin", "manager", "accounts"], external: true },
    ],
  },
];

export const COMPANY_NAME = "M/S ASHOKA ENTERPRISES (VALUE PLUS)";
export const COMPANY_GSTIN = "09ANHPJ7242D1Z2";
export const COMPANY_PAN = "ANHPJ7242D";
export const COMPANY_ADDRESS = "H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR";
export const COMPANY_PHONE = "9140860604";
export const CURRENCY = "INR";
export const CURRENCY_SYMBOL = "₹";

export const GST_RATES = [0, 5, 12, 18, 28];

export const INDIAN_STATES = [
  "Uttar Pradesh", "Delhi", "Bihar", "Madhya Pradesh", "Maharashtra",
  "Rajasthan", "Haryana", "Punjab", "West Bengal", "Gujarat",
  "Uttarakhand", "Jharkhand", "Chhattisgarh", "Karnataka", "Tamil Nadu",
];

export const PAYMENT_MODES = ["Cash", "UPI", "Online", "Card", "Finance"] as const;
