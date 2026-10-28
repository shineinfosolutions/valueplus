"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus, Trash2, ClipboardList, FileMinus, ShoppingBag, Phone, UserCheck, UserPlus, X,
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Barcode, ShieldAlert, Sparkles, ArrowRight,
  Store, Building2, Lock, Warehouse as WarehouseIcon, PackagePlus
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { useBranch } from "@/context/BranchContext";
import { PurchaseBillPrintModal } from "@/components/PurchaseBillPrintModal";
import { QuickAddItemModal } from "@/components/QuickAddItemModal";
import { BillingEntityPicker } from "@/components/shared/BillingEntityPicker";
import { entityOf, entityLabel, type BillingEntity } from "@/lib/billing-entity";
import { todayInIndia } from "@/lib/today";

// Stable reference for useQuery fallbacks — `= []` inline would create a brand-new
// array on every render while data is loading, which can make effects that depend on
// it think their dependency "changed" every render and loop forever.
const EMPTY_ARRAY: any[] = [];

function formatCurrency(val: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(val);
}

interface PurchaseCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "entry" | "debit-note" | "order";
  preloadedItem?: any;
  preloadedItems?: any[];
  /** Supplier name/phone/GSTIN read off an imported PDF's own letterhead —
   *  matched against Suppliers by phone first, then used to auto-fill the
   *  form so the admin doesn't have to retype what the invoice already says. */
  preloadedSupplier?: { name?: string; phone?: string; gstin?: string };
}

