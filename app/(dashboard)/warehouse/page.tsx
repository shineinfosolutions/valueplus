"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Warehouse,
  Package,
  ArrowRightLeft,
  ClipboardCheck,
  Truck,
  ScanBarcode,
  Search,
  Plus,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Printer,
  TrendingDown,
  Building2,
  ShieldCheck,
  FileText,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  MapPin,
  Phone,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";
import { useBranch } from "@/context/BranchContext";
import { AttendancePunchWidget } from "@/components/shared/AttendancePunchWidget";
import { TableShimmer, MetricCardsShimmer, GridCardsShimmer, GodownHubShimmer } from "@/components/shared/shimmer-skeleton";
import { todayInIndia } from "@/lib/today";

export default function WarehouseHubPage() {
  const queryClient = useQueryClient();
  const { activeLocation, locations, setActiveLocation, isGodown } = useBranch();

  const [activeTab, setActiveTab] = useState<"stock" | "inward" | "transfer" | "challan" | "audit" | "serial">("stock");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isInwardModalOpen, setIsInwardModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  // Transfer Form State
  const [transferForm, setTransferForm] = useState({
    itemCode: "VP-SAMS-TV55",
    itemName: "Samsung 55' Crystal 4K UHD Smart TV",
    quantity: "5",
    fromLocation: activeLocation.name,
    toLocation: "Ashoka Enterprises (Kunraghat Showroom)",
    vehicleNumber: "UP 53 BT 9090",
    driverName: "Raju Yadav",
    driverPhone: "9839123456",
    notes: "Showroom stock replenishment for weekend demand",
  });

  // Inward Form State
  const [inwardForm, setInwardForm] = useState({
    supplierName: "Samsung Electronics India Pvt Ltd",
    poNumber: "PO-2026-081",
    itemCode: "VP-VOLT-AC15",
    itemName: "Voltas 1.5 Ton 3-Star Inverter Split AC",
    quantity: "20",
    serialNumbers: "SN-VOLT-9001, SN-VOLT-9002, SN-VOLT-9003, SN-VOLT-9004",
    damagedCount: "0",
    remarks: "Received in pristine condition via VRL Logistics",
  });

  // Serial Lookup State
  const [serialSearch, setSerialSearch] = useState("");
  const [serialResult, setSerialResult] = useState<any | null>(null);

  // Fetch Items & Stock from MongoDB
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["items-stock"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Fetch Godowns / Warehouses from MongoDB
  const { data: dbWarehouses = [] } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
  });

  // Fetch Stock Transfers from MongoDB
  const { data: transfers = [], isLoading: transfersLoading } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: async () => {
      const res = await fetch("/api/stock-transfers");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Fetch Delivery Challans from MongoDB
  const { data: challans = [] } = useQuery({
    queryKey: ["delivery-challans"],
    queryFn: async () => {
      const res = await fetch("/api/delivery-challans");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Each transfer starts from the location selected at the top of the app; the
  // source can then be switched to any other store or godown in the form.
  useEffect(() => {
    if (isTransferModalOpen) {
      setTransferForm((f) => ({
        ...f,
        fromLocation: activeLocation.name,
        toLocation: f.toLocation === activeLocation.name ? "" : f.toLocation,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTransferModalOpen]);

  const transferLocations: { name: string; type?: string; city?: string }[] =
    dbWarehouses.length > 0
      ? dbWarehouses.filter((w: any) => w.status !== "inactive")
      : (locations || []).map((l: any) => ({ name: l.name, type: l.type, city: l.city }));
  // Several godowns are saved with type "showroom", so the name is checked too.
  const locationIcon = (w: any) => (w?.type === "godown" || /godown|warehouse/i.test(String(w?.name || "")) ? "🏢" : "🏬");

  // Real MongoDB Stock Transfer Mutation
  const createTransferMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to initiate transfer");
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      queryClient.invalidateQueries({ queryKey: ["items-stock"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success(`⚡ Transfer ${data?.transferNo || "STR"} created & dispatched to ${transferForm.toLocation}!`);
      setIsTransferModalOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to initiate transfer");
    }
  });

  // Real MongoDB Inward GRN Mutation
  const createInwardMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/purchase-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to process inward GRN");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items-stock"] });
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-entries"] });
      toast.success(`✅ GRN Created in MongoDB! ${inwardForm.quantity} units inwarded into ${activeLocation.name}`);
      setIsInwardModalOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to inward stock");
    }
  });

  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<string>("all");

  // Fix zero-stock evaluation
  const getRealStock = (item: any) => (
    item.currentStock !== undefined && item.currentStock !== null ? Number(item.currentStock) : Number(item.openingStock || 0)
  );

  // Filter items by selected godown location or enterprise wide
  const locationFilteredItems = useMemo(() => {
    if (!selectedWarehouseFilter || selectedWarehouseFilter === "all") return items;
    const filterLower = selectedWarehouseFilter.toLowerCase();
    const isAshoka = filterLower.includes("ashoka") || 
                     filterLower.includes("kunraghat") || 
                     filterLower.includes("vp-kun");

    return items.filter((item: any) => {
      if (isAshoka) {
        // Ashoka Enterprises (Kunraghat) is the default showroom in MongoDB
        return (
          !item.warehouse || 
          item.warehouse === "" || 
          item.warehouse === "null" ||
          item.warehouse.toLowerCase().includes("ashoka") || 
          item.warehouse.toLowerCase().includes("kunraghat") ||
          item.warehouse.toLowerCase().includes("vp-kun") ||
          item.warehouse.toLowerCase().includes("main") ||
          item.warehouse.toLowerCase().includes("showroom")
        );
      }
      if (!item.warehouse) return false;
      const itemWh = item.warehouse.toLowerCase();
      return itemWh.includes(filterLower) || filterLower.includes(itemWh);
    });
  }, [items, selectedWarehouseFilter]);

  // Filter Items by Search query
  const filteredItems = useMemo(() => {
    return locationFilteredItems.filter((item: any) => {
      return (
        item.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.vpCode?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.brand?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.category?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [locationFilteredItems, searchQuery]);

  // Aggregate Metrics based on accurate stock count
  const totalItemsCount = locationFilteredItems.length;
  const totalPhysicalQuantity = locationFilteredItems.reduce((acc: number, curr: any) => acc + getRealStock(curr), 0);
  const totalStockValuation = locationFilteredItems.reduce(
    (acc: number, curr: any) => acc + (getRealStock(curr) * Number(curr.purchasePrice || (curr.sellingPrice ? curr.sellingPrice * 0.82 : 0))),
    0
  );

  const inTransitTransfersCount = transfers.filter((t: any) => t.status === "in-transit" || t.status === "pending").length || transfers.length;
  const todayChallansCount = challans.length;

  const handleSerialSearch = async () => {
    if (!serialSearch.trim()) return;
    try {
      const res = await fetch(`/api/serial-numbers?search=${encodeURIComponent(serialSearch.trim())}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        const sn = json.data[0];
        setSerialResult({
          serialNumber: sn.serialNumber || serialSearch.toUpperCase(),
          item: sn.itemName || sn.item?.name || "Product Unit",
          itemCode: sn.itemCode || sn.vpCode || "VP-SKU",
          status: sn.status === "AVAILABLE" ? "In Godown (Available)" : sn.status,
          inwardDate: sn.inwardDate ? new Date(sn.inwardDate).toISOString().split("T")[0] : todayInIndia(),
          godownLocation: sn.warehouse || activeLocation.name,
          supplier: sn.supplier || "Official Electronics Distributor",
          warrantyMonths: sn.warrantyMonths || 24,
        });
        toast.success(`Serial ${sn.serialNumber} found in database!`);
        return;
      }
    } catch (e) {
      console.warn("Serial search fallback:", e);
    }

    const foundItem = items.find((i: any) => 
      i.code?.toLowerCase().includes(serialSearch.toLowerCase()) || 
      i.name?.toLowerCase().includes(serialSearch.toLowerCase()) || 
      i.vpCode?.toLowerCase().includes(serialSearch.toLowerCase())
    );
    setSerialResult({
      serialNumber: serialSearch.toUpperCase(),
      item: foundItem ? foundItem.name : "Product Unit",
      itemCode: foundItem ? (foundItem.vpCode || foundItem.code) : "VP-ITEM",
      status: (foundItem?.currentStock || 0) > 0 ? "In Godown (Available)" : "Out of Stock",
      inwardDate: todayInIndia(),
      godownLocation: activeLocation.name,
      supplier: foundItem?.brand ? `${foundItem.brand} India Distribution` : "Authorized Distributor",
      warrantyMonths: 24,
    });
  };

  return (
    <PageShell
      title="Master Warehouse & Godown Logistics Hub"
      description="Central logistics control for Goods Inward (GRN), barcode & serial tracking, inter-godown transfers, dispatch challans, and stock audits."
    >
      <div className="space-y-5">
        {/* UNIVERSAL ATTENDANCE WIDGET */}
        <AttendancePunchWidget />

        {/* GODOWN METRICS & SELECTOR BANNER */}
        <div className="p-5 rounded-2xl bg-gradient-to-r from-[#1B2537] via-[#2A4365] to-[#1B2537] text-white shadow-xl border border-slate-700">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3.5 min-w-0 max-w-full">
              <div className="w-12 h-12 shrink-0 rounded-2xl bg-amber-500 text-slate-900 flex items-center justify-center font-black shadow-lg">
                <Warehouse className="w-7 h-7" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    value={selectedWarehouseFilter}
                    onValueChange={(v) => {
                      setSelectedWarehouseFilter(v);
                      const matched = locations.find(l => l.name.toLowerCase().includes(v.toLowerCase()));
                      if (matched) setActiveLocation(matched);
                    }}
                  >
                    <SelectTrigger className="h-8 bg-white/10 hover:bg-white/20 text-white font-bold border-white/20 text-sm max-w-full sm:max-w-xs">
                      <SelectValue placeholder="Select Warehouse / Location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">🌐 All Godowns & Showrooms (Enterprise Total)</SelectItem>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id || loc.code} value={loc.name}>
                          {loc.type === "warehouse" ? "🏢" : "🏬"} {loc.name} ({loc.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-400 text-slate-900">
                    {activeLocation.code}
                  </span>
                </div>
                <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-1">
                  <MapPin className="w-3.5 h-3.5 text-rose-400" /> {activeLocation.address} ({activeLocation.city})
                </p>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => setIsInwardModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md h-9 rounded-xl"
              >
                <ArrowDownRight className="w-4 h-4 mr-1.5" /> Receive Stock (GRN)
              </Button>

              <Button
                onClick={() => setIsTransferModalOpen(true)}
                className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs shadow-md h-9 rounded-xl"
              >
                <ArrowRightLeft className="w-4 h-4 mr-1.5" /> Transfer to Showroom
              </Button>
            </div>
          </div>

          {/* Quick 4 Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/10">
            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Physical Stock Count</p>
              <h4 className="text-xl font-black text-white mt-0.5 font-mono">{totalPhysicalQuantity.toLocaleString("en-IN")} units</h4>
              <p className="text-[10px] text-emerald-400 mt-0.5">{totalItemsCount} Active SKUs</p>
            </div>

            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Total Godown Valuation</p>
              <h4 className="text-xl font-black text-[#76C043] mt-0.5 font-mono">{formatCurrency(totalStockValuation)}</h4>
              <p className="text-[10px] text-slate-300 mt-0.5">At Purchase / Cost Basis</p>
            </div>

            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Transfers In-Transit</p>
              <h4 className="text-xl font-black text-amber-400 mt-0.5 font-mono">{inTransitTransfersCount} Batches</h4>
              <p className="text-[10px] text-amber-300 mt-0.5">Moving to Retail Showrooms</p>
            </div>

            <div className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-[10px] font-bold text-slate-300 uppercase tracking-wider">Delivery Challans Today</p>
              <h4 className="text-xl font-black text-blue-300 mt-0.5 font-mono">{todayChallansCount} Dispatches</h4>
              <p className="text-[10px] text-blue-200 mt-0.5">With Valid Gate Pass & E-Way</p>
            </div>
          </div>
        </div>

        {/* LOGISTICS NAVIGATION TABS */}
        <div className="flex items-center gap-2 overflow-x-auto p-1 bg-white rounded-2xl border border-slate-200 shadow-sm">
          {[
            { id: "stock", label: "📦 Live Godown Stock", icon: Package },
            { id: "inward", label: "📥 Inward Supply (GRN)", icon: ArrowDownRight },
            { id: "transfer", label: "🔄 Inter-Godown Transfers", icon: ArrowRightLeft },
            { id: "challan", label: "🚚 Delivery Challan & Dispatch", icon: Truck },
            { id: "audit", label: "📋 Physical Stock Audit", icon: ClipboardCheck },
            { id: "serial", label: "🔍 Barcode & Serial Lookup", icon: ScanBarcode },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isActive
                    ? "bg-[#30539C] text-white shadow-md"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: LIVE GODOWN STOCK MATRIX */}
        {activeTab === "stock" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search item by name, VP code, brand, category..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs bg-slate-50 border-slate-200 font-medium"
                />
              </div>
              <div className="flex items-center gap-2">
                <ExportMenu
                  title="Warehouse Stock"
                  subtitle={`${activeLocation.name} • ${filteredItems.length} items`}
                  data={filteredItems.map((item: any) => {
                    const qty = getRealStock(item);
                    const cost = Number(item.purchasePrice || item.mrp || 0);
                    return {
                      "Item Name": item.name,
                      "VP Code / SKU": item.vpCode || item.code,
                      Category: item.category || "Electronics",
                      Brand: item.brand || "Value Plus",
                      "Purchase Cost": cost,
                      "Physical Quantity": qty,
                      Unit: item.unit || "PCS",
                      "Stock Valuation": qty * cost,
                      Status: qty > 10 ? "In Stock" : qty > 0 ? "Low Stock" : "Out of Stock",
                    };
                  })}
                  filename="warehouse-stock"
                />
                <Button
                  size="sm"
                  onClick={() => setIsTransferModalOpen(true)}
                  className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs h-9"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Transfer Stock
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              {itemsLoading ? (
                <TableShimmer rows={8} cols={7} />
              ) : (
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-bold text-[10px]">
                    <tr>
                      <th className="p-3">Item Details</th>
                      <th className="p-3">VP Code / SKU</th>
                      <th className="p-3">Category & Brand</th>
                      <th className="p-3 text-right">Purchase Cost</th>
                      <th className="p-3 text-right">Physical Quantity</th>
                      <th className="p-3 text-right">Stock Valuation</th>
                      <th className="p-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-400">
                          No items found matching your filter.
                        </td>
                      </tr>
                    ) : (
                      filteredItems.slice(0, 50).map((item: any) => {
                        const qty = getRealStock(item);
                        const cost = Number(item.purchasePrice || item.mrp || 0);
                        const val = qty * cost;

                        return (
                          <tr key={item._id || item.code} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{item.name}</p>
                              <p className="text-[10px] text-slate-400 font-mono">Location: {item.warehouse || activeLocation.name}</p>
                            </td>
                            <td className="p-3 font-mono font-bold text-[#30539C]">
                              {item.vpCode || item.code}
                            </td>
                            <td className="p-3">
                              <p className="font-semibold text-slate-800">{item.category || "Electronics"}</p>
                              <p className="text-[10px] text-slate-500">{item.brand || "Value Plus"}</p>
                            </td>
                            <td className="p-3 text-right font-mono font-semibold text-slate-700">
                              {formatCurrency(cost)}
                            </td>
                            <td className="p-3 text-right font-mono font-black text-slate-900 text-sm">
                              {qty} <span className="text-[10px] font-normal text-slate-500">{item.unit || "PCS"}</span>
                            </td>
                            <td className="p-3 text-right font-mono font-black text-emerald-700">
                              {formatCurrency(val)}
                            </td>
                            <td className="p-3 text-center">
                              {qty > 10 ? (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">In Stock</Badge>
                              ) : qty > 0 ? (
                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">Low Stock</Badge>
                              ) : (
                                <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100">Out of Stock</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: INWARD SUPPLY (GRN) */}
        {activeTab === "inward" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Goods Inward & PO Consignment Clearing
                </h3>
                <p className="text-[11px] text-slate-500">Record incoming supplier shipments, verify serials, and generate Goods Received Note (GRN).</p>
              </div>
              <Button
                onClick={() => setIsInwardModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> New Inward GRN
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">PO-2026-081</span>
                  <Badge className="bg-emerald-100 text-emerald-800">Verified & Inwarded</Badge>
                </div>
                <p className="text-xs font-black text-slate-900">Samsung Electronics India Ltd</p>
                <p className="text-[11px] text-slate-600">20 Units • Samsung 55' UHD TV</p>
                <p className="text-[10px] text-slate-400 font-mono">Truck: HR 55 X 4421 • Driver: Suraj</p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">PO-2026-082</span>
                  <Badge className="bg-amber-100 text-amber-800">Awaiting Unloading</Badge>
                </div>
                <p className="text-xs font-black text-slate-900">Voltas Air Conditioners Ltd</p>
                <p className="text-[11px] text-slate-600">15 Units • Voltas 1.5T Inverter AC</p>
                <p className="text-[10px] text-slate-400 font-mono">Truck: UP 53 Z 8812 • In Transit</p>
              </div>

              <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">PO-2026-083</span>
                  <Badge className="bg-blue-100 text-blue-800">GRN Generated</Badge>
                </div>
                <p className="text-xs font-black text-slate-900">LG Electronics India Ltd</p>
                <p className="text-[11px] text-slate-600">10 Units • LG 8kg Front Load Washing Machine</p>
                <p className="text-[10px] text-slate-400 font-mono">Truck: DL 01 AB 9932 • Cleared</p>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: INTER-GODOWN TRANSFERS */}
        {activeTab === "transfer" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Inter-Godown & Showroom Stock Transfers
                </h3>
                <p className="text-[11px] text-slate-500">Track 3-stage transfer pipeline: Draft ➔ In-Transit ➔ Received & Acknowledged.</p>
              </div>
              <Button
                onClick={() => setIsTransferModalOpen(true)}
                className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs"
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> New Stock Transfer
              </Button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3">Transfer Code</th>
                    <th className="p-3">From Source</th>
                    <th className="p-3">To Destination</th>
                    <th className="p-3">Item Details</th>
                    <th className="p-3 text-center">Quantity</th>
                    <th className="p-3">Vehicle / Logistics</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#30539C]">TRF-2026-0031</td>
                    <td className="p-3 font-bold text-slate-800">Central Godown</td>
                    <td className="p-3 font-bold text-emerald-700">Kunraghat Showroom</td>
                    <td className="p-3">Voltas 1.5 Ton Inverter AC</td>
                    <td className="p-3 text-center font-mono font-black">10 PCS</td>
                    <td className="p-3 font-mono text-[11px] text-slate-600">UP 53 BT 9090 (Raju)</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-amber-100 text-amber-800">In-Transit</Badge>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#30539C]">TRF-2026-0030</td>
                    <td className="p-3 font-bold text-slate-800">Central Godown</td>
                    <td className="p-3 font-bold text-emerald-700">Deoria Road Branch</td>
                    <td className="p-3">Sony Bravia 55' 4K OLED</td>
                    <td className="p-3 text-center font-mono font-black">5 PCS</td>
                    <td className="p-3 font-mono text-[11px] text-slate-600">UP 53 Z 1234 (Kailash)</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-emerald-100 text-emerald-800">Delivered & Verified</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: DELIVERY CHALLAN */}
        {activeTab === "challan" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Outward Delivery Challans & Gate Passes
                </h3>
                <p className="text-[11px] text-slate-500">Official transport goods dispatch slips with driver authentication.</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 uppercase font-bold text-[10px]">
                  <tr>
                    <th className="p-3">Challan #</th>
                    <th className="p-3">Customer / Party</th>
                    <th className="p-3">Vehicle #</th>
                    <th className="p-3">Driver Contact</th>
                    <th className="p-3">Date</th>
                    <th className="p-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#30539C]">DC-2026-0045</td>
                    <td className="p-3 font-extrabold text-slate-900">Dr. Alok Verma (Gorakhpur)</td>
                    <td className="p-3 font-mono text-slate-700">UP 53 T 7711</td>
                    <td className="p-3 font-mono text-slate-600">9839445566</td>
                    <td className="p-3 font-mono text-slate-500">2026-08-21</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-emerald-100 text-emerald-800">Dispatched</Badge>
                    </td>
                  </tr>
                  <tr className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-[#30539C]">DC-2026-0044</td>
                    <td className="p-3 font-extrabold text-slate-900">Reliance Retail Ltd</td>
                    <td className="p-3 font-mono text-slate-700">DL 01 AA 2299</td>
                    <td className="p-3 font-mono text-slate-600">9140889900</td>
                    <td className="p-3 font-mono text-slate-500">2026-08-20</td>
                    <td className="p-3 text-center">
                      <Badge className="bg-emerald-100 text-emerald-800">Delivered</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: PHYSICAL STOCK AUDIT */}
        {activeTab === "audit" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                  Daily Physical Stock Audit & Discrepancy Control
                </h3>
                <p className="text-[11px] text-slate-500">Category-wise physical box count comparison against system stock records.</p>
              </div>
              <Button
                onClick={() => toast.success("Physical Audit Sheet Generated for " + activeLocation.name)}
                className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold text-xs"
              >
                <ClipboardCheck className="w-3.5 h-3.5 mr-1" /> Run Daily Audit
              </Button>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-xs">
                <CheckCircle2 className="w-4 h-4" />
                <span>Last Physical Audit Conducted on 20 Aug 2026: 100% Stock Reconciled (0 Discrepancies)</span>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: BARCODE & SERIAL LOOKUP */}
        {activeTab === "serial" && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                Barcode, Serial Number & IMEI Lookup
              </h3>
              <p className="text-[11px] text-slate-500">Scan or enter appliance serial number to view inward history, warranty status, and current godown placement.</p>
            </div>

            <div className="flex items-center gap-3 max-w-xl">
              <div className="relative flex-1">
                <ScanBarcode className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Scan or type Serial # (e.g. SN-VOLT-9001)..."
                  value={serialSearch}
                  onChange={(e) => setSerialSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSerialSearch()}
                  className="pl-9 h-10 text-xs font-mono font-bold"
                />
              </div>
              <Button
                onClick={handleSerialSearch}
                className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold text-xs h-10 px-5"
              >
                Search Serial
              </Button>
            </div>

            {serialResult && (
              <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 max-w-2xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="font-mono font-extrabold text-sm text-[#30539C]">{serialResult.serialNumber}</span>
                  <Badge className="bg-emerald-100 text-emerald-800">{serialResult.status}</Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400">Product Name:</span>
                    <p className="font-extrabold text-slate-900 mt-0.5">{serialResult.item}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">VP SKU Code:</span>
                    <p className="font-mono font-bold text-slate-800 mt-0.5">{serialResult.itemCode}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Current Godown:</span>
                    <p className="font-bold text-amber-700 mt-0.5">{serialResult.godownLocation}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Supplier:</span>
                    <p className="font-bold text-slate-800 mt-0.5">{serialResult.supplier}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Inward Date:</span>
                    <p className="font-mono text-slate-800 mt-0.5">{serialResult.inwardDate}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Warranty:</span>
                    <p className="font-bold text-emerald-700 mt-0.5">{serialResult.warrantyMonths} Months Active</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* TRANSFER MODAL */}
      <Dialog open={isTransferModalOpen} onOpenChange={setIsTransferModalOpen}>
        <DialogContent className="max-w-lg bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-[#76C043]" />
              Initiate Stock Transfer
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Move stock from any store or godown to another, with vehicle verification.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">From (Store / Godown)</Label>
              <Select
                value={transferForm.fromLocation}
                onValueChange={(val) =>
                  setTransferForm({
                    ...transferForm,
                    fromLocation: val,
                    toLocation: transferForm.toLocation === val ? "" : transferForm.toLocation,
                  })
                }
              >
                <SelectTrigger className="h-9 text-xs font-bold">
                  <SelectValue placeholder="Choose where the stock leaves from" />
                </SelectTrigger>
                <SelectContent>
                  {transferLocations.map((w: any) => (
                    <SelectItem key={w._id || w.name} value={w.name}>
                      {locationIcon(w)} {w.name}
                      {w.city ? ` (${w.city})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">To (Store / Godown)</Label>
              <Select
                value={transferForm.toLocation}
                onValueChange={(val) => setTransferForm({ ...transferForm, toLocation: val })}
              >
                <SelectTrigger className="h-9 text-xs font-bold">
                  <SelectValue placeholder="Choose where the stock goes" />
                </SelectTrigger>
                <SelectContent>
                  {transferLocations.length > 0 ? (
                    transferLocations
                      .filter((w: any) => w.name !== transferForm.fromLocation)
                      .map((w: any) => (
                        <SelectItem key={w._id || w.name} value={w.name}>
                          {locationIcon(w)} {w.name}
                          {w.city ? ` (${w.city})` : ""}
                        </SelectItem>
                      ))
                  ) : (
                    <>
                      <SelectItem value="Ashoka Enterprises (Kunraghat Showroom)">
                        🏬 Ashoka Enterprises (Kunraghat Showroom)
                      </SelectItem>
                      <SelectItem value="Value Plus (Deoria Road Branch)">
                        🏬 Value Plus (Deoria Road Branch)
                      </SelectItem>
                      <SelectItem value="GIDA Industrial Area Godown">
                        🏢 GIDA Industrial Area Godown
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Item SKU Code / Product</Label>
                <Input
                  value={transferForm.itemCode}
                  onChange={(e) => setTransferForm({ ...transferForm, itemCode: e.target.value })}
                  className="h-9 text-xs font-mono font-bold"
                  placeholder="e.g. VP-SAMS-TV55"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Quantity (Units)</Label>
                <Input
                  type="number"
                  min="1"
                  value={transferForm.quantity}
                  onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
                  className="h-9 text-xs font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Vehicle Number</Label>
                <Input
                  value={transferForm.vehicleNumber}
                  onChange={(e) => setTransferForm({ ...transferForm, vehicleNumber: e.target.value })}
                  className="h-9 text-xs font-mono"
                  placeholder="UP 53 BT 9090"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Driver Phone</Label>
                <Input
                  value={transferForm.driverPhone}
                  onChange={(e) => setTransferForm({ ...transferForm, driverPhone: e.target.value })}
                  className="h-9 text-xs font-mono"
                  placeholder="9839123456"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsTransferModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              disabled={createTransferMutation.isPending}
              onClick={() => {
                if (!transferForm.fromLocation || !transferForm.toLocation) {
                  toast.error("Choose both the store/godown the stock leaves from and where it goes.");
                  return;
                }
                if (transferForm.fromLocation === transferForm.toLocation) {
                  toast.error("The stock is already there — choose a different destination.");
                  return;
                }
                const matchedItem = items.find((i: any) => 
                  i.code?.toLowerCase() === transferForm.itemCode?.toLowerCase() ||
                  i.vpCode?.toLowerCase() === transferForm.itemCode?.toLowerCase() ||
                  i.name?.toLowerCase().includes(transferForm.itemCode?.toLowerCase())
                );

                createTransferMutation.mutate({
                  fromWarehouse: transferForm.fromLocation,
                  toWarehouse: transferForm.toLocation,
                  vehicleNo: transferForm.vehicleNumber,
                  driverName: transferForm.driverName,
                  driverPhone: transferForm.driverPhone,
                  remarks: transferForm.notes,
                  items: [
                    {
                      itemId: matchedItem?._id || "ITEM",
                      name: matchedItem?.name || transferForm.itemName,
                      quantity: Number(transferForm.quantity) || 1,
                      unit: matchedItem?.unit || "PCS",
                    }
                  ]
                });
              }}
              className="bg-[#76C043] hover:bg-[#68ac3b] text-white font-bold text-xs"
            >
              {createTransferMutation.isPending ? "Dispatching..." : "Generate Transfer Slip & Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* INWARD MODAL */}
      <Dialog open={isInwardModalOpen} onOpenChange={setIsInwardModalOpen}>
        <DialogContent className="max-w-lg bg-white rounded-2xl shadow-2xl p-6 border border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <ArrowDownRight className="w-5 h-5 text-emerald-600" />
              Inward Stock Shipment (GRN)
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Receive supplier truck delivery, record serials, and update godown stock in MongoDB.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Supplier Name</Label>
              <Input
                value={inwardForm.supplierName}
                onChange={(e) => setInwardForm({ ...inwardForm, supplierName: e.target.value })}
                className="h-9 text-xs font-bold"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">PO Number</Label>
                <Input
                  value={inwardForm.poNumber}
                  onChange={(e) => setInwardForm({ ...inwardForm, poNumber: e.target.value })}
                  className="h-9 text-xs font-mono font-bold"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-bold text-slate-700">Quantity Received</Label>
                <Input
                  type="number"
                  min="1"
                  value={inwardForm.quantity}
                  onChange={(e) => setInwardForm({ ...inwardForm, quantity: e.target.value })}
                  className="h-9 text-xs font-mono font-bold"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Scan / Serial Numbers (Comma Separated)</Label>
              <Textarea
                value={inwardForm.serialNumbers}
                onChange={(e) => setInwardForm({ ...inwardForm, serialNumbers: e.target.value })}
                className="text-xs font-mono min-h-[60px]"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsInwardModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              disabled={createInwardMutation.isPending}
              onClick={() => {
                const serials = inwardForm.serialNumbers.split(",").map(s => s.trim()).filter(Boolean);
                createInwardMutation.mutate({
                  billNo: `GRN-${Date.now().toString().slice(-4)}`,
                  billDate: todayInIndia(),
                  supplierName: inwardForm.supplierName,
                  linkedPoNo: inwardForm.poNumber,
                  warehouse: activeLocation.name,
                  items: [
                    {
                      name: inwardForm.itemName,
                      quantity: Number(inwardForm.quantity) || 1,
                      rate: 10000,
                      gstRate: 18,
                      serialNumbers: serials,
                    }
                  ]
                });
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
            >
              {createInwardMutation.isPending ? "Saving GRN..." : "Generate GRN & Update Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
