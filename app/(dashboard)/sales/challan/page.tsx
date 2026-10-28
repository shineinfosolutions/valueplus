"use client";

/**
 * VALUEPLUS ERP — Delivery & Return Challan (GIDA Central Hub Logistics & Official Invoice-Style Print)
 */

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  Plus, Search, Truck, PackageCheck, Printer, Download, RotateCcw, 
  FileText, CheckCircle2, UserCheck, MessageCircle,
  FileMinus, Tag, Edit3, Hash, Building2, Store, Check, X, Sparkles, Layers,
  PhoneCall, ShieldCheck, CheckCircle, ArrowLeft
} from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { formatDate, cn, formatCurrency } from "@/lib/utils";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

interface ChallanItem {
  _id?: string;
  id?: string;
  challanNo: string;
  type: "Customer Return" | "Warehouse Return" | "Supplier Return" | "Outward Delivery";
  invoiceNumber?: string;
  sourceParty: string;
  sourceAddress: string;
  sourcePhone?: string;
  destinationParty: string;
  destinationAddress: string;
  customerPhone?: string;
  itemName: string;
  vpCode?: string;
  hsn: string;
  serialImei: string;
  quantity: number;
  unit: string;
  itemPrice?: number;
  defectDescription?: string;
  reason: string;
  date: string;
  vehicleNo: string;
  transporterName?: string;
  driverName: string;
  driverPhone: string;
  ewayBillNo?: string;
  flowType?: "CNR" | "PR";
  approvalStatus?: "pending" | "approved" | "rejected";
  approvedAt?: string;
  approvedBy?: string;
  status: "dispatched" | "in-transit" | "delivered" | "returned" | "received";
}

const GIDA_HUB = {
  name: "VALUEPLUS Central Warehouse & Hub (GIDA)",
  address: "PLOT NO. G-12, SECTOR 13, GIDA INDUSTRIAL AREA, GORAKHPUR (UP) - 273209",
  phone: "9140860604",
};

const KUNRAGHAT_STORE = {
  name: "VALUEPLUS Showroom & Store (Kunraghat)",
  address: "H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR (UP)",
  phone: "9140860604",
};

