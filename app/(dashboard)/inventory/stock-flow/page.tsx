"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Search,
  Filter,
  RefreshCw,
  Calendar,
  Truck,
  User,
  FileText,
  Clock,
  Building2,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Layers,
  X,
  Eye
} from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter 
} from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { DateRangeFilter } from "@/components/shared/date-range-filter";
import { BrandLogo } from "@/components/shared/brand-logo";
import { useBranch } from "@/context/BranchContext";
import { todayInIndia } from "@/lib/today";

export default function StockFlowPage() {
  const { activeLocation } = useBranch();
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Date range for stock movement. Empty = all time, so the page opens showing the
  // full history exactly as it did before.
  const [dateFilter, setDateFilter] = useState("");
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: "", end: "" });
  // "all" | "in" | "out" | "transfer"
  const [movementFilter, setMovementFilter] = useState("all");
  const [selectedItem, setSelectedItem] = useState<any | null>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const PER_PAGE = 12;

  // 1. Fetch Stock Flow API
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["stock-flow", brandFilter, categoryFilter, statusFilter, dateRange.start, dateRange.end, movementFilter, activeLocation?.name],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (brandFilter !== "all") params.append("brand", brandFilter);
      if (categoryFilter !== "all") params.append("category", categoryFilter);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (movementFilter !== "all") params.append("movement", movementFilter);
      if (dateRange.start && dateRange.end) {
        params.append("startDate", dateRange.start);
        params.append("endDate", dateRange.end);
      }
      if (activeLocation?.name) params.append("warehouse", activeLocation.name);

      const res = await fetch(`/api/inventory/stock-flow?${params.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load stock flow");
      return json;
    },
  });

  // 2. Fetch Brands & Categories for filter dropdowns
  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const items = data?.data || [];
  const summary = data?.summary || {
    totalSKUs: 0,
    totalCurrentStock: 0,
    totalStockValuation: 0,
    totalInwardUnits: 0,
    totalOutwardUnits: 0,
    totalTransfers: 0,
  };

  // Client-side search filtering
  const filteredItems = useMemo(() => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter(
      (item: any) =>
        item.name?.toLowerCase().includes(q) ||
        item.code?.toLowerCase().includes(q) ||
        item.vpCode?.toLowerCase().includes(q) ||
        item.brand?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q) ||
        item.lastInward?.supplierName?.toLowerCase().includes(q) ||
        item.lastOutward?.customerName?.toLowerCase().includes(q)
    );
  }, [items, search]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PER_PAGE));
  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PER_PAGE;
    return filteredItems.slice(start, start + PER_PAGE);
  }, [filteredItems, page]);

  const handleOpenLedger = (item: any) => {
    setSelectedItem(item);
    setIsLedgerOpen(true);
  };

  const exportRows = filteredItems.map((item: any) => ({
    "VP Code": item.vpCode || item.code,
    "Item Name": item.name,
    Brand: item.brand,
    Category: item.category,
    "Current Stock": item.currentStock,
    Unit: item.unit,
    "Purchase Rate": item.purchasePrice,
    "Selling Price": item.sellingPrice,
    "Stock Valuation": item.currentStock * item.purchasePrice,
    "Last Stock In (Date)": item.lastInward?.date || "N/A",
    "Last Stock In (Qty)": item.lastInward?.quantity || "N/A",
    "Last Stock In (Supplier/Bill)": `${item.lastInward?.supplierName || ""} (${item.lastInward?.billNo || ""})`,
    "Last Stock Out (Date)": item.lastOutward?.date || "N/A",
    "Last Stock Out (Qty)": item.lastOutward?.quantity || "N/A",
    "Last Stock Out (Customer/Inv)": `${item.lastOutward?.customerName || ""} (${item.lastOutward?.invoiceNo || ""})`,
    Warehouse: item.warehouse,
  }));

  const exportPeriodTag = dateRange.start && dateRange.end
    ? `${dateRange.start}_to_${dateRange.end}`
    : todayInIndia();
  const exportMovementTag = movementFilter === "all" ? "" : `_${movementFilter}`;
  const exportFilename = `Stock_Flow_Report${exportMovementTag}_${exportPeriodTag}`;

  return (
    <PageShell
      title="Stock Flow (In / Out)"
      subtitle={
        dateFilter || movementFilter !== "all"
          ? `${
              movementFilter === "in" ? "Stock In only" : movementFilter === "out" ? "Stock Out only" : movementFilter === "transfer" ? "Transfers only" : "All movement"
            }${dateFilter ? ` · ${dateFilter} (${dateRange.start} → ${dateRange.end})` : " · All time"} — on-hand stock always shows live quantity`
          : "Live inventory on-hand, recent inward receipts, outward sales & warehouse transfers"
      }
      breadcrumbs={[
        { label: "Inventory", href: "/inventory/stock-flow" },
        { label: "Stock Flow" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="text-xs h-8"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <ExportMenu
            className="text-xs h-8 text-[#3F63AD] border-blue-200 hover:bg-blue-50"
            title="Stock Flow (In / Out)"
            subtitle={`${filteredItems.length} SKUs`}
            data={exportRows}
            filename={exportFilename}
          />
        </div>
      }
    >
      {/* ─── 4 TOP METRIC CARDS ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Live On-Hand Inventory */}
        <div className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#3F63AD]/10 text-[#3F63AD] flex items-center justify-center shrink-0">
            <Package className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Live On-Hand Stock</p>
            <h3 className="text-xl font-bold text-slate-900 mt-0.5">
              {summary.totalCurrentStock.toLocaleString()} <span className="text-xs font-normal text-slate-500">Units</span>
            </h3>
            <p className="text-[11px] text-slate-500 font-mono mt-0.5">
              Valuation: <span className="font-semibold text-slate-800">{formatCurrency(summary.totalStockValuation)}</span>
            </p>
          </div>
        </div>

        {/* Metric 2: Stock In (Inwards) */}
        <div className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Stock In (Inward){dateFilter ? "" : " · All Time"}
            </p>
            <h3 className="text-xl font-bold text-emerald-700 mt-0.5">
              +{summary.totalInwardUnits.toLocaleString()} <span className="text-xs font-normal text-emerald-600">Units</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dateFilter ? `Purchases in ${dateFilter}` : "Purchases & Inward Goods"}
            </p>
          </div>
        </div>

        {/* Metric 3: Stock Out (Outwards) */}
        <div className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-blue-50 text-[#3F63AD] flex items-center justify-center shrink-0">
            <ArrowUpRight className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Stock Out (Outward){dateFilter ? "" : " · All Time"}
            </p>
            <h3 className="text-xl font-bold text-[#3F63AD] mt-0.5">
              -{summary.totalOutwardUnits.toLocaleString()} <span className="text-xs font-normal text-[#3F63AD]/80">Units</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dateFilter ? `Sales in ${dateFilter}` : "Billed Tax Invoices & Sales"}
            </p>
          </div>
        </div>

        {/* Metric 4: Warehouse Transfers */}
        <div className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <ArrowLeftRight className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Warehouse Movements</p>
            <h3 className="text-xl font-bold text-purple-700 mt-0.5">
              {summary.totalTransfers} <span className="text-xs font-normal text-purple-600">Transfers</span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Godown to Store Transfers
            </p>
          </div>
        </div>
      </div>

      {/* ─── FILTER & SEARCH BAR ────────────────────────────────────────── */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3 mt-5">
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search SKU, VP Code, Brand, Supplier, Customer..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Brand Filter */}
          <Select
            value={brandFilter}
            onValueChange={(val) => {
              setBrandFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-[130px]">
              <SelectValue placeholder="Brand" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Brands</SelectItem>
              {brands.map((b: any) => (
                <SelectItem key={b._id || b.name} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category Filter */}
          <Select
            value={categoryFilter}
            onValueChange={(val) => {
              setCategoryFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-[145px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c: any) => (
                <SelectItem key={c._id || c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Stock Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-[135px]">
              <SelectValue placeholder="Stock Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="in-stock">In Stock</SelectItem>
              <SelectItem value="low-stock">Low Stock (Reorder)</SelectItem>
              <SelectItem value="out-of-stock">Out of Stock</SelectItem>
              <SelectItem value="recent-inward">Recent Inwards</SelectItem>
            </SelectContent>
          </Select>

          {/* Movement Type: view only Stock In, only Stock Out, or transfers */}
          <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
            {[
              { key: "all", label: "All" },
              { key: "in", label: "Stock In" },
              { key: "out", label: "Stock Out" },
              { key: "transfer", label: "Transfers" },
            ].map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  setMovementFilter(m.key);
                  setPage(1);
                }}
                className={cn(
                  "px-2.5 h-8 rounded-md text-[11px] font-bold transition-all whitespace-nowrap",
                  movementFilter === m.key
                    ? m.key === "in"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : m.key === "out"
                      ? "bg-[#3F63AD] text-white shadow-xs"
                      : m.key === "transfer"
                      ? "bg-purple-600 text-white shadow-xs"
                      : "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Date Range: scopes Stock In / Stock Out to a period */}
          <DateRangeFilter
            value={dateFilter}
            onChange={(val, start, end) => {
              setDateFilter(val);
              setDateRange({ start: start || "", end: end || "" });
              setPage(1);
            }}
            showIcon={true}
            placeholder="All Time"
            className="w-[140px] h-9 text-xs"
          />

          {(search || brandFilter !== "all" || categoryFilter !== "all" || statusFilter !== "all" || dateFilter || movementFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("");
                setBrandFilter("all");
                setCategoryFilter("all");
                setStatusFilter("all");
                setDateFilter("");
                setDateRange({ start: "", end: "" });
                setMovementFilter("all");
                setPage(1);
              }}
              className="h-9 text-xs text-slate-500 hover:text-red-600 px-2"
            >
              Reset Filters
            </Button>
          )}
        </div>
      </div>

      {/* ─── DATA TABLE ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mt-4">
        {isLoading ? (
          <div className="p-6">
            <TableShimmer rows={8} cols={6} />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto flex items-center justify-center mb-3">
              <Package className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">
              {dateFilter || movementFilter !== "all" ? "No stock movement in this selection" : "No stock records found"}
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {dateFilter
                ? `No ${movementFilter === "in" ? "inward" : movementFilter === "out" ? "outward" : "stock"} movement recorded between ${dateRange.start} and ${dateRange.end}. Try a wider date range.`
                : "No products match the selected search or filter criteria. Try adjusting your filters or search keywords."}
            </p>
            {(dateFilter || movementFilter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 text-xs h-8"
                onClick={() => {
                  setDateFilter("");
                  setDateRange({ start: "", end: "" });
                  setMovementFilter("all");
                  setPage(1);
                }}
              >
                Show all time
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase border-b border-slate-200 tracking-wider">
                <tr>
                  <th className="px-4 py-3">Product / SKU Details</th>
                  <th className="px-3 py-3 text-center">Current Stock</th>
                  <th className="px-3 py-3">Last Stock In (Inward)</th>
                  <th className="px-3 py-3">Last Stock Out (Outward)</th>
                  <th className="px-3 py-3">Warehouse & Moves</th>
                  <th className="px-3 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paginatedItems.map((item: any) => {
                  const isLow = item.currentStock <= item.reorderLevel && item.currentStock > 0;
                  const isOut = item.currentStock === 0;

                  return (
                    <tr key={item._id || item.code} className="hover:bg-slate-50/80 transition-colors">
                      {/* 1. PRODUCT DETAILS */}
                      <td className="px-4 py-3 max-w-[320px]">
                        <div className="flex items-center gap-2.5">
                          <BrandLogo name={item.brand} size="sm" className="w-8 h-8 rounded-lg shadow-none" />
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 text-xs leading-snug line-clamp-1">
                              {item.name}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono font-bold text-[10px] text-[#3F63AD] bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                {item.vpCode || item.code}
                              </span>
                              <span className="text-[10px] text-slate-500 font-medium truncate">
                                {item.category}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* 2. CURRENT STOCK */}
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex flex-col items-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-black font-mono ${
                              isOut
                                ? "bg-red-100 text-red-700 border border-red-200"
                                : isLow
                                ? "bg-amber-100 text-amber-700 border border-amber-200"
                                : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                            }`}
                          >
                            {item.currentStock} {item.unit || "Pcs"}
                          </span>
                          {isOut ? (
                            <span className="text-[9.5px] text-red-600 font-bold mt-0.5">Out of Stock</span>
                          ) : isLow ? (
                            <span className="text-[9.5px] text-amber-600 font-bold mt-0.5">Reorder Needed</span>
                          ) : (
                            <span className="text-[9.5px] text-emerald-600 font-medium mt-0.5">Healthy</span>
                          )}
                        </div>
                      </td>

                      {/* 3. LAST STOCK IN (INWARD) */}
                      <td className="px-3 py-3 max-w-[220px]">
                        {item.lastInward ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-emerald-700 bg-emerald-50 text-[10px] px-1.5 py-0.2 rounded border border-emerald-200">
                                +{item.lastInward.quantity} {item.unit || "Pcs"}
                              </span>
                              <span className="text-[10.5px] text-slate-500 font-medium">
                                {formatDate(item.lastInward.date)}
                              </span>
                            </div>
                            <div className="text-[11px] font-semibold text-slate-800 truncate" title={item.lastInward.supplierName}>
                              {item.lastInward.supplierName}
                            </div>
                            {item.lastInward.billNo && (
                              <div className="text-[10px] font-mono text-slate-400 truncate">
                                Bill: {item.lastInward.billNo}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">— No recent inwards —</span>
                        )}
                      </td>

                      {/* 4. LAST STOCK OUT (OUTWARD) */}
                      <td className="px-3 py-3 max-w-[220px]">
                        {item.lastOutward ? (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-blue-700 bg-blue-50 text-[10px] px-1.5 py-0.2 rounded border border-blue-200">
                                -{item.lastOutward.quantity} {item.unit || "Pcs"}
                              </span>
                              <span className="text-[10.5px] text-slate-500 font-medium">
                                {formatDate(item.lastOutward.date)}
                              </span>
                            </div>
                            <div className="text-[11px] font-semibold text-slate-800 truncate" title={item.lastOutward.customerName}>
                              {item.lastOutward.customerName}
                            </div>
                            {item.lastOutward.invoiceNo && (
                              <div className="text-[10px] font-mono text-slate-400 truncate">
                                Inv: {item.lastOutward.invoiceNo}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 text-xs">— No recent sales —</span>
                        )}
                      </td>

                      {/* 5. WAREHOUSE & MOVES */}
                      <td className="px-3 py-3 max-w-[200px]">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-700">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{item.warehouse || "Main Store - Gorakhpur"}</span>
                          </div>
                          {item.lastTransfer ? (
                            <div className="text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100 flex items-center gap-1">
                              <ArrowLeftRight className="w-3 h-3 shrink-0" />
                              <span className="truncate">
                                {item.lastTransfer.fromWarehouse} ➔ {item.lastTransfer.toWarehouse} ({item.lastTransfer.quantity} {item.unit})
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </td>

                      {/* 6. ACTION */}
                      <td className="px-3 py-3 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenLedger(item)}
                          className="h-7 text-[11px] px-2.5 font-semibold text-[#3F63AD] border-[#3F63AD]/30 hover:bg-[#3F63AD]/10"
                        >
                          <Eye className="w-3 h-3 mr-1" />
                          View Ledger
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filteredItems.length > PER_PAGE && (
          <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs">
            <div className="text-slate-500">
              Showing {(page - 1) * PER_PAGE + 1} to {Math.min(page * PER_PAGE, filteredItems.length)} of {filteredItems.length} items
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-7 text-xs px-2.5"
              >
                Previous
              </Button>
              <span className="px-2 text-slate-600 font-semibold">
                Page {page} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 text-xs px-2.5"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* ─── FULL ITEM MOVEMENT LEDGER MODAL ────────────────────────────── */}
      <Dialog open={isLedgerOpen} onOpenChange={setIsLedgerOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-y-auto">
          {selectedItem && (
            <>
              {/* Header */}
              <DialogHeader className="p-5 border-b border-slate-200 bg-slate-50">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xs bg-[#3F63AD] text-white px-2 py-0.5 rounded">
                        {selectedItem.vpCode || selectedItem.code}
                      </span>
                      <span className="text-xs font-semibold text-slate-600 bg-slate-200 px-2 py-0.5 rounded">
                        {selectedItem.brand}
                      </span>
                      <span className="text-xs text-slate-500 font-medium">
                        {selectedItem.category}
                      </span>
                    </div>
                    <DialogTitle className="text-base font-bold text-slate-900 mt-1.5 leading-snug">
                      {selectedItem.name}
                    </DialogTitle>
                    <DialogDescription className="text-xs text-slate-500 mt-0.5">
                      Chronological Stock In / Stock Out and Warehouse Movement History
                    </DialogDescription>
                  </div>
                </div>

                {/* SKU Summary Strip */}
                <div className="grid grid-cols-3 gap-2.5 mt-3 pt-3 border-t border-slate-200 text-xs">
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Current On-Hand</span>
                    <span className="text-sm font-black text-emerald-700 font-mono">
                      {selectedItem.currentStock} {selectedItem.unit || "Pcs"}
                    </span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Purchase Cost</span>
                    <span className="text-sm font-bold text-slate-900 font-mono">
                      {formatCurrency(selectedItem.purchasePrice)}
                    </span>
                  </div>
                  <div className="bg-white p-2 rounded-lg border border-slate-200">
                    <span className="text-[10px] text-slate-500 uppercase font-semibold block">Warehouse Location</span>
                    <span className="text-xs font-semibold text-slate-800 truncate block mt-0.5" title={selectedItem.warehouse}>
                      {selectedItem.warehouse || "Main Store"}
                    </span>
                  </div>
                </div>
              </DialogHeader>

              {/* Timeline Body */}
              <div className="p-5 overflow-y-auto max-h-[420px] space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Transaction Audit Trail ({selectedItem.timeline?.length || 0} events)
                </h4>

                {(!selectedItem.timeline || selectedItem.timeline.length === 0) ? (
                  <div className="p-8 text-center text-slate-400 text-xs">
                    No movement records logged for this item yet.
                  </div>
                ) : (
                  <div className="relative border-l-2 border-slate-200 ml-3 space-y-4 pl-4 py-1">
                    {selectedItem.timeline.map((event: any, idx: number) => {
                      const isInward = event.type === "INWARD";
                      const isOutward = event.type === "OUTWARD";
                      const isTransfer = event.type === "TRANSFER";

                      return (
                        <div key={idx} className="relative group">
                          {/* Dot Icon */}
                          <div
                            className={`absolute -left-[23px] top-0.5 w-4 h-4 rounded-full border-2 border-white flex items-center justify-center shadow-sm ${
                              isInward
                                ? "bg-emerald-500"
                                : isOutward
                                ? "bg-blue-500"
                                : "bg-purple-500"
                            }`}
                          />

                          <div className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs hover:shadow-sm transition-all">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded ${
                                    isInward
                                      ? "bg-emerald-100 text-emerald-800"
                                      : isOutward
                                      ? "bg-blue-100 text-blue-800"
                                      : "bg-purple-100 text-purple-800"
                                  }`}
                                >
                                  {event.badge}
                                </span>
                                <span className="text-xs font-bold text-slate-800">
                                  {event.title}
                                </span>
                              </div>
                              <span className="text-[10.5px] font-medium text-slate-400">
                                {formatDate(event.date)}
                              </span>
                            </div>

                            <div className="mt-1.5 flex items-center justify-between text-xs text-slate-600">
                              <div>
                                <span className="font-medium text-slate-700">{event.partyName}</span>
                                {event.warehouse && (
                                  <span className="text-slate-400 text-[11px] ml-1.5">
                                    • {event.warehouse}
                                  </span>
                                )}
                              </div>
                              {event.rate > 0 && (
                                <span className="font-mono font-semibold text-slate-800">
                                  @ {formatCurrency(event.rate)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <DialogFooter className="p-3 border-t border-slate-200 bg-slate-50">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsLedgerOpen(false)}
                  className="text-xs"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
