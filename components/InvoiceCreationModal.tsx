import React, { useState, useMemo, useEffect, useRef } from "react";
import { allowedGstRate } from "@/lib/gst-rate";
const todayInIndia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AutocompleteSearch } from "@/components/shared/autocomplete-search";
import { 
  Receipt, Users, CreditCard, Sparkles, ShoppingCart, Plus, Trash2, Printer,
  XCircle, Phone, UserCheck, UserPlus, X, Shield, AlertTriangle, FileText, CheckCircle2, Truck, Clock, ChevronsDownUp, Wallet, Upload
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BillingEntityPicker } from "@/components/shared/BillingEntityPicker";
import { AuthorizePinDialog, type PinAuthResult } from "@/components/AuthorizePinDialog";
import { BILLING_ENTITIES, entityOf, entityLabel, type BillingEntity } from "@/lib/billing-entity";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { INDIA_STATES, INDIA_STATES_AND_DISTRICTS, normalizeStateName, normalizeCityName } from "@/lib/data/locations";
import { saveOfflineInvoice, getCachedCatalogItems, getCachedCustomers, cacheCustomers } from "@/lib/offline-storage";
import ValueplusInvoice from "@/app/invoice/page";
import { useSession } from "next-auth/react";
import { useBranch } from "@/context/BranchContext";

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val || 0);
}

export const WARRANTY_PROVIDERS = [
  "OneAssist",
  "Onsitego",
  "Zopper",
  "Value Plus Protect",
  "Brand Extended Care",
  "GoCare Protection",
  "Other / Custom"
];

export const WARRANTY_DURATIONS = [
  { label: "1 Year Extended Cover", value: 1 },
  { label: "2 Years Extended Cover", value: 2 },
  { label: "3 Years Extended Cover", value: 3 },
  { label: "4 Years Extended Cover", value: 4 },
  { label: "5 Years Extended Cover", value: 5 },
];

export const WARRANTY_PLANS = [
  { id: "none", name: "No Warranty", duration: 0, price: 0 },
  { id: "ew_1yr", name: "1 Year Extended Warranty", duration: 1, price: 1499 },
  { id: "ew_2yr", name: "2 Year Extended Warranty", duration: 2, price: 2799 },
  { id: "screen_care", name: "1 Year Screen & Accidental Care", duration: 1, price: 1999 },
  { id: "complete_care", name: "Comprehensive ValuePlus Protection (2 Yrs)", duration: 2, price: 3499 },
];

