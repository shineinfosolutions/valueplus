"use client";

import { useState, useMemo, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { 
  TrendingUp, TrendingDown, DollarSign, ShoppingBag, Package, 
  Search, Filter, Printer, ArrowUpRight, ArrowDownRight,
  Layers, Award, Calendar, RefreshCw, BarChart2, ShieldAlert,
  Percent, ArrowRight, Building2, Store, CheckCircle2, AlertCircle,
  FileText, History, HelpCircle, X, Check, Eye
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProductLedgerModal } from "@/components/ProductLedgerModal";
import { ExportMenu } from "@/components/shared/ExportMenu";

const QUICK_DATE_PILLS = [
  { label: "Today", value: "Today" },
  { label: "Yesterday", value: "Yesterday" },
  { label: "This Week", value: "Last 7 Days" },
  { label: "This Month", value: "This Month" },
  { label: "Last Month", value: "Last Month" },
  { label: "Last 3 Months", value: "Last 3 Months" },
  { label: "This FY (Year)", value: "Last Year" },
];

function ProfitLossContent() {
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [activeTab, setActiveTab] = useState("products");
  
  // Filters for Product Table
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [brandFilter, setBrandFilter] = useState("ALL");
  const [healthFilter, setHealthFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState<"profit-desc" | "profit-asc" | "margin-desc" | "revenue-desc" | "qty-desc">("profit-desc");
  const [page, setPage] = useState(1);
  const PER_PAGE = 15;

  // Modals
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [selectedProductForLedger, setSelectedProductForLedger] = useState<any | null>(null);

  // Fetch P&L Report Data
  const { data: reportData, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["profit-loss-report", dateRange.start, dateRange.end],
    queryFn: async () => {
      const url = `/api/reports/profit-loss?startDate=${dateRange.start}&endDate=${dateRange.end}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch profit loss report");
      return json.data;
    },
  });

  const summary = reportData?.summary || {
    totalRevenue: 0,
    totalCOGS: 0,
    grossProfit: 0,
    grossMarginPct: 0,
    totalExpenses: 0,
    netProfit: 0,
    netMarginPct: 0,
    totalUnitsSold: 0,
    totalInvoices: 0,
    totalPurchases: 0,
    totalPurchaseBills: 0,
  };

  const productBreakdown: any[] = reportData?.productBreakdown || [];
  const categoryBreakdown: any[] = reportData?.categoryBreakdown || [];
  const brandBreakdown: any[] = reportData?.brandBreakdown || [];
  const expenseBreakdown: any[] = reportData?.expenseBreakdown || [];
  const purchaseBreakdown: any[] = reportData?.purchaseBreakdown || [];

  // Extract unique categories & brands for filter dropdowns
  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(productBreakdown.map((p) => p.category).filter(Boolean)));
  }, [productBreakdown]);

  const uniqueBrands = useMemo(() => {
    return Array.from(new Set(productBreakdown.map((p) => p.brand).filter(Boolean)));
  }, [productBreakdown]);

  // Counts for Health Badges
  const healthCounts = useMemo(() => {
    return {
      all: productBreakdown.length,
      high: productBreakdown.filter(p => p.status === "high").length,
      healthy: productBreakdown.filter(p => p.status === "healthy").length,
      low: productBreakdown.filter(p => p.status === "low").length,
      loss: productBreakdown.filter(p => p.status === "loss").length,
    };
  }, [productBreakdown]);

  // Filtered and Sorted Products
  const filteredProducts = useMemo(() => {
    return productBreakdown
      .filter((p) => {
        const matchesSearch =
          !search ||
          p.name?.toLowerCase().includes(search.toLowerCase()) ||
          p.vpCode?.toLowerCase().includes(search.toLowerCase()) ||
          p.code?.toLowerCase().includes(search.toLowerCase()) ||
          p.brand?.toLowerCase().includes(search.toLowerCase());

        const matchesCat = categoryFilter === "ALL" || p.category === categoryFilter;
        const matchesBrand = brandFilter === "ALL" || p.brand === brandFilter;
        const matchesHealth = healthFilter === "ALL" || p.status === healthFilter;

        return matchesSearch && matchesCat && matchesBrand && matchesHealth;
      })
      .sort((a, b) => {
        if (sortBy === "profit-desc") return b.totalProfit - a.totalProfit;
        if (sortBy === "profit-asc") return a.totalProfit - b.totalProfit;
        if (sortBy === "margin-desc") return b.marginPct - a.marginPct;
        if (sortBy === "revenue-desc") return b.totalRevenue - a.totalRevenue;
        if (sortBy === "qty-desc") return b.qtySold - a.qtySold;
        return 0;
      });
  }, [productBreakdown, search, categoryFilter, brandFilter, healthFilter, sortBy]);

  const totalPages = Math.ceil(filteredProducts.length / PER_PAGE) || 1;
  const paginatedProducts = filteredProducts.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleDatePresetClick = (presetValue: string) => {
    setDateFilter(presetValue);
    const resolved = resolveDateRange(presetValue);
    setDateRange(resolved);
    setPage(1);
  };

  const handleCustomDateChange = (val: string, start?: string, end?: string) => {
    setDateFilter(val);
    if (start && end) {
      setDateRange({ start, end });
    } else {
      const resolved = resolveDateRange(val);
      setDateRange(resolved);
    }
    setPage(1);
  };

  const handleResetFilters = () => {
    setSearch("");
    setCategoryFilter("ALL");
    setBrandFilter("ALL");
    setHealthFilter("ALL");
    setSortBy("profit-desc");
    setPage(1);
  };

  const hasActiveFilters = search !== "" || categoryFilter !== "ALL" || brandFilter !== "ALL" || healthFilter !== "ALL";

  const isNetProfitable = summary.netProfit >= 0;
  const isGrossProfitable = summary.grossProfit >= 0;

  return (
    <PageShell
      title="Profit & Loss Statement (P&L)"
      subtitle="Financial performance, sales margins, and detailed product-wise profit analysis"
      breadcrumbs={[{ label: "Accounting", href: "/accounting/profit-loss" }, { label: "Profit & Loss" }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <DateRangeFilter
            value={dateFilter}
            onChange={handleCustomDateChange}
            showIcon={true}
            className="w-[155px]"
          />
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()} 
            disabled={isFetching}
            className="text-xs bg-white"
          >
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isFetching && "animate-spin")} /> Refresh
          </Button>
          <ExportMenu
            size="sm"
            className="text-xs bg-white text-slate-700 font-semibold"
            title="Profit & Loss - Product Wise"
            subtitle={`${filteredProducts.length} products · ${formatDate(dateRange.start)} to ${formatDate(dateRange.end)}`}
            data={filteredProducts.map((p, idx) => ({
              "#": idx + 1,
              "Product Name": p.name,
              "VP Code": p.vpCode,
              "Brand": p.brand,
              "Category": p.category,
              "Units Sold": p.qtySold,
              "Purchase Rate (Cost)": p.purchasePrice,
              "Avg Selling Price": p.avgSellingPrice,
              "Total Purchase Cost (COGS)": p.totalCost,
              "Total Sales Revenue": p.totalRevenue,
              "Profit / Loss Amount": p.totalProfit,
              "Profit Margin %": `${p.marginPct}%`,
              "Margin Health": p.status.toUpperCase(),
              "Current In-Stock": p.currentStock,
            }))}
            filename={`profit_loss_report_${dateRange.start}_to_${dateRange.end}`}
          />
          <Button 
            size="sm" 
            onClick={() => setIsPrintModalOpen(true)}
            className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold shadow-sm"
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" /> Print P&L Statement
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* QUICK DATE PRESET PILLS BAR */}
        <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-xs flex items-center justify-between gap-3 overflow-x-auto">
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] font-bold uppercase text-slate-500 flex items-center gap-1 mr-1">
              <Calendar className="w-3.5 h-3.5 text-[#3F63AD]" /> Period:
            </span>
            {QUICK_DATE_PILLS.map((pill) => {
              const isActive = dateFilter === pill.value;
              return (
                <button
                  key={pill.value}
                  type="button"
                  onClick={() => handleDatePresetClick(pill.value)}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    isActive
                      ? "bg-[#3F63AD] text-white shadow-xs font-bold"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  )}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-600 font-medium shrink-0 pl-2">
            Selected: <span className="font-bold text-slate-900">{formatDate(dateRange.start)}</span> to <span className="font-bold text-slate-900">{formatDate(dateRange.end)}</span>
          </div>
        </div>

        {/* TOP EXECUTIVE METRIC CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Total Sales Revenue */}
          <Card className="border border-slate-200/80 shadow-xs bg-white overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-blue-500" />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Total Sales Revenue</span>
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <ShoppingBag className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-black text-slate-900">{formatCurrency(summary.totalRevenue)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1 font-medium">
                <span>{summary.totalUnitsSold} items sold</span> · <span>{summary.totalInvoices} bills</span>
              </p>
            </CardContent>
          </Card>

          {/* Cost of Goods Sold (COGS) */}
          <Card className="border border-slate-200/80 shadow-xs bg-white overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-amber-500" />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Cost of Goods (COGS)</span>
                <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                  <Package className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-black text-slate-900">{formatCurrency(summary.totalCOGS)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">
                Total Purchase Cost of Sold Units
              </p>
            </CardContent>
          </Card>

          {/* Total Purchases — actual stock-in bills raised this period, not
              the same number as COGS above (that's the cost of what was SOLD
              this period; this is what was actually BOUGHT, whether sold yet
              or not — the two only match if nothing's left on the shelf). */}
          <Card className="border border-slate-200/80 shadow-xs bg-white overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-orange-500" />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Purchase Entries</span>
                <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
                  <Building2 className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-black text-slate-900">{formatCurrency(summary.totalPurchases)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">
                {summary.totalPurchaseBills} bill{summary.totalPurchaseBills === 1 ? "" : "s"} raised this period
              </p>
            </CardContent>
          </Card>

          {/* Gross Profit & Margin */}
          <Card className="border border-slate-200/80 shadow-xs bg-white overflow-hidden relative">
            <div className={cn("absolute top-0 left-0 w-full h-1", isGrossProfitable ? "bg-emerald-500" : "bg-rose-500")} />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Gross Profit (Margin)</span>
                <div className={cn("p-2 rounded-lg", isGrossProfitable ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                  <TrendingUp className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={cn("text-xl font-black", isGrossProfitable ? "text-emerald-700" : "text-rose-600")}>
                  {formatCurrency(summary.grossProfit)}
                </span>
                <Badge variant="outline" className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5",
                  isGrossProfitable ? "bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-rose-50 text-rose-700 border-rose-300"
                )}>
                  {summary.grossMarginPct}% Margin
                </Badge>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">
                Revenue − Direct Product Cost
              </p>
            </CardContent>
          </Card>

          {/* Operating Expenses */}
          <Card className="border border-slate-200/80 shadow-xs bg-white overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-1 bg-purple-500" />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">Operating Expenses</span>
                <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                  <DollarSign className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-black text-slate-900">{formatCurrency(summary.totalExpenses)}</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1 font-medium">
                Store Rent, Utilities, Petty & Staff
              </p>
            </CardContent>
          </Card>

          {/* Net Profit / Loss */}
          <Card className={cn(
            "border shadow-sm overflow-hidden relative",
            isNetProfitable 
              ? "bg-gradient-to-br from-emerald-500/10 via-emerald-50/40 to-white border-emerald-300 ring-1 ring-emerald-200" 
              : "bg-gradient-to-br from-rose-500/10 via-rose-50/40 to-white border-rose-300 ring-1 ring-rose-200"
          )}>
            <div className={cn("absolute top-0 left-0 w-full h-1.5", isNetProfitable ? "bg-emerald-600" : "bg-rose-600")} />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold tracking-wider uppercase text-slate-700">Net Profit / Loss</span>
                <div className={cn("p-2 rounded-lg", isNetProfitable ? "bg-emerald-600 text-white" : "bg-rose-600 text-white")}>
                  {isNetProfitable ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={cn("text-2xl font-black tracking-tight", isNetProfitable ? "text-emerald-700" : "text-rose-700")}>
                  {formatCurrency(summary.netProfit)}
                </span>
                <Badge className={cn(
                  "text-[10px] font-extrabold px-2 py-0.5",
                  isNetProfitable ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"
                )}>
                  {summary.netMarginPct}% Net
                </Badge>
              </div>
              <p className="text-[11px] font-semibold text-slate-600 mt-1">
                Gross Profit − Operating Expenses
              </p>
            </CardContent>
          </Card>
        </div>

        {/* CALCULATION HELPER STRIP */}
        <div className="bg-slate-100/70 p-3 rounded-xl border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-700">
            <HelpCircle className="w-4 h-4 text-[#3F63AD] shrink-0" />
            <span className="font-semibold">How Profit is calculated:</span>
            <span className="bg-white px-2 py-0.5 rounded border font-mono text-[11px]">
              Gross Profit = Selling Price − Purchase Rate
            </span>
            <span className="text-slate-400">➔</span>
            <span className="bg-white px-2 py-0.5 rounded border font-mono text-[11px]">
              Net Profit = Gross Profit − Operating Expenses
            </span>
          </div>
          <span className="text-[11px] text-slate-500">
            💡 Click on any product row or <strong>"View Ledger"</strong> to see all purchases, sales bills & serials!
          </span>
        </div>

        {/* TABS VIEW */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <TabsList className="bg-slate-100 p-1 border border-slate-200">
              <TabsTrigger value="products" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                <Package className="w-3.5 h-3.5 mr-1.5" /> Product-Wise Profit & Loss ({filteredProducts.length})
              </TabsTrigger>
              <TabsTrigger value="categories" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                <Layers className="w-3.5 h-3.5 mr-1.5" /> Category & Brand Margins
              </TabsTrigger>
              <TabsTrigger value="statement" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                <BarChart2 className="w-3.5 h-3.5 mr-1.5" /> Financial P&L Statement (Ledger)
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: PRODUCT-WISE PROFIT & LOSS */}
          <TabsContent value="products" className="space-y-4 m-0">
            {/* Health Filter Chips Bar */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-slate-600 mr-1">Filter by Profitability:</span>
              <button
                type="button"
                onClick={() => { setHealthFilter("ALL"); setPage(1); }}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-colors border",
                  healthFilter === "ALL" ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                )}
              >
                All Products ({healthCounts.all})
              </button>
              <button
                type="button"
                onClick={() => { setHealthFilter("high"); setPage(1); }}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1.5",
                  healthFilter === "high" ? "bg-emerald-700 text-white border-emerald-700" : "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> High Margin &gt;20% ({healthCounts.high})
              </button>
              <button
                type="button"
                onClick={() => { setHealthFilter("healthy"); setPage(1); }}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1.5",
                  healthFilter === "healthy" ? "bg-blue-700 text-white border-blue-700" : "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-blue-500" /> Healthy 8-20% ({healthCounts.healthy})
              </button>
              <button
                type="button"
                onClick={() => { setHealthFilter("low"); setPage(1); }}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1.5",
                  healthFilter === "low" ? "bg-amber-700 text-white border-amber-700" : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500" /> Low Margin &lt;8% ({healthCounts.low})
              </button>
              <button
                type="button"
                onClick={() => { setHealthFilter("loss"); setPage(1); }}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-bold transition-colors border flex items-center gap-1.5",
                  healthFilter === "loss" ? "bg-rose-700 text-white border-rose-700" : "bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" /> Loss Making ({healthCounts.loss})
              </button>
            </div>

            {/* Filter Controls Bar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 items-center">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search product name, VP code, brand..."
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  className="pl-9 bg-slate-50 text-xs"
                />
              </div>

              <div>
                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
                  <SelectTrigger className="text-xs bg-slate-50">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Categories</SelectItem>
                    {uniqueCategories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Select value={brandFilter} onValueChange={(v) => { setBrandFilter(v); setPage(1); }}>
                  <SelectTrigger className="text-xs bg-slate-50">
                    <SelectValue placeholder="All Brands" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Brands</SelectItem>
                    {uniqueBrands.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="text-xs bg-slate-50 font-medium">
                    <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="profit-desc">Highest Profit (₹)</SelectItem>
                    <SelectItem value="profit-asc">Lowest Profit / Loss</SelectItem>
                    <SelectItem value="margin-desc">Highest Margin %</SelectItem>
                    <SelectItem value="revenue-desc">Highest Sales Revenue</SelectItem>
                    <SelectItem value="qty-desc">Most Units Sold</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                {hasActiveFilters && (
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm" 
                    onClick={handleResetFilters} 
                    className="w-full text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                  >
                    <X className="w-3.5 h-3.5 mr-1" /> Reset Filters
                  </Button>
                )}
              </div>
            </div>

            {/* Product Profit Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="bg-slate-100/90 text-slate-700 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-3.5 text-center w-10 shrink-0">#</th>
                      <th className="px-4 py-3.5 text-left min-w-[220px]">Product Particulars</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[95px]">In-Stock</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[90px]">Sold Qty</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[110px]">Purchase Cost</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[110px]">Avg Selling Rate</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[110px]">Total Cost</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[120px]">Total Sales</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[120px]">Profit / Loss (₹)</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[85px]">Margin %</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[105px]">Health</th>
                      <th className="px-3 py-3.5 text-center whitespace-nowrap min-w-[95px]">Ledger</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {isLoading ? (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-slate-500 font-medium">
                          <RefreshCw className="w-5 h-5 animate-spin mx-auto text-[#3F63AD] mb-2" />
                          Calculating live product margins and profits...
                        </td>
                      </tr>
                    ) : paginatedProducts.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="py-12 text-center text-slate-400">
                          <Package className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                          <p className="font-bold text-slate-600">No sold products found for this filter/period</p>
                          <p className="text-[11px] text-slate-400 mt-0.5">Try selecting a different date range or clearing search filters.</p>
                          {hasActiveFilters && (
                            <Button size="sm" variant="outline" onClick={handleResetFilters} className="mt-3 text-xs">
                              Reset All Filters
                            </Button>
                          )}
                        </td>
                      </tr>
                    ) : (
                      paginatedProducts.map((p, idx) => {
                        const isProfitable = p.totalProfit >= 0;
                        return (
                          <tr 
                            key={p.id || idx} 
                            className="hover:bg-slate-50/90 transition-colors cursor-pointer group"
                            onClick={() => setSelectedProductForLedger(p)}
                          >
                            <td className="px-3 py-3 text-center font-mono font-bold text-slate-400">
                              {(page - 1) * PER_PAGE + idx + 1}
                            </td>
                            <td className="px-4 py-3 min-w-[220px]">
                              <p className="font-bold text-slate-900 text-xs leading-snug group-hover:text-[#3F63AD] transition-colors line-clamp-1">
                                {p.name}
                              </p>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="font-mono text-[10px] font-bold text-[#3F63AD] bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">
                                  {p.vpCode || p.code}
                                </span>
                                <span className="text-[10px] text-slate-600 font-semibold">{p.brand}</span>
                                <span className="text-slate-300">·</span>
                                <span className="text-[10px] text-slate-500 font-medium">{p.category}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200/80 inline-block">
                                {p.currentStock} {p.unit}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              <span className="font-mono text-xs font-black text-[#30539C] bg-blue-50/90 border border-blue-200 px-2.5 py-1 rounded-md inline-block">
                                {p.qtySold} {p.unit}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-slate-600 font-semibold whitespace-nowrap">
                              {formatCurrency(p.purchasePrice)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-slate-900 font-bold whitespace-nowrap">
                              {formatCurrency(p.avgSellingPrice)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-amber-800 font-semibold whitespace-nowrap">
                              {formatCurrency(p.totalCost)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs text-blue-900 font-black whitespace-nowrap">
                              {formatCurrency(p.totalRevenue)}
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                              <span className={cn(
                                "font-black px-2.5 py-1 rounded-md inline-block border",
                                isProfitable 
                                  ? "text-emerald-800 bg-emerald-50 border-emerald-200" 
                                  : "text-rose-800 bg-rose-50 border-rose-200"
                              )}>
                                {isProfitable ? "+" : ""}{formatCurrency(p.totalProfit)}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              <span className={cn(
                                "font-mono text-xs font-black px-2 py-0.5 rounded",
                                p.marginPct >= 20 ? "text-emerald-700 bg-emerald-50" :
                                p.marginPct >= 8 ? "text-blue-700 bg-blue-50" :
                                p.marginPct >= 0 ? "text-amber-700 bg-amber-50" : "text-rose-700 bg-rose-50"
                              )}>
                                {p.marginPct}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap">
                              {p.status === "high" && (
                                <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 text-[10px] font-bold border border-emerald-300">
                                  High &gt;20%
                                </Badge>
                              )}
                              {p.status === "healthy" && (
                                <Badge className="bg-blue-50 text-blue-800 hover:bg-blue-50 text-[10px] font-bold border border-blue-200">
                                  Healthy
                                </Badge>
                              )}
                              {p.status === "low" && (
                                <Badge className="bg-amber-50 text-amber-800 hover:bg-amber-50 text-[10px] font-bold border border-amber-200">
                                  Low &lt;8%
                                </Badge>
                              )}
                              {p.status === "loss" && (
                                <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 text-[10px] font-bold border border-rose-300">
                                  Loss Unit
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedProductForLedger(p)}
                                className="h-7 px-2.5 text-[11px] font-bold text-[#30539C] bg-blue-50 hover:bg-blue-100 border-blue-200 shadow-xs"
                              >
                                <History className="w-3.5 h-3.5 mr-1 text-[#3F63AD]" /> Ledger
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Table Footer / Pagination */}
              <div className="bg-slate-50 px-4 py-3 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
                <p>
                  Showing <span className="font-bold text-slate-800">{filteredProducts.length > 0 ? (page - 1) * PER_PAGE + 1 : 0}</span> to{" "}
                  <span className="font-bold text-slate-800">{Math.min(page * PER_PAGE, filteredProducts.length)}</span> of{" "}
                  <span className="font-bold text-slate-800">{filteredProducts.length}</span> products sold
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="h-7 px-3 text-xs bg-white"
                  >
                    Previous
                  </Button>
                  <span className="px-2 font-semibold text-slate-700">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-7 px-3 text-xs bg-white"
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: CATEGORY & BRAND MARGINS */}
          <TabsContent value="categories" className="space-y-6 m-0">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Profitability */}
              <Card className="border border-slate-200 shadow-xs bg-white">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#3F63AD]" /> Category Profit & Margin Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {categoryBreakdown.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">No category data available for this range</p>
                  ) : (
                    categoryBreakdown.map((cat, idx) => (
                      <div key={cat.name || idx} className="p-3 rounded-lg bg-slate-50/80 border border-slate-100 hover:border-slate-300 transition-colors">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{cat.name}</span>
                            <Badge variant="outline" className="text-[10px] bg-white text-slate-600 font-mono">
                              {cat.qty} sold
                            </Badge>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-black text-emerald-700">{formatCurrency(cat.profit)}</span>
                            <span className="text-[10px] text-slate-500 font-semibold ml-1.5">({cat.marginPct}%)</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                          <span>Revenue: <strong className="text-slate-800">{formatCurrency(cat.revenue)}</strong></span>
                          <span>Cost: <strong className="text-amber-700">{formatCurrency(cat.cost)}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Brand Profitability */}
              <Card className="border border-slate-200 shadow-xs bg-white">
                <CardHeader className="pb-3 border-b border-slate-100">
                  <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Award className="w-4 h-4 text-[#3F63AD]" /> Brand Profit & Margin Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {brandBreakdown.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">No brand data available for this range</p>
                  ) : (
                    brandBreakdown.map((brand, idx) => (
                      <div key={brand.name || idx} className="p-3 rounded-lg bg-slate-50/80 border border-slate-100 hover:border-slate-300 transition-colors">
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">{brand.name}</span>
                            <Badge variant="outline" className="text-[10px] bg-white text-slate-600 font-mono">
                              {brand.qty} sold
                            </Badge>
                          </div>
                          <div className="text-right">
                            <span className="font-mono font-black text-emerald-700">{formatCurrency(brand.profit)}</span>
                            <span className="text-[10px] text-slate-500 font-semibold ml-1.5">({brand.marginPct}%)</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
                          <span>Revenue: <strong className="text-slate-800">{formatCurrency(brand.revenue)}</strong></span>
                          <span>Cost: <strong className="text-amber-700">{formatCurrency(brand.cost)}</strong></span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Supplier-wise Purchases — what was actually BOUGHT this
                period (bills raised), not a profit/margin figure like the
                two panels above. */}
            <Card className="border border-slate-200 shadow-xs bg-white">
              <CardHeader className="pb-3 border-b border-slate-100">
                <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#3F63AD]" /> Purchase Entries by Supplier
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {purchaseBreakdown.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No purchase entries recorded for this period</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {purchaseBreakdown.map((s, idx) => (
                      <div key={s.name || idx} className="p-3 rounded-lg bg-slate-50/80 border border-slate-100 hover:border-slate-300 transition-colors">
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-bold text-slate-900 truncate">{s.name}</span>
                          <Badge variant="outline" className="text-[10px] bg-white text-slate-600 font-mono shrink-0 ml-1.5">
                            {s.bills} bill{s.bills === 1 ? "" : "s"}
                          </Badge>
                        </div>
                        <span className={cn(
                          "font-mono font-black text-sm",
                          s.amount < 0 ? "text-rose-700" : "text-orange-700"
                        )}>
                          {formatCurrency(s.amount)}
                        </span>
                        {s.amount < 0 && (
                          <span className="text-[10px] text-rose-600 font-semibold ml-1.5">(net debit notes)</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* TAB 3: TRADITIONAL FINANCIAL STATEMENT VIEW */}
          <TabsContent value="statement" className="space-y-4 m-0">
            <Card className="border border-slate-200 shadow-sm bg-white overflow-hidden">
              <CardHeader className="bg-slate-50/80 border-b border-slate-200 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-black text-slate-900 tracking-tight uppercase">
                      Trading and Profit & Loss Account
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      For the period from <strong className="text-slate-800">{formatDate(dateRange.start)}</strong> to <strong className="text-slate-800">{formatDate(dateRange.end)}</strong>
                    </p>
                  </div>
                  <Badge className="bg-[#3F63AD] text-white text-xs font-mono font-bold self-start sm:self-auto">
                    M/S ASHOKA ENTERPRISES (VALUE PLUS)
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs">
                  {/* LEFT SIDE: EXPENDITURES & COSTS */}
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">Particulars (Cost / Expenses)</span>
                      <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">Amount (₹)</span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-slate-600 text-[11px] pl-3 border-l-2 border-slate-200">
                        <span>Purchases (Stock-In Bills Raised This Period)</span>
                        <span className="font-mono font-semibold">{formatCurrency(summary.totalPurchases)}</span>
                      </div>

                      <div className="flex items-center justify-between font-semibold text-slate-700">
                        <span>To Cost of Goods Sold (COGS - Purchase Cost)</span>
                        <span className="font-mono text-slate-900 font-bold">{formatCurrency(summary.totalCOGS)}</span>
                      </div>

                      <div className="flex items-center justify-between font-extrabold text-emerald-800 bg-emerald-50/80 p-2 rounded border border-emerald-200">
                        <span>To Gross Profit c/d</span>
                        <span className="font-mono">{formatCurrency(summary.grossProfit)}</span>
                      </div>

                      <div className="border-t border-dashed pt-3 mt-4">
                        <p className="text-[11px] font-bold uppercase text-purple-800 mb-2">Operating Expenses Breakdown:</p>
                        {expenseBreakdown.length === 0 ? (
                          <p className="text-slate-400 italic text-[11px]">No operating expenses recorded for this period</p>
                        ) : (
                          expenseBreakdown.map((exp, i) => (
                            <div key={i} className="flex items-center justify-between py-1 text-slate-600">
                              <span>To {exp.category} ({exp.percentage}%)</span>
                              <span className="font-mono font-semibold">{formatCurrency(exp.amount)}</span>
                            </div>
                          ))
                        )}
                      </div>

                      <div className={cn(
                        "flex items-center justify-between font-black text-sm p-3 rounded-lg border mt-4",
                        isNetProfitable ? "bg-emerald-100/70 text-emerald-900 border-emerald-300" : "bg-rose-100/70 text-rose-900 border-rose-300"
                      )}>
                        <span>{isNetProfitable ? "To Net Profit (Transferred to Capital)" : "To Net Operating Deficit"}</span>
                        <span className="font-mono text-base">{formatCurrency(summary.netProfit)}</span>
                      </div>
                    </div>
                  </div>

                  {/* RIGHT SIDE: INCOMES & REVENUES */}
                  <div className="p-5 space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">Particulars (Income / Revenue)</span>
                      <span className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">Amount (₹)</span>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>By Sales Revenue (Invoiced Total)</span>
                        <span className="font-mono text-blue-900 text-sm font-black">{formatCurrency(summary.totalRevenue)}</span>
                      </div>

                      <div className="flex items-center justify-between text-slate-500 text-[11px] pl-3 border-l-2 border-slate-200">
                        <span>Less: Discounts Allowed</span>
                        <span className="font-mono text-rose-600 font-semibold">−{formatCurrency(summary.totalDiscountGiven)}</span>
                      </div>

                      <div className="flex items-center justify-between text-slate-500 text-[11px] pl-3 border-l-2 border-slate-200">
                        <span>GST Collected on Sales</span>
                        <span className="font-mono text-slate-700 font-semibold">{formatCurrency(summary.totalTaxCollected)}</span>
                      </div>

                      <div className="flex items-center justify-between font-extrabold text-emerald-800 bg-emerald-50/80 p-2 rounded border border-emerald-200 mt-4">
                        <span>By Gross Profit b/d</span>
                        <span className="font-mono">{formatCurrency(summary.grossProfit)}</span>
                      </div>

                      <div className="pt-8 text-slate-400 text-center text-[11px] italic">
                        All revenues reconciled with GST invoices and inventory ledger records.
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* PRODUCT LEDGER MODAL */}
      <ProductLedgerModal
        isOpen={!!selectedProductForLedger}
        onClose={() => setSelectedProductForLedger(null)}
        productIdentifier={selectedProductForLedger}
        startDate={dateRange.start}
        endDate={dateRange.end}
      />

      {/* PRINT P&L STATEMENT MODAL */}
      <Dialog open={isPrintModalOpen} onOpenChange={setIsPrintModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6">
          <DialogHeader className="border-b pb-3">
            <DialogTitle className="text-base font-black text-slate-900 flex items-center justify-between">
              <span>Financial Profit & Loss Statement</span>
              <Button size="sm" onClick={() => window.print()} className="bg-[#3F63AD] text-white text-xs font-bold">
                <Printer className="w-3.5 h-3.5 mr-1" /> Print Paper Copy
              </Button>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 pt-2 text-xs">
            {/* Header */}
            <div className="text-center border-b pb-4">
              <h2 className="text-lg font-black text-slate-900 uppercase">M/S ASHOKA ENTERPRISES</h2>
              <p className="text-xs font-bold text-[#3F63AD]">VALUE PLUS RETAIL ELECTRONICS & APPLIANCES</p>
              <p className="text-[11px] text-slate-500 mt-0.5">Kunraghat, Gorakhpur · GSTIN: 09ANHPJ7242D1Z2</p>
              <div className="mt-2 inline-block bg-slate-100 px-3 py-1 rounded font-bold text-slate-700">
                PROFIT & LOSS STATEMENT ({formatDate(dateRange.start)} — {formatDate(dateRange.end)})
              </div>
            </div>

            {/* Financial Summary Table */}
            <table className="w-full text-xs border border-slate-300">
              <thead className="bg-slate-100 font-bold border-b border-slate-300">
                <tr>
                  <th className="p-2.5 text-left border-r border-slate-300">Financial Metric</th>
                  <th className="p-2.5 text-right">Amount (INR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-medium">
                <tr>
                  <td className="p-2.5 border-r border-slate-300 font-bold text-slate-800">Gross Sales Revenue</td>
                  <td className="p-2.5 text-right font-mono font-bold text-blue-900">{formatCurrency(summary.totalRevenue)}</td>
                </tr>
                <tr>
                  <td className="p-2.5 border-r border-slate-300 text-slate-600">Less: Cost of Goods Sold (Purchase Cost)</td>
                  <td className="p-2.5 text-right font-mono text-amber-800 font-semibold">{formatCurrency(summary.totalCOGS)}</td>
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td className="p-2.5 border-r border-slate-300 text-emerald-800 font-extrabold">GROSS PROFIT ({summary.grossMarginPct}%)</td>
                  <td className="p-2.5 text-right font-mono text-emerald-800 font-black">{formatCurrency(summary.grossProfit)}</td>
                </tr>
                <tr>
                  <td className="p-2.5 border-r border-slate-300 text-slate-600">Less: Total Store Operating Expenses</td>
                  <td className="p-2.5 text-right font-mono text-purple-800 font-semibold">{formatCurrency(summary.totalExpenses)}</td>
                </tr>
                <tr className={cn("font-black text-sm", isNetProfitable ? "bg-emerald-100 text-emerald-900" : "bg-rose-100 text-rose-900")}>
                  <td className="p-3 border-r border-slate-300 uppercase">NET PROFIT / LOSS ({summary.netMarginPct}%)</td>
                  <td className="p-3 text-right font-mono text-base">{formatCurrency(summary.netProfit)}</td>
                </tr>
              </tbody>
            </table>

            {/* Top 8 Products Table in Print */}
            <div>
              <h4 className="font-bold text-slate-800 text-xs mb-2">Top Profitable Products in this Period:</h4>
              <table className="w-full text-[11px] border border-slate-200">
                <thead className="bg-slate-100 font-bold border-b border-slate-200">
                  <tr>
                    <th className="p-1.5 text-left">Product</th>
                    <th className="p-1.5 text-center">Qty Sold</th>
                    <th className="p-1.5 text-right">Cost Rate</th>
                    <th className="p-1.5 text-right">Selling Rate</th>
                    <th className="p-1.5 text-right">Profit (₹)</th>
                    <th className="p-1.5 text-center">Margin %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {productBreakdown.slice(0, 8).map((p, i) => (
                    <tr key={i}>
                      <td className="p-1.5 font-semibold text-slate-800">{p.name}</td>
                      <td className="p-1.5 text-center font-mono">{p.qtySold}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(p.purchasePrice)}</td>
                      <td className="p-1.5 text-right font-mono">{formatCurrency(p.avgSellingPrice)}</td>
                      <td className="p-1.5 text-right font-mono font-bold text-emerald-700">{formatCurrency(p.totalProfit)}</td>
                      <td className="p-1.5 text-center font-mono font-bold">{p.marginPct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pt-6 border-t flex items-center justify-between text-[10px] text-slate-500">
              <p>Generated by Value Plus ERP Accounting System</p>
              <p>Authorized Signatory: ________________________</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

export default function ProfitLossPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading Profit & Loss Statement...</div>}>
      <ProfitLossContent />
    </Suspense>
  );
}
