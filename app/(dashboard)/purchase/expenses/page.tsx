"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  Plus, Search, DollarSign, Receipt, Trash2, AlertTriangle, X, Printer, 
  TrendingDown, PieChart as PieIcon, Wallet, CreditCard, Building2, ArrowUpRight, ArrowLeft
} from "lucide-react";
import { useState, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { formatCurrency, formatDate, formatDateShort, indianNumberFormat } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { TableShimmer, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

interface ExpenseItem {
  _id?: string;
  id?: string;
  expenseNo: string;
  category: string;
  description: string;
  amount: number;
  date: string;
  createdAt?: string;
  paymentMode: "UPI" | "Bank Transfer" | "Cash" | "Card";
  status: "paid" | "approved" | "pending";
}

const EXPENSE_CATEGORIES = [
  "Electricity Bill (Bijli Bill)",
  "Water Bill & Water Supply",
  "House Bill & Showroom Rent",
  "Freight Charges & Transportation",
  "Customer Delivery & Unloading",
  "Generator Diesel & Fuel",
  "Tea, Pantry & Staff Refreshment",
  "Staff Salary & Daily Wages",
  "Showroom Repair & Maintenance",
  "Office Stationery & Printing",
  "Internet Broadband & Phone Bill",
  "Marketing, Hoardings & Advertising",
  "Security Guard & Cleaning Services",
  "Bank & POS Machine Charges",
  "General Petty Cash & Miscellaneous"
];

export default function ExpensesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500 font-medium">Loading Expenses Hub...</div>}>
      <ExpensesContent />
    </Suspense>
  );
}

function ExpensesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const urlDateFilter = searchParams.get("dateFilter") || "This Month";
  const [dateFilter, setDateFilter] = useState(urlDateFilter);
  const [dateRange, setDateRange] = useState(() => resolveDateRange(urlDateFilter));
  
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [paymentModeFilter, setPaymentModeFilter] = useState("all");

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<string | null>(null);
  const [selectedVoucherForPrint, setSelectedVoucherForPrint] = useState<ExpenseItem | null>(null);

  const [formData, setFormData] = useState({
    category: "Electricity Bill (Bijli Bill)",
    description: "",
    amount: "",
    paymentMode: "UPI" as "UPI" | "Bank Transfer" | "Cash" | "Card",
    date: todayInIndia(),
  });

  const { data: expenses = [], isLoading: loading } = useQuery({
    queryKey: ["expenses"],
    queryFn: async () => {
      const res = await fetch("/api/expenses");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: cashRegisterData } = useQuery({
    queryKey: ["cash-register"],
    queryFn: async () => {
      const res = await fetch("/api/cash-register");
      const json = await res.json();
      return json.success ? json.data : null;
    }
  });
  const liveCashBalance = cashRegisterData?.currentBalance || 0;

  // Filtered expenses based on active filters
  const filtered = useMemo(() => {
    return expenses.filter((e: any) => {
      const matchesSearch = !search ||
        (e.expenseNo || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.category || "").toLowerCase().includes(search.toLowerCase()) ||
        (e.description || "").toLowerCase().includes(search.toLowerCase());
      const matchesCategory = categoryFilter === "all" || e.category === categoryFilter;
      const matchesMode = paymentModeFilter === "all" || e.paymentMode === paymentModeFilter;
      const matchesDate = isDateInRange(e.date || e.createdAt, dateRange.start, dateRange.end);
      return matchesSearch && matchesCategory && matchesMode && matchesDate;
    });
  }, [expenses, search, categoryFilter, paymentModeFilter, dateRange]);

  // Real-time KPI calculations
  const totalAmount = useMemo(() => {
    return filtered.reduce((acc: number, e: any) => acc + (Number(e.amount) || 0), 0);
  }, [filtered]);

  const cashAmount = useMemo(() => {
    return filtered.filter((e: any) => e.paymentMode === "Cash").reduce((acc: number, e: any) => acc + (Number(e.amount) || 0), 0);
  }, [filtered]);

  const onlineAmount = useMemo(() => {
    return filtered.filter((e: any) => e.paymentMode !== "Cash").reduce((acc: number, e: any) => acc + (Number(e.amount) || 0), 0);
  }, [filtered]);

  // Category Breakdown
  const categoryStats = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach((e: any) => {
      const cat = e.category || "Miscellaneous";
      map[cat] = (map[cat] || 0) + (Number(e.amount) || 0);
    });

    return Object.entries(map)
      .map(([category, amount]) => ({
        category,
        amount,
        percentage: totalAmount > 0 ? Math.round((amount / totalAmount) * 100) : 0
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filtered, totalAmount]);

  // Timeline chart data with continuous hourly or daily checkpoints (Petpooja style)
  const chartData = useMemo(() => {
    const isSingleDay = dateFilter === "Today" || dateFilter === "Yesterday" || dateRange.start === dateRange.end;
    const dataMap: Record<string, number> = {};

    if (isSingleDay) {
      const hourlySlots = ["08:00 AM", "10:00 AM", "12:00 PM", "02:00 PM", "04:00 PM", "06:00 PM", "08:00 PM", "10:00 PM"];
      hourlySlots.forEach(slot => {
        dataMap[slot] = 0;
      });

      filtered.forEach((exp: any) => {
        let h = 12;
        if (exp.createdAt) {
          const dObj = new Date(exp.createdAt);
          if (!isNaN(dObj.getTime())) h = dObj.getHours();
        }
        let slot = "12:00 PM";
        if (h < 9) slot = "08:00 AM";
        else if (h < 11) slot = "10:00 AM";
        else if (h < 13) slot = "12:00 PM";
        else if (h < 15) slot = "02:00 PM";
        else if (h < 17) slot = "04:00 PM";
        else if (h < 19) slot = "06:00 PM";
        else if (h < 21) slot = "08:00 PM";
        else slot = "10:00 PM";

        dataMap[slot] = (dataMap[slot] || 0) + (Number(exp.amount) || 0);
      });
    } else {
      const s = new Date(dateRange.start);
      const e = new Date(dateRange.end);
      const cur = new Date(s);
      while (cur <= e) {
        const monthShort = cur.toLocaleString('en-US', { month: 'short' });
        const day = cur.getDate();
        const displayDate = `${day < 10 ? '0' + day : day} ${monthShort}`;
        dataMap[displayDate] = 0;
        cur.setDate(cur.getDate() + 1);
      }

      filtered.forEach((exp: any) => {
        const d = new Date(exp.date || exp.createdAt);
        if (!isNaN(d.getTime())) {
          const monthShort = d.toLocaleString('en-US', { month: 'short' });
          const day = d.getDate();
          const displayDate = `${day < 10 ? '0' + day : day} ${monthShort}`;
          if (dataMap[displayDate] !== undefined) {
            dataMap[displayDate] += (Number(exp.amount) || 0);
          } else {
            dataMap[displayDate] = (Number(exp.amount) || 0);
          }
        }
      });
    }

    return Object.entries(dataMap).map(([date, amount]) => ({ date, amount }));
  }, [filtered, dateFilter, dateRange]);

  const createExpenseMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create expense");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["cash-register"] });
      toast.success("Expense voucher recorded successfully");
      setIsFormOpen(false);
      setFormData({
        category: "Store Rent",
        description: "",
        amount: "",
        paymentMode: "UPI",
        date: todayInIndia(),
      });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (expenseNo: string) => {
      const res = await fetch(`/api/expenses?expenseNo=${encodeURIComponent(expenseNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete expense");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      toast.success("Expense voucher deleted successfully");
      setExpenseToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });

  const handleSave = () => {
    if (!formData.description || !formData.amount) {
      toast.error("Please fill Particulars Description and Expense Amount");
      return;
    }

    const payload = {
      expenseNo: `EXP-${new Date().getFullYear()}-${String(expenses.length + 95).padStart(4, "0")}`,
      category: formData.category,
      description: formData.description,
      amount: Number(formData.amount) || 0,
      date: formData.date || todayInIndia(),
      paymentMode: formData.paymentMode,
      status: "paid",
    };

    createExpenseMutation.mutate(payload);
  };

  return (
    <PageShell
      title="Showroom Operating Expenses"
      subtitle="Comprehensive expense ledger, showroom operating costs, payroll & analytics"
      breadcrumbs={[{ label: "Purchase" }, { label: "Expenses" }]}
      actions={
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold shadow-2xs">
            <Wallet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Showroom Cash: {formatCurrency(liveCashBalance)}</span>
          </div>

          <ExportMenu
            title="Showroom Operating Expenses"
            subtitle={`${filtered.length} vouchers (${dateFilter})`}
            data={filtered.map((e: any) => ({
              "Voucher No": e.expenseNo,
              Date: formatDate(e.date || e.createdAt),
              Category: e.category,
              Description: e.description || "",
              "Payment Mode": e.paymentMode || "Cash",
              Amount: e.amount,
              Status: e.status || "Paid",
            }))}
            filename="expenses"
          />

          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-rose-600 hover:bg-rose-700 text-white font-bold h-9 shadow-sm">
            <Plus className="w-4 h-4 mr-1.5" /> Record Expense
          </Button>
        </div>
      }
    >
      {/* ─── TOP KPI CARDS ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Expenses */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Expense</span>
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <Receipt className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <p className="text-2xl font-black text-rose-600 font-mono">{formatCurrency(totalAmount)}</p>
          </div>
          <span className="text-[11px] text-slate-500 font-medium">{filtered.length} vouchers recorded ({dateFilter})</span>
        </div>

        {/* Cash Outflow */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cash Counter Outflow</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-[#76C043] flex items-center justify-center">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <p className="text-2xl font-bold text-slate-900 font-mono">{formatCurrency(cashAmount)}</p>
          </div>
          <span className="text-[11px] text-emerald-600 font-semibold">{totalAmount > 0 ? Math.round((cashAmount / totalAmount) * 100) : 0}% of total expenses</span>
        </div>

        {/* Digital / Bank Outflow */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">UPI & Bank Outflow</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#3F63AD] flex items-center justify-center">
              <CreditCard className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <p className="text-2xl font-bold text-slate-900 font-mono">{formatCurrency(onlineAmount)}</p>
          </div>
          <span className="text-[11px] text-[#3F63AD] font-semibold">{totalAmount > 0 ? Math.round((onlineAmount / totalAmount) * 100) : 0}% via digital banking</span>
        </div>

        {/* Top Category */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Top Cost Center</span>
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Building2 className="w-4 h-4" />
            </div>
          </div>
          <div className="my-2">
            <p className="text-lg font-extrabold text-slate-900 truncate">
              {categoryStats[0]?.category || "Store Rent"}
            </p>
          </div>
          <span className="text-[11px] text-amber-700 font-semibold">
            {formatCurrency(categoryStats[0]?.amount || 0)} ({categoryStats[0]?.percentage || 0}%)
          </span>
        </div>
      </div>

      {/* ─── VISUAL ANALYTICS & CATEGORY DISTRIBUTION ─────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend AreaChart */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
            <div>
              <h3 className="font-extrabold text-slate-900 text-base tracking-tight flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-rose-600" /> Expense Trajectory Timeline
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {dateFilter === "Today" || dateFilter === "Yesterday" ? `Hourly business trajectory for ${dateFilter}` : `Daily expense trend for ${dateFilter}`}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-rose-50 text-rose-700 border border-rose-200">
              {formatCurrency(totalAmount)}
            </span>
          </div>

          <div className="h-[210px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#e11d48" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <Tooltip 
                  formatter={(val: any) => [`₹${indianNumberFormat(Number(val))}`, "Expense"]}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
                />
                <Area type="monotone" dataKey="amount" stroke="#e11d48" strokeWidth={3} fillOpacity={1} fill="url(#expenseGradient)" dot={{ r: 4, stroke: "#e11d48", strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 6, stroke: "#e11d48", strokeWidth: 2, fill: "#fff" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Breakdown Progress */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
            <h3 className="font-extrabold text-slate-900 text-sm tracking-tight flex items-center gap-2">
              <PieIcon className="w-4 h-4 text-slate-600" /> Category Distribution
            </h3>
            <span className="text-xs text-muted-foreground">{categoryStats.length} active</span>
          </div>

          <div className="space-y-3.5 flex-1 justify-center flex flex-col">
            {categoryStats.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-8">No expenses logged for this timeframe</p>
            ) : (
              categoryStats.slice(0, 5).map((cat, i) => {
                const colors = ["bg-rose-500", "bg-amber-500", "bg-blue-500", "bg-purple-500", "bg-emerald-500"];
                const color = colors[i % colors.length];
                return (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-700 truncate max-w-[170px]">{cat.category}</span>
                      <span className="font-mono text-slate-900">{formatCurrency(cat.amount)} ({cat.percentage}%)</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${cat.percentage}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ─── DATA TABLE WITH UNIFIED FILTER TOOLBAR ──────────────────── */}
      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b bg-white rounded-t-xl">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search voucher #, category, description..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
                className="pl-9 h-9 text-xs" 
              />
            </div>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] h-9 text-xs">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Payment Mode Filter */}
            <Select value={paymentModeFilter} onValueChange={setPaymentModeFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs">
                <SelectValue placeholder="All Modes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modes</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                <SelectItem value="Cash">Cash Counter</SelectItem>
                <SelectItem value="Card">Card</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Unified Date Range Filter */}
          <DateRangeFilter 
            value={dateFilter} 
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-44 h-9"
            showIcon={true}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Voucher #</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Particulars / Description</th>
                <th className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Payment Mode</th>
                <th className="px-4 py-3 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-center text-xs font-bold text-slate-500 uppercase tracking-wider w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0"><TableShimmer rows={6} cols={8} /></td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-400 font-medium">
                    No expense vouchers matching the selected filters ({dateFilter})
                  </td>
                </tr>
              ) : (
                filtered.map((e: any) => (
                  <tr key={e._id || e.expenseNo} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-[#3F63AD] cursor-pointer hover:underline" onClick={() => setSelectedVoucherForPrint(e)}>
                      {e.expenseNo}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(e.date || e.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 whitespace-nowrap">
                        {e.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 max-w-[280px] font-medium truncate">{e.description || "-"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                        {e.paymentMode || "Cash"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-rose-600 font-mono text-sm">{formatCurrency(e.amount)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={e.status === "paid" ? "success" : "warning"} className="text-[10px]">
                        {e.status || "Paid"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-slate-400 hover:text-[#3F63AD] hover:bg-blue-50"
                          onClick={() => setSelectedVoucherForPrint(e)}
                          title="Print / View Voucher"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => setExpenseToDelete(e.expenseNo)}
                          title="Delete Expense"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── RECORD EXPENSE MODAL ───────────────────────────────────────── */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Receipt className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">Record Showroom Expense</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Log operational expenses, showroom rent, payroll, utilities & courier
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Expense Category *</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EXPENSE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Payment Mode</Label>
                  <Select value={formData.paymentMode} onValueChange={(v: any) => setFormData({ ...formData, paymentMode: v })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UPI">UPI</SelectItem>
                      <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                      <SelectItem value="Cash">Cash Counter</SelectItem>
                      <SelectItem value="Card">Card</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Voucher Date</Label>
                  <Input 
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Expense Amount (₹) *</Label>
                  <Input
                    type="number"
                    placeholder="25000"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="bg-slate-50 border-slate-300 font-bold text-slate-900"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-bold text-slate-700">
                    Particulars / Reason for Expense (Kyu hua / Kis cheez ka kharcha hai) *
                  </Label>
                  <Input
                    placeholder="Mandatory: e.g. Paid electricity bill / Tea & refreshments for staff / Freight for stock"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                    required
                  />
                </div>
              </div>

              {/* LIVE CASH REGISTER BALANCE & OVERFLOW WARNING */}
              {formData.paymentMode === "Cash" && (
                <div className={`p-3 rounded-xl border flex items-start gap-2.5 transition-all ${
                  Number(formData.amount) > liveCashBalance
                    ? "bg-rose-50 border-rose-300 text-rose-900"
                    : "bg-emerald-50 border-emerald-200 text-emerald-800"
                }`}>
                  <Wallet className={`w-4 h-4 mt-0.5 flex-shrink-0 ${Number(formData.amount) > liveCashBalance ? "text-rose-600" : "text-emerald-600"}`} />
                  <div className="text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">Showroom Cash in Register:</span>
                      <span className="font-mono font-black">{formatCurrency(liveCashBalance)}</span>
                    </div>
                    {Number(formData.amount) > liveCashBalance ? (
                      <span className="text-[11px] text-rose-700 mt-1 block font-medium">
                        ⚠️ <strong>Cash Deficit Warning:</strong> Expense amount ({formatCurrency(Number(formData.amount))}) exceeds available register cash by <strong>{formatCurrency(Number(formData.amount) - liveCashBalance)}</strong>. A cash deficit will be logged in the Cash Ledger.
                      </span>
                    ) : (
                      <span className="text-[11px] text-emerald-700 mt-0.5 block">
                        ✓ Sufficient cash balance available in showroom register.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-rose-600 hover:bg-rose-700 text-white px-6 font-bold shadow-lg shadow-rose-600/20">
              Save Expense Voucher
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── PRINT / VOUCHER PREVIEW MODAL ─────────────────────────────── */}
      <Dialog open={!!selectedVoucherForPrint} onOpenChange={(open) => !open && setSelectedVoucherForPrint(null)}>
        <DialogContent className="max-w-xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto bg-white">
          {selectedVoucherForPrint && (
            <div className="p-8 space-y-6">
              {/* Header */}
              <div className="flex items-center justify-between border-b pb-4">
                <div>
                  <h2 className="text-xl font-black text-slate-900">VALUEPLUS RETAIL PVT LTD</h2>
                  <p className="text-xs text-slate-500">Official Payment & Expense Debit Voucher</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-slate-400 uppercase">Voucher #</p>
                  <p className="text-base font-black font-mono text-rose-600">{selectedVoucherForPrint.expenseNo}</p>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl text-xs">
                <div>
                  <span className="text-slate-400 block font-semibold uppercase">Voucher Date</span>
                  <span className="font-bold text-slate-800 text-sm">{formatDate(selectedVoucherForPrint.date || selectedVoucherForPrint.createdAt)}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold uppercase">Category</span>
                  <span className="font-bold text-rose-600 text-sm">{selectedVoucherForPrint.category}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold uppercase">Payment Method</span>
                  <span className="font-bold text-slate-800 text-sm">{selectedVoucherForPrint.paymentMode || "Cash"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-semibold uppercase">Status</span>
                  <span className="font-bold text-emerald-600 text-sm uppercase">{selectedVoucherForPrint.status || "Paid"}</span>
                </div>
              </div>

              {/* Particulars & Amount */}
              <div className="border rounded-xl p-4 space-y-2">
                <span className="text-xs font-bold text-slate-400 uppercase">Particulars / Description</span>
                <p className="text-sm font-semibold text-slate-800">{selectedVoucherForPrint.description || "Operational Store Expense"}</p>
                <div className="pt-4 border-t flex items-center justify-between mt-4">
                  <span className="text-sm font-bold text-slate-700">Total Voucher Amount:</span>
                  <span className="text-2xl font-black text-rose-600 font-mono">{formatCurrency(selectedVoucherForPrint.amount)}</span>
                </div>
              </div>

              {/* Signatures */}
              <div className="grid grid-cols-2 gap-8 pt-8 border-t text-center text-xs text-slate-500">
                <div>
                  <div className="border-b border-slate-300 w-32 mx-auto mb-1"></div>
                  <span>Prepared By</span>
                </div>
                <div>
                  <div className="border-b border-slate-300 w-32 mx-auto mb-1"></div>
                  <span>Authorized Signatory</span>
                </div>
              </div>

              {/* Footer buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t print:hidden">
                <Button variant="outline" onClick={() => setSelectedVoucherForPrint(null)}>
                  Close
                </Button>
                <Button onClick={() => window.print()} className="bg-slate-900 hover:bg-slate-800 text-white font-bold">
                  <Printer className="w-4 h-4 mr-1.5" /> Print Voucher
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── DELETE CONFIRMATION MODAL ─────────────────────────────────── */}
      <Dialog open={!!expenseToDelete} onOpenChange={(open) => !open && setExpenseToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Confirm Expense Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete expense voucher <span className="font-bold">{expenseToDelete}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setExpenseToDelete(null)} disabled={deleteExpenseMutation.isPending}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => expenseToDelete && deleteExpenseMutation.mutate(expenseToDelete)}
              disabled={deleteExpenseMutation.isPending}
            >
              {deleteExpenseMutation.isPending ? "Deleting..." : "Delete Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
