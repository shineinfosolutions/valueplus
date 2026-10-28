"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  AlertTriangle, ShoppingBag, Truck, Package, Plus, CheckCircle2,
  ArrowRight, Search, Filter, Sparkles, RefreshCw, Eye, Check,
  DollarSign, BarChart2, ShieldAlert, Store, Warehouse, Layers
} from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { PurchaseCreationModal } from "@/components/PurchaseCreationModal";
import { useSession } from "next-auth/react";

export default function LowStockReorderPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  // Search & Filter State
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [brandFilter, setBrandFilter] = useState("all");
  const [urgencyFilter, setUrgencyFilter] = useState("all"); // "all" | "out_of_stock" | "low_stock"
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});

  // Modal State for PO customization
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [selectedPOItem, setSelectedPOItem] = useState<any | null>(null);
  const [selectedPOItems, setSelectedPOItems] = useState<any[]>([]);

  // 1. Fetch Items Catalog
  const { data: items = [], isLoading: loadingItems, refetch: refetchItems } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    }
  });

  // 2. Fetch Suppliers Master
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    }
  });

  // 3. Fetch Categories & Brands for Filters
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    }
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    }
  });

  // Filter low stock and out-of-stock items
  const lowStockItems = useMemo(() => {
    return items.filter((item: any) => {
      const stock = Number(item.currentStock || 0);
      const reorderLvl = Number(item.reorderLevel || 5);
      return stock <= reorderLvl;
    });
  }, [items]);

  // Match items with suggested suppliers and recommended reorder quantities
  const enrichedLowStockItems = useMemo(() => {
    return lowStockItems.map((item: any) => {
      const stock = Number(item.currentStock || 0);
      const reorderLvl = Number(item.reorderLevel || 5);
      
      // Default suggested order qty = (reorderLevel * 2) - currentStock (minimum 2 units)
      const defaultSuggestedQty = Math.max(2, (reorderLvl * 2) - stock);
      const userQty = customQuantities[item.code] !== undefined ? customQuantities[item.code] : defaultSuggestedQty;

      // Purchase rate calculation
      const purPrice = Number(item.purchasePrice || (item.sellingPrice ? item.sellingPrice * 0.82 : 1000));
      const lineTotal = purPrice * userQty;
      const gstRate = Number(item.gstRate || 18);
      const totalWithGst = lineTotal * (1 + gstRate / 100);

      // Match supplier by brand or item supplier
      const matchedSupplier = suppliers.find((s: any) => 
        s.name?.toLowerCase().includes(item.brand?.toLowerCase()) ||
        (item.supplier && s.name?.toLowerCase().includes(item.supplier?.toLowerCase()))
      );

      const supplierName = matchedSupplier?.name || (item.brand ? `${item.brand} India Distribution` : "Authorized Electronics Distributor");

      return {
        ...item,
        currentStock: stock,
        reorderLevel: reorderLvl,
        suggestedQty: defaultSuggestedQty,
        orderQty: userQty,
        estimatedPurchasePrice: purPrice,
        estimatedLineTotal: lineTotal,
        totalWithGst: totalWithGst,
        supplierName: supplierName,
        supplierPhone: matchedSupplier?.phone || "9876543210",
        isOutOfStock: stock === 0,
      };
    });
  }, [lowStockItems, suppliers, customQuantities]);

  // Apply User UI Filters
  const filteredItems = useMemo(() => {
    return enrichedLowStockItems.filter((item: any) => {
      const matchSearch = !search || 
        item.name?.toLowerCase().includes(search.toLowerCase()) ||
        item.code?.toLowerCase().includes(search.toLowerCase()) ||
        item.vpCode?.toLowerCase().includes(search.toLowerCase()) ||
        item.brand?.toLowerCase().includes(search.toLowerCase()) ||
        item.supplierName?.toLowerCase().includes(search.toLowerCase());

      const matchCat = categoryFilter === "all" || item.category === categoryFilter;
      const matchBrand = brandFilter === "all" || item.brand === brandFilter;
      
      let matchUrgency = true;
      if (urgencyFilter === "out_of_stock") matchUrgency = item.isOutOfStock;
      if (urgencyFilter === "low_stock") matchUrgency = !item.isOutOfStock;

      return matchSearch && matchCat && matchBrand && matchUrgency;
    });
  }, [enrichedLowStockItems, search, categoryFilter, brandFilter, urgencyFilter]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalLow = enrichedLowStockItems.length;
    const outOfStockCount = enrichedLowStockItems.filter((i: any) => i.isOutOfStock).length;
    const totalReorderValue = enrichedLowStockItems.reduce((acc, curr) => acc + curr.totalWithGst, 0);
    const uniqueSuppliers = new Set(enrichedLowStockItems.map((i: any) => i.supplierName)).size;

    return {
      totalLow,
      outOfStockCount,
      totalReorderValue,
      uniqueSuppliers,
    };
  }, [enrichedLowStockItems]);

  // Handle Multi-Select Checkboxes
  const handleSelectAll = (checked: boolean) => {
    setSelectedCodes(checked ? filteredItems.map((i: any) => i.code) : []);
  };

  const handleToggleSelect = (code: string) => {
    setSelectedCodes(prev => 
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  // Update Custom Order Quantity
  const handleQuantityChange = (code: string, qty: number) => {
    const safeQty = Math.max(1, qty || 1);
    setCustomQuantities(prev => ({ ...prev, [code]: safeQty }));
  };

  // 1-Click Direct Purchase Order Creation Mutation
  const createSinglePOMutation = useMutation({
    mutationFn: async (item: any) => {
      const totalAmount = Math.round(item.totalWithGst);
      const subtotal = Math.round(item.estimatedLineTotal);
      const gstAmount = totalAmount - subtotal;

      const payload = {
        supplierName: item.supplierName,
        supplierPhone: item.supplierPhone,
        totalAmount: totalAmount,
        subtotal: subtotal,
        gst: gstAmount,
        status: "sent",
        items: [
          {
            itemId: item.code || item.vpCode || "ITEM",
            name: item.name,
            quantity: item.orderQty,
            rate: item.estimatedPurchasePrice,
            gstRate: item.gstRate || 18,
          }
        ]
      };

      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to generate Purchase Order");
      return json.data;
    },
    onSuccess: (data, item) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success(
        `⚡ Purchase Order ${data.poNo || "Generated"} created successfully for ${item.name} (${item.orderQty} units with ${item.supplierName})!`,
        {
          action: {
            label: "View POs",
            onClick: () => router.push("/purchase/orders"),
          },
          duration: 6000,
        }
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to create Purchase Order");
    }
  });

  // Bulk 1-Click Purchase Order Generation (Grouped by Supplier)
  const createBulkPOMutation = useMutation({
    mutationFn: async (itemsToOrder: any[]) => {
      // Group items by supplier
      const supplierGroups: Record<string, any[]> = {};
      itemsToOrder.forEach(it => {
        const sName = it.supplierName || "Authorized Electronics Distributor";
        if (!supplierGroups[sName]) supplierGroups[sName] = [];
        supplierGroups[sName].push(it);
      });

      const promises = Object.entries(supplierGroups).map(async ([supplierName, groupItems]) => {
        const subtotal = groupItems.reduce((acc, i) => acc + i.estimatedLineTotal, 0);
        const totalAmount = groupItems.reduce((acc, i) => acc + i.totalWithGst, 0);
        const gst = totalAmount - subtotal;

        const payload = {
          supplierName: supplierName,
          supplierPhone: groupItems[0]?.supplierPhone || "9876543210",
          totalAmount: Math.round(totalAmount),
          subtotal: Math.round(subtotal),
          gst: Math.round(gst),
          status: "sent",
          items: groupItems.map(i => ({
            itemId: i.code || i.vpCode || "ITEM",
            name: i.name,
            quantity: i.orderQty,
            rate: i.estimatedPurchasePrice,
            gstRate: i.gstRate || 18,
          }))
        };

        const res = await fetch("/api/purchase-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || `Failed for ${supplierName}`);
        return json.data;
      });

      return Promise.all(promises);
    },
    onSuccess: (results) => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setSelectedCodes([]);
      toast.success(
        `🎉 Successfully generated ${results.length} Purchase Order(s) for ${results.reduce((a, r) => a + (r.items?.length || 0), 0)} items!`,
        {
          action: {
            label: "Open Purchase Orders",
            onClick: () => router.push("/purchase/orders"),
          },
          duration: 6000,
        }
      );
    },
    onError: (err: any) => {
      toast.error(err.message || "Bulk Purchase Order generation failed");
    }
  });

  const handleBulkReorderSelected = () => {
    const selectedItems = enrichedLowStockItems.filter(i => selectedCodes.includes(i.code));
    if (selectedItems.length === 0) {
      toast.error("Please select at least one low stock product to reorder");
      return;
    }
    createBulkPOMutation.mutate(selectedItems);
  };

  const handleReorderAllLowStock = () => {
    if (enrichedLowStockItems.length === 0) {
      toast.info("No low stock products to reorder!");
      return;
    }
    if (window.confirm(`Generate automatic Purchase Orders for ALL ${enrichedLowStockItems.length} low stock items across ${summaryMetrics.uniqueSuppliers} suppliers?`)) {
      createBulkPOMutation.mutate(enrichedLowStockItems);
    }
  };

  const openDetailedPOModal = (item: any) => {
    setSelectedPOItem(item);
    setSelectedPOItems([item]);
    setIsPOModalOpen(true);
  };

  return (
    <PageShell
      title="Low Stock & Auto Reorder"
      subtitle={`${summaryMetrics.totalLow} products below threshold • 1-Click Purchase Order Generation`}
      breadcrumbs={[{ label: "Purchase", href: "/purchase/orders" }, { label: "Low Stock Alert" }]}
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <ExportMenu
            className="text-xs"
            title="Low Stock & Auto Reorder"
            subtitle={`${summaryMetrics.totalLow} products below threshold`}
            data={enrichedLowStockItems.map((i: any) => ({
              Code: i.code,
              VP_Code: i.vpCode || "",
              Product_Name: i.name,
              Category: i.category,
              Brand: i.brand,
              Current_Stock: i.currentStock,
              Min_Reorder_Level: i.reorderLevel,
              Suggested_Order_Qty: i.orderQty,
              Unit_Purchase_Price: i.estimatedPurchasePrice,
              Estimated_Total: i.totalWithGst,
              Supplier: i.supplierName,
            }))}
            filename="low_stock_reorder_list"
          />

          {selectedCodes.length > 0 && (
            <Button
              size="sm"
              onClick={handleBulkReorderSelected}
              disabled={createBulkPOMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs"
            >
              <ShoppingBag className="w-4 h-4 mr-1.5" />
              {createBulkPOMutation.isPending ? "Generating POs..." : `⚡ Reorder Selected (${selectedCodes.length})`}
            </Button>
          )}

          <Button
            size="sm"
            onClick={handleReorderAllLowStock}
            disabled={createBulkPOMutation.isPending || enrichedLowStockItems.length === 0}
            className="bg-[#76C043] hover:bg-[#62a336] text-white font-bold text-xs shadow-xs"
          >
            <Sparkles className="w-4 h-4 mr-1.5" />
            {createBulkPOMutation.isPending ? "Processing POs..." : "⚡ 1-Click Reorder All"}
          </Button>
        </div>
      }
    >
      {/* ─── METRIC CARDS ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div 
          onClick={() => setUrgencyFilter("all")}
          className={cn(
            "metric-card flex items-center justify-between p-4 cursor-pointer rounded-2xl border transition-all hover:scale-[1.01]",
            urgencyFilter === "all" ? "ring-2 ring-amber-500 bg-amber-50/50 border-amber-400" : "bg-white border-slate-200"
          )}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-amber-100 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{summaryMetrics.totalLow}</p>
              <p className="text-xs font-semibold text-slate-500">Total Low Stock Items</p>
            </div>
          </div>
          {urgencyFilter === "all" && <Badge className="bg-amber-500 text-[10px]">Active</Badge>}
        </div>

        <div 
          onClick={() => setUrgencyFilter("out_of_stock")}
          className={cn(
            "metric-card flex items-center justify-between p-4 cursor-pointer rounded-2xl border transition-all hover:scale-[1.01]",
            urgencyFilter === "out_of_stock" ? "ring-2 ring-red-500 bg-red-50/50 border-red-400" : "bg-white border-slate-200"
          )}
        >
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-red-100 text-red-600">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-2xl font-black text-slate-900">{summaryMetrics.outOfStockCount}</p>
              <p className="text-xs font-semibold text-slate-500">Critical (0 Stock)</p>
            </div>
          </div>
          {urgencyFilter === "out_of_stock" && <Badge className="bg-red-600 text-[10px]">Active</Badge>}
        </div>

        <div className="metric-card flex items-center gap-3.5 p-4 rounded-2xl border bg-white border-slate-200">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-emerald-100 text-emerald-700">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(summaryMetrics.totalReorderValue)}</p>
            <p className="text-xs font-semibold text-slate-500">Estimated Reorder Cost</p>
          </div>
        </div>

        <div className="metric-card flex items-center gap-3.5 p-4 rounded-2xl border bg-white border-slate-200">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center bg-blue-100 text-[#30539C]">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-2xl font-black text-slate-900">{summaryMetrics.uniqueSuppliers}</p>
            <p className="text-xs font-semibold text-slate-500">Primary Suppliers</p>
          </div>
        </div>
      </div>

      {/* ─── DATA TABLE & TOOLBAR ────────────────────────────────── */}
      <div className="data-table-container">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative min-w-48 max-w-sm flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search low stock product, VP code, brand, supplier..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-40 h-9 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c: any) => (
                  <SelectItem key={c._id || c.name} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="w-36 h-9 text-xs">
                <SelectValue placeholder="Brand" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Brands</SelectItem>
                {brands.map((b: any) => (
                  <SelectItem key={b._id || b.name} value={b.name}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
              <SelectTrigger className="w-36 h-9 text-xs font-semibold">
                <SelectValue placeholder="Urgency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Low Stock</SelectItem>
                <SelectItem value="out_of_stock">0 Stock (Critical)</SelectItem>
                <SelectItem value="low_stock">Approaching Reorder</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchItems()}
              className="h-9 px-3 text-xs"
              title="Refresh live catalog stock"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loadingItems && "animate-spin")} />
            </Button>
          </div>
        </div>

        {/* Low Stock Table */}
        <div className="overflow-x-auto">
          {loadingItems ? (
            <TableShimmer />
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-3" />
              <h3 className="text-base font-bold text-slate-800">All Stock Levels Healthy!</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                No items currently match low stock criteria. All products in the catalog are above minimum reorder thresholds.
              </p>
            </div>
          ) : (
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50/80 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5 w-10">
                    <input
                      type="checkbox"
                      checked={selectedCodes.length > 0 && selectedCodes.length === filteredItems.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-slate-300 w-4 h-4 text-[#30539C] focus:ring-[#30539C] cursor-pointer"
                    />
                  </th>
                  <th className="p-3.5">Product & VP Code</th>
                  <th className="p-3.5">Category & Brand</th>
                  <th className="p-3.5">Suggested Supplier</th>
                  <th className="p-3.5 text-center">Live Stock / Min</th>
                  <th className="p-3.5 text-center">Order Qty</th>
                  <th className="p-3.5 text-right">Est. Unit Rate</th>
                  <th className="p-3.5 text-right">Total (Inc. GST)</th>
                  <th className="p-3.5 text-center">Instant Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70">
                {filteredItems.map((item: any) => {
                  const isSelected = selectedCodes.includes(item.code);
                  const isOrderingThis = createSinglePOMutation.isPending && createSinglePOMutation.variables?.code === item.code;

                  return (
                    <tr 
                      key={item.code || item._id}
                      className={cn(
                        "hover:bg-slate-50/70 transition-colors",
                        item.isOutOfStock ? "bg-red-50/20" : isSelected ? "bg-amber-50/30" : ""
                      )}
                    >
                      <td className="p-3.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.code)}
                          className="rounded border-slate-300 w-4 h-4 text-[#30539C] focus:ring-[#30539C] cursor-pointer"
                        />
                      </td>

                      <td className="p-3.5 font-medium">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 leading-snug">{item.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[10.5px] font-bold text-[#30539C] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                              {item.vpCode || item.code}
                            </span>
                            {item.isOutOfStock && (
                              <Badge className="bg-red-600 text-white text-[9.5px] font-bold px-1.5 py-0">
                                OUT OF STOCK
                              </Badge>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="space-y-0.5">
                          <Badge variant="outline" className="text-[10px] font-semibold text-slate-700 bg-slate-100/70 border-slate-200">
                            {item.category || "General"}
                          </Badge>
                          <p className="text-[10.5px] text-slate-500 font-bold">{item.brand || "Standard"}</p>
                        </div>
                      </td>

                      <td className="p-3.5">
                        <div className="min-w-0">
                          <p className="font-bold text-slate-800 truncate max-w-[160px]">{item.supplierName}</p>
                          <p className="text-[10px] font-mono text-slate-500 flex items-center gap-1">
                            <Truck className="w-3 h-3 text-slate-400" /> Direct PO
                          </p>
                        </div>
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="inline-flex flex-col items-center">
                          <div className="flex items-center gap-1 font-mono font-black text-xs">
                            <span className={item.isOutOfStock ? "text-red-600 text-sm font-black" : "text-amber-700"}>
                              {item.currentStock}
                            </span>
                            <span className="text-slate-400 font-normal">/</span>
                            <span className="text-slate-600 font-semibold">{item.reorderLevel}</span>
                            <span className="text-[10px] text-slate-500 font-normal">{item.unit || "PCS"}</span>
                          </div>
                          <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden mt-1">
                            <div 
                              className={cn("h-full", item.isOutOfStock ? "bg-red-500" : "bg-amber-500")}
                              style={{ width: `${Math.min(100, Math.max(10, (item.currentStock / Math.max(1, item.reorderLevel)) * 100))}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="inline-flex items-center gap-1.5">
                          <Input
                            type="number"
                            min="1"
                            value={item.orderQty}
                            onChange={(e) => handleQuantityChange(item.code, Number(e.target.value))}
                            className="w-16 h-8 text-center font-bold font-mono text-xs bg-white border-slate-300 focus:border-amber-500"
                          />
                          <span className="text-[10px] text-slate-500">{item.unit || "PCS"}</span>
                        </div>
                      </td>

                      <td className="p-3.5 text-right font-mono font-bold text-slate-800">
                        {formatCurrency(item.estimatedPurchasePrice)}
                      </td>

                      <td className="p-3.5 text-right">
                        <p className="font-mono font-black text-slate-900">
                          {formatCurrency(item.totalWithGst)}
                        </p>
                        <p className="text-[9.5px] text-slate-400 font-mono">
                          (inc. {item.gstRate || 18}% GST)
                        </p>
                      </td>

                      <td className="p-3.5 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="sm"
                            onClick={() => createSinglePOMutation.mutate(item)}
                            disabled={isOrderingThis || createBulkPOMutation.isPending}
                            className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[11px] shadow-2xs rounded-lg flex items-center gap-1"
                            title="Generate 1-Click Purchase Order with supplier"
                          >
                            <ShoppingBag className="w-3 h-3" />
                            {isOrderingThis ? "Ordering..." : "Order Now"}
                          </Button>

                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDetailedPOModal(item)}
                            className="h-7 px-2 text-[10.5px] text-slate-600 hover:text-slate-900 border-slate-200"
                            title="Customize Purchase Order details"
                          >
                            Edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── PURCHASE CREATION MODAL FOR CUSTOM EDITING ─────────── */}
      <PurchaseCreationModal
        isOpen={isPOModalOpen}
        onClose={() => setIsPOModalOpen(false)}
        mode="order"
        preloadedItem={selectedPOItem}
        preloadedItems={selectedPOItems}
      />
    </PageShell>
  );
}