export default function DeliveryChallanPage() {
  const router = useRouter();
  const [challans, setChallans] = useState<ChallanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [flowFilter, setFlowFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedChallan, setSelectedChallan] = useState<ChallanItem | null>(null);
  const [isPrintOpen, setIsPrintOpen] = useState(false);
  
  const [items, setItems] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  
  const [selectedProductUniqueId, setSelectedProductUniqueId] = useState<string | null>(null);
  const [itemSearchText, setItemSearchText] = useState("");
  const [hsnFilterText, setHsnFilterText] = useState("");
  const [billFilterText, setBillFilterText] = useState("");
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);

  const fetchChallans = async () => {
    try {
      const res = await fetch("/api/delivery-challans");
      const json = await res.json();
      if (json.success) setChallans(json.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchItems = async () => {
    try {
      const res = await fetch("/api/items");
      const json = await res.json();
      if (json.success) setItems(json.data);
    } catch (error) { console.error(error); }
  };

  const fetchInvoices = async () => {
    try {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      if (json.success) setInvoices(json.data);
    } catch (error) { console.error(error); }
  };

  const fetchCustomers = async () => {
    try {
      const res = await fetch("/api/customers");
      const json = await res.json();
      if (json.success) setCustomers(json.data);
    } catch (error) { console.error(error); }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      if (json.success) setSuppliers(json.data);
    } catch (error) { console.error(error); }
  };

  const fetchPurchases = async () => {
    try {
      const res = await fetch("/api/purchase-entries?type=entry");
      const json = await res.json();
      if (json.success) setPurchases(json.data);
    } catch (error) { console.error(error); }
  };

  useEffect(() => {
    fetchChallans();
    fetchItems();
    fetchInvoices();
    fetchCustomers();
    fetchSuppliers();
    fetchPurchases();
  }, []);

  const [formData, setFormData] = useState({
    type: "Customer Return" as ChallanItem["type"],
    flowType: "CNR" as "CNR" | "PR",
    invoiceNumber: "",
    sourceParty: "",
    sourcePhone: "",
    sourceAddress: "",
    destinationParty: GIDA_HUB.name,
    destinationAddress: GIDA_HUB.address,
    itemName: "",
    vpCode: "",
    hsn: "85287217",
    serialImei: "",
    quantity: "1",
    unit: "PCS",
    itemPrice: "",
    defectDescription: "",
    reason: "Defective Replacement / Transit to GIDA Hub",
    vehicleNo: "UP-53-ET-8819",
    transporterName: "Value Plus In-House Van (GIDA Route)",
    driverName: "AMIT SINGH",
    driverPhone: "9140860604",
    ewayBillNo: "",
  });

  const handleCategoryChange = (category: ChallanItem["type"]) => {
    setSelectedProductUniqueId(null);
    if (category === "Customer Return") {
      setFormData((prev) => ({
        ...prev,
        type: category,
        flowType: "CNR",
        sourceParty: "",
        sourcePhone: "",
        sourceAddress: "",
        destinationParty: GIDA_HUB.name,
        destinationAddress: GIDA_HUB.address,
        itemName: "",
        serialImei: "",
        reason: "Customer Defective Return Transit to GIDA Hub",
      }));
    } else if (category === "Warehouse Return") {
      setFormData((prev) => ({
        ...prev,
        type: category,
        flowType: "PR",
        sourceParty: KUNRAGHAT_STORE.name,
        sourcePhone: KUNRAGHAT_STORE.phone,
        sourceAddress: KUNRAGHAT_STORE.address,
        destinationParty: GIDA_HUB.name,
        destinationAddress: GIDA_HUB.address,
        itemName: "",
        serialImei: "",
        reason: "Showroom Return to GIDA Central Warehouse",
      }));
    } else if (category === "Supplier Return") {
      setFormData((prev) => ({
        ...prev,
        type: category,
        flowType: "PR",
        sourceParty: GIDA_HUB.name,
        sourcePhone: GIDA_HUB.phone,
        sourceAddress: GIDA_HUB.address,
        destinationParty: "Authorised Brand Service Center",
        destinationAddress: "Industrial Area, Gorakhpur / Delhi Hub",
        itemName: "",
        serialImei: "",
        reason: "Brand Defective Warranty Return Claim",
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        type: category,
        flowType: "CNR",
        sourceParty: GIDA_HUB.name,
        sourcePhone: GIDA_HUB.phone,
        sourceAddress: GIDA_HUB.address,
        destinationParty: "",
        destinationAddress: "",
        reason: "Direct Outward Stock Delivery",
      }));
    }
  };

  const customerSoldItems = useMemo(() => {
    if (formData.type !== "Customer Return") return [];
    if (!formData.sourceParty && !formData.sourcePhone && !formData.invoiceNumber) return [];

    const normPhone = formData.sourcePhone?.replace(/\D/g, "");
    const normName = formData.sourceParty?.trim().toLowerCase();
    const normInv = formData.invoiceNumber?.trim().toLowerCase();

    const matchedInvoices = invoices.filter((inv: any) => {
      if (normInv && inv.invoiceNumber?.toLowerCase() === normInv) return true;
      if (normPhone && normPhone.length >= 10 && inv.customerPhone?.replace(/\D/g, "") === normPhone) return true;
      if (normName && inv.customerName && inv.customerName.toLowerCase().includes(normName)) return true;
      return false;
    });

    const prods: any[] = [];
    matchedInvoices.forEach((inv: any) => {
      (inv.items || []).forEach((it: any, itIdx: number) => {
        const serial = it.serialNumber || it.serialImei || it.batchNumber || "";
        prods.push({
          uniqueId: `${inv.invoiceNumber || 'INV'}-${itIdx}-${serial || it.name || itIdx}`,
          invoiceNumber: inv.invoiceNumber,
          invoiceDate: inv.date || inv.createdAt,
          customerName: inv.customerName,
          customerPhone: inv.customerPhone,
          customerAddress: inv.customerAddress || inv.placeOfSupply || "Gorakhpur, UP",
          itemName: it.itemName || it.name,
          vpCode: it.vpCode || it.itemCode || "",
          hsn: it.hsnCode || it.hsn || "85287217",
          serialImei: serial,
          quantity: it.quantity || it.qty || 1,
          unit: it.unit || "PCS",
          rate: it.rate || it.price || 0,
          total: it.amount || it.total || 0,
        });
      });
    });

    return prods;
  }, [invoices, formData.type, formData.sourceParty, formData.sourcePhone, formData.invoiceNumber]);

  const supplierPurchasedItems = useMemo(() => {
    if (formData.type !== "Supplier Return") return [];
    if (!formData.destinationParty && !formData.sourceParty) return [];

    const query = (formData.destinationParty || formData.sourceParty || "").toLowerCase();

    const matchedPurchases = purchases.filter((p: any) =>
      p.supplierName && p.supplierName.toLowerCase().includes(query)
    );

    const prods: any[] = [];
    matchedPurchases.forEach((p: any) => {
      (p.items || []).forEach((it: any, itIdx: number) => {
        const serials = it.serialNumbers && it.serialNumbers.length > 0 ? it.serialNumbers.join(", ") : "";
        prods.push({
          uniqueId: `${p.billNo || 'BILL'}-${itIdx}-${serials || it.name || itIdx}`,
          billNo: p.billNo,
          billDate: p.billDate,
          supplierName: p.supplierName,
          itemName: it.name,
          vpCode: it.itemId || "",
          hsn: it.hsn || "85287217",
          serialImei: serials,
          quantity: it.quantity || 1,
          unit: "PCS",
          rate: it.rate || 0,
        });
      });
    });

    return prods;
  }, [purchases, formData.type, formData.destinationParty, formData.sourceParty]);

  const warehouseGidaItems = useMemo(() => {
    if (formData.type !== "Warehouse Return") return [];
    return items.map((it: any, idx: number) => ({
      uniqueId: `${it._id || it.code || 'ITEM'}-${idx}`,
      itemName: it.name,
      vpCode: it.vpCode || it.code || "",
      hsn: it.hsn || it.hsnCode || "85287217",
      serialImei: it.serialNumber || "",
      quantity: it.stock || 1,
      unit: it.unit || "PCS",
      rate: it.sellingPrice || it.rate || 0,
      category: it.category || "Electronics",
    }));
  }, [items, formData.type]);

  const contextAvailableItems = useMemo(() => {
    if (formData.type === "Customer Return") return customerSoldItems;
    if (formData.type === "Supplier Return") return supplierPurchasedItems;
    if (formData.type === "Warehouse Return") return warehouseGidaItems;
    return items.map((it: any, idx: number) => ({
      uniqueId: `${it._id || it.code || 'ITEM'}-${idx}`,
      itemName: it.name,
      vpCode: it.vpCode || it.code || "",
      hsn: it.hsn || "85287217",
      serialImei: "",
      quantity: 1,
      unit: it.unit || "PCS",
      rate: it.sellingPrice || 0,
    }));
  }, [formData.type, customerSoldItems, supplierPurchasedItems, warehouseGidaItems, items]);

  const filteredContextItems = useMemo(() => {
    let list = contextAvailableItems;
    if (itemSearchText.trim()) {
      const q = itemSearchText.toLowerCase();
      list = list.filter((it: any) =>
        it.itemName?.toLowerCase().includes(q) ||
        it.vpCode?.toLowerCase().includes(q) ||
        it.serialImei?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [contextAvailableItems, itemSearchText, hsnFilterText, billFilterText]);

  const handleSelectProduct = (prod: any) => {
    setSelectedProductUniqueId(prod.uniqueId);
    setFormData((prev) => ({
      ...prev,
      itemName: prod.itemName,
      vpCode: prod.vpCode || prev.vpCode,
      hsn: prod.hsn || prev.hsn,
      serialImei: prod.serialImei || prev.serialImei,
      quantity: String(prod.quantity || 1),
      unit: prod.unit || "PCS",
      itemPrice: prod.rate ? String(prod.rate) : prev.itemPrice,
      invoiceNumber: prod.invoiceNumber || prod.billNo || prev.invoiceNumber,
      sourceParty: prod.customerName || prev.sourceParty,
      sourcePhone: (prod.customerPhone || prev.sourcePhone || "").replace(/\D/g, ""),
      sourceAddress: prod.customerAddress || prev.sourceAddress,
    }));
    toast.success(`✅ Selected: ${prod.itemName}${prod.serialImei ? ` (SN: ${prod.serialImei})` : ""}`);
  };

  const handleSelectCustomer = (c: any) => {
    setSelectedProductUniqueId(null);
    setFormData((prev) => ({
      ...prev,
      sourceParty: c.name,
      sourcePhone: (c.phone || "").replace(/\D/g, ""),
      sourceAddress: c.address || c.city || "Gorakhpur, UP",
    }));
    setShowPartyDropdown(false);
    toast.info(`Customer "${c.name}" selected. Sold products loaded below.`);
  };

  const handleSelectSupplier = (s: any) => {
    setSelectedProductUniqueId(null);
    setFormData((prev) => ({
      ...prev,
      destinationParty: s.name,
      sourceParty: GIDA_HUB.name,
      sourceAddress: GIDA_HUB.address,
    }));
    setShowPartyDropdown(false);
    toast.info(`Supplier "${s.name}" selected. Purchased items loaded below.`);
  };

  const handleToggleFlowType = async (challan: ChallanItem) => {
    try {
      const res = await fetch("/api/delivery-challans", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challanNo: challan.challanNo, action: "toggle-flow" }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`Challan ${challan.challanNo} switched to ${json.data.flowType}!`);
        fetchChallans();
      }
    } catch (e: any) { toast.error("Error updating flow"); }
  };

  const filtered = useMemo(() => {
    return challans.filter((c) => {
      const matchSearch =
        !search ||
        (c.challanNo && c.challanNo.toLowerCase().includes(search.toLowerCase())) ||
        (c.sourceParty && c.sourceParty.toLowerCase().includes(search.toLowerCase())) ||
        (c.destinationParty && c.destinationParty.toLowerCase().includes(search.toLowerCase())) ||
        (c.itemName && c.itemName.toLowerCase().includes(search.toLowerCase())) ||
        (c.invoiceNumber && c.invoiceNumber.toLowerCase().includes(search.toLowerCase())) ||
        (c.serialImei && c.serialImei.toLowerCase().includes(search.toLowerCase())) ||
        (c.vehicleNo && c.vehicleNo.toLowerCase().includes(search.toLowerCase()));
      const matchType = typeFilter === "all" || c.type === typeFilter;
      const matchFlow = flowFilter === "all" || (c.flowType || "CNR") === flowFilter;
      const matchDate = isDateInRange(c.date, dateRange.start, dateRange.end);
      return matchSearch && matchType && matchFlow && matchDate;
    });
  }, [challans, search, typeFilter, flowFilter, dateRange]);

  const handleSave = async () => {
    if (!formData.sourceParty || !formData.itemName) {
      toast.error("Please select party and item to issue delivery challan");
      return;
    }

    const payload = {
      ...formData,
      challanNo: `DC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      quantity: Number(formData.quantity) || 1,
      itemPrice: Number(formData.itemPrice) || 0,
      status: "dispatched",
      approvalStatus: "pending",
    };

    try {
      const res = await fetch("/api/delivery-challans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`🎉 Delivery Challan ${json.data.challanNo} issued!`);
        setIsFormOpen(false);
        fetchChallans();
      } else {
        toast.error(json.error || "Failed to create delivery challan");
      }
    } catch (error) {
      toast.error("An error occurred");
    }
  };

  const openPrintSheet = (c: ChallanItem) => {
    setSelectedChallan(c);
    setIsPrintOpen(true);
  };

  return (
    <PageShell
      title="Delivery & Return Challan (GIDA Hub Logistics)"
      subtitle="Issue transit challans for customer warranty replacements, GIDA warehouse transfers & supplier returns"
      breadcrumbs={[{ label: "Sales" }, { label: "Delivery Challan" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Delivery & Return Challans"
            subtitle={`${filtered.length} challans`}
            data={(filtered as any[]).map((c) => ({
              "Challan No": c.challanNo,
              Date: formatDate(c.date),
              Type: c.type,
              "Source Party": c.sourceParty,
              "Destination Party": c.destinationParty,
              Item: c.itemName,
              "VP Code": c.vpCode || "",
              "Serial/IMEI": c.serialImei || "",
              Quantity: c.quantity,
              Unit: c.unit,
              "Vehicle No": c.vehicleNo || "",
              Driver: c.driverName || "",
              "Flow Mode": c.flowType || "CNR",
              Approval: c.approvalStatus === "approved" ? "Approved" : "Pending",
            }))}
            filename="delivery-challans"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold shadow-md">
            <Plus className="w-4 h-4 mr-1.5" /> Issue Delivery Challan
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#3F63AD]/10 flex items-center justify-center text-[#3F63AD]">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{challans.length}</p>
              <p className="text-xs text-muted-foreground">Total Records</p>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-600">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{challans.filter((c) => (c.flowType || "CNR") === "CNR").length}</p>
              <p className="text-xs text-muted-foreground">CNR (Customer Claims)</p>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-blue-50 flex items-center justify-center text-[#30539C]">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{challans.filter((c) => c.type === "Warehouse Return").length}</p>
              <p className="text-xs text-muted-foreground">GIDA Warehouse Transfers</p>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-bold">{challans.filter((c) => c.approvalStatus === "approved").length}</p>
              <p className="text-xs text-muted-foreground">Approved & Settled</p>
            </div>
          </div>
        </div>
      </div>

      <div className="data-table-container">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search Challan #, Customer, GIDA Hub, Item, Serial/IMEI, Vehicle..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={flowFilter} onValueChange={setFlowFilter}>
            <SelectTrigger className="w-36 font-semibold">
              <SelectValue placeholder="Flow Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Flows</SelectItem>
              <SelectItem value="CNR">🔄 CNR Only</SelectItem>
              <SelectItem value="PR">📦 PR Only</SelectItem>
            </SelectContent>
          </Select>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44 font-semibold">
              <SelectValue placeholder="Challan Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="Customer Return">Customer Return</SelectItem>
              <SelectItem value="Warehouse Return">Warehouse Return (GIDA)</SelectItem>
              <SelectItem value="Supplier Return">Supplier Return</SelectItem>
              <SelectItem value="Outward Delivery">Outward Delivery</SelectItem>
            </SelectContent>
          </Select>

          <DateRangeFilter 
            value={dateFilter} 
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-40"
            showIcon={true}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Challan #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Origin & Destination</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item & Serial / Defect</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Qty / Value</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Vehicle & Driver</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Flow Mode</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Approval</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr><td colSpan={8} className="p-0"><TableShimmer rows={7} cols={8} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">No records found.</td></tr>
              ) : (
                filtered.map((c) => {
                  const isCNR = (c.flowType || "CNR") === "CNR";
                  const isApproved = c.approvalStatus === "approved";
                  return (
                    <tr key={c._id || c.challanNo} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-bold text-[#3F63AD] cursor-pointer" onClick={() => openPrintSheet(c)}>
                        {c.challanNo}
                        <span className="block text-[10px] text-slate-400 font-normal">{formatDate(c.date)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{c.sourceParty}</p>
                        <p className="text-[11px] text-[#30539C] font-semibold mt-0.5">→ {c.destinationParty}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-bold text-slate-900">{c.itemName}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          {c.vpCode && <span className="text-[10px] font-mono font-bold text-[#3F63AD] bg-blue-50 px-1 rounded">VP: {c.vpCode}</span>}
                          {c.serialImei && <span className="text-[10px] font-mono text-slate-600 bg-slate-100 px-1 rounded">SN: {c.serialImei}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-slate-900">{c.quantity} {c.unit}</span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-xs font-mono font-bold text-slate-800 uppercase">{c.vehicleNo || "GIDA Van"}</p>
                        <p className="text-[11px] text-slate-500">{c.transporterName}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 border border-slate-200">
                          <button
                            type="button"
                            onClick={() => !isApproved && handleToggleFlowType(c)}
                            disabled={isApproved}
                            className={cn("px-2 py-1 rounded-md text-xs font-extrabold", isCNR ? "bg-amber-500 text-white" : "text-slate-500")}
                          >
                            CNR
                          </button>
                          <button
                            type="button"
                            onClick={() => !isApproved && handleToggleFlowType(c)}
                            disabled={isApproved}
                            className={cn("px-2 py-1 rounded-md text-xs font-extrabold", !isCNR ? "bg-[#30539C] text-white" : "text-slate-500")}
                          >
                            PR
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isApproved ? (
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">✅ Approved</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-bold text-[10px]">⏳ Pending</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button variant="outline" size="sm" onClick={() => openPrintSheet(c)} className="h-7 px-2 text-[11px] font-semibold border-[#3F63AD]/40 text-[#3F63AD] hover:bg-[#3F63AD] hover:text-white">
                          <Printer className="w-3 h-3 mr-1" /> Sheet
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto p-0 rounded-2xl shadow-2xl border border-slate-200">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 pr-14 rounded-t-2xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20 shrink-0">
                <Truck className="w-6 h-6 text-[#76C043]" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-bold tracking-tight truncate">Issue Delivery & Return Challan</h3>
                <p className="text-xs text-slate-300 mt-0.5">GIDA Hub Logistics & Replacement Transit.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/10 p-1.5 rounded-xl border border-white/15 shrink-0">
              <button onClick={() => setFormData({ ...formData, flowType: "CNR" })} className={cn("px-3 py-1 rounded-lg text-xs font-black", formData.flowType === "CNR" ? "bg-amber-500 text-white" : "text-slate-300")}>CNR</button>
              <button onClick={() => setFormData({ ...formData, flowType: "PR" })} className={cn("px-3 py-1 rounded-lg text-xs font-black", formData.flowType === "PR" ? "bg-[#30539C] text-white" : "text-slate-300")}>PR</button>
            </div>
          </div>
          <div className="p-6 space-y-6 bg-slate-50/70">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-[#3F63AD]" /> 1. Challan Category & Party Information
                </h4>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-500">Select Mode:</span>
                  <Select value={formData.type} onValueChange={(v: any) => handleCategoryChange(v)}>
                    <SelectTrigger className="h-8 text-xs bg-slate-50 border-slate-300 font-bold w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Customer Return">🔄 Customer Return (Sold Items)</SelectItem>
                      <SelectItem value="Warehouse Return">🏢 Warehouse Return (GIDA Central Hub)</SelectItem>
                      <SelectItem value="Supplier Return">🏭 Supplier Return (Purchased Items)</SelectItem>
                      <SelectItem value="Outward Delivery">🚚 Outward Direct Delivery</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {formData.type === "Customer Return" && (
                  <>
                    <div className="space-y-1.5 relative">
                      <Label className="text-xs font-bold text-slate-800">Select / Search Customer *</Label>
                      <Input value={formData.sourceParty} onChange={(e) => { setFormData({ ...formData, sourceParty: e.target.value }); setShowPartyDropdown(true); }} className="bg-slate-50 border-slate-300 font-bold" />
                      {showPartyDropdown && customers.length > 0 && formData.sourceParty.trim() && (
                        <div className="absolute left-0 top-16 w-full bg-white border-2 border-[#3F63AD] shadow-2xl rounded-xl z-[9999] max-h-48 overflow-y-auto divide-y divide-slate-100 p-1">
                          {customers.filter((c: any) => c.name?.toLowerCase().includes(formData.sourceParty.toLowerCase())).slice(0, 6).map((c: any, idx: number) => (
                            <div key={idx} onMouseDown={() => handleSelectCustomer(c)} className="p-2 hover:bg-blue-50 cursor-pointer text-xs font-bold">{c.name}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-slate-800">10-Digit Mobile Number *</Label>
                      <Input maxLength={10} value={formData.sourcePhone} onChange={(e) => setFormData({ ...formData, sourcePhone: e.target.value.replace(/\D/g, "") })} className="bg-slate-50 border-slate-300 font-mono font-bold" />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">Destination (Warehouse Hub)</Label>
                      <Input value={formData.destinationParty} readOnly className="bg-slate-100 border-slate-300 font-medium text-xs text-slate-700" />
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                <div className="flex items-center gap-2">
                  <PackageCheck className="w-4 h-4 text-[#3F63AD]" />
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD]">
                    2. Available Units for Selection
                  </h4>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <Input placeholder="Filter item / serial..." value={itemSearchText} onChange={(e) => setItemSearchText(e.target.value)} className="h-7 text-xs pl-8 w-40 bg-slate-50 border-slate-300" />
                  </div>
                </div>
              </div>

              {filteredContextItems.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                  {filteredContextItems.map((prod: any) => {
                    const isSelected = selectedProductUniqueId === prod.uniqueId;
                    return (
                      <div key={prod.uniqueId} onClick={() => handleSelectProduct(prod)} className={cn("p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2", isSelected ? "bg-emerald-50 border-emerald-500 ring-2 ring-emerald-400" : "bg-slate-50/70 border-slate-200")}>
                        <div className="space-y-1 min-w-0">
                          <p className="font-bold text-xs text-slate-900 truncate">{prod.itemName}</p>
                          {prod.serialImei && <p className="text-[10px] text-amber-900 font-mono font-bold">SN: {prod.serialImei}</p>}
                        </div>
                        <Button size="sm" className={cn("h-6 px-2.5 text-[10px] font-bold rounded-lg", isSelected ? "bg-emerald-600 text-white" : "bg-[#3F63AD] text-white")}>
                          {isSelected ? "✅ Selected" : "Select Unit"}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-6 bg-slate-50 rounded-xl border border-dashed border-slate-300 text-center">
                  <p className="text-xs text-slate-600 font-semibold">No products found. Please refine selection.</p>
                </div>
              )}

              {/* SELECTED ITEM DETAILS CARD & DEFECT INPUT */}
              {formData.itemName && (
                <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 p-4 rounded-xl border-2 border-emerald-400 shadow-sm space-y-3 mt-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-900">
                        Selected Unit for Delivery Challan
                      </span>
                    </div>
                    <Badge className="bg-emerald-700 text-white font-mono font-bold text-xs">
                      {formData.quantity} {formData.unit} · {formData.flowType} Mode
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                    <div className="space-y-1 md:col-span-3">
                      <Label className="text-[11px] font-bold text-slate-700">Product / Model Name *</Label>
                      <Input
                        value={formData.itemName}
                        onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
                        className="bg-white border-emerald-300 font-bold text-xs text-slate-900"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-1">
                      <Label className="text-[11px] font-semibold text-slate-700">VP Code</Label>
                      <Input
                        value={formData.vpCode}
                        onChange={(e) => setFormData({ ...formData, vpCode: e.target.value })}
                        className="bg-white border-emerald-300 font-mono text-xs font-bold uppercase"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-1">
                      <Label className="text-[11px] font-semibold text-slate-700">HSN Code</Label>
                      <Input
                        value={formData.hsn}
                        onChange={(e) => setFormData({ ...formData, hsn: e.target.value })}
                        className="bg-white border-emerald-300 font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-1">
                      <Label className="text-[11px] font-semibold text-slate-700">Quantity</Label>
                      <Input
                        type="number"
                        min="1"
                        value={formData.quantity}
                        onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                        className="bg-white border-emerald-300 font-bold text-xs"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-[11px] font-bold text-slate-800">Serial / IMEI Number</Label>
                      <Input
                        placeholder="SN / IMEI..."
                        value={formData.serialImei}
                        onChange={(e) => setFormData({ ...formData, serialImei: e.target.value })}
                        className="bg-white border-emerald-300 font-mono text-xs font-bold uppercase"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-[11px] font-semibold text-slate-700">Estimated Value / Price (₹)</Label>
                      <Input
                        type="number"
                        placeholder="Estimated item value"
                        value={formData.itemPrice}
                        onChange={(e) => setFormData({ ...formData, itemPrice: e.target.value })}
                        className="bg-white border-emerald-300 font-mono text-xs font-bold text-emerald-800"
                      />
                    </div>

                    <div className="space-y-1 md:col-span-2">
                      <Label className="text-[11px] font-bold text-rose-700">Defect Description / Fault Notes</Label>
                      <Input
                        placeholder="e.g. Display flickering / Dead on Arrival"
                        value={formData.defectDescription}
                        onChange={(e) => setFormData({ ...formData, defectDescription: e.target.value })}
                        className="bg-rose-50/70 border-rose-300 text-xs font-medium text-rose-900"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* ─── SECTION 3: VEHICLE & TRANSPORTATION LOGISTICS ─── */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                <Truck className="w-4 h-4 text-[#3F63AD]" /> 3. Vehicle & Transportation Logistics (GIDA Route)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-slate-800">Vehicle Reg Number *</Label>
                  <Input 
                    placeholder="e.g. UP-53-ET-8819" 
                    value={formData.vehicleNo} 
                    onChange={(e) => setFormData({ ...formData, vehicleNo: e.target.value.toUpperCase() })} 
                    className="bg-slate-50 border-slate-300 font-mono uppercase font-bold" 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Transporter / Agency Name</Label>
                  <Input 
                    placeholder="Value Plus In-House Van" 
                    value={formData.transporterName} 
                    onChange={(e) => setFormData({ ...formData, transporterName: e.target.value })} 
                    className="bg-slate-50 border-slate-300 text-xs" 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Driver / Dispatcher Name</Label>
                  <Input 
                    placeholder="Amit Singh" 
                    value={formData.driverName} 
                    onChange={(e) => setFormData({ ...formData, driverName: e.target.value })} 
                    className="bg-slate-50 border-slate-300 text-xs" 
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Driver Phone Number</Label>
                  <Input 
                    placeholder="9140860604" 
                    value={formData.driverPhone} 
                    onChange={(e) => setFormData({ ...formData, driverPhone: e.target.value })} 
                    className="bg-slate-50 border-slate-300 font-mono" 
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">E-Way Bill / LR No. (Optional)</Label>
                  <Input 
                    placeholder="EWB-94829103984" 
                    value={formData.ewayBillNo} 
                    onChange={(e) => setFormData({ ...formData, ewayBillNo: e.target.value })} 
                    className="bg-slate-50 border-slate-300 font-mono text-xs" 
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Reason for Dispatch / Transit</Label>
                  <Input 
                    placeholder="Transit to GIDA Warehouse Hub" 
                    value={formData.reason} 
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })} 
                    className="bg-slate-50 border-slate-300 text-xs" 
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-medium">* Non-commercial transit document.</span>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/25">
                <CheckCircle2 className="w-4 h-4 mr-1.5" /> Issue Delivery Challan ({formData.flowType})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── OFFICIAL INVOICE-STYLE PRINTABLE DELIVERY CHALLAN SHEET MODAL ─── */}
      <Dialog open={isPrintOpen} onOpenChange={setIsPrintOpen}>
        <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
          {selectedChallan && (
            <div className="bg-slate-200 p-4 md:p-6 print:p-0 print:bg-white text-slate-900 font-sans">
              
              {/* TOP ACTION BAR (HIDDEN IN PRINT) */}
              <div className="max-w-[860px] mx-auto mb-4 bg-white p-3.5 rounded-xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border">
                    Challan No: <span className="text-[#30539C] font-black">{selectedChallan.challanNo}</span>
                  </span>
                  <Badge className={cn("text-xs font-bold font-mono px-2 py-0.5", selectedChallan.flowType === "PR" ? "bg-[#30539C] text-white" : "bg-amber-500 text-white")}>
                    {selectedChallan.flowType || "CNR"} Mode
                  </Badge>
                  {selectedChallan.approvalStatus === "approved" && (
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-xs">
                      ✅ Approved
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => {
                      const phone = (selectedChallan.sourcePhone || selectedChallan.customerPhone || "").replace(/\D/g, "");
                      const ph = phone.length === 10 ? `91${phone}` : phone;
                      const msg = encodeURIComponent(
                        `*VALUE PLUS / ASHOKA ENTERPRISES*\nDelivery & Return Challan #${selectedChallan.challanNo}\nFlow Mode: ${selectedChallan.flowType || 'CNR'}\nItem: ${selectedChallan.itemName}\nSerial: ${selectedChallan.serialImei || 'N/A'}\nQty: ${selectedChallan.quantity} ${selectedChallan.unit}\nDestination: ${selectedChallan.destinationParty}\nStatus: ${selectedChallan.status}\n\nThank you!`
                      );
                      window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
                    }} 
                    className="gap-1.5 text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-600 hover:text-white text-xs font-bold"
                  >
                    <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => window.print()} 
                    className="gap-1.5 border-slate-300 text-slate-800 text-xs font-bold shadow-xs"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Challan
                  </Button>
                  <Button 
                    size="sm" 
                    onClick={() => window.print()} 
                    className="bg-[#30539C] hover:bg-[#203a70] text-white text-xs font-bold gap-1.5 shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" /> Download PDF
                  </Button>
                </div>
              </div>

              {/* ─── OFFICIAL VALUE PLUS TAX-INVOICE STYLE DELIVERY CHALLAN CONTAINER ─── */}
              <div className="max-w-[860px] mx-auto bg-white border border-slate-400 p-8 shadow-xl print:border-none print:shadow-none print:p-0 print:m-0 text-[11px] leading-tight">
                
                {/* 1. TOP HEADER: OFFICIAL VALUE PLUS BRANDING */}
                <div className="flex flex-col items-center justify-center pb-2 border-b border-slate-300">
                  <div className="flex items-center text-3xl font-black tracking-tight">
                    <span className="text-[#30539C]">VALUE</span>
                    <span className="text-[#76C043]">PLUS</span>
                  </div>
                  <p className="text-[10px] text-slate-500 tracking-wider mt-0.5">plug into great experience |</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="h-[1px] w-6 bg-slate-400" />
                    <span className="text-xs font-bold text-slate-800 tracking-wider">— रिश्ता विश्वास का —</span>
                    <span className="h-[1px] w-6 bg-slate-400" />
                  </div>
                </div>

                {/* 2. TITLE & META BAR (IDENTICAL TO INVOICE) */}
                <div className="flex items-center justify-between py-2 border-b border-slate-400 font-bold">
                  <span className="text-xs flex items-center gap-1.5">
                    DELIVERY & RETURN CHALLAN
                    <span className="text-[10px] text-slate-600 font-normal">
                      ({selectedChallan.flowType === "PR" ? "Purchase / Vendor Return Note" : "Customer Replacement / Warranty Transit"})
                    </span>
                  </span>
                  <span className="text-xs font-mono">
                    Challan No : <span className="text-black font-black">{selectedChallan.challanNo}</span>
                  </span>
                  <span className="text-xs">
                    Dated : <span className="font-mono">{formatDate(selectedChallan.date)}</span>
                  </span>
                </div>

                {/* 3. CONSIGNOR (ORIGIN) & CONSIGNEE (DESTINATION) DETAILS */}
                <div className="grid grid-cols-12 border-b border-slate-400 py-2.5 gap-3">
                  {/* Left: Dispatch Origin / Showroom or Customer */}
                  <div className="col-span-6 pr-2 border-r border-slate-300 space-y-0.5">
                    <p className="text-[10px] font-black uppercase text-[#30539C] mb-1">DISPATCH FROM (ORIGIN / SENDER)</p>
                    <p className="font-bold text-xs text-slate-900">{selectedChallan.sourceParty}</p>
                    {selectedChallan.sourcePhone && (
                      <p className="text-slate-700 font-mono">Mobile / Phone: <b>{selectedChallan.sourcePhone}</b></p>
                    )}
                    <p className="text-slate-600">{selectedChallan.sourceAddress || "Gorakhpur, Uttar Pradesh (09)"}</p>
                    <p className="text-slate-600">State: <b>Uttar Pradesh (09)</b></p>
                  </div>

                  {/* Right: Dispatch Destination / GIDA Central Hub */}
                  <div className="col-span-6 pl-1 space-y-0.5">
                    <p className="text-[10px] font-black uppercase text-[#76C043] mb-1">DISPATCH TO (DESTINATION / RECEIVER)</p>
                    <p className="font-bold text-xs text-slate-900">{selectedChallan.destinationParty}</p>
                    <p className="text-slate-600">{selectedChallan.destinationAddress || GIDA_HUB.address}</p>
                    <p className="text-slate-600">Destination Hub: <b>GIDA Central Warehouse & Logistics</b></p>
                    {selectedChallan.invoiceNumber && (
                      <p className="text-emerald-700 font-mono font-bold mt-1">
                        Original Invoice Ref: #{selectedChallan.invoiceNumber}
                      </p>
                    )}
                  </div>
                </div>

                {/* 4. ITEMS TABLE (INVOICE STRUCTURE) */}
                <div className="py-2">
                  <table className="w-full text-left border-collapse border border-slate-400">
                    <thead>
                      <tr className="bg-slate-100 text-slate-800 text-[10px] font-bold uppercase border-b border-slate-400">
                        <th className="p-1.5 text-center border-r border-slate-400 w-8">#</th>
                        <th className="p-1.5 border-r border-slate-400">Description of Goods / Defective Unit</th>
                        <th className="p-1.5 text-center border-r border-slate-400 w-20">HSN/SAC</th>
                        <th className="p-1.5 text-center border-r border-slate-400 w-14">Qty</th>
                        <th className="p-1.5 text-center border-r border-slate-400 w-14">UOM</th>
                        <th className="p-1.5 text-right border-r border-slate-400 w-24">Est. Rate</th>
                        <th className="p-1.5 text-right w-24">Est. Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      <tr>
                        <td className="p-2 text-center font-mono font-bold border-r border-slate-400">1</td>
                        <td className="p-2 border-r border-slate-400">
                          <p className="font-bold text-slate-900 text-xs">{selectedChallan.itemName}</p>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[10px] text-slate-600 font-mono">
                            {selectedChallan.vpCode && (
                              <span>VP Code: <b>{selectedChallan.vpCode}</b></span>
                            )}
                            {selectedChallan.serialImei && (
                              <span className="bg-slate-100 px-1 py-0.2 rounded border text-slate-800">
                                Serial / IMEI: <b>{selectedChallan.serialImei}</b>
                              </span>
                            )}
                          </div>
                          {selectedChallan.defectDescription && (
                            <p className="text-[10px] text-rose-700 italic mt-1 bg-rose-50 p-1 rounded border border-rose-200">
                              <b>Defect / Fault Reported:</b> {selectedChallan.defectDescription}
                            </p>
                          )}
                        </td>
                        <td className="p-2 text-center font-mono border-r border-slate-400">{selectedChallan.hsn || "85287217"}</td>
                        <td className="p-2 text-center font-bold border-r border-slate-400">{selectedChallan.quantity}</td>
                        <td className="p-2 text-center border-r border-slate-400">{selectedChallan.unit || "PCS"}</td>
                        <td className="p-2 text-right font-mono border-r border-slate-400">
                          {selectedChallan.itemPrice ? `₹${Number(selectedChallan.itemPrice).toLocaleString("en-IN")}` : "0.00"}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-slate-900">
                          {selectedChallan.itemPrice ? `₹${(Number(selectedChallan.itemPrice) * Number(selectedChallan.quantity)).toLocaleString("en-IN")}` : "0.00"}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold border-t border-slate-400 text-slate-900">
                        <td colSpan={3} className="p-1.5 text-right border-r border-slate-400 uppercase text-[10px]">
                          Total Quantity & Non-Commercial Value:
                        </td>
                        <td className="p-1.5 text-center font-mono border-r border-slate-400">{selectedChallan.quantity}</td>
                        <td className="p-1.5 text-center border-r border-slate-400">{selectedChallan.unit || "PCS"}</td>
                        <td className="p-1.5 text-right border-r border-slate-400 font-mono">—</td>
                        <td className="p-1.5 text-right font-mono text-emerald-800 font-black">
                          {selectedChallan.itemPrice ? `₹${(Number(selectedChallan.itemPrice) * Number(selectedChallan.quantity)).toLocaleString("en-IN")}` : "₹0.00"}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* 5. VEHICLE & TRANSPORTATION LOGISTICS PARTICULARS */}
                <div className="grid grid-cols-12 border border-slate-400 my-2 bg-slate-50 text-[10px]">
                  <div className="col-span-3 p-2 border-r border-slate-300">
                    <span className="text-slate-500 uppercase font-bold block">Vehicle Number:</span>
                    <span className="font-mono font-bold text-slate-900 text-xs uppercase">{selectedChallan.vehicleNo || "UP-53-ET-8819"}</span>
                  </div>
                  <div className="col-span-3 p-2 border-r border-slate-300">
                    <span className="text-slate-500 uppercase font-bold block">Transporter / Route:</span>
                    <span className="font-bold text-slate-800">{selectedChallan.transporterName || "Value Plus GIDA Logistics Van"}</span>
                  </div>
                  <div className="col-span-3 p-2 border-r border-slate-300">
                    <span className="text-slate-500 uppercase font-bold block">Driver & Contact:</span>
                    <span className="font-bold text-slate-800">{selectedChallan.driverName || "AMIT SINGH"}</span>
                    {selectedChallan.driverPhone && <span className="font-mono text-slate-600 block">Ph: {selectedChallan.driverPhone}</span>}
                  </div>
                  <div className="col-span-3 p-2">
                    <span className="text-slate-500 uppercase font-bold block">Transit Reason / E-Way:</span>
                    <span className="font-bold text-[#30539C]">{selectedChallan.reason || "Transit to GIDA Warehouse Hub"}</span>
                    {selectedChallan.ewayBillNo && <span className="font-mono text-slate-600 block">E-Way: {selectedChallan.ewayBillNo}</span>}
                  </div>
                </div>

                {/* 6. STATUTORY NON-COMMERCIAL DECLARATION & TERMS */}
                <div className="border border-slate-400 p-2 text-[9.5px] text-slate-600 space-y-1 bg-white mb-4">
                  <p className="font-bold text-slate-800 uppercase tracking-wide">
                    DECLARATION (SUPPLY NOT FOR COMMERCIAL SALE / TRANSIT CHALLAN):
                  </p>
                  <p>
                    1. This Delivery Challan is issued under GST Rules for transit of defective/replacement goods between showroom, customer, and GIDA Central Logistics Hub.
                  </p>
                  <p>
                    2. No commercial sale or tax liability is incurred on this transit. Goods remain the property of Value Plus / Customer under claim settlement.
                  </p>
                </div>

                {/* 7. DUAL SIGNATURE BOXES (OFFICIAL INVOICE STYLE) */}
                <div className="grid grid-cols-2 gap-8 pt-6 border-t border-slate-400 text-xs">
                  <div className="text-center pt-8 border-t border-dashed border-slate-400">
                    <p className="font-bold text-slate-900">Receiver / Customer / Driver Signature</p>
                    <p className="text-[9.5px] text-slate-500 mt-0.5">Goods Received in Stated Condition</p>
                  </div>
                  <div className="text-center pt-8 border-t border-dashed border-slate-400">
                    <p className="font-bold text-slate-900">For VALUEPLUS / ASHOKA ENTERPRISES</p>
                    <p className="text-[9.5px] text-slate-500 mt-0.5">Authorised Signatory / Store Seal</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
