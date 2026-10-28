"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Search, Calendar, Clock, Printer, Send, IndianRupee, CreditCard, Receipt, Wallet, Package, Eye } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ValueplusInvoice from "@/app/invoice/page";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, formatCurrency, formatDateShort } from "@/lib/utils";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">Completed</span>;
  return (
    <span className={cn(
      "inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border",
      status === "Paid" || status === "Completed" || status === "paid" ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
      status === "Pending" || status === "pending" ? "bg-amber-50 text-amber-700 border-amber-200" :
      status === "Failed" ? "bg-red-50 text-red-700 border-red-200" :
      "bg-slate-50 text-slate-700 border-slate-200"
    )}>
      {status}
    </span>
  );
}
export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading Report...</div>}>
      <ReportsContent />
    </Suspense>
  );
}

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportType = searchParams.get("type") || "revenue";
  const initialDateFilter = searchParams.get("dateFilter") || "Today";

  const [dateFilter, setDateFilter] = useState(initialDateFilter);
  const [startDate, setStartDate] = useState(() => resolveDateRange(initialDateFilter).start);
  const [endDate, setEndDate] = useState(() => resolveDateRange(initialDateFilter).end);
  const [isDateInitialized, setIsDateInitialized] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [activePrintInvoice, setActivePrintInvoice] = useState<any | null>(null);

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // A row here can be a real invoice/order OR a standalone payment receipt
  // (e.g. a due settled with no invoice reference) — only the former has a
  // full bill to show, so this looks the actual invoice up rather than
  // assuming the row's own fields are enough to print.
  const openInvoicePreview = (tx: any) => {
    const docNo = tx.id || tx.invoiceNumber;
    const match = invoices.find((inv: any) => inv.invoiceNumber === docNo);
    if (!match) {
      toast.error("No invoice found for this entry — it may be a standalone payment receipt.");
      return;
    }
    setActivePrintInvoice(match);
  };

  const handleDateChange = (val: string, s?: string, e?: string) => {
    setDateFilter(val);
    if (val === "Custom Date" && s && e) {
      setStartDate(s);
      setEndDate(e);
    } else {
      const range = resolveDateRange(val);
      setStartDate(range.start);
      setEndDate(range.end);
    }
  };

  useEffect(() => {
    if (startDate && endDate) {
      fetchStats();
    }
  }, [startDate, endDate]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/stats?startDate=${startDate}&endDate=${endDate}`);
      const json = await res.json();
      if (json.success) {
        setStats(json);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredTransactions = () => {
    if (!stats) return [];
    if (reportType === "expense") {
      const exps = stats.expenses?.recent || [];
      return exps.map((e: any) => ({
        id: e.expenseNo || "EXP",
        customer: `${e.category} - ${e.description || ""}`,
        amount: e.amount || 0,
        time: e.date ? `${e.date} 12:00 PM` : e.createdAt,
        mode: e.paymentMode || "Cash",
        status: e.status || "Paid"
      })).filter((tx: any) => {
        const q = searchQuery.toLowerCase();
        return (tx.id || "").toLowerCase().includes(q) || (tx.customer || "").toLowerCase().includes(q);
      });
    }

    const t = stats.transactions || { cash: [], upi: [], online: [], card: [], finance: [], due: [], all: [] };
    let list = [];
    if (reportType === "cash") list = t.cash || [];
    else if (reportType === "upi") list = t.upi || [];
    else if (reportType === "online") list = t.online || [];
    else if (reportType === "card") list = t.card || [];
    else if (reportType === "finance") list = t.finance || [];
    else if (reportType === "due") list = t.due || [];
    else if (reportType === "orders") list = stats.recentInvoices || [];
    else if (reportType === "aov") list = t.all || [];
    else list = t.all || []; // fallback to all transactions

    return list.filter((tx: any) => {
      const q = searchQuery.toLowerCase();
      const idMatch = (tx.id || tx.invoiceNumber || "").toLowerCase().includes(q);
      const custMatch = (tx.customer || tx.customerName || "").toLowerCase().includes(q);
      return idMatch || custMatch;
    });
  };

  const getReportDetails = () => {
    switch (reportType) {
      case "all": return { title: "Gross Sales / Total Revenue", icon: IndianRupee, color: "#2E3192" };
      case "cash": return { title: "Cash Collections", icon: IndianRupee, color: "#76C043" };
      case "upi": return { title: "UPI / QR Code Collections", icon: CreditCard, color: "#8B5CF6" };
      case "online": return { title: "Online & Digital Receipts", icon: CreditCard, color: "#3F63AD" };
      case "card": return { title: "Card (POS) Collections", icon: CreditCard, color: "#06B6D4" };
      case "finance": return { title: "Finance & Credit Ledger", icon: Receipt, color: "#F59E0B" };
      case "due": return { title: "Due / Credit Bills", icon: Receipt, color: "#EF4444" };
      case "expense": return { title: "Showroom Operating Expenses", icon: Receipt, color: "#e11d48" };
      case "orders": return { title: "Total Sales Invoices", icon: Package, color: "#6b7280" };
      case "aov": return { title: "Average Order Value (AOV)", icon: IndianRupee, color: "#8b5cf6" };
      default: return { title: "General Report", icon: Wallet, color: "#6b7280" };
    }
  };

  const details = getReportDetails();
  const Icon = details.icon;

  const chartData = (stats?.dailyRevenue || []).map((day: any) => {
    let value = 0;
    if (reportType === "all" || reportType === "revenue") {
      value = day.revenue;
    } else if (reportType === "cash") {
      value = day.cash;
    } else if (reportType === "upi") {
      value = day.upi;
    } else if (reportType === "online") {
      value = day.online;
    } else if (reportType === "card") {
      value = day.card;
    } else if (reportType === "finance") {
      value = day.finance;
    } else if (reportType === "due") {
      value = day.due;
    } else if (reportType === "expense") {
      value = day.expense || 0;
    } else if (reportType === "orders") {
      value = day.profit; // total orders
    } else if (reportType === "aov") {
      value = day.profit ? day.revenue / day.profit : 0;
    } else {
      value = day.revenue; // fallback
    }
    return { date: day.date, value };
  });

  return (
    <div className="flex flex-col min-h-screen bg-slate-50/50 p-6">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push('/dashboard')} className="rounded-xl shadow-sm h-10">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
        {reportType === "expense" && (
          <Button onClick={() => router.push(`/purchase/expenses?dateFilter=${dateFilter}`)} className="bg-rose-600 hover:bg-rose-700 text-white font-bold h-10 rounded-xl shadow-sm">
            <Receipt className="w-4 h-4 mr-2" /> Open Full Expense Hub & Vouchers
          </Button>
        )}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
        <div className="p-6 border-b border-slate-100 flex items-center gap-4">
          <div className="p-3 rounded-xl text-white shadow-sm" style={{ backgroundColor: details.color }}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">{details.title}</h1>
            <p className="text-slate-500 font-medium mt-1">Detailed breakdown and trend analysis</p>
          </div>
        </div>

        {/* Date Filter & Chart Area */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6 items-center border-b border-slate-100">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Time Period</label>
            <DateRangeFilter 
              value={dateFilter} 
              onChange={handleDateChange} 
              showIcon={true} 
              className="w-[200px] h-10 rounded-xl"
            />
            
            <div className="mt-8">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
                {reportType === "orders" ? "Total Bills" : reportType === "aov" ? "Average Value" : "Total Amount"} ({dateFilter})
              </label>
              <div className="text-3xl font-extrabold text-slate-900">
                {loading ? "..." : 
                  reportType === "orders" ? 
                    getFilteredTransactions().length :
                  reportType === "aov" ?
                    formatCurrency(getFilteredTransactions().length ? getFilteredTransactions().reduce((acc: any, tx: any) => acc + (tx.amount || tx.total || 0), 0) / getFilteredTransactions().length : 0) :
                    formatCurrency(getFilteredTransactions().reduce((acc: any, tx: any) => acc + (tx.amount || tx.total || 0), 0))
                }
              </div>
            </div>
          </div>

          <div className="h-[220px] w-full pl-4 border-l border-slate-100">
            {loading ? (
              <div className="w-full h-full bg-slate-100 animate-pulse rounded-xl" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={details.color} stopOpacity={0.3}/>
                      <stop offset="95%" stopColor={details.color} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} tickFormatter={(val) => reportType === "orders" ? `${val}` : `₹${(val/1000).toFixed(0)}k`} />
                  <Tooltip 
                    cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
                  />
                  <Area type="monotone" dataKey="value" stroke={details.color} strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Search & Table */}
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-slate-800">Transaction Logs</h2>
            <div className="relative w-[320px]">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by customer name or invoice number..."
                className="pl-9 h-10 border-slate-200 rounded-xl bg-white shadow-sm focus-visible:ring-[#3F63AD]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="border border-slate-200 rounded-xl overflow-x-auto bg-white shadow-[0_2px_10px_rgb(0,0,0,0.02)]">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 uppercase text-[11px] tracking-wider">
                <tr>
                  <th className="p-4 whitespace-nowrap">Invoice #</th>
                  <th className="p-4">Customer</th>
                  <th className="p-4 whitespace-nowrap">Date / Time</th>
                  <th className="p-4 min-w-[140px]">Payment Mode</th>
                  <th className="p-4 text-right whitespace-nowrap">Amount</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="p-0"><TableShimmer rows={6} cols={7} /></td>
                  </tr>
                ) : getFilteredTransactions().length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-8 text-slate-500 font-medium">
                      No matching transactions found for this period.
                    </td>
                  </tr>
                ) : (
                  getFilteredTransactions().map((tx: any, idx: number) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                      <td className="p-4 font-bold text-[#3F63AD] cursor-pointer hover:underline whitespace-nowrap">
                        {tx.id || tx.invoiceNumber}
                      </td>
                      <td className="p-4 font-medium text-slate-800">{tx.customer || tx.customerName}</td>
                      <td className="p-4 text-slate-500">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span className="whitespace-nowrap">{tx.time || tx.date}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="inline-flex items-center px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap" title={tx.mode || tx.paymentTerms || "Cash"}>
                          {tx.mode || tx.paymentTerms || "Cash"}
                        </div>
                      </td>
                      <td className="p-4 font-bold text-right text-slate-900 text-[15px]">
                        {formatCurrency(tx.amount || tx.total)}
                      </td>
                      <td className="p-4 text-center">
                        <StatusBadge status={tx.status} />
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex items-center justify-center gap-2 transition-opacity">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-full border-slate-300 text-slate-600 hover:bg-slate-600 hover:text-white transition-all shadow-sm"
                            title="View Invoice Details"
                            onClick={() => openInvoicePreview(tx)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-full border-blue-200 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                            title="Print Invoice"
                            onClick={() => openInvoicePreview(tx)}
                          >
                            <Printer className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-full border-emerald-200 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                            title="Send WhatsApp Reminder"
                            onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Dear ${tx.customer || tx.customerName}, your payment of ${formatCurrency(tx.amount || tx.total)} has been received. Invoice: ${tx.id || tx.invoiceNumber}. Thank you!`)}`, '_blank')}
                          >
                            <Send className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          <div className="mt-4 flex items-center justify-between">
            <span className="text-slate-500 text-xs font-medium">
              Showing <span className="font-bold text-slate-700">{getFilteredTransactions().length}</span> entries
            </span>
            <ExportMenu
              size="sm"
              className="h-8 text-xs font-bold text-slate-700"
              title={details.title}
              subtitle={`${getFilteredTransactions().length} entries`}
              data={getFilteredTransactions().map((tx: any) => ({
                "Invoice/Ref #": tx.id || tx.invoiceNumber || "",
                "Customer": tx.customer || tx.customerName || "",
                "Date/Time": tx.time || tx.date || "",
                "Payment Mode": tx.mode || tx.paymentTerms || tx.paymentMode || "",
                "Amount": tx.amount || tx.total || 0,
                "Status": tx.status || "",
              }))}
              filename={`${reportType}-transactions-${dateFilter.replace(/\s+/g, "-")}`}
            />
          </div>
        </div>
      </div>

      {/* Full invoice preview — same read-only view used on the Invoices page,
          opened here instead of printing whatever this reports page itself
          currently shows. */}
      <Dialog open={!!activePrintInvoice} onOpenChange={() => setActivePrintInvoice(null)}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-2">
          {activePrintInvoice && <ValueplusInvoice invoiceData={activePrintInvoice} onBack={() => setActivePrintInvoice(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