export function PurchaseCreationModal({ isOpen, onClose, mode = "entry", preloadedItem, preloadedItems, preloadedSupplier }: PurchaseCreationModalProps) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { activeLocation, locations } = useBranch();

  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const isSuperAdmin = userRole === "admin" || (session?.user as any)?.assignedWarehouseName === "ALL" || (session?.user as any)?.canSwitchWarehouse;
  const userAssignedBranch = (session?.user as any)?.assignedWarehouseName || activeLocation?.name || "Ashoka Enterprises (Kunraghat Showroom)";

  const [currentMode, setCurrentMode] = useState<"entry" | "debit-note" | "order">(mode);
  const [createdBillToPrint, setCreatedBillToPrint] = useState<any | null>(null);
  // Starts unset on purpose — the form used to silently assume "fully paid"
  // whenever nobody touched the amount field, which meant the supplier's
  // payable balance almost never actually recorded a pending amount. Forcing
  // an explicit Yes/No here closes that gap.
  // Starts as "no": a bill is pending until someone records what was paid.
  const [paymentMadeChoice, setPaymentMadeChoice] = useState<"yes" | "no" | null>("no");
  // Whose stock this purchase is — Value Plus or Ashoka Enterprises. Empty until
  // answered: it is never assumed, because it decides which bills the products
  // can later be sold on.
  const [billingEntity, setBillingEntity] = useState<BillingEntity | "">("");
  const [amountPaidNow, setAmountPaidNow] = useState<string>("");
  const [purchaseDueDate, setPurchaseDueDate] = useState<string>("");

  const { data: dbWarehouses = EMPTY_ARRAY } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Combined list of all available Showrooms and Godowns
  const allLocationsList = useMemo(() => {
    const list: Array<{ _id: string; name: string; type: string; code: string }> = [];
    const source = dbWarehouses.length > 0 ? dbWarehouses : locations;
    source.forEach((loc: any) => {
      const isG = loc.type ? loc.type === "godown" : (loc.name?.toLowerCase().includes("godown") || loc.name?.toLowerCase().includes("warehouse") || loc.name?.toLowerCase().includes("gida"));
      if (!list.some(x => x.name.toLowerCase() === loc.name.toLowerCase())) {
        list.push({
          _id: loc._id || loc.id || "",
          name: loc.name,
          type: isG ? "Central Godown" : "Showroom / Store",
          code: loc.code || "WH"
        });
      }
    });
    return list;
  }, [dbWarehouses, locations]);

  const { data: suppliers = EMPTY_ARRAY } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const [form, setForm] = useState({
    billNo: "",
    billDate: todayInIndia(),
    warehouse: userAssignedBranch,
    warehouseId: "" as string,
    supplierName: "",
    supplierPhone: "",
    supplierGST: "",
    supplierId: "" as string,
    linkedPoNo: "",
    noPoReason: "",
    items: [] as Array<{
      id: string;
      itemId: string;
      name: string;
      quantity: number;
      rate: number;
      gstRate: number;
      serialNumbers: string[];
      showSerials?: boolean;
      /** Marked by hand as a gift / accessory: serial numbers become optional. */
      noSerial?: boolean;
    }>,
  });

  // Gifts and accessories (a free bowl set, a remote, a stand) carry no serial
  // or IMEI, so for them it is optional. A line counts as one when its product's
  // category or name says so ("GIFT OTHER", "HAVELLS ACCESSORIES", …), or when
  // it is ticked by hand on the line.
  const GIFT_OR_ACCESSORY = /\b(gift|gifts|accessor(y|ies)|free\s*gift|complimentary|freebie)\b/i;
  const isSerialOptional = (row: { itemId: string; name: string; noSerial?: boolean }) => {
    if (row.noSerial) return true;
    const product: any = catalogItems.find((c: any) => c._id === row.itemId);
    // Brand is left out on purpose: the old stock sheet filled it with groups like
    // "GIFT & ACCESSORIES" (Bajaj coolers) and "MOBILE & ACCESSORIES" (phones,
    // which must keep their IMEI).
    return [product?.category, product?.name, row.name].some((v) => GIFT_OR_ACCESSORY.test(String(v || "")));
  };

  const prevIsOpenRef = React.useRef(false);

  // Sync mode prop & preloaded item with local state only when modal transitions to open
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setCurrentMode(mode);
      setBillingEntity("");
      setPaymentMadeChoice("no");
      setAmountPaidNow("");
      setPurchaseDueDate("");
      const defaultWh = userAssignedBranch || "Ashoka Enterprises (Kunraghat Showroom)";

      if (preloadedItem || (preloadedItems && preloadedItems.length > 0)) {
        const itemsToLoad = preloadedItems && preloadedItems.length > 0 ? preloadedItems : [preloadedItem];
        const firstItem = itemsToLoad[0];

        // A PDF's own letterhead (name/phone/GSTIN read straight off the
        // invoice) is real, admin-verifiable data — matched against the
        // Supplier master by phone first (the one field guaranteed unique
        // per supplier), then GSTIN, then name, so a supplier already on
        // file is reused instead of risking a near-duplicate record.
        let matchedSupplier = preloadedSupplier?.phone
          ? suppliers.find((s: any) => s.phone === preloadedSupplier.phone)
          : undefined;
        if (!matchedSupplier && preloadedSupplier?.gstin) {
          matchedSupplier = suppliers.find(
            (s: any) => s.gstNumber?.toUpperCase() === preloadedSupplier.gstin?.toUpperCase()
          );
        }
        if (!matchedSupplier && preloadedSupplier?.name) {
          matchedSupplier = suppliers.find(
            (s: any) => s.name?.trim().toLowerCase() === preloadedSupplier.name?.trim().toLowerCase()
          );
        }
        // No letterhead was read at all (Excel upload, or a PDF this
        // couldn't extract from) — fall back to the old brand-name guess
        // rather than leaving the field completely empty.
        if (!matchedSupplier && !preloadedSupplier) {
          matchedSupplier = suppliers.find((s: any) =>
            s.name?.toLowerCase().includes(firstItem.brand?.toLowerCase()) ||
            (firstItem.supplier && s.name?.toLowerCase().includes(firstItem.supplier?.toLowerCase()))
          );
        }

        const supplierName =
          matchedSupplier?.name ||
          preloadedSupplier?.name ||
          (firstItem.brand ? `${firstItem.brand} India Distribution` : "");

        setForm({
          billNo: "",
          billDate: todayInIndia(),
          warehouse: defaultWh,
          warehouseId: "",
          supplierName: supplierName,
          // Left blank (not a shared placeholder number) when no real supplier
          // matched. A hardcoded fallback phone here meant every unmatched
          // brand's auto-create lookup (which checks phone before name) found
          // the FIRST such supplier ever created and reused it — so "LG India
          // Distribution", "SAMSUNG India Distribution" etc. all silently
          // resolved to whichever brand got created first, and never became
          // their own Supplier record even though the PO/bill kept their real
          // name. Leaving it blank forces a real number before saving.
          supplierPhone: matchedSupplier?.phone || preloadedSupplier?.phone || "",
          supplierGST: matchedSupplier?.gstNumber || preloadedSupplier?.gstin || "",
          supplierId: matchedSupplier?._id || "auto",
          linkedPoNo: "",
          noPoReason: "",
          items: itemsToLoad.map((it: any) => {
            const reorderQty = Math.max(1, (Number(it.reorderLevel || 5) * 2) - Number(it.currentStock || 0));
            // `purchasePrice`/`rate` can legitimately be 0 (an imported row
            // resolveRows genuinely found no trustworthy price for) — `||`
            // would silently swap that for a guessed ₹1000-ish number, which
            // reads as a real price instead of the "unknown, please check"
            // signal it actually is. Only a truly absent value (no field at
            // all, e.g. a bare reorder suggestion with no purchase history)
            // falls through to the sellingPrice-based estimate.
            const knownRate = it.purchasePrice ?? it.rate;
            const purRate = Number(
              knownRate != null ? knownRate : (it.sellingPrice ? it.sellingPrice * 0.82 : 1000)
            );
            return {
              id: Math.random().toString(),
              // The real catalog _id must win here — a human-readable code
              // string in this field (the old priority order) can't be
              // matched back to the Item collection by _id at all, silently
              // breaking every _id-based lookup downstream (HSN code on the
              // GST report, stock updates falling back to a slower/fuzzier
              // name match instead of the direct one they're built for).
              itemId: it._id || it.code || it.vpCode || "ITEM",
              name: it.name,
              quantity: it.orderQty || reorderQty,
              // Rounded to the nearest whole rupee here used to silently
              // drop a supplier invoice's own paise — ₹23,864.41 became
              // ₹23,864 the moment it reached this form, even though the
              // exact figure was already sitting in `it.purchasePrice`.
              // Currency only ever needs 2 decimal places, not zero.
              rate: Math.round(purRate * 100) / 100,
              gstRate: Number(it.gstRate || 18),
              // Carry through any serials the import already found (e.g. from a
              // supplier PDF's serial-number table) instead of discarding them —
              // pre-expanded so they're immediately visible for review.
              serialNumbers: Array.isArray(it.serialNumbers) ? it.serialNumbers : [],
              showSerials: Array.isArray(it.serialNumbers) && it.serialNumbers.length > 0,
            };
          })
        });
      } else {
        setForm(prev => ({
          ...prev,
          warehouse: isSuperAdmin ? (prev.warehouse || defaultWh) : defaultWh
        }));
      }
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, mode, preloadedItem, preloadedItems, userAssignedBranch, isSuperAdmin]);

  const { data: catalogItems = EMPTY_ARRAY } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Fetched once so product search can also match by serial number (reverse-lookup to
  // the parent item), the same way name/code/vpCode already match.
  const { data: allSerials = EMPTY_ARRAY } = useQuery({
    queryKey: ["all-serial-numbers"],
    queryFn: async () => {
      const res = await fetch("/api/serial-numbers?status=AVAILABLE");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(null);
  const [quickAddContext, setQuickAddContext] = useState<{ rowId: string; initialName: string } | null>(null);

  const getCandidatesForQuery = (query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const byNameCode = catalogItems.filter((c: any) =>
      // A purchase only offers the products of the company it is for.
      (!billingEntity || entityOf(c) === billingEntity) &&
      ((c.name || "").toLowerCase().includes(q) ||
        (c.code || "").toLowerCase().includes(q) ||
        (c.vpCode || "").toLowerCase().includes(q))
    );
    const matchedIds = new Set(byNameCode.map((c: any) => c._id));
    const bySerial = allSerials
      .filter((s: any) => (s.serialNumber || "").toLowerCase().includes(q))
      .map((s: any) => catalogItems.find((c: any) => c._id === s.itemId || c.vpCode === s.vpCode || c.code === s.vpCode))
      .filter((c: any) => c && !matchedIds.has(c._id));
    return [...byNameCode, ...bySerial].slice(0, 20);
  };

  const { data: purchaseEntries = EMPTY_ARRAY } = useQuery({
    queryKey: ["purchase-entries"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-entries");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: purchaseOrders = EMPTY_ARRAY } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-orders");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const [supplierLookupStatus, setSupplierLookupStatus] = useState<"idle" | "existing" | "new">("idle");

  // Get active pending POs for the selected supplier
  const supplierPendingPOs = useMemo(() => {
    if (!form.supplierName) return [];
    return purchaseOrders.filter((po: any) => 
      po.supplierName?.trim().toLowerCase() === form.supplierName.trim().toLowerCase() && 
      po.status !== "received"
    );
  }, [purchaseOrders, form.supplierName]);

  const isDuplicateBillNo = useMemo(() => {
    if (!form.billNo || currentMode === "order") return false;
    const clean = form.billNo.trim().toLowerCase();
    return purchaseEntries.some((e: any) => 
      (e.billNo || e.billNumber || "").trim().toLowerCase() === clean && 
      e.type === (currentMode === "debit-note" ? "debit-note" : "entry")
    );
  }, [form.billNo, currentMode, purchaseEntries]);

  const handleSupplierPhoneLookup = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    setForm((prev) => ({ ...prev, supplierPhone: cleanPhone }));

    if (cleanPhone.length < 10) {
      setSupplierLookupStatus("idle");
      return;
    }

    if (cleanPhone.length === 10) {
      const found = suppliers.find((s: any) => s.phone === cleanPhone);
      if (found) {
        setForm((prev) => ({
          ...prev,
          supplierId: found._id,
          supplierName: found.name,
          supplierPhone: cleanPhone,
          supplierGST: found.gstNumber || "",
          // Items only came FROM a specific PO if one was actually linked —
          // dropping them here regardless used to wipe out a PDF-imported or
          // hand-typed item list the moment the admin finished correcting
          // the phone number, which has nothing to do with a PO at all.
          linkedPoNo: prev.linkedPoNo ? "" : prev.linkedPoNo,
          items: prev.linkedPoNo ? [] : prev.items,
        }));
        setSupplierLookupStatus("existing");
        toast.success(`Supplier found: ${found.name}`);
      } else {
        setForm((prev) => ({
          ...prev,
          supplierId: "new",
          // A supplier name already typed by hand, or auto-filled from an
          // imported invoice, must survive a phone edit that simply doesn't
          // match anyone yet — blanking it here threw away exactly what the
          // admin had just filled in.
          supplierName: prev.supplierName,
          supplierPhone: cleanPhone,
          linkedPoNo: prev.linkedPoNo ? "" : prev.linkedPoNo,
          items: prev.linkedPoNo ? [] : prev.items,
        }));
        setSupplierLookupStatus("new");
      }
    }
  };

  const handleSupplierSelect = (supplierName: string) => {
    const found = suppliers.find((s: any) => s.name === supplierName);
    if (found) {
      setForm(prev => ({
        ...prev,
        supplierName: found.name,
        supplierPhone: found.phone || "",
        supplierGST: found.gstNumber || "",
        supplierId: found._id,
        // Same reasoning as the phone lookup above: items only need
        // dropping if they came from a PO tied to the previous supplier.
        linkedPoNo: prev.linkedPoNo ? "" : prev.linkedPoNo,
        items: prev.linkedPoNo ? [] : prev.items,
      }));
      setSupplierLookupStatus("existing");
    }
  };

  const handleLoadPO = (poNo: string) => {
    const po = purchaseOrders.find((p: any) => p.poNo === poNo);
    if (!po) return;
    
    setForm(prev => ({
      ...prev,
      supplierName: po.supplierName,
      linkedPoNo: poNo,
      items: (po.items || []).map((i: any) => {
        const qty = Number(i.quantity) || 1;
        return {
          id: Math.random().toString(),
          itemId: i.itemId,
          name: i.name,
          quantity: qty,
          rate: Number(i.rate) || 0,
          gstRate: Number(i.gstRate) || 18,
          serialNumbers: Array.from({ length: qty }).map(() => ""),
          showSerials: true,
        };
      })
    }));
    toast.success(`Loaded items from Purchase Order ${poNo}`);
  };

  useEffect(() => {
    if (isOpen) {
      setForm(prev => {
        let newNo = "";
        if (currentMode === "order") {
          const numbers = purchaseOrders.map((p: any) => {
            const matches = (p.poNo || "").match(/\d+/g);
            return matches ? parseInt(matches[matches.length - 1], 10) : 0;
          });
          const maxNum = numbers.length ? Math.max(...numbers, 0) : 0;
          newNo = `PO-2026-${String(maxNum + 1).padStart(4, "0")}`;
        } else {
          const entriesOfMode = purchaseEntries.filter((x: any) => x.type === currentMode);
          const numbers = entriesOfMode.map((e: any) => {
            const matches = (e.billNo || "").match(/\d+/g);
            return matches ? parseInt(matches[matches.length - 1], 10) : 0;
          });
          const maxNum = numbers.length ? Math.max(...numbers, 0) : 0;
          if (currentMode === "debit-note") {
            newNo = `DN-2026-${String(maxNum + 1).padStart(4, "0")}`;
          } else {
            newNo = `BILL-2026-${String(maxNum + 1).padStart(4, "0")}`;
          }
        }
        return newNo === prev.billNo ? prev : { ...prev, billNo: newNo };
      });
    }
  }, [isOpen, currentMode, purchaseEntries, purchaseOrders]);

  const addLineItem = () => {
    setForm(prev => ({
      ...prev,
      items: [
        ...prev.items,
        {
          id: Math.random().toString(),
          itemId: "",
          name: "",
          quantity: 1,
          rate: 0,
          gstRate: 18,
          serialNumbers: [""],
          showSerials: true,
        }
      ]
    }));
  };

  const removeLineItem = (id: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.filter(item => item.id !== id)
    }));
  };

  const applyItemToRow = (rowId: string, catalogItem: any) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === rowId
          ? {
              ...item,
              itemId: catalogItem._id,
              name: catalogItem.name,
              rate: catalogItem.purchasePrice || 0,
              gstRate: catalogItem.gstRate || 18,
            }
          : item
      )
    }));
    setActiveSearchRowId(null);
  };

  const handleItemSelect = (rowId: string, itemId: string) => {
    const catalogItem = catalogItems.find((i: any) => i._id === itemId);
    if (!catalogItem) return;
    applyItemToRow(rowId, catalogItem);
  };

  const updateLineItem = (rowId: string, field: string, value: any) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id !== rowId) return item;

        if (field === "quantity") {
          const newQty = Math.max(1, Number(value));
          const currentSerials = item.serialNumbers || [];
          let updatedSerials: string[] = [];
          if (newQty > currentSerials.length) {
            updatedSerials = [
              ...currentSerials,
              ...Array.from({ length: newQty - currentSerials.length }).map(() => "")
            ];
          } else {
            updatedSerials = currentSerials.slice(0, newQty);
          }
          return { ...item, quantity: newQty, serialNumbers: updatedSerials };
        }

        return { ...item, [field]: value };
      })
    }));
  };

  const updateSerialNumber = (rowId: string, unitIndex: number, serialValue: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map(item => {
        if (item.id !== rowId) return item;
        const serials = [...(item.serialNumbers || [])];
        serials[unitIndex] = serialValue;
        return { ...item, serialNumbers: serials };
      })
    }));
  };

  const toggleSerialsDisplay = (rowId: string) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map(item =>
        item.id === rowId ? { ...item, showSerials: !item.showSerials } : item
      )
    }));
  };

  const totals = useMemo(() => {
    let subtotal = 0;
    let gst = 0;

    form.items.forEach(item => {
      const rowTotal = (item.quantity || 0) * (item.rate || 0);
      const rowGst = rowTotal * ((item.gstRate || 0) / 100);
      subtotal += rowTotal;
      gst += rowGst;
    });

    return {
      subtotal,
      gst,
      total: subtotal + gst,
    };
  }, [form.items]);

  // Only counts as paid once the cashier has explicitly said "yes" — picking
  // "no" always zeroes this out regardless of whatever is sitting in the
  // amount field, so there's no way to end up fully-paid by accident.
  const paidAmount = paymentMadeChoice !== "yes"
    ? 0
    : Math.max(0, Math.min(totals.total, Number(amountPaidNow) || 0));
  const balanceAmount = Math.max(0, totals.total - paidAmount);
  const entryPaymentStatus: "paid" | "partial" | "pending" =
    // Nothing paid is always pending — an empty bill (total 0) has no balance
    // either, and used to read as "paid" before a single rupee was entered.
    paidAmount <= 0 ? "pending" : (balanceAmount <= 0 ? "paid" : "partial");

  const saveMutation = useMutation({
    networkMode: "always",
    mutationFn: async () => {
      const effectiveWarehouseName = form.warehouse || userAssignedBranch;
      const resolvedWarehouseId =
        form.warehouseId || allLocationsList.find((l) => l.name === effectiveWarehouseName)?._id || "";
      const payload: any = {
        type: currentMode,
        billNo: form.billNo,
        warehouse: effectiveWarehouseName,
        warehouseId: resolvedWarehouseId,
        supplierName: form.supplierName,
        supplierPhone: form.supplierPhone,
        supplierGST: form.supplierGST,
        supplierId: form.supplierId,
        billDate: form.billDate,
        linkedPoNo: form.linkedPoNo,
        noPoReason: form.linkedPoNo ? "" : form.noPoReason.trim(),
        items: form.items.map(i => {
          // Frozen onto the purchase line at billing time, same reasoning as
          // the invoice side — the GST purchase register needs a per-product
          // HSN code the item form itself never collected directly.
          const catalogItem = catalogItems.find((c: any) => c._id === i.itemId);
          return {
            itemId: i.itemId,
            name: i.name,
            quantity: Number(i.quantity),
            rate: Number(i.rate),
            gstRate: Number(i.gstRate),
            hsn: catalogItem?.hsnCode || "",
            // A gift/accessory line may have no serials, or only some: blanks are
            // dropped so no empty serial record is created for it.
            serialNumbers: isSerialOptional(i)
              ? (i.serialNumbers || []).map((s) => String(s || "").trim()).filter(Boolean)
              : i.serialNumbers || [],
          };
        }),
        billingEntity: billingEntity || undefined,
        subtotal: totals.subtotal,
        gst: totals.gst,
        total: totals.total,
        paid: currentMode === "entry" ? paidAmount : 0,
        balance: currentMode === "debit-note" ? totals.total : (currentMode === "entry" ? balanceAmount : 0),
        status: currentMode === "entry" ? entryPaymentStatus : (currentMode === "order" ? "sent" : "pending"),
        dueDate: currentMode === "entry" && balanceAmount > 0 ? (purchaseDueDate || undefined) : undefined,
      };

      if (currentMode === "order") {
        payload.poNo = payload.billNo;
        payload.date = payload.billDate;
        payload.expectedDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
        payload.totalAmount = payload.total;
      }

      const endpoint = currentMode === "order" ? "/api/purchase-orders" : "/api/purchase-entries";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save");
      return json.data;
    },
    onSuccess: (data: any) => {
      toast.success(currentMode === "order" ? "Purchase Order Sent Successfully" : currentMode === "entry" ? "Purchase Inward Bill & IMEI Stock Logged" : "Debit Note Issued");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      queryClient.invalidateQueries({ queryKey: ["debit-notes"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["stock-flow"] });
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("erp-purchase-created", { detail: data }));
      }
      
      if (data) {
        setCreatedBillToPrint(data);
      }
      onClose();
      // Reset form
      setForm({
        billNo: "",
        billDate: todayInIndia(),
        warehouse: userAssignedBranch,
        warehouseId: "",
        supplierName: "",
        supplierPhone: "",
        supplierGST: "",
        supplierId: "",
        linkedPoNo: "",
        noPoReason: "",
        items: [],
      });
      setSupplierLookupStatus("idle");
      setBillingEntity("");
      setPaymentMadeChoice("no");
      setAmountPaidNow("");
      setPurchaseDueDate("");
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const handleSave = async () => {
    if (!form.supplierPhone || form.supplierPhone.length !== 10) {
      toast.error("Supplier mobile number (10 digits) is mandatory.");
      return;
    }
    if (!form.supplierName) {
      toast.error("Please enter or select a supplier name");
      return;
    }

    if (isDuplicateBillNo) {
      toast.error(`Purchase Bill #${form.billNo} already exists in the system! Each purchase entry must have a unique bill number.`);
      return;
    }

    if (form.items.length === 0) {
      toast.error("Please add or load at least one product item");
      return;
    }

    if (currentMode === "entry") {
      if (!billingEntity) {
        toast.error("Choose whether this purchase is for Value Plus or Ashoka Enterprises.");
        return;
      }
      // Rows added before the company was chosen (a preloaded product, an imported
      // sheet) can belong to the other one — caught here rather than on save.
      const others = form.items
        .map((row: any) => catalogItems.find((c: any) => c._id === row.itemId))
        .filter((c: any) => c && entityOf(c) !== billingEntity);
      if (others.length > 0) {
        toast.error(
          `${others.map((c: any) => c.name).join(", ")} belong${others.length === 1 ? "s" : ""} to ${entityLabel(others[0])}, not ${entityLabel(billingEntity)}. Remove ${others.length === 1 ? "it" : "them"} or change the company.`
        );
        return;
      }
    }

    // "Paid" with no amount used to mean fully paid, which is how bills ended up
    // marked paid by accident. A payment now has to be typed in to count.
    if (currentMode === "entry" && paymentMadeChoice === "yes" && !(Number(amountPaidNow) > 0)) {
      toast.error("Enter the amount paid to the supplier, or choose Pending.");
      return;
    }

    // A purchase entry with no linked PO is still allowed — it just has to
    // say why, so a direct entry always leaves an audit trail of the reason
    // rather than silently bypassing the PO process.
    if (currentMode === "entry" && !form.linkedPoNo && !form.noPoReason.trim()) {
      toast.error("Enter a reason for skipping the Purchase Order, or link an existing PO above.");
      return;
    }

    const hasIncompleteItem = form.items.some(i => !i.itemId || i.quantity <= 0);
    if (hasIncompleteItem) {
      toast.error("Please select products and ensure quantity > 0");
      return;
    }

    // MANDATORY IMEI / SERIAL NUMBER VALIDATION FOR PURCHASE ENTRY
    if (currentMode === "entry") {
      for (const item of form.items) {
        // Gifts and accessories: serial / IMEI is optional.
        if (isSerialOptional(item)) continue;
        const serials = item.serialNumbers || [];
        if (serials.length !== item.quantity) {
          toast.error(`Please enter all ${item.quantity} IMEI / Serial numbers for ${item.name}`);
          return;
        }
        for (let i = 0; i < serials.length; i++) {
          if (!serials[i] || !serials[i].trim()) {
            toast.error(`Unit #${i + 1} IMEI / Serial number is missing for "${item.name}"`);
            return;
          }
        }
      }

      // Check duplicate serial numbers within the entry
      const allSerials = form.items.flatMap(i => (i.serialNumbers || []).map(s => s.trim().toUpperCase()).filter(Boolean));
      const uniqueSerials = new Set(allSerials);
      if (uniqueSerials.size !== allSerials.length) {
        toast.error("Duplicate IMEI / Serial numbers detected. Every unit must have a unique identifier.");
        return;
      }
    }

    // Auto-create new supplier in Master Suppliers
    if (form.supplierPhone && form.supplierName) {
      try {
        const newSupPayload = {
          name: form.supplierName,
          phone: form.supplierPhone,
          gstNumber: form.supplierGST,
          status: "active",
          address: {
            line1: "Commercial Trade Hub / Store Outlet",
            city: "Mumbai",
            state: "Maharashtra",
            pincode: "400001",
            country: "India",
          }
        };
        const supRes = await fetch("/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSupPayload)
        });
        const supJson = await supRes.json();
        if (supJson.success && supJson.data?._id) {
          form.supplierId = supJson.data._id;
          queryClient.invalidateQueries({ queryKey: ["suppliers"] });
        }
      } catch (err) {
        console.error("Auto-create supplier failed:", err);
      }
    }

    saveMutation.mutate();
  };

  const isDebit = currentMode === "debit-note";
  const isOrder = currentMode === "order";
  const isEntry = currentMode === "entry";
  // A Purchase Entry no longer requires a linked PO — when none is linked, items are
  // picked/edited manually just like Order/Debit-note mode. Only a PO-linked entry
  // keeps its items locked to the agreed PO quantities/rates.
  const itemsAreEditable = !isEntry || !form.linkedPoNo;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl p-0 overflow-y-auto bg-slate-50 flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className={`p-6 text-white flex items-center justify-between shrink-0 ${isDebit ? 'bg-gradient-to-r from-red-950 via-red-900 to-red-950' : (isOrder ? 'bg-gradient-to-r from-amber-900 via-amber-800 to-amber-900' : 'bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537]')}`}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              {isDebit ? <FileMinus className="w-6 h-6 text-red-400" /> : (isOrder ? <ShoppingBag className="w-6 h-6 text-amber-400" /> : <ClipboardList className="w-6 h-6 text-[#76C043]" />)}
            </div>
            <div>
              <DialogTitle className="text-xl font-bold tracking-tight">
                {isDebit ? "Issue Debit Note (Purchase Return)" : (isOrder ? "Create Purchase Order" : "Record Purchase Inward Entry")}
              </DialogTitle>
              <DialogDescription className={`text-xs mt-0.5 ${isDebit ? 'text-red-200' : (isOrder ? 'text-amber-200' : 'text-slate-300')}`}>
                {isDebit 
                  ? "Record returns to supplier and adjust payables" 
                  : (isOrder 
                    ? "Send formal restocking purchase order to supplier" 
                    : "Link approved Purchase Order, log incoming inventory & record unit IMEI serial numbers")}
              </DialogDescription>
            </div>
          </div>

          {/* Mode Switcher pill if needed */}
          {isEntry && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (form.items.length > 0 && !confirm("This switches to creating a Purchase Order instead of a Purchase Entry (Supplier Bill) — it won't update stock or count as a received bill. Your entered items stay filled in. Continue?")) {
                    return;
                  }
                  setCurrentMode("order");
                  setForm(prev => ({ ...prev, linkedPoNo: "" }));
                }}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 text-xs h-8"
              >
                <ShoppingBag className="w-3.5 h-3.5 mr-1.5 text-amber-300" /> Create PO First
              </Button>
            </div>
          )}
          {isOrder && mode === "entry" && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentMode("entry")}
                className="bg-white/10 border-white/20 text-white hover:bg-white/20 text-xs h-8"
              >
                <ClipboardList className="w-3.5 h-3.5 mr-1.5 text-emerald-300" /> Back to Purchase Entry
              </Button>
            </div>
          )}
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isEntry && (
            <BillingEntityPicker
              value={billingEntity}
              onChange={setBillingEntity}
              question="Is this purchase for Value Plus or Ashoka Enterprises?"
              hint="The products on this bill will belong to the company you choose, and can only be sold on its bills."
            />
          )}

          {/* Supplier Details */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h4 className="text-sm font-semibold text-slate-800 flex items-center justify-between">
              <span className="flex items-center gap-2">1. Supplier & Voucher Details</span>
              {isEntry && (
                <span className="text-[11px] font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                  * Unit IMEI Required (PO Link Optional)
                </span>
              )}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600 flex items-center justify-between">
                  <span>{isOrder ? "Purchase Order No." : "Bill / Inward No. *"}</span>
                  {isDuplicateBillNo && <span className="text-[10px] text-rose-600 font-bold">ALREADY EXISTS!</span>}
                </Label>
                <Input
                  value={form.billNo}
                  onChange={(e) => setForm({ ...form, billNo: e.target.value })}
                  className={cn(
                    "bg-slate-50 font-mono text-sm font-bold",
                    isDuplicateBillNo ? "border-rose-500 text-rose-700 bg-rose-50/50 ring-1 ring-rose-200" : "text-[#3F63AD]"
                  )}
                />
                {isDuplicateBillNo && (
                  <p className="text-[10px] text-rose-600 font-bold flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="w-3 h-3" /> Bill #{form.billNo} already recorded! Must be unique.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Voucher Date</Label>
                <Input
                  type="date"
                  value={form.billDate}
                  onChange={(e) => setForm({ ...form, billDate: e.target.value })}
                  className="bg-slate-50 text-sm"
                />
              </div>

              {/* Target Inward Destination (Showroom / Godown) */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600 flex items-center justify-between">
                  <span className="flex items-center gap-1 font-semibold text-slate-700">
                    <Store className="w-3.5 h-3.5 text-[#3F63AD]" /> Inward Location *
                  </span>
                  {isSuperAdmin ? (
                    <span className="text-[9px] text-blue-700 font-bold bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                      Admin: All Locations
                    </span>
                  ) : (
                    <span className="text-[9px] text-slate-700 font-bold bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                      <Lock className="w-2.5 h-2.5 text-slate-500" /> Assigned Store
                    </span>
                  )}
                </Label>
                {isSuperAdmin ? (
                  <Select
                    value={form.warehouse || userAssignedBranch}
                    onValueChange={(val) => {
                      const matched = allLocationsList.find((l) => l.name === val);
                      setForm({ ...form, warehouse: val, warehouseId: matched?._id || "" });
                    }}
                  >
                    <SelectTrigger className="bg-white border-slate-300 text-xs font-bold text-slate-800 h-9">
                      <SelectValue placeholder="Select Inward Showroom / Godown" />
                    </SelectTrigger>
                    <SelectContent>
                      {allLocationsList.map((loc) => (
                        <SelectItem key={loc.name} value={loc.name} className="text-xs">
                          <div className="flex items-center justify-between w-full gap-2">
                            <span className="font-semibold">{loc.name}</span>
                            <span className="text-[10px] text-slate-500 font-mono">({loc.type})</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="h-9 px-3 bg-slate-100/90 border border-slate-200 rounded-md flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 truncate" title={form.warehouse || userAssignedBranch}>
                      {form.warehouse || userAssignedBranch}
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-white text-slate-600 font-mono shrink-0 ml-1.5">
                      {userAssignedBranch.toLowerCase().includes("godown") ? "Godown" : "Showroom"}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-[#3F63AD]" /> Supplier Mobile Number *
                </Label>
                <div className="relative">
                  <Input
                    type="text"
                    maxLength={10}
                    placeholder="Enter 10-digit mobile"
                    value={form.supplierPhone}
                    onChange={(e) => handleSupplierPhoneLookup(e.target.value)}
                    className={cn(
                      "bg-slate-50 font-mono text-base tracking-wider pr-10",
                      supplierLookupStatus === "existing" && "border-emerald-400 bg-emerald-50/50 ring-2 ring-emerald-100",
                      supplierLookupStatus === "new" && "border-amber-400 bg-amber-50/50 ring-2 ring-amber-100"
                    )}
                  />
                  {supplierLookupStatus === "existing" && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2"><UserCheck className="w-4 h-4 text-emerald-600" /></span>
                  )}
                  {supplierLookupStatus === "new" && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2"><UserPlus className="w-4 h-4 text-amber-600" /></span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Supplier Name *</Label>
                <Input
                  placeholder="Enter or select supplier name"
                  value={form.supplierName}
                  onChange={(e) => setForm({ ...form, supplierName: e.target.value })}
                  className={cn(
                    "bg-slate-50 text-sm font-semibold",
                    supplierLookupStatus === "existing" && "bg-emerald-50/30"
                  )}
                />
              </div>

              {/* Supplier Dropdown Quick Pick */}
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Existing Supplier Quick Pick</Label>
                <Select value={form.supplierName} onValueChange={handleSupplierSelect}>
                  <SelectTrigger className="bg-slate-50 text-sm">
                    <SelectValue placeholder="Choose Supplier..." />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s._id} value={s.name}>{s.name} ({s.phone || "No Phone"})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Supplier GSTIN (Optional)</Label>
                <Input
                  placeholder="09XXXXX1234X1ZX"
                  value={form.supplierGST}
                  onChange={(e) => setForm({ ...form, supplierGST: e.target.value.toUpperCase() })}
                  className="bg-slate-50 font-mono text-xs uppercase"
                />
              </div>
            </div>

            {/* ─── LINK PURCHASE ORDER SECTION (OPTIONAL, FOR ENTRY MODE) ──── */}
            {isEntry && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-2">
                  <Label className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase tracking-wide">
                    <Barcode className="w-4 h-4 text-[#3F63AD]" /> 2. Link Purchase Order (Optional)
                  </Label>

                  {form.supplierName && supplierPendingPOs.length > 0 && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {supplierPendingPOs.length} active PO(s) available
                    </span>
                  )}
                </div>

                {!form.supplierName ? (
                  <div className="bg-slate-100/80 border border-slate-200 p-4 rounded-xl text-xs text-slate-500 flex items-center gap-2.5">
                    <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                    <span>Please enter or select a Supplier above to check available Purchase Orders (or skip this and add products directly below).</span>
                  </div>
                ) : supplierPendingPOs.length === 0 ? (
                  // NO PO EXISTS FOR THIS SUPPLIER — LINKING IS OPTIONAL, SO OFFER BOTH PATHS
                  <div className="bg-amber-50/90 border-2 border-amber-200 p-5 rounded-xl space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-amber-100 rounded-lg text-amber-800 shrink-0 mt-0.5">
                        <ShieldAlert className="w-5 h-5" />
                      </div>
                      <div>
                        <h5 className="text-sm font-bold text-amber-950">No Active Purchase Order Found</h5>
                        <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                          You do not have any pending or active Purchase Orders for <span className="font-bold underline">{form.supplierName}</span>.
                          That's fine — you can add products directly below without a PO, or create one first if you'd like formal order tracking.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-amber-200">
                      <span className="text-xs font-semibold text-amber-800 flex items-center gap-1">
                        <ArrowRight className="w-3.5 h-3.5" /> Or just add products directly in section 3 below.
                      </span>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (form.items.length > 0 && !confirm("This switches to creating a Purchase Order instead of a Purchase Entry (Supplier Bill) — it won't update stock or count as a received bill. Your entered items stay filled in. Continue?")) {
                            return;
                          }
                          setCurrentMode("order");
                          setForm(prev => ({ ...prev, linkedPoNo: "" }));
                          toast.info("Switched to Purchase Order mode. Create and send PO first.");
                        }}
                        className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs h-8 shadow-sm"
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Create Purchase Order for {form.supplierName}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // POs ARE AVAILABLE - SHOW SELECTION DROPDOWN
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Select value={form.linkedPoNo} onValueChange={handleLoadPO}>
                        <SelectTrigger className="bg-slate-50 text-sm flex-1 border-slate-300 h-10">
                          <SelectValue placeholder="-- Select Approved Purchase Order to Auto-Fill Items --" />
                        </SelectTrigger>
                        <SelectContent>
                          {supplierPendingPOs.map((po: any) => (
                            <SelectItem key={po.poNo} value={po.poNo}>
                              <span className="font-bold font-mono text-[#3F63AD]">{po.poNo}</span> — {po.items?.length || 0} Products ({formatCurrency(po.totalAmount)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {form.linkedPoNo && (
                        <Badge variant="success" className="h-10 px-3 flex items-center gap-1.5 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PO Linked: {form.linkedPoNo}
                        </Badge>
                      )}
                    </div>

                    {!form.linkedPoNo && (
                      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-800 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
                        <span>Optionally select a Purchase Order above to auto-load its products, quantities, and rates — or skip this and add products directly in section 3 below.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* A direct entry (no PO) is still allowed — it just has to say
                    why, so the audit trail shows this was a deliberate call,
                    not a skipped step. Required only once a supplier is picked,
                    so the field doesn't demand an answer before there's even a
                    PO list to have skipped. */}
                {form.supplierName && !form.linkedPoNo && (
                  <div className="mt-3 space-y-1.5">
                    <Label className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Reason for No Purchase Order *
                    </Label>
                    <Textarea
                      placeholder="e.g. Urgent local purchase, supplier doesn't issue POs, walk-in restock..."
                      value={form.noPoReason}
                      onChange={(e) => setForm(prev => ({ ...prev, noPoReason: e.target.value }))}
                      className={cn(
                        "text-xs bg-white",
                        !form.noPoReason.trim() && "border-red-300"
                      )}
                      rows={2}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Line Items & IMEI/Serial Numbers */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  {isEntry ? "3. Products & Unit IMEI / Serial Numbers" : "2. Product Line Items"}
                </h4>
                {isEntry && form.items.length > 0 && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    Enter unique IMEI / Serial numbers for every received physical unit.
                  </p>
                )}
              </div>

              {itemsAreEditable && (
                <Button size="sm" variant="outline" onClick={addLineItem} className="h-8 border-dashed">
                  <Plus className="w-4 h-4 mr-1" /> Add Product
                </Button>
              )}
            </div>

            {form.items.length === 0 ? (
              <div className="border border-dashed rounded-lg p-8 text-center text-muted-foreground text-sm">
                No items added. Click "Add Product" to begin.
              </div>
            ) : (
              <div className="space-y-4">
                {form.items.map((item, index) => {
                  const amount = item.quantity * item.rate;
                  const enteredSerialsCount = (item.serialNumbers || []).filter(s => s && s.trim()).length;
                  const serialOptional = isSerialOptional(item);
                  const autoOptional = serialOptional && !item.noSerial;
                  const allSerialsDone = serialOptional || (enteredSerialsCount === item.quantity && item.quantity > 0);

                  return (
                    // overflow-hidden here used to clip the product-search dropdown itself:
                    // the dropdown is absolutely positioned inside this card, and a card with
                    // overflow-hidden cuts off anything that pops out past its own bottom edge
                    // — which is exactly what the screenshot showed, a row sliced in half.
                    // Nothing else in this card needs the corner clipping (the header background
                    // is a low-opacity flat fill, not a hard-edged graphic), so it is safe to drop.
                    <div key={item.id} className="border border-slate-200 rounded-xl overflow-visible bg-white shadow-sm transition-all hover:border-slate-300">
                      {/* Item Header Row */}
                      <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
                          <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center">
                            {index + 1}
                          </span>

                          <div className="flex-1 relative">
                            {!itemsAreEditable ? (
                              <div>
                                <p className="text-sm font-bold text-slate-900">{item.name}</p>
                                <p className="text-xs text-slate-500">Agreed Rate: {formatCurrency(item.rate)} + {item.gstRate}% GST</p>
                              </div>
                            ) : (
                              <>
                                <Input
                                  placeholder="Search product by name, code, or serial number..."
                                  value={item.name}
                                  onChange={(e) => {
                                    updateLineItem(item.id, "name", e.target.value);
                                    if (item.itemId) updateLineItem(item.id, "itemId", "");
                                    setActiveSearchRowId(item.id);
                                  }}
                                  onFocus={() => setActiveSearchRowId(item.id)}
                                  onBlur={() => setTimeout(() => setActiveSearchRowId(null), 250)}
                                  className="h-9 text-xs bg-white border-slate-300"
                                />
                                {activeSearchRowId === item.id && item.name.trim().length > 0 && !item.itemId && (
                                  <div className="absolute z-50 left-0 top-10 w-full bg-white border-2 border-[#3F63AD] shadow-2xl rounded-lg max-h-56 overflow-y-auto overflow-x-hidden">
                                    {getCandidatesForQuery(item.name).length > 0 ? (
                                      getCandidatesForQuery(item.name).map((c: any) => (
                                        <div
                                          key={c._id}
                                          onMouseDown={() => handleItemSelect(item.id, c._id)}
                                          className="px-3 py-2 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex items-center justify-between gap-2"
                                        >
                                          {/* min-w-0 lets a long name truncate with an ellipsis instead of
                                              overflowing the row — a flex child's default min-width is its
                                              content size, so without this a long product name pushed the
                                              row wider than the dropdown and got clipped by the dialog's own
                                              overflow-hidden, which is what silently cut names off. */}
                                          <span className="font-semibold text-slate-800 truncate min-w-0" title={c.name}>
                                            {c.name}
                                          </span>
                                          <span className="text-slate-500 font-mono shrink-0">{formatCurrency(c.purchasePrice || 0)}</span>
                                        </div>
                                      ))
                                    ) : (
                                      <div
                                        onMouseDown={() => setQuickAddContext({ rowId: item.id, initialName: item.name })}
                                        className="px-3 py-2.5 text-xs text-[#3F63AD] font-bold hover:bg-blue-50 cursor-pointer flex items-center gap-1.5"
                                      >
                                        <PackagePlus className="w-3.5 h-3.5" /> Add New Product "{item.name}"
                                      </div>
                                    )}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Quantity & Rate */}
                        <div className="flex items-center gap-4">
                          <div className="text-center">
                            <Label className="text-[10px] text-slate-500 font-bold uppercase block">Quantity</Label>
                            <Input
                              type="number"
                              min={1}
                              value={item.quantity}
                              disabled={!itemsAreEditable}
                              onChange={(e) => updateLineItem(item.id, "quantity", Math.max(1, Number(e.target.value)))}
                              className="h-8 w-20 text-xs text-center font-bold bg-white"
                            />
                          </div>

                          <div className="text-center">
                            <Label className="text-[10px] text-slate-500 font-bold uppercase block">Rate (₹)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={item.rate}
                              disabled={!itemsAreEditable}
                              onChange={(e) => updateLineItem(item.id, "rate", Math.max(0, Number(e.target.value)))}
                              className="h-8 w-24 text-xs text-right font-bold bg-white"
                            />
                          </div>

                          <div className="text-center">
                            <Label className="text-[10px] text-slate-500 font-bold uppercase block">GST %</Label>
                            <span className="text-xs font-semibold text-slate-700 block mt-1.5">{item.gstRate}%</span>
                          </div>

                          <div className="text-right min-w-[100px]">
                            <Label className="text-[10px] text-slate-500 font-bold uppercase block">Item Total</Label>
                            <span className="text-sm font-black text-slate-900 block mt-1">{formatCurrency(amount)}</span>
                          </div>

                          {itemsAreEditable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 ml-1"
                              onClick={() => removeLineItem(item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Unit-by-Unit IMEI / Serial Number Input Grid (FOR ENTRY MODE) */}
                      {isEntry && (
                        <div className="p-4 bg-slate-50/30">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <Barcode className="w-4 h-4 text-[#3F63AD]" />
                              <span className="text-xs font-bold text-slate-800">
                                Unit IMEI / Serial Numbers
                              </span>
                              <Badge variant={allSerialsDone ? "success" : "warning"} className="text-[10px] ml-1">
                                {enteredSerialsCount} / {item.quantity} Recorded
                              </Badge>
                              {serialOptional && (
                                <Badge className="text-[10px] bg-violet-50 text-violet-700 border-violet-200">
                                  🎁 Gift / Accessory — serial optional
                                </Badge>
                              )}
                            </div>

                            {!autoOptional && (
                              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={Boolean(item.noSerial)}
                                  onChange={(e) =>
                                    setForm((f) => ({
                                      ...f,
                                      items: f.items.map((it) => (it.id === item.id ? { ...it, noSerial: e.target.checked } : it)),
                                    }))
                                  }
                                  className="w-3.5 h-3.5 accent-violet-600"
                                />
                                Gift / Accessory (no serial)
                              </label>
                            )}

                            <button 
                              type="button" 
                              onClick={() => toggleSerialsDisplay(item.id)}
                              className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium"
                            >
                              {item.showSerials ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              {item.showSerials ? "Collapse" : "Expand"}
                            </button>
                          </div>

                          {item.showSerials && (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {Array.from({ length: item.quantity }).map((_, unitIdx) => {
                                const currentSerial = item.serialNumbers?.[unitIdx] || "";
                                const isValid = currentSerial.trim().length > 0;

                                return (
                                  <div key={unitIdx} className="space-y-1 bg-white p-2.5 rounded-lg border border-slate-200">
                                    <div className="flex items-center justify-between text-[11px]">
                                      <span className="font-semibold text-slate-600">Unit #{unitIdx + 1} Serial / IMEI</span>
                                      {isValid ? (
                                        <span className="text-emerald-600 font-bold flex items-center gap-0.5 text-[10px]">
                                          <CheckCircle2 className="w-3 h-3" /> Valid
                                        </span>
                                      ) : (
                                        <span className={cn("font-bold text-[10px]", serialOptional ? "text-slate-400" : "text-amber-600")}>
                                          {serialOptional ? "Optional" : "Required *"}
                                        </span>
                                      )}
                                    </div>
                                    <Input
                                      placeholder={`Scan or type Unit #${unitIdx + 1} IMEI / Serial`}
                                      value={currentSerial}
                                      onChange={(e) => updateSerialNumber(item.id, unitIdx, e.target.value.toUpperCase())}
                                      className={cn(
                                        "h-8 text-xs font-mono tracking-wider bg-slate-50",
                                        isValid ? "border-emerald-300 bg-emerald-50/20" : serialOptional ? "border-slate-200" : "border-amber-300 bg-amber-50/20"
                                      )}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer & Totals */}
        <div className="bg-slate-100 p-6 rounded-b-2xl border-t border-slate-200 shrink-0 space-y-4">
          {isEntry && (
            <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-end gap-4">
              <div>
                <Label className="text-xs font-bold text-slate-700">Has the supplier been paid?</Label>
                <div className="flex gap-2 mt-1">
                  <Button
                    type="button"
                    variant={paymentMadeChoice === "yes" ? "default" : "outline"}
                    className="h-9 px-4 text-sm"
                    onClick={() => setPaymentMadeChoice("yes")}
                  >
                    Yes, Paid
                  </Button>
                  <Button
                    type="button"
                    variant={paymentMadeChoice === "no" ? "default" : "outline"}
                    className={`h-9 px-4 text-sm ${paymentMadeChoice === "no" ? "bg-rose-600 hover:bg-rose-700" : ""}`}
                    onClick={() => setPaymentMadeChoice("no")}
                  >
                    No, Pending
                  </Button>
                </div>
              </div>
              {paymentMadeChoice === "yes" && (
                <div>
                  <Label className="text-xs font-bold text-slate-700">Amount Paid Now (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={totals.total}
                    placeholder={String(Math.round(totals.total))}
                    value={amountPaidNow}
                    onChange={(e) => setAmountPaidNow(e.target.value)}
                    className="h-9 w-40 text-sm font-bold mt-1"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Enter what was paid. Less than the bill total is recorded as partial.</p>
                </div>
              )}
              {paymentMadeChoice && (
                <div className="text-sm">
                  <span className="text-slate-500">Balance Payable to Supplier: </span>
                  <span className={`font-mono font-black ${balanceAmount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatCurrency(balanceAmount)}
                  </span>
                  <span className={`ml-2 text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                    entryPaymentStatus === "paid" ? "bg-emerald-100 text-emerald-800" :
                    entryPaymentStatus === "partial" ? "bg-amber-100 text-amber-800" :
                    "bg-rose-100 text-rose-800"
                  }`}>
                    {entryPaymentStatus}
                  </span>
                </div>
              )}
              {paymentMadeChoice && balanceAmount > 0 && (
                <div>
                  <Label className="text-xs font-bold text-slate-700">Payment Due Date</Label>
                  <Input
                    type="date"
                    value={purchaseDueDate}
                    onChange={(e) => setPurchaseDueDate(e.target.value)}
                    className="h-9 text-sm mt-1"
                  />
                </div>
              )}
            </div>
          )}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-4 text-sm text-slate-600">
                <span>Taxable Subtotal: <strong className="text-slate-800">{formatCurrency(totals.subtotal)}</strong></span>
                <span>GST Tax: <strong className="text-slate-800">{formatCurrency(totals.gst)}</strong></span>
              </div>
              <div className="text-xl font-black text-slate-900">
                Net Voucher Total: <span className="text-[#3F63AD] font-mono">{formatCurrency(totals.total)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <Button variant="outline" onClick={onClose} className="w-full md:w-auto px-6">
                Cancel
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={saveMutation.isPending}
                className={`w-full md:w-auto px-8 font-bold shadow-lg ${isDebit ? 'bg-red-600 hover:bg-red-700 shadow-red-600/20' : (isOrder ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20' : 'bg-[#3F63AD] hover:bg-[#2E4F95] shadow-[#3F63AD]/20')}`}
              >
                {saveMutation.isPending ? "Recording..." : (isDebit ? "Save Debit Note" : (isOrder ? "Send Purchase Order" : "Record Purchase Inward & Stock"))}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>

    <PurchaseBillPrintModal
      isOpen={!!createdBillToPrint}
      onClose={() => {
        setCreatedBillToPrint(null);
        queryClient.invalidateQueries({ queryKey: ["items"] });
        queryClient.invalidateQueries({ queryKey: ["stock-flow"] });
        queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      }}
      billData={createdBillToPrint}
    />

    <QuickAddItemModal
      isOpen={!!quickAddContext}
      onClose={() => setQuickAddContext(null)}
      initialName={quickAddContext?.initialName || ""}
      billingEntity={billingEntity}
      onCreated={(newItem) => {
        if (quickAddContext) applyItemToRow(quickAddContext.rowId, newItem);
        setQuickAddContext(null);
      }}
    />
    </>
  );
}