export function InvoiceCreationModal({ 
  isOpen, 
  onClose, 
  onSuccess, 
  mode = "invoice",
  preloadedEstimate = null,
  editEstimate = null,
  editInvoice = null,
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onSuccess?: () => void; 
  mode?: "invoice" | "estimate" | "sales-order" | "credit-note";
  preloadedEstimate?: any;
  /** An existing estimate to edit: the form opens filled with it and saving
   *  updates it (same number) instead of creating a new one. */
  editEstimate?: any;
  /** A saved tax invoice to edit: the form opens filled with it and saving
   *  re-does the bill on the server (PIN + reason), keeping its number. */
  editInvoice?: any;
}) {
  const isEditingEstimate = mode === "estimate" && Boolean(editEstimate);
  const isEditingInvoice = mode === "invoice" && Boolean(editInvoice);
  const queryClient = useQueryClient();
  const [offlineInvoiceToPrint, setOfflineInvoiceToPrint] = useState<any>(null);
  const [generatedInvoiceToPrint, setGeneratedInvoiceToPrint] = useState<any>(null);

  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const currentUserName = session?.user?.name || "Staff Member";
  const { activeLocation } = useBranch();
  
  const isSuperAdmin = userRole === "admin" || userRole === "superadmin";
  const isManager = userRole === "manager" || userRole === "store_manager" || userRole === "storemanager";
  const isCashier = userRole === "cashier" || userRole === "pos" || userRole === "billing";
  const isAccountant = userRole === "accountant" || userRole === "accounts";
  
  // Cashiers, Admins, Managers, and Accountants can freely choose & change the Salesperson on any bill:
  const canChangeSalesExecutive = isSuperAdmin || isManager || isCashier || isAccountant;
  const isIndividualStaff = !canChangeSalesExecutive;

  const { data: usersList = [] } = useQuery({
    queryKey: ["users-list-for-invoice-modal"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/users");
        const json = await res.json();
        return json.success && Array.isArray(json.data) ? json.data : [];
      } catch (e) {
        return [];
      }
    },
  });

  const { data: customers = getCachedCustomers() } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/customers");
        const json = await res.json();
        return json.success ? json.data : getCachedCustomers();
      } catch (e) {
        return getCachedCustomers();
      }
    }
  });

  const { data: catalogItems = getCachedCatalogItems() } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/items");
        const json = await res.json();
        return json.success ? json.data : getCachedCatalogItems();
      } catch (e) {
        return getCachedCatalogItems();
      }
    }
  });

  const { data: billingCompanies = [] } = useQuery({
    queryKey: ["billing-companies"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/billing-companies");
        const json = await res.json();
        return json.success ? json.data : [];
      } catch (e) {
        return [];
      }
    }
  });

  const { data: serialNumbers = [] } = useQuery({
    queryKey: ["serialNumbers"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/serial-numbers?status=AVAILABLE");
        const json = await res.json();
        return json.success ? json.data : [];
      } catch (e) {
        return [];
      }
    }
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: estimatesList = [] } = useQuery({
    queryKey: ["estimates"],
    queryFn: async () => {
      const res = await fetch("/api/estimates");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: ordersList = [] } = useQuery({
    queryKey: ["orders"],
    queryFn: async () => {
      const res = await fetch("/api/orders");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const INITIAL_BILLING_FORM = {
    invoiceNo: "",
    // Today in India time (toISOString is UTC — "yesterday" before 5:30 am).
    invoiceDate: todayInIndia(),
    // Defaults to today, not some days-out guess — the picker still lets it be
    // moved up to 7 days ahead, but an untouched field should mean "due now",
    // not silently promise a week's grace the customer never actually asked for.
    dueDate: todayInIndia(),
    customerId: "",
    customerName: "",
    customerPhone: "",
    customerAltPhone: "",
    customerEmail: "",
    customerGstin: "",
    customerPan: "",
    customerCompanyName: "",
    customerAddress: "",
    customerCity: "Gorakhpur",
    customerState: "Uttar Pradesh",
    customerPin: "273001",
    isShippingSameAsBilling: true,
    shippingAddress: "",
    shippingCity: "Gorakhpur",
    shippingState: "Uttar Pradesh",
    shippingPin: "273001",
    dispatchType: "immediate" as "immediate" | "delayed_delivery",
    // For a delayed delivery: when the goods are to be handed over (optional).
    expectedDeliveryDate: "",
    driverName: "",
    driverPhone: "",
    placeOfSupply: "Uttar Pradesh(09)",
    vehicleNumber: "",
    
    // Primary Payment Mode: "Cash" | "UPI" | "Online" | "Credit Card" | "Debit Card" | "Finance" | "Due / Credit"
    // Starts unselected on purpose — the cashier must actively pick the real mode
    // used, instead of every bill silently defaulting to "Cash" when nobody taps a button.
    paymentMode: "" as "" | "Cash" | "UPI" | "Online" | "Credit Card" | "Debit Card" | "Finance" | "Due / Credit",
    paymentStatus: "Paid",
    
    // Cash specifics
    cashReceivedBy: "Amit Singh (Counter #1)",
    cashRemarks: "",
    
    // UPI specifics
    upiTxnId: "",
    upiRemarks: "",
    
    // Online specifics
    onlineTxnId: "",
    onlineRefId: "",
    onlineGateway: "Razorpay POS",
    onlineRemarks: "",
    
    // Credit Card specifics + Admin Configurable MDR
    creditCardType: "HDFC POS EDC",
    creditCardTxnId: "",
    creditCardLast4: "",
    creditCardMdrPercent: 2.0, // Configurable MDR % by Admin
    creditCardRemarks: "",
    
    // Debit Card specifics
    debitCardType: "HDFC POS EDC",
    debitCardTxnId: "",
    debitCardLast4: "",
    debitCardMdrPercent: 0.0, // 0% standard for debit
    debitCardRemarks: "",
    
    // Finance specifics
    financeProvider: "Bajaj Finance Limited",
    financeDoId: "",
    financeAppId: "",
    financeGrossLoan: 0,
    financeDownPayment: 0,
    financeDownPaymentMode: "Cash",
    financeTenureMonths: 8,
    financeSchemeType: "no_cost",
    financeInterestRate: 0,
    financeApprovalStatus: "Approved" as "Pending" | "Under Review" | "Approved" | "Disbursed" | "Reconciled",
    financePdfUrl: "",
    financeRemarks: "",

    // Due / Credit specifics
    dueAdvanceAmount: 0,
    dueAdvanceMode: "Cash",
    dueRemarks: "",
    
    downPayment: 0,
    downPaymentMode: "Cash",
    shippingCharges: 0,
    freightCharges: 0,
    salesExecutive: "AMIT SINGH",
    advanceAmount: 0,
    linkedEstimateNumber: "",
    lineItems: [] as any[],
  };

  const [billingForm, setBillingForm] = useState(INITIAL_BILLING_FORM);
  const [estimateIncludesAdvance, setEstimateIncludesAdvance] = useState(false);
  const [preBookingAdvanceAmount, setPreBookingAdvanceAmount] = useState<number>(5000);
  const [preBookingPaymentMode, setPreBookingPaymentMode] = useState<string>("UPI");
  const [preBookingTransactionRef, setPreBookingTransactionRef] = useState<string>("");

  // ─── VALUE PLUS OR ASHOKA ENTERPRISES ───────────────────────────────────
  // Asked first, before anything else on the bill: it decides which products the
  // list offers and which number series the bill is drawn from. Never assumed —
  // it stays empty until someone picks it (or a product already on the bill,
  // e.g. from "Bill Now", settles it).
  const [billingEntity, setBillingEntity] = useState<BillingEntity | "">("");

  /**
   * Local placeholder only — shown for the instant before the server responds.
   *
   * The real number is allocated by /api/invoices/next-number from the highest
   * number actually stored. Deriving it here from the cached list length (plus a
   * hardcoded +602 offset) produced numbers that already existed, and the save
   * endpoint then returned that older invoice as a "success" — so the bill printed
   * but was never recorded.
   */
  const generateDocNumber = (type: string) => {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    if (type === "estimate") {
      return `EST-2026-${String(estimatesList.length + 1).padStart(4, "0")}-${randomSuffix}`;
    } else if (type === "sales-order") {
      return `SO-2026-${String(ordersList.length + 1).padStart(4, "0")}-${randomSuffix}`;
    } else if (type === "credit-note") {
      return `CN-2026-${String(invoices.filter((i:any) => i.type === "credit-note").length + 1).padStart(4, "0")}-${randomSuffix}`;
    } else {
      return "";
    }
  };

  /** Ask the server for the next free document number. */
  const fetchNextDocNumber = async (docMode: string): Promise<string> => {
    const apiType =
      docMode === "estimate" ? "estimate"
      : docMode === "sales-order" ? "sales-order"
      : docMode === "credit-note" ? "credit-note"
      : "tax-invoice";
    try {
      const res = await fetch(`/api/invoices/next-number?type=${apiType}&entity=${billingEntity || "valueplus"}`);
      const json = await res.json();
      if (json.success && json.number) return json.number;
    } catch (e) {
      console.warn("Could not allocate document number from server:", e);
    }
    return generateDocNumber(docMode);
  };

  useEffect(() => {
    if (!isOpen) {
      setBillingForm(INITIAL_BILLING_FORM);
      setBillingEntity("");
      setEstimateIncludesAdvance(false);
    } else {
      if (isIndividualStaff && currentUserName) {
        setBillingForm((prev) => ({ ...prev, salesExecutive: currentUserName }));
      }
    }
  }, [isOpen, isIndividualStaff, currentUserName]);

  useEffect(() => {
    // No number until the company is known — each has its own series.
    if (!isOpen || billingForm.invoiceNo || !billingEntity || isEditingInvoice) return;
    let cancelled = false;
    (async () => {
      const number = await fetchNextDocNumber(mode);
      if (cancelled) return;
      setBillingForm(prev => (
        prev.invoiceNo
          ? prev
          : {
              ...prev,
              invoiceNo: number,
              salesExecutive: isIndividualStaff ? currentUserName : prev.salesExecutive,
            }
      ));
    })();
    return () => { cancelled = true; };
  }, [isOpen, billingForm.invoiceNo, mode, isIndividualStaff, currentUserName, billingEntity]);

  // Picking (or changing) the company. Products of the other company cannot stay
  // on the bill, and the number has to come from the new company's series.
  const chooseBillingEntity = (next: BillingEntity) => {
    if (next === billingEntity) return;
    const belongsToNext = (line: any) => {
      const product = catalogItems.find(
        (cat: any) => cat._id === line.itemId || (line.itemCode && cat.code === line.itemCode)
      );
      return !product || entityOf(product) === next;
    };
    const dropped = billingForm.lineItems.filter((line: any) => !belongsToNext(line));
    if (
      dropped.length > 0 &&
      !window.confirm(
        `Switching to ${entityLabel(next)} will remove ${dropped.length} product${dropped.length === 1 ? "" : "s"} that belong${dropped.length === 1 ? "s" : ""} to ${entityLabel(billingEntity || "valueplus")}. Continue?`
      )
    ) {
      return;
    }
    setBillingEntity(next);
    setBillingForm((prev) => ({ ...prev, invoiceNo: "", lineItems: prev.lineItems.filter(belongsToNext) }));
  };

  // A bill opened with a product already on it ("Bill Now", a converted estimate
  // or lead) takes that product's company, so the question is not asked twice.
  useEffect(() => {
    if (!isOpen || billingEntity) return;
    const firstLine = billingForm.lineItems.find((line: any) => line.itemId);
    if (!firstLine) return;
    const product = catalogItems.find((cat: any) => cat._id === firstLine.itemId);
    if (product) setBillingEntity(entityOf(product));
  }, [isOpen, billingEntity, billingForm.lineItems, catalogItems]);

  const [activeSuggestRow, setActiveSuggestRow] = useState<number | null>(null);

  // Filled-in product rows collapse to a compact single line (like Vyapaar) so many
  // products can be added quickly without the list growing too tall.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Scroll/focus the row just added via "Add Product Item" so the cashier can keep
  // adding products without manually scrolling down each time.
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const lastRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (justAddedId) {
      lastRowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [justAddedId]);

  // Admin PIN Floor Price Override States — asked once at submit time, covering every
  // below-floor line item at once, rather than interrupting per keystroke.
  const [pinPrompt, setPinPrompt] = useState<{
    items: { idx: number; proposedRate: number; minPrice: number; itemName: string }[];
  } | null>(null);
  const [enteredPin, setEnteredPin] = useState("");
  const [pinError, setPinError] = useState(false);

  // Billing & GST Calculations
  // A GSTIN entered against the bill zeroes the GST breakdown out entirely,
  // by admin's explicit instruction — the sticker price the customer pays
  // (grossAmount, below) doesn't depend on the GST rate either way, so
  // treating the rate as 0% here just reclassifies the whole amount as
  // taxable value with no tax line, without changing what's actually charged.
  const gstinProvided = Boolean(billingForm.customerGstin && billingForm.customerGstin.trim());

  const billCalculations = useMemo(() => {
    let subtotal = 0;
    let totalTaxable = 0;
    let totalGst = 0;
    let warrantyTotal = 0;
    let totalIncentive = 0;

    billingForm.lineItems.forEach((item) => {
      // Rate is GST-inclusive: split it back into taxable + GST instead of adding GST on top.
      const grossAmount = ((Number(item.rate) || 0) - (Number(item.discount) || 0)) * (Number(item.qty) || 1);
      const effectiveGstRate = gstinProvided ? 0 : (Number(item.gstRate) || 0);
      const lineTaxable = grossAmount / (1 + (effectiveGstRate / 100));
      const lineGst = grossAmount - lineTaxable;
      subtotal += (Number(item.rate) || 0) * (Number(item.qty) || 1);
      totalTaxable += lineTaxable;
      totalGst += lineGst;
      if (item.extendedWarrantyAmount) {
        warrantyTotal += Number(item.extendedWarrantyAmount);
      }

      // Compute salesperson incentive for this item based on target selling price
      let lineInc = 0;
      const targetAmt = Number(item.incentiveTargetAmount) || 0;
      const rewardVal = Number(item.incentiveValue) || Number(item.incentiveAmount) || 0;
      const incType = item.incentiveType || "fixed";
      const currentRate = Number(item.rate) || 0;
      const qty = Number(item.qty) || 1;

      if (rewardVal > 0 && incType !== "none") {
        const isTargetMet = targetAmt <= 0 || currentRate >= targetAmt;
        if (isTargetMet) {
          if (incType === "percentage") {
            lineInc = lineTaxable * (rewardVal / 100);
          } else {
            lineInc = rewardVal * qty;
          }
        }
      }
      totalIncentive += lineInc;
    });

    const isIntraState = billingForm.placeOfSupply.includes("09") || billingForm.placeOfSupply.toLowerCase().includes("uttar pradesh");
    const cgst = isIntraState ? totalGst / 2 : 0;
    const sgst = isIntraState ? totalGst / 2 : 0;
    const igst = isIntraState ? 0 : totalGst;
    
    // Product grand total + warranty + freight/shipping
    const freight = Number(billingForm.freightCharges || billingForm.shippingCharges || 0);
    const rawTotal = totalTaxable + totalGst + warrantyTotal + freight;
    const grandTotal = Math.round(rawTotal);
    const roundOff = Number((grandTotal - rawTotal).toFixed(2));

    // Card MDR Calculation: MDR % of grand total, Net Settlement = grandTotal - MDR
    const isCreditCard = billingForm.paymentMode === "Credit Card";
    const isDebitCard = billingForm.paymentMode === "Debit Card";
    const isCard = isCreditCard || isDebitCard;

    const activeMdrPercent = isCreditCard 
      ? Number(billingForm.creditCardMdrPercent ?? 2.0) 
      : (isDebitCard ? Number(billingForm.debitCardMdrPercent ?? 0.0) : 0);

    const cardMdrAmount = Number(((grandTotal * activeMdrPercent) / 100).toFixed(2));
    const cardNetSettlement = Number((grandTotal - cardMdrAmount).toFixed(2));

    return { 
      subtotal, 
      totalTaxable, 
      totalGst, 
      cgst, 
      sgst, 
      igst, 
      warrantyTotal, 
      freight,
      totalIncentive: Math.round(totalIncentive * 100) / 100,
      roundOff, 
      grandTotal,
      activeMdrPercent,
      cardMdrAmount,
      cardNetSettlement
    };
  }, [billingForm]);

  // Customer Pre-Booking / Advance Token Query
  const cleanPhoneForAdvance = (billingForm.customerPhone || "").replace(/\D/g, "");

  // ─── LEAD → SALESMAN ────────────────────────────────────────────────────
  // If this customer has an open lead, the bill belongs to the salesman who has
  // been working it. Looked up by mobile as soon as all ten digits are typed.
  const { data: customerLead = null } = useQuery({
    queryKey: ["customer-open-lead", cleanPhoneForAdvance],
    queryFn: async () => {
      const res = await fetch(`/api/crm/leads?mobile=${cleanPhoneForAdvance}`);
      const json = await res.json();
      const leads: any[] = json.success && Array.isArray(json.data) ? json.data : [];
      return leads.find((l) => !["Converted", "Lost"].includes(l.status)) || null;
    },
    enabled: Boolean(isOpen && cleanPhoneForAdvance && cleanPhoneForAdvance.length === 10),
  });
  // Set once the cashier picks a salesman by hand; from then on the lead no
  // longer overrides their choice for this bill.
  const salesExecutivePickedByHand = useRef(false);
  const leadSalesman = (() => {
    const staff = String((customerLead as any)?.assignedStaff || "").trim();
    if (!staff || /^sales team$/i.test(staff)) return "";
    const user = (usersList as any[]).find((u) => String(u.name || "").trim().toLowerCase() === staff.toLowerCase());
    return user?.name || staff;
  })();

  useEffect(() => {
    if (!isOpen) {
      salesExecutivePickedByHand.current = false;
      return;
    }
    if (!leadSalesman || isIndividualStaff || salesExecutivePickedByHand.current) return;
    setBillingForm((prev) => (prev.salesExecutive === leadSalesman ? prev : { ...prev, salesExecutive: leadSalesman }));
  }, [isOpen, leadSalesman, isIndividualStaff]);
  const { data: customerAdvances = [] } = useQuery({
    queryKey: ["customer-advances", cleanPhoneForAdvance],
    queryFn: async () => {
      if (!cleanPhoneForAdvance || cleanPhoneForAdvance.length < 10) return [];
      const res = await fetch(`/api/crm/advances?phone=${cleanPhoneForAdvance}&status=Available`);
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
    enabled: Boolean(cleanPhoneForAdvance && cleanPhoneForAdvance.length >= 10),
  });

  const bookingAdvanceTotal = useMemo(() => {
    return customerAdvances.reduce((sum: number, a: any) => sum + (Number(a.remainingBalance) || 0), 0);
  }, [customerAdvances]);

  // Money this customer already paid through Receive Payment without a bill:
  // it sits as a negative outstandingBalance on their record. It is offered
  // as an advance too, after any Advance Booking receipts; the server re-checks
  // the real balance before using it.
  const selectedCustomerRecord = (customers as any[]).find((c: any) => c._id === billingForm.customerId);
  const accountCredit = Math.max(0, -(Number(selectedCustomerRecord?.outstandingBalance) || 0));

  // An edited bill keeps the advance it already deducted (Advance Booking or
  // Receive Payment credit); the server holds it fixed too.
  const editAdvance = isEditingInvoice ? Number(editInvoice?.advanceAdjusted) || 0 : 0;
  const totalAvailableAdvance = isEditingInvoice ? editAdvance : bookingAdvanceTotal + accountCredit;

  const [applyAdvanceCredit, setApplyAdvanceCredit] = useState(true);
  const [customAdvanceAdjusted, setCustomAdvanceAdjusted] = useState<number | null>(null);

  const maxDeductibleAdvance = Math.min(totalAvailableAdvance, billCalculations.grandTotal);
  const effectiveAdvanceAdjusted = isEditingInvoice
    ? Math.min(editAdvance, billCalculations.grandTotal)
    : (applyAdvanceCredit && (totalAvailableAdvance > 0 || customAdvanceAdjusted !== null) && mode === "invoice")
      ? (customAdvanceAdjusted !== null ? Math.min(customAdvanceAdjusted, billCalculations.grandTotal) : maxDeductibleAdvance)
      : 0;
  const netAmountPayableAfterAdvance = Math.max(0, billCalculations.grandTotal - effectiveAdvanceAdjusted);
  const activePaymentAmount = (mode === "estimate" && estimateIncludesAdvance)
    ? preBookingAdvanceAmount
    : (mode === "invoice" ? netAmountPayableAfterAdvance : billCalculations.grandTotal);

  // ─── SPLIT PAYMENT ────────────────────────────────────────────────────────
  // Off by default, so the single-mode flow above is completely unchanged.
  // When on, the bill is divided across several modes and the rows must add up
  // to the amount payable before the invoice can be saved.
  const [isSplitPayment, setIsSplitPayment] = useState(false);
  const [isUploadingFinanceDoc, setIsUploadingFinanceDoc] = useState(false);
  const [splitRows, setSplitRows] = useState<Array<{ mode: string; amount: string; txnId: string }>>([
    { mode: "Cash", amount: "", txnId: "" },
    { mode: "UPI", amount: "", txnId: "" },
  ]);

  const SPLIT_MODE_OPTIONS = ["Cash", "UPI", "Credit Card", "Debit Card", "Online", "Finance", "Due / Credit"];

  const splitAllocated = splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const splitRemaining = Number((activePaymentAmount - splitAllocated).toFixed(2));
  const isSplitBalanced = Math.abs(splitRemaining) <= 1;
  const splitCollected = splitRows
    .filter((r) => !/finance|due|credit bill/i.test(r.mode) || /credit card/i.test(r.mode))
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  // A split with a Finance row is a finance sale too: which company financed it
  // (and its DO) has to be asked here just as in single Finance mode.
  const splitHasFinance = isSplitPayment && splitRows.some((r) => r.mode === "Finance");
  const splitFinanceAmount = splitRows
    .filter((r) => r.mode === "Finance")
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

  const updateSplitRow = (idx: number, patch: Partial<{ mode: string; amount: string; txnId: string }>) => {
    // Choosing Finance on a row clears the pre-filled company, so it is picked
    // on purpose rather than saved as the default without anyone asking.
    if (patch.mode === "Finance" && !splitRows.some((r) => r.mode === "Finance")) {
      setBillingForm((f: any) => ({ ...f, financeProvider: "" }));
    }
    setSplitRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addSplitRow = () => setSplitRows((rows) => [...rows, { mode: "Cash", amount: "", txnId: "" }]);
  const removeSplitRow = (idx: number) =>
    setSplitRows((rows) => (rows.length <= 2 ? rows : rows.filter((_, i) => i !== idx)));
  const fillRemainingInRow = (idx: number) => {
    const others = splitRows.reduce((sum, r, i) => (i === idx ? sum : sum + (Number(r.amount) || 0)), 0);
    updateSplitRow(idx, { amount: String(Math.max(0, Number((activePaymentAmount - others).toFixed(2)))) });
  };

  const [phoneLookupStatus, setPhoneLookupStatus] = useState<"idle" | "existing" | "new">("idle");
  const [matchedEstimate, setMatchedEstimate] = useState<any>(null);

  const handleLoadEstimate = (est: any) => {
    if (!est) return;

    // 1. Map items from estimate
    const newItems = (est.items && est.items.length > 0)
      ? est.items.map((it: any, idx: number) => {
          const matchedCatalog = catalogItems.find((cat: any) => 
            (it.itemCode && cat.itemCode === it.itemCode) || 
            (it.name && (cat.name === it.name || cat.itemName === it.name))
          );

          const gst = Number(it.tax) || Number(it.gstRate) || (matchedCatalog?.gstRate || 18);
          const rate = Number(it.rate) || Number(matchedCatalog?.sellingPrice || 0);
          const qty = Number(it.quantity || it.qty || 1);

          return {
            id: `est-item-${Date.now()}-${idx}`,
            name: it.name || it.itemName || matchedCatalog?.name || "Product Item",
            itemCode: it.itemCode || matchedCatalog?.itemCode || "8471",
            vpCode: matchedCatalog?.vpCode || it.vpCode || "",
            serialNumber: it.serialNumber || "",
            batchNumber: it.batchNumber || "",
            qty,
            rate,
            minSellingPrice: matchedCatalog?.minSellingPrice || 0,
            maxDiscountPercent: matchedCatalog?.maxDiscountPercent || 0,
            maxDiscountAmount: matchedCatalog?.maxDiscountAmount || 0,
            incentiveTargetAmount: matchedCatalog?.incentiveTargetAmount || 0,
            incentiveAmount: matchedCatalog?.incentiveAmount || 0,
            adminApprovedRate: false,
            incentiveType: matchedCatalog?.incentiveType || "fixed",
            incentiveValue: matchedCatalog?.incentiveValue || 0,
            discount: Number(it.discount) || 0,
            gstRate: allowedGstRate(gst),
            availableStock: matchedCatalog?.currentStock || matchedCatalog?.openingStock || 10,
            extendedWarrantyProvider: "OneAssist",
            extendedWarrantyPlan: "none",
            extendedWarrantyAmount: 0,
            extendedWarrantyDuration: 1,
            extendedWarrantyStartDate: todayInIndia(),
            extendedWarrantyEndDate: "",
            extendedWarrantyHsn: "",
            extendedWarrantySerial: "",
          };
        })
      : [
          {
            id: String(Date.now()),
            name: "Estimate Item",
            itemCode: "8471",
            vpCode: "",
            serialNumber: "",
            batchNumber: "",
            qty: 1,
            rate: Number(est.total) || 1000,
            minSellingPrice: 0,
            maxDiscountPercent: 0,
            maxDiscountAmount: 0,
            incentiveTargetAmount: 0,
            incentiveAmount: 0,
            adminApprovedRate: false,
            incentiveType: "fixed",
            incentiveValue: 0,
            discount: 0,
            gstRate: 18,
            availableStock: 10,
            extendedWarrantyProvider: "OneAssist",
            extendedWarrantyPlan: "none",
            extendedWarrantyAmount: 0,
            extendedWarrantyDuration: 1,
            extendedWarrantyStartDate: todayInIndia(),
            extendedWarrantyEndDate: "",
            extendedWarrantyHsn: "",
            extendedWarrantySerial: "",
          },
        ];

    setBillingForm((prev: any) => ({
      ...prev,
      customerName: est.customerName || prev.customerName,
      customerPhone: (est.customerPhone || prev.customerPhone || "").replace(/\D/g, ""),
      customerAddress: est.customerAddress || prev.customerAddress || "",
      customerGstin: est.customerGST || prev.customerGstin || "",
      customerCompanyName: est.customerCompanyName || prev.customerCompanyName || "",
      notes: prev.notes ? `${prev.notes} • Linked to Estimate ${est.estimateNumber}` : `Linked to Estimate ${est.estimateNumber}`,
      linkedEstimateNumber: est.estimateNumber,
      lineItems: newItems,
    }));

    if (Number(est.paidAmount || est.advanceAmount || 0) > 0) {
      setApplyAdvanceCredit(true);
      setCustomAdvanceAdjusted(Number(est.paidAmount || est.advanceAmount));
    }

    toast.success(`Estimate ${est.estimateNumber} items & details imported successfully!`);
  };

  useEffect(() => {
    if (isOpen && preloadedEstimate) {
      handleLoadEstimate(preloadedEstimate);
    }
  }, [isOpen, preloadedEstimate]);

  // Editing an estimate: same number, date and salesperson; the company is the
  // one it was made under, so no new number is drawn.
  useEffect(() => {
    if (!isOpen || !isEditingEstimate) return;
    const est = editEstimate;
    setBillingEntity(entityOf(est.billingEntity || est));
    handleLoadEstimate(est);
    setBillingForm((prev: any) => ({
      ...prev,
      invoiceNo: est.estimateNumber || est.estimateNo || prev.invoiceNo,
      invoiceDate: String(est.date || prev.invoiceDate).slice(0, 10),
      dueDate: est.expiryDate ? String(est.expiryDate).slice(0, 10) : prev.dueDate,
      salesExecutive: est.salesperson || est.salesExecutive || prev.salesExecutive,
      notes: est.notes && est.notes !== "Official Estimate Generated" ? est.notes : "",
      linkedEstimateNumber: undefined,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditingEstimate, editEstimate]);

  // Editing a saved tax invoice: the form opens filled with it. Its number,
  // date and company stay as they are; the server re-does stock, serials and
  // payments when it is saved (PUT action "full-edit").
  useEffect(() => {
    if (!isOpen || !isEditingInvoice) return;
    const inv = editInvoice;
    setBillingEntity(entityOf(inv.billingEntity || inv));

    const savedLines: any[] = inv.items || [];
    const lines = savedLines.map((it: any, idx: number) => {
      const cat: any = catalogItems.find((c: any) => c._id === it.itemId);
      // This bill already took its own quantity off stock, so it may keep it.
      const qtyOnBill = savedLines
        .filter((x: any) => x.itemId === it.itemId)
        .reduce((sum: number, x: any) => sum + (Number(x.quantity) || 0), 0);
      const showroomNow = cat ? (cat.showroomStock !== undefined ? cat.showroomStock : cat.currentStock || 0) : 0;
      return {
        id: `edit-${idx}-${Date.now()}`,
        name: it.itemName || "",
        itemId: it.itemId,
        itemCode: it.itemCode || "",
        vpCode: it.vpCode || "",
        brand: it.brand || "",
        serialNumber: it.serialNumber || "",
        batchNumber: it.batchNumber || "",
        qty: Number(it.quantity) || 1,
        rate: Number(it.rate) || 0,
        discount: Number(it.discount) || 0,
        // A bill with a GSTIN saved its lines at 0%; the form zeroes GST itself
        // for a GSTIN, so the line goes back to the product's own rate here.
        gstRate: allowedGstRate(Number(it.gstRate) > 0 ? it.gstRate : (cat?.gstRate ?? 18)),
        minSellingPrice: Number(it.minSellingPrice) || cat?.minSellingPrice || 0,
        maxDiscountPercent: cat?.maxDiscountPercent || 0,
        maxDiscountAmount: cat?.maxDiscountAmount || 0,
        incentiveTargetAmount: Number(it.incentiveTargetAmount) || 0,
        incentiveAmount: Number(it.incentiveAmount) || 0,
        incentiveType: it.incentiveType || "fixed",
        incentiveValue: Number(it.incentiveValue) || 0,
        adminApprovedRate: Boolean(it.adminOverrideRate),
        availableStock: showroomNow + qtyOnBill,
        showroomStock: showroomNow + qtyOnBill,
        godownStock: cat?.godownStock,
        isSerialized: Boolean(cat?.isSerialized || it.serialNumber),
        extendedWarrantyProvider: it.extendedWarrantyProvider || "OneAssist",
        extendedWarrantyPlan: it.extendedWarrantyPlan || "none",
        extendedWarrantyAmount: Number(it.extendedWarrantyAmount) || 0,
        extendedWarrantyDuration: Number(it.extendedWarrantyDuration) || 1,
        extendedWarrantyPolicyNo: it.extendedWarrantyPolicyNo || "",
      };
    });

    const savedMode = String(inv.paymentMode || "");
    const knownModes = ["Cash", "UPI", "Online", "Credit Card", "Debit Card", "Finance", "Due / Credit"];
    const isSplit = Array.isArray(inv.payments) && inv.payments.length > 1;
    const remarksKey = savedMode === "Due / Credit" ? "dueRemarks" : savedMode === "UPI" ? "upiRemarks" : "cashRemarks";

    setBillingForm((prev: any) => ({
      ...prev,
      invoiceNo: inv.invoiceNumber,
      invoiceDate: String(inv.date || prev.invoiceDate).slice(0, 10),
      dueDate: inv.dueDate ? String(inv.dueDate).slice(0, 10) : prev.dueDate,
      customerId: inv.customerId || "",
      customerName: inv.customerName || "",
      customerPhone: String(inv.customerPhone || "").replace(/\D/g, ""),
      customerAltPhone: inv.customerAltPhone || "",
      customerEmail: inv.customerEmail || "",
      customerGstin: inv.customerGST || "",
      customerPan: inv.customerPAN || "",
      customerCompanyName: inv.customerCompanyName || "",
      customerAddress: inv.customerAddress || "",
      customerCity: inv.customerCity || prev.customerCity,
      customerState: inv.customerState || prev.customerState,
      customerPin: inv.customerPin || prev.customerPin,
      isShippingSameAsBilling: inv.isShippingSameAsBilling !== false,
      shippingAddress: inv.shippingStreet || "",
      shippingCity: inv.shippingCity || prev.shippingCity,
      shippingState: inv.shippingState || prev.shippingState,
      shippingPin: inv.shippingPin || prev.shippingPin,
      dispatchType: inv.dispatchType === "delayed_delivery" ? "delayed_delivery" : "immediate",
      expectedDeliveryDate: inv.expectedDeliveryDate || "",
      driverName: inv.driverName || "",
      driverPhone: inv.driverPhone || "",
      placeOfSupply: inv.placeOfSupply || prev.placeOfSupply,
      vehicleNumber: inv.vehicleNumber || "",
      paymentMode: (knownModes.includes(savedMode) ? savedMode : isSplit ? prev.paymentMode : "Cash") as any,
      cashReceivedBy: inv.cashReceivedBy || prev.cashReceivedBy,
      upiTxnId: inv.upiTxnId || "",
      onlineTxnId: inv.onlineTxnId || "",
      onlineGateway: inv.onlineGateway || prev.onlineGateway,
      creditCardType: savedMode === "Credit Card" ? inv.cardType || prev.creditCardType : prev.creditCardType,
      creditCardTxnId: savedMode === "Credit Card" ? inv.cardTxnId || "" : "",
      creditCardLast4: savedMode === "Credit Card" ? inv.cardLast4 || "" : "",
      debitCardType: savedMode === "Debit Card" ? inv.cardType || prev.debitCardType : prev.debitCardType,
      debitCardTxnId: savedMode === "Debit Card" ? inv.cardTxnId || "" : "",
      debitCardLast4: savedMode === "Debit Card" ? inv.cardLast4 || "" : "",
      financeProvider: inv.financeProvider || prev.financeProvider,
      financeDoId: inv.financeDoId || "",
      financeAppId: inv.financeAppId || "",
      financeGrossLoan: Number(inv.financeGrossLoan) || 0,
      financeDownPayment: Number(inv.financeDownPayment) || 0,
      financeDownPaymentMode: inv.financeDownPaymentMode || prev.financeDownPaymentMode,
      financeTenureMonths: Number(inv.financeTenureMonths) || prev.financeTenureMonths,
      financeSchemeType: inv.financeSchemeType || prev.financeSchemeType,
      financeInterestRate: Number(inv.financeInterestRate) || 0,
      financeApprovalStatus: inv.financeApprovalStatus || prev.financeApprovalStatus,
      financePdfUrl: inv.financePdfUrl || "",
      dueAdvanceAmount: Number(inv.dueAdvanceAmount) || 0,
      advanceAmount: Number(inv.dueAdvanceAmount) || 0,
      dueAdvanceMode: inv.dueAdvanceMode || prev.dueAdvanceMode,
      shippingCharges: Number(inv.shippingCharges) || 0,
      freightCharges: Number(inv.freightCharges) || 0,
      salesExecutive: inv.salesExecutive || prev.salesExecutive,
      linkedEstimateNumber: "",
      [remarksKey]: inv.notes || "",
      lineItems: lines,
    }));

    if (isSplit) {
      setIsSplitPayment(true);
      setSplitRows(inv.payments.map((p: any) => ({ mode: p.mode, amount: String(p.amount ?? ""), txnId: p.txnId || "" })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isEditingInvoice, editInvoice]);

  const handlePhoneLookup = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    setBillingForm((prev) => ({ ...prev, customerPhone: cleanPhone }));

    if (cleanPhone.length < 10) {
      setPhoneLookupStatus("idle");
      setMatchedEstimate(null);
      return;
    }

    if (cleanPhone.length === 10) {
      // 1. Check for Active Estimate for THIS customer only (strict 10-digit match)
      const activeEst = estimatesList.find((est: any) => {
        const estPhone = (est.customerPhone || "").replace(/\D/g, "");
        if (!estPhone || estPhone.length < 10) return false;
        const estStatus = (est.status || "").toLowerCase();
        if (estStatus === "converted" || estStatus === "accepted" || estStatus === "cancelled") return false;
        return estPhone.slice(-10) === cleanPhone.slice(-10);
      });
      if (activeEst) {
        setMatchedEstimate(activeEst);
      } else {
        setMatchedEstimate(null);
      }

      // 2. Check Customer Master
      const found = customers.find((c: any) => c.phone === cleanPhone);
      if (found) {
        const normalizedState = normalizeStateName(found.billingAddress?.state || found.state || "Uttar Pradesh");
        const addr = found.billingAddress?.line1 ? `${found.billingAddress.line1}` : found.address || "";
        const city = normalizeCityName(found.billingAddress?.city || found.city || "Gorakhpur", normalizedState);
        const pin = found.billingAddress?.pincode || found.pin || found.pincode || "273001";
        const shipAddr = found.shippingAddress?.line1 || addr;
        const shipCity = found.shippingAddress?.city || city;
        const shipState = found.shippingAddress?.state ? normalizeStateName(found.shippingAddress.state) : normalizedState;
        const shipPin = found.shippingAddress?.pincode || pin;
        const isSame = !found.shippingAddress?.line1 || (found.shippingAddress?.line1 === addr);

        setBillingForm((prev) => ({
          ...prev,
          customerId: found._id,
          customerName: found.name,
          customerPhone: cleanPhone,
          customerAltPhone: found.altPhone || found.customerAltPhone || prev.customerAltPhone || "",
          customerEmail: found.email || "",
          customerGstin: found.gstNumber || found.gst || "",
          customerPan: found.panNumber || "",
          placeOfSupply: normalizedState.includes("09") ? normalizedState : `${normalizedState}(09)`,
          customerState: normalizedState,
          customerCity: city,
          customerPin: pin,
          customerAddress: addr,
          isShippingSameAsBilling: isSame,
          shippingAddress: shipAddr,
          shippingCity: shipCity,
          shippingState: shipState,
          shippingPin: shipPin,
        }));
        setPhoneLookupStatus("existing");
        toast.success(`Customer found: ${found.name}`);
      } else if (activeEst) {
        setBillingForm((prev) => ({
          ...prev,
          customerId: "new",
          customerName: activeEst.customerName || prev.customerName,
          customerPhone: cleanPhone,
          customerAddress: activeEst.customerAddress || prev.customerAddress,
          customerGstin: activeEst.customerGST || prev.customerGstin,
          customerCompanyName: activeEst.customerCompanyName || prev.customerCompanyName,
        }));
        setPhoneLookupStatus("existing");
      } else {
        setBillingForm((prev) => ({
          ...prev,
          customerId: "new",
          customerPhone: cleanPhone,
        }));
        setPhoneLookupStatus("new");
      }
    }
  };

  const addLineItem = () => {
    const newId = String(Date.now());
    setJustAddedId(newId);
    // Collapse any already-filled-in rows so the list stays compact as more are added.
    setCollapsedIds(prev => {
      const next = new Set(prev);
      billingForm.lineItems.forEach((it) => { if (it.name) next.add(it.id); });
      return next;
    });
    setBillingForm((prev) => ({
      ...prev,
      lineItems: [
        ...prev.lineItems,
        {
          id: newId,
          name: "",
          itemCode: "", 
          vpCode: "", 
          serialNumber: "", 
          batchNumber: "", 
          qty: 1, 
          rate: 0,
          minSellingPrice: 0,
          maxDiscountPercent: 0,
          maxDiscountAmount: 0,
          incentiveTargetAmount: 0,
          incentiveAmount: 0,
          adminApprovedRate: false,
          incentiveType: "fixed",
          incentiveValue: 0,
          discount: 0, 
          gstRate: 18, 
          availableStock: 0,
          extendedWarrantyProvider: "OneAssist",
          extendedWarrantyPlan: "none",
          extendedWarrantyAmount: 0,
          extendedWarrantyDuration: 1,
          extendedWarrantyPolicyNo: "",
        },
      ],
    }));
  };

  const removeLineItem = (idx: number) => {
    setBillingForm((prev) => ({
      ...prev,
      lineItems: prev.lineItems.filter((_, i) => i !== idx),
    }));
  };

  const handleLineItemChange = (idx: number, field: string, value: any) => {
    const updated = [...billingForm.lineItems];
    if (field === "qty" && mode === "invoice") {
      const maxStock = updated[idx].availableStock !== undefined ? updated[idx].availableStock : Infinity;
      if (value > maxStock) {
        toast.warning(`Warning: Requested ${value} units exceeds available stock of ${maxStock}!`);
      }
    }
    
    if (field === "extendedWarrantyPlan") {
      const plan = WARRANTY_PLANS.find(p => p.id === value);
      if (plan && plan.id !== "none") {
        updated[idx] = {
          ...updated[idx],
          extendedWarrantyPlan: plan.name,
          extendedWarrantyAmount: plan.price,
          extendedWarrantyDuration: plan.duration,
          extendedWarrantyProvider: updated[idx].extendedWarrantyProvider || "OneAssist",
        };
      } else if (value === "none") {
        updated[idx] = {
          ...updated[idx],
          extendedWarrantyPlan: "none",
          extendedWarrantyAmount: 0,
          extendedWarrantyDuration: 0,
          extendedWarrantyProvider: "",
          extendedWarrantyPolicyNo: "",
        };
      } else {
        updated[idx] = { ...updated[idx], [field]: value };
      }
    } else {
      updated[idx] = { ...updated[idx], [field]: value };
    }
    
    setBillingForm((prev) => ({ ...prev, lineItems: updated }));
  };

  // Discount is hard-capped per product (admin-configured) — no PIN bypass, just clamp.
  const handleDiscountChangeAttempt = (idx: number, newDiscount: number) => {
    const item = billingForm.lineItems[idx];
    const capAmt = Number(item.maxDiscountAmount) > 0 ? Number(item.maxDiscountAmount) : Infinity;
    const capPct = Number(item.maxDiscountPercent) > 0 ? (Number(item.rate) || 0) * Number(item.maxDiscountPercent) / 100 : Infinity;
    const effectiveCap = Math.min(capAmt, capPct);

    if (isFinite(effectiveCap) && newDiscount > effectiveCap) {
      toast.warning(`Max discount for "${item.name || "this product"}" is ₹${effectiveCap.toFixed(2)}. Capped.`);
      handleLineItemChange(idx, "discount", effectiveCap);
      return;
    }

    handleLineItemChange(idx, "discount", newDiscount);
  };

  const handleVerifyAdminPin = async () => {
    const ADMIN_PIN = "1234";
    if (enteredPin.trim() === ADMIN_PIN) {
      if (pinPrompt) {
        const approvedIdx = new Set(pinPrompt.items.map((i) => i.idx));
        const updatedLineItems = billingForm.lineItems.map((it, i) =>
          approvedIdx.has(i) ? { ...it, adminApprovedRate: true } : it
        );
        setBillingForm((prev) => ({ ...prev, lineItems: updatedLineItems }));
        toast.success(`✅ Admin Authorization Approved for ${pinPrompt.items.length} item(s) below floor price!`);
        setPinPrompt(null);
        setEnteredPin("");
        setPinError(false);
        await proceedToFinalize(updatedLineItems);
      }
    } else {
      setPinError(true);
      toast.error("❌ Invalid Admin PIN! Cannot bill below minimum price without supervisor authorization.");
    }
  };

  const selectProductSuggestion = (idx: number, prod: any) => {
    const isOutOfStock = (prod.currentStock || 0) <= 0;
    if (isOutOfStock && mode === "invoice") {
      toast.error(`"${prod.name}" is OUT OF STOCK. Cannot be billed in a Tax Invoice.`);
      return;
    }

    const updated = [...billingForm.lineItems];
    const itemVpCode = prod.vpCode || prod.code;
    const itemShowroomStock = prod.showroomStock !== undefined ? prod.showroomStock : (prod.currentStock || 0);
    const itemGodownStock = prod.godownStock !== undefined ? prod.godownStock : (prod.currentStock || 0);
    const totalItemStock = itemShowroomStock + itemGodownStock;

    updated[idx] = {
      ...updated[idx],
      name: prod.name,
      rate: prod.sellingPrice || prod.rate || 0,
      minSellingPrice: prod.minSellingPrice || prod.purchasePrice || 0,
      maxDiscountPercent: prod.maxDiscountPercent || 0,
      maxDiscountAmount: prod.maxDiscountAmount || 0,
      incentiveTargetAmount: prod.incentiveTargetAmount || prod.sellingPrice || 0,
      incentiveAmount: prod.incentiveAmount || prod.incentiveValue || 0,
      incentiveType: prod.incentiveType || "fixed",
      incentiveValue: prod.incentiveAmount || prod.incentiveValue || 0,
      adminApprovedRate: false,
      gstRate: allowedGstRate(prod.gstRate ?? 18),
      itemCode: prod.code,
      vpCode: itemVpCode,
      itemId: prod._id,
      availableStock: itemShowroomStock,
      showroomStock: itemShowroomStock,
      godownStock: itemGodownStock,
      batchNumber: prod.batchNumber || "",
      isSerialized: prod.isSerialized || false,
    };
    
    if (totalItemStock <= 0) {
      toast.warning(`Notice: ${prod.name} is OUT OF STOCK across Showroom & Godown.`);
    } else {
      toast.info(`Selected: ${prod.name} — 🏪 Showroom: ${itemShowroomStock} PCS | 🏭 Godown: ${itemGodownStock} PCS`);
    }

    setBillingForm((prev) => ({ ...prev, lineItems: updated }));
    setActiveSuggestRow(null);
  };

  const createInvoiceMutation = useMutation({
    networkMode: "always",
    mutationFn: async (payload: any) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const offlineRecord = saveOfflineInvoice(payload);
        return { isOffline: true, data: offlineRecord };
      }

      if (mode === "estimate") {
        try {
          const estRes = await fetch("/api/estimates", {
            method: isEditingEstimate ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              estimateNumber: payload.invoiceNumber,
              customerName: payload.customerName,
              customerPhone: payload.customerPhone,
              customerAddress: payload.customerAddress,
              customerGST: payload.customerGstin,
              customerCompanyName: payload.customerCompanyName,
              salesExecutive: payload.salesExecutive,
              salesperson: payload.salesExecutive,
              createdBy: payload.createdBy,
              date: payload.date,
              expiryDate: payload.dueDate,
              items: (payload.items || []).map((it: any) => ({
                itemCode: it.itemCode || it.vpCode || "GEN",
                name: it.itemName || it.name || "Item",
                quantity: it.quantity || 1,
                rate: it.rate || 0,
                tax: it.gstRate || 0,
                amount: it.amount || 0,
              })),
              subTotal: payload.subtotal,
              taxTotal: payload.totalGST,
              total: payload.total,
              status: "Sent",
              notes: payload.notes || "Official Estimate Generated",
            }),
          });
          const estJson = await estRes.json();
          if (!estJson.success) {
            console.error("Error creating Estimate record:", estJson.error);
            toast.warning("Invoice saved, but the Estimate list entry failed to save: " + (estJson.error || "unknown error"));
          }
        } catch (e) {
          console.error("Error creating Estimate record:", e);
          toast.warning("Invoice saved, but the Estimate list entry failed to save.");
        }
      }

      // An edited estimate updates its own quotation record; nothing else (stock,
      // payments) is touched — an estimate never moved any of them.
      if (isEditingEstimate) {
        const upd = await fetch("/api/invoices", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, type: "proforma" }),
        });
        const updJson = await upd.json().catch(() => ({}));
        // Older estimates exist only in the estimates list — that one was updated above.
        return { isOffline: false, edited: true, data: updJson?.data || { invoiceNumber: payload.invoiceNumber } };
      }

      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to generate invoice");
      if (json.pendingApproval) return { isOffline: false, pendingApproval: true, message: json.message };
      return {
        isOffline: false,
        data: json.data,
        numberReassignedFrom: json.numberReassignedFrom,
        warning: json.warning,
      };
    },
    onSuccess: (result: any) => {
      // A back-dated bill from the Store Manager is held for the Admin: nothing
      // to print until it is approved.
      if (result.pendingApproval) {
        toast.info(result.message || "Sent to the Admin for approval.", { duration: 8000 });
        onSuccess && onSuccess();
        return;
      }
      if (result.isOffline) {
        toast.warning("⚡ Saved locally in offline queue. Auto-sync on connection.", { duration: 5000 });
        setOfflineInvoiceToPrint(result.data);
      } else {
        toast.success(
          result.edited
            ? `Estimate ${result.data?.invoiceNumber || ""} updated.`
            : mode === "estimate"
            ? `Estimate ${result.data?.invoiceNumber || ""} created & recorded!`
            : `Invoice ${result.data?.invoiceNumber || ""} finalized successfully!`
        );
        if (result.numberReassignedFrom) {
          toast.warning(
            `Number ${result.numberReassignedFrom} was already taken — this bill was saved as ${result.data?.invoiceNumber}.`,
            { duration: 8000 }
          );
        }
        if (result.warning) {
          toast.warning(result.warning, { duration: 8000 });
        }
        queryClient.invalidateQueries({ queryKey: ["invoices"] });
        queryClient.invalidateQueries({ queryKey: ["estimates"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["items"] });
        queryClient.invalidateQueries({ queryKey: ["serialNumbers"] });
        queryClient.invalidateQueries({ queryKey: ["reports"] });
        // The dashboard's Due Collections widget loads invoices with a plain
        // fetch on mount, not react-query, so invalidateQueries above never
        // reaches it — a bill created here (or its due settled) stayed
        // invisible there until a full page reload. This event is what its
        // "erp-invoice-created" listener refreshes on.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("erp-invoice-created", { detail: result.data }));
        }
        setGeneratedInvoiceToPrint(result.data);
        onSuccess && onSuccess();
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to generate invoice");
    }
  });

  // Saving an edited invoice: the payload waits here until the PIN and reason
  // are given, then goes to PUT /api/invoices (action "full-edit").
  const [pendingEdit, setPendingEdit] = useState<any>(null);
  const [editAuthError, setEditAuthError] = useState<string | null>(null);
  const editInvoiceMutation = useMutation({
    mutationFn: async ({ pin, reason }: PinAuthResult) => {
      const res = await fetch("/api/invoices", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "full-edit",
          invoiceNumber: editInvoice?.invoiceNumber,
          pin,
          reason,
          invoice: pendingEdit,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || "Could not update the invoice");
      if (json.pendingApproval) return { pendingApproval: true, message: json.message };
      return json.data;
    },
    onSuccess: (data: any) => {
      setPendingEdit(null);
      // Anyone but the Admin: the correction waits for the Admin's approval.
      if (data?.pendingApproval) {
        toast.info(data.message || "Sent to the Admin for approval.", { duration: 8000 });
        onSuccess && onSuccess();
        return;
      }
      toast.success(`Invoice ${data?.invoiceNumber || ""} updated.`);
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["serialNumbers"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp-invoice-created", { detail: data }));
      }
      setGeneratedInvoiceToPrint(data);
      onSuccess && onSuccess();
    },
    onError: (error: any) => setEditAuthError(error.message || "Could not update the invoice"),
  });

  const handleFinanceDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file again later
    if (!file) return;

    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Sirf JPG, PNG, WEBP image ya PDF file upload kar sakte hain.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("The file must be smaller than 10 MB.");
      return;
    }

    setIsUploadingFinanceDoc(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "valueplus/finance-docs");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      setBillingForm((f: any) => ({ ...f, financePdfUrl: json.data.url }));
      toast.success("DO attachment uploaded.");
    } catch (err: any) {
      toast.error(err.message || "Upload failed, please try again.");
    } finally {
      setIsUploadingFinanceDoc(false);
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mode === "invoice" && isIndividualStaff) {
      toast.error("Sales staff cannot generate official Tax Invoices. Official billing is handled exclusively by the Store Cashier / Admin desk. Please create an Estimate instead.");
      return;
    }

    if (!billingForm.customerName.trim()) {
      toast.error("Customer Name is mandatory.");
      return;
    }
    if (!billingForm.customerPhone || billingForm.customerPhone.length !== 10) {
      toast.error("Valid 10-digit Customer Mobile number is mandatory.");
      return;
    }
    if (!billingEntity) {
      toast.error("Choose whether this bill is for Value Plus or Ashoka Enterprises.");
      return;
    }
    if (billingForm.lineItems.length === 0) {
      toast.error("Please add at least 1 product item to the bill.");
      return;
    }
    // A plain quotation takes no money, so it has no payment mode to pick. Only an
    // estimate with a token advance (and every real bill) needs one.
    const needsPaymentMode = !(mode === "estimate" && !estimateIncludesAdvance);
    if (needsPaymentMode && !isSplitPayment && !billingForm.paymentMode) {
      toast.error("Select a payment mode — Cash, UPI or Card.");
      return;
    }
    if (mode !== "estimate" && billingForm.dispatchType === "delayed_delivery" && !billingForm.expectedDeliveryDate) {
      toast.error("Confirm the delivery date with the customer and enter it — the bill then shows in Order Dispatch.");
      return;
    }
    if (splitHasFinance && mode !== "estimate" && !String(billingForm.financeProvider || "").trim()) {
      toast.error("Select the finance company (Bajaj, HDB, …) for the Finance part of this split payment.");
      return;
    }

    if (mode === "invoice") {
      for (const it of billingForm.lineItems) {
        if (it.availableStock !== undefined && it.availableStock <= 0) {
          toast.error(`"${it.name}" is OUT OF STOCK. Cannot generate a Tax Invoice.`);
          return;
        }
        if (it.availableStock !== undefined && it.qty > it.availableStock) {
          toast.error(`Quantity for "${it.name}" (${it.qty}) exceeds available on-hand stock (${it.availableStock}).`);
          return;
        }
      }
    }

    // Floor-price protection: ask for one Admin PIN covering every below-floor item,
    // right at submit time — not while the cashier is still typing the rate.
    const belowFloor = billingForm.lineItems
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => Number(it.minSellingPrice) > 0 && Number(it.rate) < Number(it.minSellingPrice) && !it.adminApprovedRate);

    if (belowFloor.length > 0) {
      setPinPrompt({
        items: belowFloor.map(({ it, idx }) => ({
          idx,
          proposedRate: Number(it.rate) || 0,
          minPrice: Number(it.minSellingPrice) || 0,
          itemName: it.name || "Selected Product",
        })),
      });
      setEnteredPin("");
      setPinError(false);
      return;
    }

    await proceedToFinalize();
  };

  const proceedToFinalize = async (lineItemsOverride?: typeof billingForm.lineItems) => {
    const items = lineItemsOverride || billingForm.lineItems;

    const formattedItems = items.map(item => {
      // Rate is GST-inclusive: split it back into taxable + GST instead of adding GST on top.
      const grossAmount = ((Number(item.rate) || 0) - (Number(item.discount) || 0)) * (Number(item.qty) || 1);
      const effectiveGstRate = gstinProvided ? 0 : (Number(item.gstRate) || 0);
      const lineTaxable = grossAmount / (1 + (effectiveGstRate / 100));
      const lineGst = grossAmount - lineTaxable;
      const isIntraState = billingForm.placeOfSupply.includes("09") || billingForm.placeOfSupply.toLowerCase().includes("uttar pradesh");
      
      let lineInc = 0;
      const targetAmt = Number(item.incentiveTargetAmount) || 0;
      const rewardVal = Number(item.incentiveValue) || Number(item.incentiveAmount) || 0;
      const incType = item.incentiveType || "fixed";
      const currentRate = Number(item.rate) || 0;
      const qty = Number(item.qty) || 1;

      if (rewardVal > 0 && incType !== "none") {
        const isTargetMet = targetAmt <= 0 || currentRate >= targetAmt;
        if (isTargetMet) {
          if (incType === "percentage") {
            lineInc = lineTaxable * (rewardVal / 100);
          } else {
            lineInc = rewardVal * qty;
          }
        }
      }

      // Frozen onto the invoice line at sale time — the GST Sales Register
      // needs a per-product HSN code, which the item form never collected
      // directly, but the catalog entry this row was picked from already has.
      const matchedCatalog = catalogItems.find(
        (cat: any) => cat._id === item.itemId || cat.code === item.itemCode || (item.vpCode && cat.vpCode === item.vpCode)
      );

      return {
        itemId: item.itemId || `ITEM-${Date.now()}`,
        itemName: item.name,
        brand: item.brand || item.brandName || "Showroom Partner",
        itemCode: item.itemCode || "GEN",
        vpCode: item.vpCode || item.itemCode || "",
        hsn: matchedCatalog?.hsnCode || "",
        description: item.serialNumber ? `Serial/IMEI: ${item.serialNumber}` : (item.batchNumber ? `Batch: ${item.batchNumber}` : ""),
        quantity: item.qty,
        unit: "PCS",
        rate: item.rate,
        minSellingPrice: item.minSellingPrice || 0,
        incentiveTargetAmount: targetAmt,
        incentiveAmount: rewardVal,
        adminOverrideRate: item.adminApprovedRate || false,
        incentiveType: incType,
        incentiveValue: rewardVal,
        incentiveEarned: Math.round(lineInc * 100) / 100,
        discount: item.discount,
        discountType: "amount",
        taxableAmount: lineTaxable,
        gstRate: effectiveGstRate,
        cgst: isIntraState ? lineGst / 2 : 0,
        sgst: isIntraState ? lineGst / 2 : 0,
        igst: isIntraState ? 0 : lineGst,
        amount: lineTaxable + lineGst + (Number(item.extendedWarrantyAmount) || 0),
        serialNumber: item.serialNumber || "",
        batchNumber: item.batchNumber || "",
        extendedWarrantyProvider: item.extendedWarrantyProvider || "",
        extendedWarrantyPlan: item.extendedWarrantyPlan && item.extendedWarrantyPlan !== "none" ? item.extendedWarrantyPlan : (item.extendedWarrantyAmount > 0 ? `${item.extendedWarrantyDuration || 1} Year Plan` : ""),
        extendedWarrantyAmount: Number(item.extendedWarrantyAmount) || 0,
        extendedWarrantyDuration: Number(item.extendedWarrantyDuration) || 0,
        extendedWarrantyPolicyNo: item.extendedWarrantyPolicyNo || "",
      };
    });

    const isEstimate = mode === "estimate";
    const isFinance = billingForm.paymentMode === "Finance";
    const isDueCredit = billingForm.paymentMode === "Due / Credit";
    const isCard = billingForm.paymentMode === "Credit Card" || billingForm.paymentMode === "Debit Card";
    
    let paidAmt = 0;
    let balanceAmt = 0;
    let downPay = 0;
    let paymentModeToSave = billingForm.paymentMode;
    let advanceAdjustedToSave = isEstimate ? 0 : effectiveAdvanceAdjusted;
    let advanceReceiptNoToSave = isEstimate ? "" : (effectiveAdvanceAdjusted > 0 ? (customerAdvances[0]?.receiptNumber || "") : "");
    // Advance Booking receipts are used first; whatever is left comes from the
    // customer's Receive Payment credit.
    const creditAdjustedToSave = isEstimate ? 0 : Math.max(0, Math.min(accountCredit, effectiveAdvanceAdjusted - bookingAdvanceTotal));

    if (isEstimate) {
      if (estimateIncludesAdvance) {
        paidAmt = Math.min(billCalculations.grandTotal, preBookingAdvanceAmount);
        balanceAmt = Math.max(0, billCalculations.grandTotal - paidAmt);
        paymentModeToSave = billingForm.paymentMode;
        try {
          const txnRef = billingForm.upiTxnId || billingForm.creditCardTxnId || billingForm.debitCardTxnId || billingForm.onlineTxnId || "";
          fetch("/api/crm/advances", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              customerName: billingForm.customerName,
              customerPhone: billingForm.customerPhone,
              amount: paidAmt,
              paymentMode: billingForm.paymentMode,
              transactionRef: txnRef,
              productBooked: formattedItems.map(i => i.itemName).join(", "),
              notes: `Estimate Advance Token against #${billingForm.invoiceNo} (${billingForm.paymentMode})`,
              receivedBy: currentUserName,
            })
          }).catch(err => console.warn("Estimate advance logging:", err));
        } catch (e) {
          console.warn("Notice:", e);
        }
      } else {
        paidAmt = 0;
        balanceAmt = billCalculations.grandTotal;
        paymentModeToSave = "N/A" as any;
      }
    } else {
      const netBillAfterAdvance = Math.max(0, billCalculations.grandTotal - effectiveAdvanceAdjusted);
      downPay = isFinance ? (Number(billingForm.financeDownPayment) || 0) : (isDueCredit ? (Number(billingForm.advanceAmount || billingForm.dueAdvanceAmount) || 0) : netBillAfterAdvance);
      paidAmt = isFinance ? downPay : (isDueCredit ? downPay : netBillAfterAdvance);
      balanceAmt = Math.max(0, netBillAfterAdvance - paidAmt);
    }

    // ─── SPLIT PAYMENT PAYLOAD ────────────────────────────────────────────
    // The rows become the source of truth; the server re-derives paymentMode,
    // paidAmount and balanceAmount from them so the two can never disagree.
    let splitPaymentsPayload: Array<{ mode: string; amount: number; txnId: string }> | undefined;
    if (isSplitPayment && !isEstimate) {
      const rows = splitRows
        .map((r) => ({ mode: r.mode, amount: Number(r.amount) || 0, txnId: r.txnId || "" }))
        .filter((r) => r.amount > 0);

      if (rows.length < 2) {
        toast.error("Add at least two payment modes, or turn off Split Payment.");
        return;
      }
      const allocated = rows.reduce((s, r) => s + r.amount, 0);
      if (Math.abs(allocated - activePaymentAmount) > 1) {
        toast.error(
          `Split payments (${formatCurrency(allocated)}) must add up to the bill amount (${formatCurrency(activePaymentAmount)}).`
        );
        return;
      }

      splitPaymentsPayload = rows;
      const collected = rows
        .filter((r) => !/^finance$|^due/i.test(r.mode))
        .reduce((s, r) => s + r.amount, 0);
      paidAmt = collected;
      balanceAmt = Math.max(0, activePaymentAmount - collected);
      paymentModeToSave = (rows.length === 1 ? rows[0].mode : "Multiple") as any;
    }

    const finalPayload: any = {
      payments: splitPaymentsPayload,
      ...billingForm,
      invoiceNumber: billingForm.invoiceNo,
      // Which warehouse this sale deducts from — the server trusts the
      // cashier's own assigned location over this for locked roles, so this
      // only actually matters for admin/switch-permitted roles.
      warehouseId: activeLocation?.id,
      warehouse: activeLocation?.name,
      type: mode === "credit-note" ? "credit-note" : (mode === "sales-order" ? "sales-order" : (mode === "estimate" ? "proforma" : "tax-invoice")),
      billingEntity,
      salesExecutive: isIndividualStaff ? currentUserName : (billingForm.salesExecutive || currentUserName),
      salesperson: isIndividualStaff ? currentUserName : (billingForm.salesExecutive || currentUserName),
      createdBy: currentUserName,
      date: billingForm.invoiceDate,
      dueDate: billingForm.dueDate || todayInIndia(),
      customerName: billingForm.customerName,
      customerPhone: billingForm.customerPhone,
      customerAltPhone: billingForm.customerAltPhone || "",
      // billingForm's own field names (customerGstin/customerPan) don't
      // match the invoice schema's (customerGST/customerPAN) — the ...billingForm
      // spread above carries the wrong-named keys along harmlessly, but
      // without this explicit mapping the GSTIN/PAN/company name a biller
      // enters was silently never saved at all.
      customerGST: billingForm.customerGstin || "",
      customerPAN: billingForm.customerPan || "",
      customerCompanyName: billingForm.customerCompanyName || "",
      customerAddress: billingForm.customerAddress,
      customerCity: billingForm.customerCity,
      customerState: billingForm.customerState,
      customerPin: billingForm.customerPin,
      isShippingSameAsBilling: billingForm.isShippingSameAsBilling,
      shippingStreet: billingForm.isShippingSameAsBilling ? billingForm.customerAddress : billingForm.shippingAddress,
      shippingCity: billingForm.isShippingSameAsBilling ? billingForm.customerCity : billingForm.shippingCity,
      shippingState: billingForm.isShippingSameAsBilling ? billingForm.customerState : billingForm.shippingState,
      shippingPin: billingForm.isShippingSameAsBilling ? billingForm.customerPin : billingForm.shippingPin,
      shippingAddress: billingForm.isShippingSameAsBilling 
        ? (billingForm.customerAddress ? `${billingForm.customerAddress}, ${billingForm.customerCity}, ${billingForm.customerState} - ${billingForm.customerPin}` : "")
        : (billingForm.shippingAddress ? `${billingForm.shippingAddress}, ${billingForm.shippingCity}, ${billingForm.shippingState} - ${billingForm.shippingPin}` : ""),
      dispatchType: mode === "estimate" ? "immediate" : billingForm.dispatchType || "immediate",
      deliveryStatus: mode !== "estimate" && billingForm.dispatchType === "delayed_delivery" ? "pending_dispatch" : "delivered",
      expectedDeliveryDate:
        mode !== "estimate" && billingForm.dispatchType === "delayed_delivery" ? billingForm.expectedDeliveryDate || "" : "",
      driverName: billingForm.driverName || "",
      driverPhone: billingForm.driverPhone || "",
      driverVehicleNo: billingForm.vehicleNumber || "",
      placeOfSupply: billingForm.placeOfSupply,
      vehicleNumber: billingForm.vehicleNumber,
      
      salesExecutiveIncentive: billCalculations.totalIncentive,
      adminOverridePinUsed: items.some(i => i.adminApprovedRate),
      
      items: formattedItems,
      subtotal: billCalculations.subtotal,
      taxableAmount: billCalculations.totalTaxable,
      totalGST: billCalculations.totalGst,
      cgst: billCalculations.cgst,
      sgst: billCalculations.sgst,
      igst: billCalculations.igst,
      extendedWarrantyTotal: billCalculations.warrantyTotal,
      shippingCharges: Number(billingForm.freightCharges || billingForm.shippingCharges || 0),
      freightCharges: Number(billingForm.freightCharges || billingForm.shippingCharges || 0),
      roundOff: billCalculations.roundOff,
      total: billCalculations.grandTotal,

      // Advance Adjustment
      advanceAdjusted: advanceAdjustedToSave,
      advanceReceiptNo: advanceReceiptNoToSave,
      creditAdjusted: creditAdjustedToSave,
      
      paymentMode: paymentModeToSave,
      paidAmount: paidAmt,
      balanceAmount: balanceAmt,
      status: isEstimate ? "sent" : (balanceAmt === 0 ? "paid" : (paidAmt > 0 ? "partial" : "sent")),
      
      // Payment specifics
      cardCategory: billingForm.paymentMode === "Credit Card" ? "Credit Card" : (billingForm.paymentMode === "Debit Card" ? "Debit Card" : "Card"),
      cardType: billingForm.paymentMode === "Credit Card" 
        ? billingForm.creditCardType 
        : (billingForm.paymentMode === "Debit Card" ? billingForm.debitCardType : ""),
      cardTxnId: billingForm.paymentMode === "Credit Card" 
        ? billingForm.creditCardTxnId 
        : (billingForm.paymentMode === "Debit Card" ? billingForm.debitCardTxnId : ""),
      cardLast4: billingForm.paymentMode === "Credit Card" 
        ? billingForm.creditCardLast4 
        : (billingForm.paymentMode === "Debit Card" ? billingForm.debitCardLast4 : ""),
      cardMdrPercent: isCard ? billCalculations.activeMdrPercent : 0,
      cardMdrAmount: isCard ? billCalculations.cardMdrAmount : 0,
      cardNetSettlement: isCard ? billCalculations.cardNetSettlement : 0,
      
      // A split bill with a Finance row carries the same finance details: the
      // Finance row is the loan, the other rows are what the customer paid.
      ...(splitHasFinance && splitPaymentsPayload
        ? {
            financeProvider: billingForm.financeProvider,
            financeDoId: billingForm.financeDoId || "",
            financeAppId: billingForm.financeAppId || "",
            financeApprovalStatus: billingForm.financeApprovalStatus,
            financePdfUrl: billingForm.financePdfUrl || "",
            financeDownPayment: paidAmt,
            financeDownPaymentMode: "Split",
            financeGrossLoan: splitFinanceAmount,
            financeNetLoan: splitFinanceAmount,
          }
        : {
            financeProvider: isFinance ? billingForm.financeProvider : "",
            financeDoId: isFinance ? billingForm.financeDoId : "",
            financeAppId: isFinance ? billingForm.financeAppId : "",
            financeDownPayment: isFinance ? (Number(billingForm.financeDownPayment) || 0) : 0,
            financeDownPaymentMode: isFinance ? (billingForm.financeDownPaymentMode || "Cash") : "",
            financeGrossLoan: isFinance ? (billCalculations.grandTotal - downPay) : 0,
            financeNetLoan: isFinance ? (billCalculations.grandTotal - downPay) : 0,
          }),

      // Due specifics
      dueAdvanceAmount: isDueCredit ? (Number(billingForm.advanceAmount || billingForm.dueAdvanceAmount) || 0) : 0,
      dueAdvanceMode: isDueCredit ? (billingForm.dueAdvanceMode || "Cash") : "",
      notes: billingForm.dueRemarks || billingForm.cashRemarks || billingForm.upiRemarks || "",
    };

    if (isEditingInvoice) {
      setEditAuthError(null);
      setPendingEdit(finalPayload);
      return;
    }
    createInvoiceMutation.mutate(finalPayload);
  };

  return (
    <>
      <Dialog open={isOpen && !offlineInvoiceToPrint} onOpenChange={onClose}>
        <DialogContent className="max-w-6xl max-h-[94vh] overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-5 rounded-t-2xl flex items-center justify-between border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Receipt className="w-5 h-5 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                  {isEditingInvoice ? `Edit Tax Invoice ${editInvoice?.invoiceNumber || ""}` : mode === "estimate" ? "Create Commercial Estimate" : mode === "sales-order" ? "Sales Order Booking" : mode === "credit-note" ? "Issue Credit Note" : `${billingEntity ? entityLabel(billingEntity) : "New"} Tax Invoice Billing`}
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#76C043]/20 text-[#76C043] border border-[#76C043]/30 font-mono font-bold">
                    {mode === "credit-note" ? "CREDIT NOTE" : mode === "estimate" ? "COMMERCIAL ESTIMATE" : mode === "sales-order" ? "SALES ORDER" : "TAX INVOICE (ORIGINAL)"}
                  </span>
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  {billingEntity
                    ? `Billing for: ${entityLabel(billingEntity)} • ${BILLING_ENTITIES[billingEntity].printName} • GSTIN: 09ANHPJ7242D1Z2`
                    : "Choose Value Plus or Ashoka Enterprises to start the bill"}
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleFinalSubmit} className="p-6 space-y-6 bg-slate-50/70">
            {isEditingInvoice ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-slate-700">
                Editing bill <strong className="font-mono text-[#3F63AD]">{editInvoice?.invoiceNumber}</strong> of{" "}
                <strong>{billingEntity ? entityLabel(billingEntity) : ""}</strong>, dated <strong>{String(editInvoice?.date || "").slice(0, 10)}</strong>.
                Number and company stay the same; the Admin or Store Manager can change the Bill Date below. Changes by anyone other than the Admin are made only after the Admin approves them. Stock,
                serial numbers, the customer&apos;s balance and payment are corrected when you save (Security PIN needed).
              </div>
            ) : (
            <BillingEntityPicker
              value={billingEntity}
              onChange={chooseBillingEntity}
              question="Is this bill for Value Plus or Ashoka Enterprises?"
              hint={
                billingEntity
                  ? `Only ${entityLabel(billingEntity)} products are listed below. Changing this removes the other company's products from the bill.`
                  : "Choose one to start. The product list will show only that company's products."
              }
            />
            )}

            {/* Everything below stays locked until the company is chosen. */}
            <div
              className={cn("space-y-6", !billingEntity && "opacity-40 pointer-events-none select-none")}
              aria-disabled={!billingEntity}
            >
            {/* SECTION 1: CUSTOMER-FIRST BILLING FORM */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#3F63AD]" /> 1. CUSTOMER PARTICULARS (CUSTOMER-FIRST IDENTIFICATION)
                </h4>
                <div className="text-xs text-slate-500 font-semibold">
                  Default: <span className="text-[#3F63AD] font-bold">Gorakhpur, Uttar Pradesh</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* 1. CUSTOMER NAME — RESTRICTED TO ALPHABETS ONLY */}
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    Customer Name * <span className="text-[10px] text-slate-500 font-normal">(Alphabets & spaces only)</span>
                  </Label>
                  <Input 
                    placeholder="e.g. Ajay Tiwari / Mohd Dilshad" 
                    value={billingForm.customerName} 
                    onChange={(e) => {
                      const cleanLetters = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                      // Every word starts capitalised regardless of how it was
                      // typed (Caps Lock on/off, mixed case) — the rest of each
                      // word is left exactly as typed, only the first letter of
                      // each word (start of string, or right after a space) is
                      // forced uppercase.
                      const capitalized = cleanLetters.replace(/(^|\s)([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
                      setBillingForm({ ...billingForm, customerName: capitalized });
                    }}
                    className="bg-slate-50 border-slate-300 font-bold text-slate-900"
                    autoFocus
                  />
                </div>

                {/* 2. PRIMARY MOBILE NUMBER */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-[#3F63AD]" /> Mobile Number *
                  </Label>
                  <div className="relative">
                    <Input 
                      type="text"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      value={billingForm.customerPhone} 
                      onChange={(e) => handlePhoneLookup(e.target.value)}
                      className={cn(
                        "bg-slate-50 border-slate-300 font-mono tracking-wider",
                        phoneLookupStatus === "existing" && "border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-100",
                        phoneLookupStatus === "new" && "border-amber-400 bg-amber-50/50 ring-2 ring-amber-100"
                      )}
                    />
                    {phoneLookupStatus === "existing" && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 text-xs font-bold">✓ Exists</span>
                    )}
                  </div>
                </div>

                {/* 2b. ALTERNATE MOBILE NUMBER */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Phone className="w-3.5 h-3.5 text-slate-400" /> Alternate Mobile (Optional)
                  </Label>
                  <Input 
                    type="text"
                    maxLength={10}
                    placeholder="10-digit alt phone"
                    value={billingForm.customerAltPhone || ""} 
                    onChange={(e) => setBillingForm({ ...billingForm, customerAltPhone: e.target.value.replace(/\D/g, '') })}
                    className="bg-slate-50 border-slate-300 font-mono tracking-wider text-xs"
                  />
                </div>

                {/* 3. DOCUMENT NUMBER */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Doc / Invoice No.</Label>
                  <Input value={billingForm.invoiceNo} readOnly={isEditingInvoice} onChange={e => setBillingForm({ ...billingForm, invoiceNo: e.target.value })} className="font-mono text-xs font-bold text-[#3F63AD] bg-blue-50/60 border-blue-200" />
                </div>

                {/* 3b. BILL DATE — only the Admin and the Store Manager can date a bill
                    earlier; a Store Manager's back-dated bill goes to the Admin to approve. */}
                {mode === "invoice" && ["admin", "superadmin", "manager"].includes(userRole) && (
                  <div className="space-y-1.5 md:col-span-1">
                    <Label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Bill Date</Label>
                    <Input
                      type="date"
                      value={billingForm.invoiceDate}
                      max={todayInIndia()}
                      onChange={(e) => setBillingForm({ ...billingForm, invoiceDate: e.target.value || todayInIndia() })}
                      className={cn(
                        "font-mono text-xs",
                        billingForm.invoiceDate < todayInIndia() && "border-amber-400 bg-amber-50 text-amber-900"
                      )}
                    />
                    {billingForm.invoiceDate < todayInIndia() && (
                      <p className="text-[10px] font-semibold text-amber-700">
                        {userRole === "manager"
                          ? "Back-dated — the Admin will be asked to approve this bill."
                          : "Back-dated bill."}
                      </p>
                    )}
                  </div>
                )}

                {/* 4. BILLING ADDRESS GROUP */}
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-bold text-slate-800 flex items-center justify-between">
                    <span>🏢 Customer Billing Address *</span>
                    <span className="text-[10px] text-slate-400 font-normal">For GST / Tax Invoice</span>
                  </Label>
                  <Input 
                    placeholder="Street / House No., Area / Landmark" 
                    value={billingForm.customerAddress} 
                    onChange={(e) => setBillingForm({ ...billingForm, customerAddress: e.target.value })} 
                    className="bg-slate-50 border-slate-300 font-medium text-xs"
                  />
                </div>

                {/* 5. BILLING STATE */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700">Billing State</Label>
                  <Select value={billingForm.customerState} onValueChange={(v) => setBillingForm({ ...billingForm, customerState: v, placeOfSupply: `${v}(09)` })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300 font-semibold text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INDIA_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* 6. BILLING CITY & PINCODE */}
                <div className="space-y-1.5 md:col-span-1">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[11px] font-semibold text-slate-700">City</Label>
                      <Input 
                        value={billingForm.customerCity} 
                        onChange={(e) => setBillingForm({ ...billingForm, customerCity: e.target.value })} 
                        className="bg-slate-50 border-slate-300 font-semibold text-xs h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-[11px] font-semibold text-slate-700">Pincode</Label>
                      <Input 
                        placeholder="273001"
                        maxLength={6}
                        value={billingForm.customerPin} 
                        onChange={(e) => setBillingForm({ ...billingForm, customerPin: e.target.value.replace(/\D/g, '') })} 
                        className="font-mono bg-slate-50 border-slate-300 font-semibold text-xs h-9"
                      />
                    </div>
                  </div>
                </div>

                {/* 7. SHIPPING ADDRESS SECTION & SAME AS BILLING CHECKBOX */}
                <div className="md:col-span-4 p-3 bg-blue-50/40 rounded-xl border border-blue-100 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="w-4 h-4 text-[#30539C]" />
                      <span className="text-xs font-bold text-slate-900">Shipping & Delivery Destination</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer bg-white px-2.5 py-1 rounded-lg border border-slate-200 shadow-2xs hover:bg-slate-50">
                      <input 
                        type="checkbox"
                        checked={billingForm.isShippingSameAsBilling}
                        onChange={(e) => setBillingForm({ ...billingForm, isShippingSameAsBilling: e.target.checked })}
                        className="w-4 h-4 rounded text-[#30539C] focus:ring-[#30539C]"
                      />
                      <span className="text-xs font-semibold text-slate-700 select-none">
                        Same as Billing Address
                      </span>
                    </label>
                  </div>

                  {/* CUSTOM SHIPPING ADDRESS (SHOWN WHEN UNCHECKED) */}
                  {!billingForm.isShippingSameAsBilling && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1 animate-in fade-in slide-in-from-top-1">
                      <div className="md:col-span-2 space-y-1">
                        <Label className="text-[11px] font-bold text-blue-900">Shipping Street Address *</Label>
                        <Input 
                          placeholder="e.g. Delivery Address / Site / Office / Relative's House" 
                          value={billingForm.shippingAddress} 
                          onChange={(e) => setBillingForm({ ...billingForm, shippingAddress: e.target.value })} 
                          className="bg-white border-blue-200 text-xs font-medium"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] font-semibold text-slate-700">Shipping State</Label>
                        <Select value={billingForm.shippingState} onValueChange={(v) => setBillingForm({ ...billingForm, shippingState: v })}>
                          <SelectTrigger className="bg-white border-blue-200 text-xs font-medium"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {INDIA_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-700">City</Label>
                          <Input 
                            value={billingForm.shippingCity} 
                            onChange={(e) => setBillingForm({ ...billingForm, shippingCity: e.target.value })} 
                            className="bg-white border-blue-200 text-xs font-medium h-9"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] font-semibold text-slate-700">Pin</Label>
                          <Input 
                            maxLength={6}
                            placeholder="273001"
                            value={billingForm.shippingPin} 
                            onChange={(e) => setBillingForm({ ...billingForm, shippingPin: e.target.value.replace(/\D/g, '') })} 
                            className="font-mono bg-white border-blue-200 text-xs font-medium h-9"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DISPATCH / DELIVERY TIMING MODE SELECTOR — bills only; an estimate
                      is a quotation, nothing is handed over yet. */}
                  {mode !== "estimate" && (
                  <div className="pt-2 border-t border-blue-100/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">Dispatch Mode:</span>
                      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => setBillingForm({ ...billingForm, dispatchType: "immediate" })}
                          className={cn(
                            "px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5",
                            billingForm.dispatchType === "immediate" 
                              ? "bg-[#30539C] text-white shadow-xs" 
                              : "text-slate-600 hover:text-slate-900"
                          )}
                        >
                          🏪 Immediate Handover
                        </button>
                        <button
                          type="button"
                          onClick={() => setBillingForm({ ...billingForm, dispatchType: "delayed_delivery" })}
                          className={cn(
                            "px-2.5 py-1 text-xs font-bold rounded-md transition-all flex items-center gap-1.5",
                            billingForm.dispatchType === "delayed_delivery" 
                              ? "bg-amber-600 text-white shadow-xs" 
                              : "text-slate-600 hover:text-slate-900"
                          )}
                        >
                          🚚 Delayed Home Delivery / Godown Dispatch
                        </button>
                      </div>
                    </div>

                    {billingForm.dispatchType === "delayed_delivery" && (
                      <span className="text-[11px] font-mono font-bold text-amber-800 bg-amber-100/80 px-2.5 py-1 rounded-md border border-amber-200 flex items-center gap-1.5">
                        <span>🔑 Auto Delivery OTP & WhatsApp Tracking Link will be generated</span>
                      </span>
                    )}
                    {billingForm.dispatchType === "delayed_delivery" && (
                      <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                        Delivery date *
                        <input
                          type="date"
                          value={billingForm.expectedDeliveryDate || ""}
                          min={billingForm.invoiceDate || undefined}
                          onChange={(e) => setBillingForm({ ...billingForm, expectedDeliveryDate: e.target.value })}
                          className={cn(
                            "h-8 rounded-md border bg-white px-2 text-xs font-mono",
                            billingForm.expectedDeliveryDate ? "border-slate-300" : "border-rose-400 bg-rose-50"
                          )}
                        />
                        <span className="font-normal text-slate-400">* confirm with the customer — a reminder comes 2 days before</span>
                      </label>
                    )}
                  </div>
                  )}
                </div>

                {/* 8. GSTIN */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700">Customer GSTIN (Optional)</Label>
                  <Input
                    placeholder="09XXXXX1234X1ZX"
                    value={billingForm.customerGstin}
                    onChange={(e) => {
                      const gstin = e.target.value;
                      // A GSTIN already used on an earlier invoice carries its
                      // company's name with it — typing one back in re-fills
                      // the name instead of asking the biller to retype it.
                      const matched = billingCompanies.find(
                        (c: any) => c.gstin?.toUpperCase() === gstin.trim().toUpperCase()
                      );
                      // A GSTIN's own 3rd-12th characters ARE the PAN — no
                      // separate PAN entry needed once 15 characters are in.
                      const cleanGstin = gstin.trim().toUpperCase();
                      const derivedPan = cleanGstin.length === 15 ? cleanGstin.slice(2, 12) : billingForm.customerPan;
                      setBillingForm({
                        ...billingForm,
                        customerGstin: gstin,
                        customerPan: derivedPan,
                        customerCompanyName: matched ? matched.companyName : billingForm.customerCompanyName,
                      });
                    }}
                    className="font-mono bg-slate-50 border-slate-300 text-xs uppercase"
                  />
                </div>

                {/* 9. Company Name — replaces a raw PAN field: PAN is derived
                    from the GSTIN itself, but the company's NAME is what
                    actually needs remembering for next time, so a B2B sale
                    can be billed under it again by picking it from here
                    instead of retyping the whole thing. */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700">Company Name (Optional)</Label>
                  <AutocompleteSearch
                    data={billingCompanies}
                    searchKeys={["companyName", "gstin"]}
                    displayKey="companyName"
                    subDisplayKey="gstin"
                    placeholder="e.g. Auroile Food & Beverages Pvt Ltd"
                    value={billingForm.customerCompanyName}
                    onSearchChange={(name) => {
                      const matched = billingCompanies.find((c: any) => c.companyName === name);
                      setBillingForm({
                        ...billingForm,
                        customerCompanyName: name,
                        customerGstin: matched ? matched.gstin : billingForm.customerGstin,
                      });
                    }}
                    className="w-full"
                    inputClassName="font-mono bg-slate-50 border-slate-300 text-xs uppercase"
                  />
                </div>

                {/* 10. FREIGHT / SHIPPING CHARGES (OPTIONAL) */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-emerald-600" /> Freight / Delivery Fee <span className="text-[10px] text-slate-400 font-normal">(Optional)</span>
                  </Label>
                  <Input 
                    type="number"
                    min="0"
                    placeholder="0.00 (Optional)" 
                    value={billingForm.freightCharges || billingForm.shippingCharges || ""} 
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value) || 0);
                      setBillingForm({ ...billingForm, freightCharges: val, shippingCharges: val });
                    }} 
                    className="font-mono bg-slate-50 border-slate-300 text-xs font-bold text-slate-800"
                  />
                </div>

                {/* 11. VEHICLE NUMBER */}
                <div className="space-y-1.5 md:col-span-1">
                  <Label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-blue-600" /> Vehicle Number (Optional)
                  </Label>
                  <Input 
                    placeholder="e.g. UP53 CA 1234" 
                    value={billingForm.vehicleNumber} 
                    onChange={(e) => setBillingForm({ ...billingForm, vehicleNumber: e.target.value })} 
                    className="font-mono bg-slate-50 border-slate-300 uppercase text-xs"
                  />
                </div>

                {/* 12. SALES EXECUTIVE */}
                <div className="space-y-1.5 md:col-span-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-slate-700">Sales Executive</Label>
                    {isIndividualStaff && (
                      <span className="text-[10px] text-amber-800 font-mono font-bold bg-amber-100/70 px-1 rounded border border-amber-300">
                        🔒 Auto Locked
                      </span>
                    )}
                  </div>
                  {isIndividualStaff ? (
                    <div className="h-9 px-3 bg-slate-100 border border-slate-300 rounded-md flex items-center justify-between font-bold text-xs text-[#30539C] select-none shadow-inner cursor-not-allowed">
                      <span>👤 {currentUserName}</span>
                      <span className="text-[10px] text-slate-400 font-mono uppercase">{userRole}</span>
                    </div>
                  ) : (
                    <Select
                      value={billingForm.salesExecutive}
                      onValueChange={(v) => {
                        salesExecutivePickedByHand.current = true;
                        setBillingForm({ ...billingForm, salesExecutive: v });
                      }}
                    >
                      <SelectTrigger className="bg-blue-50/50 border-blue-200 font-bold text-[#3F63AD]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-60">
                        {usersList.length > 0 ? (
                          usersList.map((u: any) => (
                            <SelectItem key={u._id || u.email} value={u.name}>
                              {u.name} {u.assignedBrand ? `(🏷️ ${u.assignedBrand} Rep)` : `(${u.role?.toUpperCase() || "STAFF"})`}
                            </SelectItem>
                          )).concat(
                            // A lead can name someone who is not in the user list; keep
                            // that name selectable rather than showing an empty box.
                            billingForm.salesExecutive && !usersList.some((u: any) => u.name === billingForm.salesExecutive)
                              ? [
                                  <SelectItem key="lead-salesman" value={billingForm.salesExecutive}>
                                    {billingForm.salesExecutive}
                                  </SelectItem>,
                                ]
                              : []
                          )
                        ) : (
                          <>
                            <SelectItem value="AMIT SINGH">AMIT SINGH (Head Store Exec)</SelectItem>
                            <SelectItem value="ROHAN VERMA">ROHAN VERMA (🏷️ Haier Rep)</SelectItem>
                            <SelectItem value="PRIYA SHARMA">PRIYA SHARMA (🏷️ Samsung Rep)</SelectItem>
                            <SelectItem value="VIKAS GUPTA">VIKAS GUPTA (🏷️ LG Rep)</SelectItem>
                            <SelectItem value="STORE MANAGER">STORE MANAGER (VIP Desk)</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* ACTIVE ESTIMATE FOUND BANNER */}
              {matchedEstimate && (
                <div className="mt-4 bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-2 border-amber-300 rounded-xl p-3.5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black flex-shrink-0 shadow-xs">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black text-amber-950 uppercase tracking-wide">
                          Active Quotation / Estimate Found:
                        </span>
                        <Badge className="bg-amber-200 text-amber-950 font-mono text-[11px] font-bold border-amber-300">
                          {matchedEstimate.estimateNumber}
                        </Badge>
                        <span className="font-mono font-black text-xs text-amber-900 bg-amber-100/80 px-2 py-0.5 rounded border border-amber-200">
                          ₹{Number(matchedEstimate.total || 0).toLocaleString("en-IN")}
                        </span>
                      </div>
                      <p className="text-xs text-amber-800 truncate mt-0.5">
                        Customer: <span className="font-bold">{matchedEstimate.customerName}</span> • Products: <span className="font-medium">{matchedEstimate.items?.map((it: any) => it.name).join(", ") || "Quotation Line Items"}</span>
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleLoadEstimate(matchedEstimate)}
                    className="h-8.5 px-4 text-xs font-black bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white shadow-sm flex-shrink-0 flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-200" /> Load Estimate Items into Bill
                  </Button>
                </div>
              )}
            </div>

            {/* SECTION 2: ITEMS, VP CODES, STOCK, SERIALS & EXTENDED WARRANTY */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                    <ShoppingCart className="w-4 h-4 text-[#3F63AD]" /> 2. PRODUCTS, VP CODES, INVENTORY STOCK & SERIAL / WARRANTY
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Select product to inspect live stock. For serialized units, choose from available serial numbers.
                  </p>
                </div>
                <Button type="button" size="sm" onClick={addLineItem} variant="outline" className="text-xs gap-1 border-[#3F63AD] text-[#3F63AD] font-bold">
                  <Plus className="w-3.5 h-3.5" /> Add Product Item
                </Button>
              </div>

              <div className="space-y-3">
                {billingForm.lineItems.map((item, idx) => {
                  // Rate is GST-inclusive: split it back into taxable + GST instead of adding GST on top.
                  const grossAmount = ((Number(item.rate) || 0) - (Number(item.discount) || 0)) * (Number(item.qty) || 1);
                  const rowEffectiveGstRate = gstinProvided ? 0 : (Number(item.gstRate) || 0);
                  const lineTaxable = grossAmount / (1 + (rowEffectiveGstRate / 100));
                  const lineGst = grossAmount - lineTaxable;
                  const warrantyAmt = Number(item.extendedWarrantyAmount) || 0;
                  const lineTotal = lineTaxable + lineGst + warrantyAmt;

                  const query = (item.name || "").toLowerCase().trim();
                  // The product list is limited to the company this bill is for.
                  const entityProducts = billingEntity
                    ? catalogItems.filter((p: any) => entityOf(p) === billingEntity)
                    : [];
                  const suggestions = query === ""
                    ? entityProducts
                    : entityProducts.filter(
                        (p: any) => p.name.toLowerCase().includes(query) || (p.code || "").toLowerCase().includes(query) || (p.vpCode || "").toLowerCase().includes(query)
                      );

                  // Filter available serial numbers for this item with robust matching
                  const itNameLower = (item.name || "").toLowerCase().trim();
                  const itCodeLower = (item.itemCode || "").toLowerCase().trim();
                  const itVpLower = (item.vpCode || "").toLowerCase().trim();
                  const itIdStr = item.itemId ? item.itemId.toString() : "";

                  const matchingSerials = serialNumbers.filter((s: any) => {
                    if (s.status !== "AVAILABLE") return false;
                    // Exclude if already chosen in another line item in the same invoice
                    const isSelectedInOtherRow = billingForm.lineItems.some((otherLine, otherIdx) => otherIdx !== idx && otherLine.serialNumber === s.serialNumber);
                    if (isSelectedInOtherRow) return false;

                    const sVp = (s.vpCode || "").toLowerCase().trim();
                    const sId = (s.itemId || "").toString();
                    const sName = (s.itemName || "").toLowerCase().trim();

                    if (itVpLower && sVp && sVp === itVpLower) return true;
                    if (itIdStr && sId && sId === itIdStr) return true;
                    if (itNameLower && sName && (sName === itNameLower || sName.includes(itNameLower) || itNameLower.includes(sName))) return true;
                    if (itCodeLower && sVp && (sVp === itCodeLower || sVp.includes(itCodeLower))) return true;

                    return false;
                  });

                  const isCollapsed = collapsedIds.has(item.id) && !!item.name;

                  if (isCollapsed) {
                    return (
                      <div
                        key={item.id}
                        onClick={() => setCollapsedIds(prev => { const next = new Set(prev); next.delete(item.id); return next; })}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 cursor-pointer transition-colors text-xs"
                      >
                        <span className="w-5 h-5 shrink-0 rounded-full bg-[#3F63AD] text-white flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-800 truncate flex-1 min-w-[8rem]">{item.name}</span>
                        {item.serialNumber && (
                          <span className="font-mono text-[10px] font-bold text-[#3F63AD] bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 shrink-0">
                            SN: {item.serialNumber}
                          </span>
                        )}
                        <span className="text-slate-500 font-mono shrink-0">{item.qty} × {formatCurrency(item.rate)}</span>
                        {Number(item.discount) > 0 && (
                          <span className="text-emerald-700 font-mono shrink-0">-{formatCurrency(item.discount)}</span>
                        )}
                        <span className="font-black text-[#3F63AD] font-mono shrink-0">{formatCurrency(lineTotal)}</span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removeLineItem(idx); }}
                          className="text-red-400 hover:text-red-600 p-0.5 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      ref={item.id === justAddedId ? lastRowRef : undefined}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 relative hover:border-blue-300 transition-colors"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 min-w-0">
                          <span className="w-6 h-6 shrink-0 rounded-full bg-[#3F63AD] text-white flex items-center justify-center text-xs font-bold">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-bold text-slate-800">
                            {item.name ? item.name : "Select or search product item..."}
                          </span>
                          {item.vpCode && (
                            <Badge variant="outline" className="font-mono text-[10px] font-bold bg-blue-50 text-[#3F63AD] border-blue-200">
                              VP CODE: {item.vpCode}
                            </Badge>
                          )}
                          {item.name && (item.showroomStock !== undefined || item.availableStock !== undefined) && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge className={cn(
                                "text-[10px] font-extrabold flex items-center gap-1 px-2 py-0.5 border shadow-2xs",
                                (item.showroomStock ?? item.availableStock ?? 0) > 0 
                                  ? "bg-blue-50 text-[#30539C] border-blue-300" 
                                  : "bg-red-50 text-red-800 border-red-200"
                              )}>
                                🏪 Showroom: <span className="font-mono font-black">{item.showroomStock ?? item.availableStock ?? 0} PCS</span>
                              </Badge>
                              <Badge className={cn(
                                "text-[10px] font-extrabold flex items-center gap-1 px-2 py-0.5 border shadow-2xs",
                                (item.godownStock ?? 0) > 0 
                                  ? "bg-amber-50 text-amber-900 border-amber-300" 
                                  : "bg-slate-100 text-slate-500 border-slate-200"
                              )}>
                                🏭 Godown: <span className="font-mono font-black">{item.godownStock ?? 0} PCS</span>
                              </Badge>
                            </div>
                          )}
                          {Number(item.incentiveValue || item.incentiveAmount) > 0 && item.incentiveType !== "none" && (
                            <Badge className={cn(
                              "font-mono text-[10px] font-bold",
                              (Number(item.incentiveTargetAmount) <= 0 || (Number(item.rate) || 0) >= (Number(item.incentiveTargetAmount) || 0))
                                ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                                : "bg-amber-50 text-amber-800 border-amber-300"
                            )}>
                              {(Number(item.incentiveTargetAmount) <= 0 || (Number(item.rate) || 0) >= (Number(item.incentiveTargetAmount) || 0))
                                ? (item.incentiveType === "percentage" 
                                    ? `🎁 Target Met: +${item.incentiveValue}% Inc` 
                                    : `🎁 Target Met: +₹${(Number(item.incentiveValue || item.incentiveAmount) || 0) * (Number(item.qty) || 1)} Inc`)
                                : `⚠️ Target: ₹${item.incentiveTargetAmount || 0} (₹0 Inc)`}
                            </Badge>
                          )}
                          {item.adminApprovedRate && (
                            <Badge className="bg-emerald-600 text-white font-mono text-[10px] font-bold">
                              ✅ Admin Approved Rate
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                          {item.name && (
                            <button
                              type="button"
                              onClick={() => setCollapsedIds(prev => new Set(prev).add(item.id))}
                              className="text-slate-500 hover:text-[#3F63AD] p-1 flex items-center gap-1 text-xs"
                              title="Collapse this row"
                            >
                              <ChevronsDownUp className="w-3.5 h-3.5" /> Collapse
                            </button>
                          )}
                          <button type="button" onClick={() => removeLineItem(idx)} className="text-red-500 hover:text-red-700 p-1 flex items-center gap-1 text-xs">
                            <Trash2 className="w-3.5 h-3.5" /> Remove
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                        {/* PRODUCT SEARCH & AUTOCOMPLETE */}
                        <div className="md:col-span-3 relative">
                          <Label className="text-[11px] font-semibold text-slate-700">Product / Item Search *</Label>
                          <Input
                            placeholder="Type to search electronics/mobile catalog..."
                            value={item.name}
                            onChange={(e) => { handleLineItemChange(idx, "name", e.target.value); setActiveSuggestRow(idx); }}
                            onFocus={() => setActiveSuggestRow(idx)}
                            onBlur={() => setTimeout(() => setActiveSuggestRow(null), 300)}
                            autoFocus={item.id === justAddedId}
                            className="h-8 text-xs bg-white border-slate-300 font-semibold"
                          />
                          {activeSuggestRow === idx && suggestions.length > 0 && (
                            <div className="absolute left-0 top-12 w-full bg-white border-2 border-[#3F63AD] shadow-2xl rounded-xl z-[9999] max-h-64 overflow-y-auto divide-y divide-slate-100 p-1.5">
                              <div className="px-3 py-1 bg-slate-100 text-[10px] font-bold text-slate-600 uppercase flex justify-between rounded-t-lg">
                                <span>Catalog Match ({suggestions.length} items)</span>
                                <span className="hidden sm:inline">🏪 Showroom & 🏭 Godown Live Stock</span>
                              </div>
                              {suggestions.map((prod: any, pIdx: number) => {
                                const shStock = prod.showroomStock !== undefined ? prod.showroomStock : (prod.currentStock || 0);
                                const gdStock = prod.godownStock !== undefined ? prod.godownStock : (prod.currentStock || 0);
                                const totStock = shStock + gdStock;

                                return (
                                  <div 
                                    key={pIdx} 
                                    onMouseDown={(e) => { e.preventDefault(); selectProductSuggestion(idx, prod); }} 
                                    className="p-2.5 hover:bg-blue-50/80 cursor-pointer flex items-center justify-between rounded-xl transition-colors"
                                  >
                                    <div className="min-w-0 pr-3">
                                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-[#3F63AD]">{prod.category || "Electronics"}</span>
                                        <span className="text-[9px] font-mono font-bold text-slate-600">VP: {prod.vpCode || prod.code}</span>
                                        {prod.brand && (
                                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">🏷️ {prod.brand}</span>
                                        )}
                                      </div>
                                      <p className="font-bold text-slate-900 text-xs truncate max-w-[180px] sm:max-w-[320px]">{prod.name}</p>
                                      
                                      {/* STOCK BREAKDOWN BADGES */}
                                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        <span className={cn(
                                          "text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md border flex items-center gap-1 shadow-2xs",
                                          shStock > 0 ? "bg-blue-50 text-[#30539C] border-blue-200" : "bg-red-50 text-red-700 border-red-200"
                                        )}>
                                          🏪 Showroom: <span className="font-mono font-black">{shStock}</span>
                                        </span>
                                        <span className={cn(
                                          "text-[9.5px] font-extrabold px-1.5 py-0.5 rounded-md border flex items-center gap-1 shadow-2xs",
                                          gdStock > 0 ? "bg-amber-50 text-amber-900 border-amber-200" : "bg-slate-100 text-slate-500 border-slate-200"
                                        )}>
                                          🏭 Godown: <span className="font-mono font-black">{gdStock}</span>
                                        </span>
                                        <span className="text-[9px] font-bold text-slate-500 font-mono">
                                          (Total: {totStock} Pcs)
                                        </span>
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <span className="font-black text-[#76C043] text-sm block">{formatCurrency(prod.sellingPrice || prod.rate || 0)}</span>
                                      <span className="text-[9px] font-bold text-emerald-700 block">VSP: {formatCurrency(prod.vsp || prod.sellingPrice || prod.rate || 0)}</span>
                                      <span className="text-[9.5px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100 mt-0.5 inline-block">
                                        + Select
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* SERIAL NUMBER DROPDOWN (EXPANDED TO 3 COLS) */}
                        <div className="md:col-span-3">
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-[11px] font-semibold text-slate-700">Serial Number (In Store)</Label>
                            {matchingSerials.length > 0 && (
                              <span className="text-[9.5px] font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded border border-emerald-200">
                                {matchingSerials.length} Available
                              </span>
                            )}
                          </div>
                          {matchingSerials.length > 0 ? (
                            <Select 
                              value={item.serialNumber || ""} 
                              onValueChange={(v) => handleLineItemChange(idx, "serialNumber", v)}
                            >
                              <SelectTrigger className="h-8 text-xs bg-white border-slate-300 font-mono font-bold text-[#3F63AD]">
                                <SelectValue placeholder="Select In-Store Serial #" />
                              </SelectTrigger>
                              <SelectContent>
                                {matchingSerials.map((s: any) => (
                                  <SelectItem key={s._id || s.serialNumber} value={s.serialNumber}>
                                    SN: {s.serialNumber}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input 
                              placeholder="e.g. 605PLTV314681" 
                              value={item.serialNumber || ""} 
                              onChange={(e) => handleLineItemChange(idx, "serialNumber", e.target.value)} 
                              className="h-8 text-xs bg-white border-slate-300 font-mono"
                            />
                          )}
                        </div>

                        {/* QTY */}
                        <div>
                          <Label className="text-[11px] font-semibold text-slate-700">Qty (Pcs)</Label>
                          <Input 
                            type="number" min="1" 
                            value={item.qty} 
                            onChange={(e) => handleLineItemChange(idx, "qty", Math.max(1, Number(e.target.value)))} 
                            className="h-8 text-xs bg-white border-slate-300 text-center font-bold"
                          />
                        </div>

                        {/* RATE */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-[11px] font-semibold text-slate-700">Rate (₹)</Label>
                            {item.minSellingPrice > 0 && (
                              <span className="text-[8.5px] font-mono text-amber-800 bg-amber-50 px-1 rounded border border-amber-200" title={`Min Floor Price: ₹${item.minSellingPrice}`}>
                                Min: ₹{item.minSellingPrice}
                              </span>
                            )}
                          </div>
                          <Input
                            type="number" min="0"
                            value={item.rate === 0 ? "" : item.rate}
                            onChange={(e) => handleLineItemChange(idx, "rate", Math.max(0, Number(e.target.value)))}
                            className={cn(
                              "h-8 text-xs bg-white border-slate-300 text-right font-semibold",
                              item.adminApprovedRate && "border-emerald-500 bg-emerald-50 text-emerald-900 font-bold",
                              item.minSellingPrice > 0 && item.rate < item.minSellingPrice && !item.adminApprovedRate && "border-amber-500 bg-amber-50 text-amber-900"
                            )}
                          />
                        </div>

                        {/* DISCOUNT */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Label className="text-[11px] font-semibold text-slate-700">Disc (₹)</Label>
                            {(item.maxDiscountAmount > 0 || item.maxDiscountPercent > 0) && (
                              <span className="text-[8.5px] font-mono text-amber-800 bg-amber-50 px-1 rounded border border-amber-200" title="Maximum allowed discount for this product">
                                Max: {item.maxDiscountAmount > 0 ? `₹${item.maxDiscountAmount}` : ""}{item.maxDiscountAmount > 0 && item.maxDiscountPercent > 0 ? " / " : ""}{item.maxDiscountPercent > 0 ? `${item.maxDiscountPercent}%` : ""}
                              </span>
                            )}
                          </div>
                          <Input
                            type="number" min="0"
                            value={item.discount === 0 ? "" : item.discount}
                            onChange={(e) => handleDiscountChangeAttempt(idx, Math.max(0, Number(e.target.value)))}
                            className="h-8 text-xs bg-white border-slate-300 text-right font-semibold text-emerald-700"
                          />
                        </div>

                        {/* GST % */}
                        <div>
                          <Label className="text-[11px] font-semibold text-slate-700">GST Slab</Label>
                          <Select value={String(item.gstRate)} onValueChange={(v) => handleLineItemChange(idx, "gstRate", Number(v))}>
                            <SelectTrigger className="h-8 text-xs bg-white border-slate-300 font-semibold"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">0%</SelectItem>
                              <SelectItem value="5">5%</SelectItem>
                              <SelectItem value="12">12%</SelectItem>
                              <SelectItem value="18">18% (Standard)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {/* EXTENDED WARRANTY PLAN & CUSTOM DETAILS */}
                        <div className="md:col-span-6 bg-purple-50/60 p-3 rounded-xl border border-purple-200 space-y-2.5">
                          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                            <Label className="text-xs font-bold text-purple-950 flex items-center gap-1.5">
                              <Shield className="w-3.5 h-3.5 text-purple-600" /> Extended Warranty & Device Protection
                            </Label>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-purple-700">Quick Plan:</span>
                              <Select 
                                value={WARRANTY_PLANS.find(p => p.name === item.extendedWarrantyPlan)?.id || (item.extendedWarrantyAmount > 0 ? "custom" : "none")} 
                                onValueChange={(v) => {
                                  if (v === "custom") {
                                    handleLineItemChange(idx, "extendedWarrantyProvider", "OneAssist");
                                    handleLineItemChange(idx, "extendedWarrantyDuration", 1);
                                    handleLineItemChange(idx, "extendedWarrantyAmount", 1499);
                                    handleLineItemChange(idx, "extendedWarrantyPlan", "Custom Extended Warranty");
                                  } else {
                                    handleLineItemChange(idx, "extendedWarrantyPlan", v);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-7 text-xs bg-white border-purple-300 font-bold text-purple-900 w-52">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {WARRANTY_PLANS.map((p) => (
                                    <SelectItem key={p.id} value={p.id}>
                                      {p.name} {p.price > 0 ? `(+₹${p.price.toLocaleString("en-IN")})` : ""}
                                    </SelectItem>
                                  ))}
                                  <SelectItem value="custom">⚙️ Custom Provider & Price</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          {(item.extendedWarrantyAmount > 0 || (item.extendedWarrantyPlan && item.extendedWarrantyPlan !== "none")) && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5 pt-1.5 border-t border-purple-200/80">
                              <div>
                                <Label className="text-[10px] font-bold text-purple-900">Provider Name *</Label>
                                <Select 
                                  value={item.extendedWarrantyProvider || "OneAssist"} 
                                  onValueChange={(v) => handleLineItemChange(idx, "extendedWarrantyProvider", v)}
                                >
                                  <SelectTrigger className="h-7 text-xs bg-white border-purple-300 font-bold text-slate-800">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {WARRANTY_PROVIDERS.map(pr => <SelectItem key={pr} value={pr}>{pr}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-[10px] font-bold text-purple-900">Duration (Years) *</Label>
                                <Select 
                                  value={String(item.extendedWarrantyDuration || 1)} 
                                  onValueChange={(v) => handleLineItemChange(idx, "extendedWarrantyDuration", Number(v))}
                                >
                                  <SelectTrigger className="h-7 text-xs bg-white border-purple-300 font-bold text-slate-800">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {WARRANTY_DURATIONS.map(d => <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>

                              <div>
                                <Label className="text-[10px] font-bold text-purple-900">Warranty Price (₹) *</Label>
                                <Input 
                                  type="number"
                                  min="0"
                                  placeholder="e.g. 1999"
                                  value={item.extendedWarrantyAmount || ""}
                                  onChange={(e) => handleLineItemChange(idx, "extendedWarrantyAmount", Math.max(0, Number(e.target.value) || 0))}
                                  className="h-7 text-xs bg-white border-purple-300 font-mono font-black text-purple-950"
                                />
                              </div>

                              <div>
                                <Label className="text-[10px] font-bold text-purple-900">Policy / Certificate No.</Label>
                                <Input 
                                  placeholder="e.g. OA-99281"
                                  value={item.extendedWarrantyPolicyNo || ""}
                                  onChange={(e) => handleLineItemChange(idx, "extendedWarrantyPolicyNo", e.target.value)}
                                  className="h-7 text-xs bg-white border-purple-300 font-mono text-xs"
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ROW TOTAL BAR */}
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200/80">
                        <div className="text-slate-600 flex items-center gap-3">
                          <span>Taxable Value: <strong className="text-slate-800">{formatCurrency(lineTaxable)}</strong></span>
                          <span>GST Tax: <strong className="text-slate-800">{formatCurrency(lineGst)}</strong></span>
                          {warrantyAmt > 0 && (
                            <span className="text-purple-700 font-semibold">Warranty: +{formatCurrency(warrantyAmt)}</span>
                          )}
                        </div>
                        <div className="font-extrabold text-sm text-slate-900">
                          Total Amount: <span className="text-[#3F63AD]">{formatCurrency(lineTotal)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button type="button" size="sm" onClick={addLineItem} variant="outline" className="w-full text-xs gap-1 border-[#3F63AD] text-[#3F63AD] font-bold border-dashed">
                <Plus className="w-3.5 h-3.5" /> Add Product Item
              </Button>
            </div>

            {/* CUSTOMER ADVANCE BOOKING TOKEN CREDIT BANNER */}
            {totalAvailableAdvance > 0 && mode === "invoice" && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-emerald-500/10 to-transparent border-2 border-amber-400/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-900 border border-amber-300 flex items-center justify-center font-black text-lg shrink-0 shadow-2xs">
                    💰
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-black text-amber-950 uppercase tracking-wide">
                        {bookingAdvanceTotal > 0 ? "Available Advance Credit" : "Payment Already Received"}: {formatCurrency(totalAvailableAdvance)}
                      </p>
                      <Badge className="bg-amber-600 text-white font-bold text-[10px] uppercase">
                        {customerAdvances[0]?.receiptNumber || "Receive Payment"}
                      </Badge>
                    </div>
                    {bookingAdvanceTotal > 0 && accountCredit > 0 && (
                      <p className="text-[11px] text-slate-700 mt-0.5 font-medium">
                        Advance Booking: <strong>{formatCurrency(bookingAdvanceTotal)}</strong> • Receive Payment: <strong>{formatCurrency(accountCredit)}</strong>
                      </p>
                    )}
                    {bookingAdvanceTotal === 0 && accountCredit > 0 && (
                      <p className="text-[11px] text-slate-700 mt-0.5 font-medium">
                        Paid earlier through Receive Payment and not yet used on any bill.
                      </p>
                    )}
                    <p className="text-[11px] text-slate-700 mt-0.5 font-medium">
                      {customerAdvances[0]?.productBooked ? (
                        <>Booked for: <strong className="text-amber-950">{customerAdvances[0].productBooked}</strong> • </>
                      ) : ""}
                      Customer deposit on file will be automatically deducted from this tax invoice.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {isEditingInvoice ? (
                    <span className="text-xs font-bold text-amber-950 bg-white px-3.5 py-2 rounded-xl border border-amber-400">
                      Deducted on this bill: <strong className="text-emerald-700 font-mono">-{formatCurrency(effectiveAdvanceAdjusted)}</strong> (stays as it was)
                    </span>
                  ) : (
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer bg-white px-3.5 py-2 rounded-xl border border-amber-400 shadow-2xs hover:bg-amber-50/50 transition-colors">
                    <input
                      type="checkbox"
                      checked={applyAdvanceCredit}
                      onChange={(e) => setApplyAdvanceCredit(e.target.checked)}
                      className="rounded w-4 h-4 text-[#30539C] focus:ring-[#30539C]"
                    />
                    <span className="text-amber-950">Deduct Advance: <strong className="text-emerald-700 font-mono">-{formatCurrency(effectiveAdvanceAdjusted)}</strong></span>
                  </label>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 3: PAYMENT MODES & RECONCILIATION */}

            {/* 3A. ESTIMATE QUOTATION TERMS (PRICE QUOTE ONLY BY DEFAULT) */}
            {mode === "estimate" && (
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-blue-700 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-600" /> 3. ESTIMATE QUOTATION TERMS
                  </h4>
                  <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 font-bold text-[10px]">
                    PRICE ESTIMATE ONLY
                  </Badge>
                </div>

                <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-200 space-y-3">
                  <div>
                    <p className="text-xs font-bold text-blue-950">Commercial Price Estimate (Quotation Only)</p>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Estimates are price quotes provided to customers before purchase. Payment modes and transaction settlement details are excluded from the estimate by default.
                    </p>
                  </div>

                  <div className="pt-2 border-t border-blue-200/80">
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={estimateIncludesAdvance}
                        onChange={(e) => setEstimateIncludesAdvance(e.target.checked)}
                        className="rounded text-[#30539C] focus:ring-[#30539C] w-4 h-4"
                      />
                      <span>Customer is paying an Advance Token Deposit with this Estimate</span>
                    </label>
                  </div>
                </div>

                {estimateIncludesAdvance && (
                  <div className="p-4 bg-amber-50/80 rounded-xl border-2 border-amber-400 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <Label className="font-bold text-amber-950">Advance Token Amount (₹) *</Label>
                      <Input
                        type="number"
                        min="1"
                        max={billCalculations.grandTotal}
                        value={preBookingAdvanceAmount}
                        onChange={(e) => setPreBookingAdvanceAmount(Math.max(1, Number(e.target.value)))}
                        className="bg-white border-amber-400 font-mono font-black text-emerald-800 mt-1 text-sm shadow-xs"
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-amber-950">Total Quotation Value (₹)</Label>
                      <Input readOnly value={formatCurrency(billCalculations.grandTotal)} className="bg-amber-100/60 border-amber-300 font-bold text-slate-900 mt-1" />
                    </div>
                    <div>
                      <Label className="font-bold text-amber-950">Remaining Due on Delivery (₹)</Label>
                      <Input readOnly value={formatCurrency(Math.max(0, billCalculations.grandTotal - preBookingAdvanceAmount))} className="bg-amber-100/80 border-amber-400 font-black text-amber-950 mt-1" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3B. PAYMENT MODES & RECONCILIATION (CASH, UPI, ONLINE, CREDIT CARD + MDR, DEBIT CARD, FINANCE, DUE) */}
            {(mode !== "estimate" || estimateIncludesAdvance) && (
              <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-3">
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-[#3F63AD]" /> 
                      {mode === "estimate" ? "3. TOKEN ADVANCE PAYMENT MODE SPECIFICATIONS" : "3. PAYMENT MODE SPECIFICATIONS & RECONCILIATION"}
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                    {mode !== "estimate" && (
                      <button
                        type="button"
                        onClick={() => setIsSplitPayment((v) => !v)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5",
                          isSplitPayment
                            ? "bg-[#76C043] text-white border-[#76C043] shadow-sm"
                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        )}
                        title="Collect one bill across several payment modes"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        Split Payment
                      </button>
                    )}
                    <div className={cn("flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg", isSplitPayment && "opacity-40 pointer-events-none")}>
                      {(mode === "estimate"
                        ? (["Cash", "UPI", "Credit Card", "Debit Card"] as const)
                        : (["Cash", "UPI", "Credit Card", "Debit Card", "Online", "Finance", "Due / Credit"] as const)
                      ).map((modeKey) => (
                        <button
                          key={modeKey}
                          type="button"
                          onClick={() => setBillingForm({ ...billingForm, paymentMode: modeKey })}
                          className={cn(
                            "px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1",
                            // While Split Payment is on, this single-mode row is
                            // disabled (see the opacity/pointer-events wrapper
                            // above) and no longer the source of truth — leaving
                            // a leftover mode highlighted here (e.g. "Credit
                            // Card" from before Split was turned on) reads as
                            // if that's still the active mode, when the real
                            // breakdown is whatever's in the split rows below.
                            !isSplitPayment && billingForm.paymentMode === modeKey
                              ? (modeKey === "Due / Credit"
                                  ? "bg-rose-600 text-white shadow-sm" 
                                  : modeKey === "Credit Card" 
                                  ? "bg-amber-600 text-white shadow-sm" 
                                  : modeKey === "Debit Card" 
                                  ? "bg-blue-600 text-white shadow-sm" 
                                  : "bg-[#3F63AD] text-white shadow-sm")
                              : "text-slate-700 hover:bg-slate-200"
                          )}
                        >
                          {modeKey}
                        </button>
                      ))}
                    </div>
                    </div>
                  </div>

                  {/* ─── SPLIT PAYMENT BUILDER ─────────────────────────────── */}
                  {isSplitPayment && (
                    <div className="p-4 bg-[#76C043]/5 rounded-xl border border-[#76C043]/40 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-bold text-slate-700">
                          Divide this bill across payment modes
                        </p>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span className="text-slate-500">
                            Bill <span className="font-black text-slate-900">{formatCurrency(activePaymentAmount)}</span>
                          </span>
                          <span className="text-slate-500">
                            Allocated <span className="font-black text-slate-900">{formatCurrency(splitAllocated)}</span>
                          </span>
                          <span
                            className={cn(
                              "px-2 py-1 rounded-md font-black border",
                              isSplitBalanced
                                ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                : splitRemaining > 0
                                ? "bg-amber-50 text-amber-800 border-amber-300"
                                : "bg-rose-50 text-rose-800 border-rose-300"
                            )}
                          >
                            {isSplitBalanced
                              ? "Balanced ✓"
                              : splitRemaining > 0
                              ? `Remaining ${formatCurrency(splitRemaining)}`
                              : `Over by ${formatCurrency(Math.abs(splitRemaining))}`}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        {splitRows.map((row, idx) => (
                          <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                            <div className="col-span-4 sm:col-span-3">
                              <select
                                value={row.mode}
                                onChange={(e) => updateSplitRow(idx, { mode: e.target.value })}
                                className="w-full h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800"
                              >
                                {SPLIT_MODE_OPTIONS.map((m) => (
                                  <option key={m} value={m}>{m}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-4 sm:col-span-3">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="Amount ₹"
                                value={row.amount}
                                onChange={(e) => updateSplitRow(idx, { amount: e.target.value })}
                                className="h-9 text-xs font-mono font-bold bg-white"
                              />
                            </div>
                            <div className="col-span-3 sm:col-span-4">
                              <Input
                                placeholder="Txn / UTR / Ref (optional)"
                                value={row.txnId}
                                onChange={(e) => updateSplitRow(idx, { txnId: e.target.value })}
                                className="h-9 text-xs bg-white"
                              />
                            </div>
                            <div className="col-span-1 sm:col-span-2 flex items-center gap-1 justify-end">
                              <button
                                type="button"
                                onClick={() => fillRemainingInRow(idx)}
                                title="Fill remaining amount here"
                                className="h-8 px-2 rounded-lg border border-slate-300 bg-white text-[10px] font-bold text-slate-600 hover:border-[#76C043] hover:text-[#76C043] whitespace-nowrap"
                              >
                                Fill
                              </button>
                              {splitRows.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() => removeSplitRow(idx)}
                                  title="Remove this row"
                                  className="h-8 w-8 rounded-lg border border-slate-300 bg-white text-slate-500 hover:text-rose-600 hover:border-rose-300 flex items-center justify-center"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={addSplitRow}
                          className="h-8 px-3 rounded-lg border border-slate-300 bg-white text-xs font-bold text-slate-700 hover:border-[#76C043] hover:text-[#76C043]"
                        >
                          + Add another mode
                        </button>
                        <p className="text-[11px] text-slate-500">
                          Collected now{" "}
                          <span className="font-mono font-bold text-emerald-700">{formatCurrency(splitCollected)}</span>
                          {splitAllocated - splitCollected > 0 && (
                            <>
                              {" · "}Receivable{" "}
                              <span className="font-mono font-bold text-rose-700">
                                {formatCurrency(splitAllocated - splitCollected)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>

                      {splitHasFinance && (
                        <div className="p-3 bg-orange-50/70 rounded-xl border border-orange-200 space-y-2">
                          <p className="text-xs font-black text-orange-950 flex items-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5 text-orange-600" /> Finance details for the{" "}
                            {formatCurrency(splitFinanceAmount)} Finance part
                          </p>
                          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                            <div>
                              <Label className="font-bold text-orange-950">Finance Company *</Label>
                              <Select
                                value={billingForm.financeProvider || undefined}
                                onValueChange={(v) => setBillingForm({ ...billingForm, financeProvider: v })}
                              >
                                <SelectTrigger
                                  className={cn(
                                    "bg-white border-orange-300 font-bold text-orange-900 mt-1",
                                    !billingForm.financeProvider && "border-rose-400 bg-rose-50"
                                  )}
                                >
                                  <SelectValue placeholder="Select finance company" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Bajaj Finance Limited">Bajaj Finance Limited</SelectItem>
                                  <SelectItem value="HDB Financial Services">HDB Financial Services</SelectItem>
                                  <SelectItem value="IDFC First Bank">IDFC First Bank</SelectItem>
                                  <SelectItem value="TVS Credit">TVS Credit</SelectItem>
                                  <SelectItem value="Kotak Mahindra Prime">Kotak Mahindra Prime</SelectItem>
                                  <SelectItem value="Home Credit India">Home Credit India</SelectItem>
                                  <SelectItem value="Other Finance">Other Finance Company</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="font-bold text-orange-950">Finance DO / Sanction ID</Label>
                              <Input
                                placeholder="e.g. B432262868"
                                value={billingForm.financeDoId}
                                onChange={(e) => setBillingForm({ ...billingForm, financeDoId: e.target.value })}
                                className="bg-white border-orange-300 font-mono font-bold mt-1"
                              />
                            </div>
                            <div>
                              <Label className="font-bold text-orange-950">Application / Deal ID</Label>
                              <Input
                                placeholder="e.g. CS289666676227"
                                value={billingForm.financeAppId}
                                onChange={(e) => setBillingForm({ ...billingForm, financeAppId: e.target.value })}
                                className="bg-white border-orange-300 font-mono mt-1"
                              />
                            </div>
                            <div>
                              <Label className="font-bold text-orange-950">Approval Status</Label>
                              <Select
                                value={billingForm.financeApprovalStatus}
                                onValueChange={(v: any) => setBillingForm({ ...billingForm, financeApprovalStatus: v })}
                              >
                                <SelectTrigger className="bg-white border-orange-300 font-bold text-slate-800 mt-1"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Pending">Pending</SelectItem>
                                  <SelectItem value="Under Review">Under Review</SelectItem>
                                  <SelectItem value="Approved">Approved</SelectItem>
                                  <SelectItem value="Disbursed">Disbursed</SelectItem>
                                  <SelectItem value="Reconciled">Reconciled</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      )}

                      {!isSplitBalanced && (
                        <p className="text-[11px] font-bold text-rose-700">
                          Rows must add up to {formatCurrency(activePaymentAmount)} before this bill can be saved.
                        </p>
                      )}
                    </div>
                  )}

                  {/* 1. CASH PAYMENT MODE */}
                  {!isSplitPayment && billingForm.paymentMode === "Cash" && (
                    <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-200 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <Label className="font-bold text-emerald-950">Cash Amount Payable (₹)</Label>
                        <Input readOnly value={formatCurrency(activePaymentAmount)} className="bg-white border-emerald-300 font-black text-emerald-800 text-sm mt-1" />
                      </div>
                      <div>
                        <Label className="font-bold text-emerald-950">Cash Received By</Label>
                        <Input value={billingForm.cashReceivedBy} onChange={(e) => setBillingForm({ ...billingForm, cashReceivedBy: e.target.value })} className="bg-white border-emerald-300 mt-1" />
                      </div>
                      <div>
                        <Label className="font-bold text-emerald-950">Remarks / Cash Drawer Notes</Label>
                        <Input placeholder="Counter collection" value={billingForm.cashRemarks} onChange={(e) => setBillingForm({ ...billingForm, cashRemarks: e.target.value })} className="bg-white border-emerald-300 mt-1" />
                      </div>
                    </div>
                  )}

                  {/* 2. UPI PAYMENT MODE */}
                  {!isSplitPayment && billingForm.paymentMode === "UPI" && (
                    <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-200 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                      <div>
                        <Label className="font-bold text-blue-950">UPI Amount (₹)</Label>
                        <Input readOnly value={formatCurrency(activePaymentAmount)} className="bg-white border-blue-300 font-black text-blue-800 text-sm mt-1" />
                      </div>
                      <div>
                        <Label className="font-bold text-blue-950">UPI Ref / UTR / Transaction ID *</Label>
                        <Input placeholder="e.g. 423985729103" value={billingForm.upiTxnId} onChange={(e) => setBillingForm({ ...billingForm, upiTxnId: e.target.value })} className="bg-white border-blue-300 font-mono mt-1" />
                      </div>
                      <div>
                        <Label className="font-bold text-blue-950">Remarks</Label>
                        <Input placeholder="PhonePe / GPay / Paytm QR" value={billingForm.upiRemarks} onChange={(e) => setBillingForm({ ...billingForm, upiRemarks: e.target.value })} className="bg-white border-blue-300 mt-1" />
                      </div>
                    </div>
                  )}

                  {/* 3. ONLINE PAYMENT MODE */}
                  {!isSplitPayment && billingForm.paymentMode === "Online" && (
                    <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-200 grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <Label className="font-bold text-indigo-950">Online Amount (₹)</Label>
                        <Input readOnly value={formatCurrency(activePaymentAmount)} className="bg-white border-indigo-300 font-black text-indigo-800 text-sm mt-1" />
                      </div>
                      <div>
                        <Label className="font-bold text-indigo-950">Transaction ID *</Label>
                        <Input placeholder="TXN-9847192" value={billingForm.onlineTxnId} onChange={(e) => setBillingForm({ ...billingForm, onlineTxnId: e.target.value })} className="bg-white border-indigo-300 font-mono mt-1" />
                      </div>
                  <div>
                    <Label className="font-bold text-indigo-950">Payment Gateway / Source</Label>
                    <Select value={billingForm.onlineGateway} onValueChange={(v) => setBillingForm({ ...billingForm, onlineGateway: v })}>
                      <SelectTrigger className="bg-white border-indigo-300 mt-1 font-semibold"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Razorpay POS">Razorpay POS</SelectItem>
                        <SelectItem value="PineLabs Gateway">PineLabs Gateway</SelectItem>
                        <SelectItem value="HDFC SmartHub">HDFC SmartHub</SelectItem>
                        <SelectItem value="Direct NetBanking">NEFT / IMPS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="font-bold text-indigo-950">Reference ID</Label>
                    <Input placeholder="Ref #" value={billingForm.onlineRefId} onChange={(e) => setBillingForm({ ...billingForm, onlineRefId: e.target.value })} className="bg-white border-indigo-300 mt-1" />
                  </div>
                </div>
              )}

              {/* 4A. CREDIT CARD PAYMENT MODE WITH ADMIN-CONFIGURABLE MDR */}
              {!isSplitPayment && billingForm.paymentMode === "Credit Card" && (
                <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-300 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-amber-200 pb-2.5 gap-2">
                    <div>
                      <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-amber-700" /> Credit Card EDC Swipe & MDR Surcharge Configuration
                      </span>
                      <p className="text-[11px] text-amber-800 mt-0.5">
                        Merchant Discount Rate (MDR) deduction. Admin can choose preset or custom MDR %.
                      </p>
                    </div>

                    {/* ADMIN MDR QUICK PRESETS */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold text-amber-900 uppercase">Admin MDR:</span>
                      {[
                        { label: "0% (Free)", val: 0 },
                        { label: "1.5% Standard", val: 1.5 },
                        { label: "1.8% RuPay/Visa", val: 1.8 },
                        { label: "2.0% Default", val: 2.0 },
                        { label: "2.5% Corp/Amex", val: 2.5 },
                      ].map((preset) => (
                        <button
                          key={preset.val}
                          type="button"
                          onClick={() => setBillingForm({ ...billingForm, creditCardMdrPercent: preset.val })}
                          className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold transition-colors border",
                            Number(billingForm.creditCardMdrPercent) === preset.val
                              ? "bg-amber-600 text-white border-amber-700 shadow-xs"
                              : "bg-white text-amber-950 border-amber-300 hover:bg-amber-100"
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                    <div>
                      <Label className="font-bold text-amber-950">Card Swiped Amount (₹)</Label>
                      <Input readOnly value={formatCurrency(activePaymentAmount)} className="bg-white border-amber-300 font-black text-slate-900 mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="font-bold text-amber-950">EDC POS Swiper Machine</Label>
                      <Select 
                        value={billingForm.creditCardType} 
                        onValueChange={(v) => setBillingForm({ ...billingForm, creditCardType: v })}
                      >
                        <SelectTrigger className="bg-white border-amber-300 mt-1 font-semibold h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HDFC POS EDC">HDFC POS EDC Machine</SelectItem>
                          <SelectItem value="ICICI Merchant EDC">ICICI Merchant EDC</SelectItem>
                          <SelectItem value="SBI Card POS">SBI Card EDC Terminal</SelectItem>
                          <SelectItem value="Axis Bank EDC">Axis Bank EDC Machine</SelectItem>
                          <SelectItem value="PineLabs Smart POS">PineLabs Smart POS</SelectItem>
                          <SelectItem value="American Express EDC">Amex EDC Terminal</SelectItem>
                          <SelectItem value="Other POS Machine">Other POS Machine</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-amber-950">Txn / RRN / Approval Code *</Label>
                      <Input 
                        placeholder="e.g. RRN 49201938" 
                        value={billingForm.creditCardTxnId} 
                        onChange={(e) => setBillingForm({ ...billingForm, creditCardTxnId: e.target.value })} 
                        className="bg-white border-amber-300 font-mono mt-1 h-8" 
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-amber-950">Card Last 4 Digits</Label>
                      <Input 
                        maxLength={4}
                        placeholder="e.g. 4812" 
                        value={billingForm.creditCardLast4} 
                        onChange={(e) => setBillingForm({ ...billingForm, creditCardLast4: e.target.value.replace(/\D/g, '') })} 
                        className="bg-white border-amber-300 font-mono font-bold mt-1 h-8" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="font-bold text-amber-950">Custom MDR %</Label>
                        <span className="text-[10px] text-amber-700 font-semibold">(Admin Rate)</span>
                      </div>
                      <Input 
                        type="number" step="0.1" min="0" max="10" 
                        value={billingForm.creditCardMdrPercent} 
                        onChange={(e) => setBillingForm({ ...billingForm, creditCardMdrPercent: Math.max(0, Number(e.target.value) || 0) })} 
                        className="bg-white border-amber-300 font-bold text-amber-950 mt-1 h-8" 
                      />
                    </div>
                  </div>

                  <div className="bg-amber-100/70 p-2.5 rounded-lg border border-amber-200 text-[11px] text-amber-950 flex flex-wrap items-center justify-between gap-2">
                    <span>Card Invoice Total: <strong className="text-slate-900">{formatCurrency(activePaymentAmount)}</strong></span>
                    <span>Bank MDR Deducted: <strong className="text-red-700">-{formatCurrency((activePaymentAmount * Number(billingForm.creditCardMdrPercent || 2)) / 100)} ({billingForm.creditCardMdrPercent}%)</strong></span>
                    <span>Net Expected Bank Settlement: <strong className="text-emerald-800 text-xs font-black">{formatCurrency(activePaymentAmount - ((activePaymentAmount * Number(billingForm.creditCardMdrPercent || 2)) / 100))}</strong></span>
                  </div>
                </div>
              )}

              {/* 4B. DEBIT CARD PAYMENT MODE */}
              {!isSplitPayment && billingForm.paymentMode === "Debit Card" && (
                <div className="p-4 bg-blue-50/60 rounded-xl border border-blue-300 space-y-4">
                  <div className="flex items-center justify-between border-b border-blue-200 pb-2.5">
                    <div>
                      <span className="text-xs font-black text-blue-950 flex items-center gap-1.5">
                        <CreditCard className="w-4 h-4 text-blue-700" /> Debit Card POS Swipe (ATM / RuPay / Visa / Master Debit)
                      </span>
                      <p className="text-[11px] text-blue-800 mt-0.5">
                        Standard retail debit card transaction (Zero / Minimal MDR rate applicable).
                      </p>
                    </div>
                    <Badge className="bg-blue-600 text-white font-bold text-[10px]">DEBIT CARD POS</Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                    <div>
                      <Label className="font-bold text-blue-950">Debit Card Amount (₹)</Label>
                      <Input readOnly value={formatCurrency(activePaymentAmount)} className="bg-white border-blue-300 font-black text-slate-900 mt-1 h-8" />
                    </div>
                    <div>
                      <Label className="font-bold text-blue-950">EDC POS Swiper Machine</Label>
                      <Select 
                        value={billingForm.debitCardType} 
                        onValueChange={(v) => setBillingForm({ ...billingForm, debitCardType: v })}
                      >
                        <SelectTrigger className="bg-white border-blue-300 mt-1 font-semibold h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="HDFC POS EDC">HDFC POS EDC Machine</SelectItem>
                          <SelectItem value="ICICI Merchant EDC">ICICI Merchant EDC</SelectItem>
                          <SelectItem value="SBI Card POS">SBI Card EDC Terminal</SelectItem>
                          <SelectItem value="Axis Bank EDC">Axis Bank EDC Machine</SelectItem>
                          <SelectItem value="PineLabs Smart POS">PineLabs Smart POS</SelectItem>
                          <SelectItem value="Other POS Machine">Other POS Machine</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-blue-950">Txn / RRN / Approval Code *</Label>
                      <Input 
                        placeholder="e.g. RRN 59102938" 
                        value={billingForm.debitCardTxnId} 
                        onChange={(e) => setBillingForm({ ...billingForm, debitCardTxnId: e.target.value })} 
                        className="bg-white border-blue-300 font-mono mt-1 h-8" 
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-blue-950">Card Last 4 Digits</Label>
                      <Input 
                        maxLength={4}
                        placeholder="e.g. 1029" 
                        value={billingForm.debitCardLast4} 
                        onChange={(e) => setBillingForm({ ...billingForm, debitCardLast4: e.target.value.replace(/\D/g, '') })} 
                        className="bg-white border-blue-300 font-mono font-bold mt-1 h-8" 
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="font-bold text-blue-950">MDR %</Label>
                        <span className="text-[10px] text-emerald-700 font-bold">(0% Standard)</span>
                      </div>
                      <Input 
                        type="number" step="0.1" min="0" max="5" 
                        value={billingForm.debitCardMdrPercent} 
                        onChange={(e) => setBillingForm({ ...billingForm, debitCardMdrPercent: Math.max(0, Number(e.target.value) || 0) })} 
                        className="bg-white border-blue-300 font-bold text-blue-950 mt-1 h-8" 
                      />
                    </div>
                  </div>

                  <div className="bg-blue-100/70 p-2.5 rounded-lg border border-blue-200 text-[11px] text-blue-950 flex flex-wrap items-center justify-between gap-2">
                    <span>Debit Card Total: <strong className="text-slate-900">{formatCurrency(activePaymentAmount)}</strong></span>
                    <span>Bank MDR: <strong className={billingForm.debitCardMdrPercent > 0 ? "text-red-700" : "text-emerald-700"}>{billingForm.debitCardMdrPercent > 0 ? `-${formatCurrency((activePaymentAmount * Number(billingForm.debitCardMdrPercent || 0)) / 100)} (${billingForm.debitCardMdrPercent}%)` : "₹0.00 (0% Zero MDR)"}</strong></span>
                    <span>Net Settlement: <strong className="text-emerald-800 text-xs font-black">{formatCurrency(activePaymentAmount - ((activePaymentAmount * Number(billingForm.debitCardMdrPercent || 0)) / 100))}</strong></span>
                  </div>
                </div>
              )}

              {/* 5. FINANCE PAYMENT MODE */}
              {!isSplitPayment && billingForm.paymentMode === "Finance" && (
                <div className="p-4 bg-orange-50/60 rounded-xl border border-orange-200 space-y-4">
                  <div className="flex items-center justify-between border-b border-orange-200 pb-2">
                    <span className="text-xs font-black text-orange-950 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-orange-600" /> Finance Provider, Down Payment & DO Details
                    </span>
                    <Badge className="bg-orange-600 text-white font-bold text-[10px]">FINANCE SALE WORKFLOW</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <Label className="font-bold text-orange-950">Finance Provider *</Label>
                      <Select value={billingForm.financeProvider} onValueChange={(v) => setBillingForm({ ...billingForm, financeProvider: v })}>
                        <SelectTrigger className="bg-white border-orange-300 font-bold text-orange-900 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Bajaj Finance Limited">Bajaj Finance Limited</SelectItem>
                          <SelectItem value="HDB Financial Services">HDB Financial Services</SelectItem>
                          <SelectItem value="IDFC First Bank">IDFC First Bank</SelectItem>
                          <SelectItem value="TVS Credit">TVS Credit</SelectItem>
                          <SelectItem value="Kotak Mahindra Prime">Kotak Mahindra Prime</SelectItem>
                          <SelectItem value="Home Credit India">Home Credit India</SelectItem>
                          <SelectItem value="Other Finance">Other Finance Company</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Finance DO / Sanction ID *</Label>
                      <Input placeholder="e.g. B432262868" value={billingForm.financeDoId} onChange={(e) => setBillingForm({ ...billingForm, financeDoId: e.target.value })} className="bg-white border-orange-300 font-mono font-bold mt-1" />
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Application / Deal ID</Label>
                      <Input placeholder="e.g. CS289666676227" value={billingForm.financeAppId} onChange={(e) => setBillingForm({ ...billingForm, financeAppId: e.target.value })} className="bg-white border-orange-300 font-mono mt-1" />
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Customer Down Payment (₹)</Label>
                      <Input 
                        type="number" min="0" 
                        value={billingForm.financeDownPayment || ""} 
                        onChange={(e) => setBillingForm({ ...billingForm, financeDownPayment: Math.max(0, Number(e.target.value)) })} 
                        className="bg-white border-orange-300 font-bold text-emerald-800 mt-1" 
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Down Payment Mode *</Label>
                      <Select 
                        value={billingForm.financeDownPaymentMode || "Cash"} 
                        onValueChange={(v) => setBillingForm({ ...billingForm, financeDownPaymentMode: v })}
                      >
                        <SelectTrigger className="bg-white border-orange-300 font-bold text-slate-800 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Cash">Cash at Counter</SelectItem>
                          <SelectItem value="UPI">UPI / QR Code</SelectItem>
                          <SelectItem value="Card">Debit / Credit Card</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Gross Sanctioned Loan (₹)</Label>
                      <Input readOnly value={formatCurrency(Math.max(0, billCalculations.grandTotal - Number(billingForm.financeDownPayment || 0)))} className="bg-orange-100/70 border-orange-300 font-black text-orange-950 mt-1" />
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">Approval Status</Label>
                      <Select value={billingForm.financeApprovalStatus} onValueChange={(v: any) => setBillingForm({ ...billingForm, financeApprovalStatus: v })}>
                        <SelectTrigger className="bg-white border-orange-300 font-bold text-slate-800 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Pending">Pending</SelectItem>
                          <SelectItem value="Under Review">Under Review</SelectItem>
                          <SelectItem value="Approved">Approved</SelectItem>
                          <SelectItem value="Disbursed">Disbursed</SelectItem>
                          <SelectItem value="Reconciled">Reconciled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-orange-950">DO / Approval Attachment (Link, Image or PDF)</Label>
                      <div className="flex items-center gap-2 mt-1">
                        <Input placeholder="Attachment link or scan ref" value={billingForm.financePdfUrl} onChange={(e) => setBillingForm({ ...billingForm, financePdfUrl: e.target.value })} className="bg-white border-orange-300" />
                        <label className={cn(
                          "shrink-0 h-9 px-3 rounded-md border border-orange-300 bg-white text-orange-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-orange-50",
                          isUploadingFinanceDoc && "opacity-60 pointer-events-none"
                        )}>
                          <Upload className="w-3.5 h-3.5" />
                          {isUploadingFinanceDoc ? "Uploading..." : "Upload"}
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
                            className="hidden"
                            onChange={handleFinanceDocUpload}
                            disabled={isUploadingFinanceDoc}
                          />
                        </label>
                      </div>
                      {billingForm.financePdfUrl && (
                        <a
                          href={billingForm.financePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-blue-600 hover:underline font-semibold mt-1 inline-block"
                        >
                          📎 View attached file
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 6. DUE / CREDIT BILL MODE */}
              {!isSplitPayment && billingForm.paymentMode === "Due / Credit" && (
                <div className="p-4 bg-rose-50/60 rounded-xl border border-rose-200 space-y-3 text-xs">
                  <div className="flex items-center justify-between border-b border-rose-200 pb-2">
                    <span className="text-xs font-black text-rose-950 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-rose-600" /> Due / Credit Sale (Udhar Khata & Promise Date)
                    </span>
                    <Badge className="bg-rose-600 text-white font-bold text-[10px]">PENDING BALANCE BILL</Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                    <div>
                      <Label className="font-bold text-rose-950">Total Bill Amount (₹)</Label>
                      <Input readOnly value={formatCurrency(billCalculations.grandTotal)} className="bg-white border-rose-300 font-black text-slate-900 mt-1" />
                    </div>
                    <div>
                      <Label className="font-bold text-rose-950">Amount Received (₹)</Label>
                      <Input 
                        type="number" min="0" max={billCalculations.grandTotal}
                        value={billingForm.advanceAmount || ""} 
                        onChange={(e) => setBillingForm({ ...billingForm, advanceAmount: Math.max(0, Number(e.target.value)) })} 
                        placeholder="0.00"
                        className="bg-white border-rose-300 font-bold text-emerald-800 mt-1" 
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-rose-950">Payment Mode</Label>
                      <Select 
                        value={billingForm.dueAdvanceMode || "Cash"} 
                        onValueChange={(v) => setBillingForm({ ...billingForm, dueAdvanceMode: v })}
                      >
                        <SelectTrigger className="bg-white border-rose-300 font-bold text-slate-800 mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Cash">Cash</SelectItem>
                          <SelectItem value="UPI">UPI</SelectItem>
                          <SelectItem value="Card">Card</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="font-bold text-rose-950">Remaining Due Balance (₹)</Label>
                      <Input 
                        readOnly 
                        value={formatCurrency(Math.max(0, billCalculations.grandTotal - (Number(billingForm.advanceAmount) || 0)))} 
                        className="bg-rose-100/80 border-rose-300 font-black text-rose-700 mt-1" 
                      />
                    </div>
                    <div>
                      <Label className="font-bold text-rose-950 text-rose-900">Promised Due Date (Kab tak jama karega) *</Label>
                      <Input
                        type="date"
                        value={billingForm.dueDate || ""}
                        min={todayInIndia()}
                        max={new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0]}
                        onChange={(e) => {
                          const todayStr = todayInIndia();
                          const maxStr = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];
                          let picked = e.target.value;
                          if (picked && picked < todayStr) picked = todayStr;
                          if (picked && picked > maxStr) picked = maxStr;
                          setBillingForm({ ...billingForm, dueDate: picked });
                        }}
                        className="bg-white border-rose-300 font-bold text-rose-950 mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="font-bold text-rose-950">Customer Promise / Udhar Notes</Label>
                    <Input 
                      placeholder="e.g. Promised to pay balance via cash/UPI by next Friday" 
                      value={billingForm.dueRemarks || ""} 
                      onChange={(e) => setBillingForm({ ...billingForm, dueRemarks: e.target.value })} 
                      className="bg-white border-rose-300 mt-1" 
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            {/* SECTION 4: PAYMENT SUMMARY & TOTALS (REQ 13) */}
            <div className="bg-[#1B2537] text-white p-5 rounded-xl border border-slate-800 shadow-md grid grid-cols-1 md:grid-cols-4 gap-4 items-center">
              <div className="space-y-1 text-xs">
                <p className="text-slate-300">Total Items: <span className="font-bold text-white">{billingForm.lineItems.length} Products</span></p>
                <p className="text-slate-300">Taxable Amount: <span className="font-bold text-white">{formatCurrency(billCalculations.totalTaxable)}</span></p>
                <p className="text-slate-300">CGST + SGST: <span className="font-bold text-[#76C043]">{formatCurrency(billCalculations.cgst + billCalculations.sgst)}</span></p>
              </div>

              <div className="space-y-1 text-xs">
                {billCalculations.warrantyTotal > 0 && (
                  <p className="text-purple-300">Extended Warranty: <span className="font-bold text-purple-200">+{formatCurrency(billCalculations.warrantyTotal)}</span></p>
                )}
                {billCalculations.freight > 0 && (
                  <p className="text-emerald-300">Freight / Delivery: <span className="font-bold text-emerald-200">+{formatCurrency(billCalculations.freight)}</span></p>
                )}
                {mode === "invoice" && effectiveAdvanceAdjusted > 0 && (
                  <p className="text-amber-300 font-bold bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-500/40 flex justify-between">
                    <span>Advance Adjusted:</span>
                    <span>-{formatCurrency(effectiveAdvanceAdjusted)}</span>
                  </p>
                )}
                {/* billCalculations.cardMdrAmount assumes the WHOLE bill was
                    paid by card, which is only true for the single-mode flow
                    — a split bill's card MDR (if any row is a card) isn't
                    tracked here at all, so this line must not show during a
                    split rather than quote a wrong deduction. */}
                {!isSplitPayment && (billingForm.paymentMode === "Credit Card" || billingForm.paymentMode === "Debit Card") && (
                  <p className="text-amber-300">MDR Deducted: <span className="font-bold text-amber-200">-{formatCurrency(billCalculations.cardMdrAmount)}</span></p>
                )}
                <p className="text-slate-300">Round Off: <span className="font-bold text-white">{billCalculations.roundOff > 0 ? `+₹${billCalculations.roundOff}` : `₹${billCalculations.roundOff}`}</span></p>
                <p className="text-slate-300">
                  Payment Mode: <span className="font-bold uppercase text-[#76C043]">
                    {mode === "estimate"
                      ? (estimateIncludesAdvance ? `Token (${preBookingPaymentMode})` : "Quotation Only")
                      : isSplitPayment
                      // billingForm.paymentMode is a leftover from before Split
                      // Payment was turned on and no longer means anything —
                      // the split rows themselves are the actual modes in use.
                      ? `Split (${splitRows.filter((r) => (Number(r.amount) || 0) > 0).map((r) => r.mode).join(" + ") || "…"})`
                      : billingForm.paymentMode}
                  </span>
                </p>
              </div>

              <div className="space-y-1.5 text-xs bg-white/5 p-3 rounded-xl border border-white/10">
                <p className="text-slate-400 font-semibold uppercase text-[10px]">Salesperson Commission</p>
                <p className="font-bold text-white text-xs truncate">{billingForm.salesExecutive || "Counter Staff"}</p>
                <p className="text-emerald-400 font-mono font-bold text-xs mt-0.5 flex items-center gap-1">
                  <span>🎁 Earned Incentive:</span>
                  <span>+{formatCurrency(billCalculations.totalIncentive)}</span>
                </p>
              </div>

              <div className="text-right">
                {mode === "estimate" ? (
                  estimateIncludesAdvance ? (
                    <>
                      <p className="text-xs uppercase text-amber-300 font-semibold tracking-wider">Advance Token Received</p>
                      <p className="text-3xl font-black text-amber-400 tracking-tight">{formatCurrency(preBookingAdvanceAmount)}</p>
                      <p className="text-[11px] text-slate-300 font-mono mt-0.5">
                        Total Quote: {formatCurrency(billCalculations.grandTotal)} • Due: {formatCurrency(Math.max(0, billCalculations.grandTotal - preBookingAdvanceAmount))}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-xs uppercase text-blue-300 font-semibold tracking-wider">Total Estimated Quotation</p>
                      <p className="text-3xl font-black text-blue-400 tracking-tight">{formatCurrency(billCalculations.grandTotal)}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Price quote only (No payment collected)</p>
                    </>
                  )
                ) : (
                  <>
                    <p className="text-xs uppercase text-slate-400 font-semibold tracking-wider">
                      {effectiveAdvanceAdjusted > 0 ? "Net Payable (After Advance)" : "Net Amount Payable"}
                    </p>
                    <p className="text-3xl font-black text-[#76C043] tracking-tight">{formatCurrency(netAmountPayableAfterAdvance)}</p>
                    {effectiveAdvanceAdjusted > 0 && (
                      <p className="text-[11px] text-slate-400 font-mono">
                        Bill Total: {formatCurrency(billCalculations.grandTotal)} • Less Advance: -{formatCurrency(effectiveAdvanceAdjusted)}
                      </p>
                    )}
                    {!isSplitPayment && billingForm.paymentMode === "Finance" && (
                      <p className="text-xs text-orange-300 font-bold mt-1">
                        Down Pay: {formatCurrency(billingForm.financeDownPayment)} • Loan: {formatCurrency(Math.max(0, netAmountPayableAfterAdvance - Number(billingForm.financeDownPayment)))}
                      </p>
                    )}
                    {!isSplitPayment && billingForm.paymentMode === "Due / Credit" && (
                      <p className="text-xs text-rose-300 font-bold mt-1">
                        Paid: {formatCurrency(billingForm.advanceAmount || 0)} • Due: {formatCurrency(Math.max(0, netAmountPayableAfterAdvance - Number(billingForm.advanceAmount || 0)))}
                      </p>
                    )}
                    {isSplitPayment && (
                      <p className="text-xs text-[#76C043] font-bold mt-1">
                        {splitRows
                          .filter((r) => (Number(r.amount) || 0) > 0)
                          .map((r) => `${r.mode}: ${formatCurrency(Number(r.amount) || 0)}`)
                          .join(" • ") || "Add amounts to the split rows above"}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <DialogFooter className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-between">
              <span className="text-xs text-slate-500 font-medium">
                * Generates commercial Value Plus Tax Invoice matching official layout with dynamic multi-page rendering
              </span>
              <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
                <Button type="button" variant="ghost" onClick={onClose} className="text-slate-600">Cancel</Button>
                <Button 
                  type="submit" 
                  disabled={createInvoiceMutation.isPending || (mode === "invoice" && isIndividualStaff)} 
                  className={cn(
                    "font-bold px-6 shadow-lg",
                    mode === "invoice" && isIndividualStaff 
                      ? "bg-slate-400 cursor-not-allowed text-white" 
                      : mode === "estimate"
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-[#3F63AD] hover:bg-[#2E4F95] text-white"
                  )}
                >
                  {mode === "estimate" ? (
                    <><FileText className="w-4 h-4 mr-2" /> Generate Estimate</>
                  ) : mode === "sales-order" ? (
                    <><ShoppingCart className="w-4 h-4 mr-2" /> Book Sales Order</>
                  ) : mode === "credit-note" ? (
                    <><Receipt className="w-4 h-4 mr-2" /> Issue Credit Note</>
                  ) : (
                    <>
                      <Receipt className="w-4 h-4 mr-2" />
                      {isIndividualStaff ? "Restricted: Cashier Only" : isEditingInvoice ? "Save Changes" : "Finalize & Generate Invoice"}
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── Admin PIN Authorization Dialog (Floor Price Override) ─── */}
      <Dialog open={!!pinPrompt} onOpenChange={(open) => { if (!open) setPinPrompt(null); }}>
        <DialogContent className="max-w-md p-0 rounded-2xl border-none shadow-2xl overflow-y-auto bg-white z-[99999]">
          <div className="bg-gradient-to-r from-amber-600 to-amber-700 text-white p-5 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-md">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-base">Admin Price Override PIN</h3>
              <p className="text-xs text-amber-100">Supervisor approval required to sell below floor price</p>
            </div>
          </div>

          <div className="p-5 space-y-4">
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-xs space-y-2 max-h-40 overflow-y-auto">
              {(pinPrompt?.items || []).map((it, i) => (
                <div key={i} className={cn("space-y-1", i > 0 && "pt-2 border-t border-amber-200")}>
                  <p className="font-bold text-amber-950 line-clamp-1">{it.itemName}</p>
                  <div className="flex justify-between text-amber-900">
                    <span>Minimum Allowed Floor Price:</span>
                    <span className="font-mono font-bold">{formatCurrency(it.minPrice)}</span>
                  </div>
                  <div className="flex justify-between text-red-700 font-bold">
                    <span>Attempted Selling Rate:</span>
                    <span className="font-mono">{formatCurrency(it.proposedRate)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-800">Enter Admin 4-Digit Security PIN *</Label>
              <Input
                type="password"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={enteredPin}
                onChange={(e) => {
                  setEnteredPin(e.target.value);
                  setPinError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleVerifyAdminPin();
                  }
                }}
                className={cn(
                  "text-center text-2xl tracking-[0.5em] font-mono h-12 font-black border-2",
                  pinError ? "border-red-500 bg-red-50" : "border-amber-400 bg-slate-50"
                )}
              />
              {pinError ? (
                <p className="text-xs text-red-600 font-semibold text-center">Incorrect PIN! Supervisor authorization failed.</p>
              ) : (
                <p className="text-[11px] text-slate-500 text-center">Default supervisor PIN is <strong className="font-mono text-slate-700">1234</strong></p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setPinPrompt(null)}
                className="flex-1 text-xs"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleVerifyAdminPin}
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs gap-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" /> Authorize Rate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {isEditingInvoice && (
        <AuthorizePinDialog
          open={Boolean(pendingEdit)}
          onOpenChange={(open) => {
            if (!open) {
              setPendingEdit(null);
              setEditAuthError(null);
            }
          }}
          onConfirm={(result) => editInvoiceMutation.mutate(result)}
          title={`Save changes to ${editInvoice?.invoiceNumber || "invoice"}`}
          description="Stock, serial numbers, the customer's balance and the bill's payment will be corrected to match. The old and new bill are kept in the audit log with your reason."
          confirmLabel="Save Changes"
          destructive={false}
          isPending={editInvoiceMutation.isPending}
          errorMessage={editAuthError}
        />
      )}

      {/* AUTO-POPUP OFFICIAL TAX INVOICE PREVIEW & PRINT AFTER BILLING */}
      {generatedInvoiceToPrint && (
        <Dialog open={!!generatedInvoiceToPrint} onOpenChange={() => { setGeneratedInvoiceToPrint(null); onClose(); }}>
          <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-2">
            <ValueplusInvoice 
              invoiceData={generatedInvoiceToPrint} 
              onBack={() => { setGeneratedInvoiceToPrint(null); onClose(); }} 
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
