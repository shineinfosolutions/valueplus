"use client";

import React, { useState, useMemo } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery } from "@tanstack/react-query";
import { 
  Award, TrendingUp, DollarSign, Users, Calendar,
  Search, Filter, Receipt, ChevronRight, ShieldCheck, Sparkles, Trophy, User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import ValueplusInvoice from "@/app/invoice/page";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useSession } from "next-auth/react";
import { TableShimmer, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function SalesIncentivesPage() {
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const currentUserName = session?.user?.name || "Sales Executive";
  const isIndividualSalesman = userRole === "salesman" || userRole === "cashier" || userRole === "sales";

  const [search, setSearch] = useState("");
  const [selectedStaff, setSelectedStaff] = useState(isIndividualSalesman ? currentUserName : "all");
  const [viewInvoice, setViewInvoice] = useState<any | null>(null);

  // Fetch all invoices
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Calculate incentive aggregation
  const staffSummary = useMemo(() => {
    const map: Record<string, {
      name: string;
      totalInvoices: number;
      totalSales: number;
      totalUnits: number;
      totalIncentive: number;
      invoices: any[];
    }> = {};

    invoices.forEach((inv: any) => {
      if (inv.type === "credit-note") return; // exclude credit notes
      const exec = (inv.salesExecutive || "Counter / Direct").trim();

      // If individual salesman, skip invoices not belonging to them
      if (isIndividualSalesman) {
        const firstName = currentUserName.toLowerCase().split(" ")[0];
        if (!exec.toLowerCase().includes(firstName) && exec.toLowerCase() !== currentUserName.toLowerCase()) {
          return;
        }
      }

      if (!map[exec]) {
        map[exec] = {
          name: exec,
          totalInvoices: 0,
          totalSales: 0,
          totalUnits: 0,
          totalIncentive: 0,
          invoices: []
        };
      }

      const invIncentive = Number(inv.salesExecutiveIncentive) || 0;
      const invTotal = Number(inv.total) || 0;
      const units = (inv.items || []).reduce((acc: number, it: any) => acc + (Number(it.quantity) || 1), 0);

      map[exec].totalInvoices += 1;
      map[exec].totalSales += invTotal;
      map[exec].totalUnits += units;
      map[exec].totalIncentive += invIncentive;
      map[exec].invoices.push(inv);
    });

    return Object.values(map).sort((a, b) => b.totalIncentive - a.totalIncentive);
  }, [invoices, isIndividualSalesman, currentUserName]);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv: any) => {
      if (inv.type === "credit-note") return false;
      const exec = (inv.salesExecutive || "").toLowerCase();
      const num = (inv.invoiceNumber || "").toLowerCase();
      const cust = (inv.customerName || "").toLowerCase();
      const q = search.toLowerCase();

      // If individual salesman, only return their invoices
      if (isIndividualSalesman) {
        const firstName = currentUserName.toLowerCase().split(" ")[0];
        if (!exec.includes(firstName) && exec !== currentUserName.toLowerCase()) {
          return false;
        }
      }

      const matchesSearch = !search || exec.includes(q) || num.includes(q) || cust.includes(q);
      const matchesStaff = selectedStaff === "all" || (inv.salesExecutive || "Counter / Direct") === selectedStaff;
      
      return matchesSearch && matchesStaff;
    });
  }, [invoices, search, selectedStaff, isIndividualSalesman, currentUserName]);

  // Overall KPIs
  const totalIncentivePaid = useMemo(() => {
    return staffSummary.reduce((acc, s) => acc + s.totalIncentive, 0);
  }, [staffSummary]);

  const totalStaffRevenue = useMemo(() => {
    return staffSummary.reduce((acc, s) => acc + s.totalSales, 0);
  }, [staffSummary]);

  const topPerformer = staffSummary[0] || null;

  return (
    <PageShell
      title={isIndividualSalesman ? "My Sales Incentives & Commission Ledger" : "Salesperson Incentives Master"}
      subtitle={
        isIndividualSalesman
          ? `Personal incentive wallet, commission earned per invoice, and target performance for ${currentUserName}.`
          : "Super Admin & HR View: Track sales commission, commission earned per invoice, floor-price unlocks, and top performers across all branches."
      }
      breadcrumbs={[{ label: isIndividualSalesman ? "My Panel" : "Staff & Operations" }, { label: "Sales Incentives" }]}
      actions={
        <ExportMenu
          size="sm"
          className="border-slate-300 font-semibold gap-1.5"
          title={isIndividualSalesman ? "My Sales Incentives" : "Salesperson Incentives Report"}
          subtitle={`${filteredInvoices.length} invoices`}
          data={filteredInvoices.map((inv: any) => ({
            InvoiceNumber: inv.invoiceNumber,
            Date: formatDate(inv.date),
            SalesExecutive: inv.salesExecutive || "N/A",
            CustomerName: inv.customerName,
            TotalBillAmount: inv.total,
            SalespersonIncentive: inv.salesExecutiveIncentive || 0,
            AdminPINUsed: inv.adminOverridePinUsed ? "YES" : "NO",
            PaymentMode: inv.paymentMode
          }))}
          filename={isIndividualSalesman ? "my_sales_incentives" : "salesperson_incentives_report"}
        />
      }
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isIndividualSalesman ? "My Total Earned Incentive" : "Total Incentive Pool"}
            </p>
            <h3 className="text-2xl font-black text-emerald-600 mt-1">{formatCurrency(totalIncentivePaid)}</h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">
              {isIndividualSalesman ? "Credited to your monthly payout" : "Across all store sales staff"}
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
            <Award className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isIndividualSalesman ? "My Gross Sales Generated" : "Staff Driven Revenue"}
            </p>
            <h3 className="text-2xl font-black text-[#3F63AD] mt-1">{formatCurrency(totalStaffRevenue)}</h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Delivered sales volume</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-[#3F63AD]">
            <TrendingUp className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isIndividualSalesman ? "My Total Sold Units" : "Top Incentive Earner"}
            </p>
            <h3 className="text-lg font-black text-amber-900 mt-1 truncate max-w-[170px]">
              {isIndividualSalesman ? `${topPerformer?.totalUnits || 0} Appliances` : topPerformer?.name || "None"}
            </h3>
            <p className="text-[11px] text-amber-700 mt-1 font-bold">
              {isIndividualSalesman ? "Qualifying target products" : `${formatCurrency(topPerformer?.totalIncentive || 0)} earned`}
            </p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600">
            <Trophy className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {isIndividualSalesman ? "My Closed Invoices" : "Total Sales Invoices"}
            </p>
            <h3 className="text-2xl font-black text-slate-800 mt-1">{filteredInvoices.length}</h3>
            <p className="text-[11px] text-slate-500 mt-1 font-medium">Billed with executive tracking</p>
          </div>
          <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
            <Receipt className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Staff Incentive Summary / Personal Scorecard */}
      <div className="bg-gradient-to-r from-[#1B2537] to-[#253959] text-white p-6 rounded-2xl shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h3 className="font-extrabold text-base tracking-wide">
              {isIndividualSalesman ? `Personal Incentive Scorecard: ${currentUserName}` : "Sales Executive Incentive Leaderboard"}
            </h3>
          </div>
          <span className="text-xs bg-white/10 px-3 py-1 rounded-full text-slate-200 font-semibold border border-white/10">
            Live Commission Status
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
          {staffSummary.map((staff, idx) => (
            <div 
              key={staff.name} 
              className={cn(
                "p-4 rounded-xl border transition-all relative overflow-hidden",
                idx === 0 
                  ? "bg-amber-500/15 border-amber-400/40 shadow-lg" 
                  : "bg-white/5 border-white/10 hover:bg-white/10"
              )}
            >
              {idx === 0 && (
                <div className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-black text-amber-400 uppercase bg-amber-400/20 px-2 py-0.5 rounded-full">
                  <Sparkles className="w-3 h-3" /> Top #1
                </div>
              )}
              <p className="text-sm font-black text-white truncate max-w-[160px]">{staff.name}</p>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="text-xs text-slate-400">Earned:</span>
                <span className="text-lg font-black text-emerald-400">{formatCurrency(staff.totalIncentive)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-300 font-mono">
                <span>{staff.totalInvoices} Invoices</span>
                <span>{formatCurrency(staff.totalSales)} Sales</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Invoice Commission Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b pb-4">
          <div>
            <h3 className="font-extrabold text-slate-900 text-base">
              {isIndividualSalesman ? "My Itemized Sales Commission Ledger" : "Itemized Sales Commission Ledger"}
            </h3>
            <p className="text-xs text-slate-500">
              {isIndividualSalesman
                ? `Showing ${filteredInvoices.length} invoices closed by ${currentUserName}`
                : "Commission breakdown per invoice based on target rules"}
            </p>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search Invoice # or Customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 border-b text-slate-600 uppercase font-bold">
              <tr>
                <th className="p-3 text-left">Invoice No & Date</th>
                <th className="p-3 text-left">Customer Name</th>
                {!isIndividualSalesman && <th className="p-3 text-left">Sales Executive</th>}
                <th className="p-3 text-right">Invoice Total (₹)</th>
                <th className="p-3 text-center">Floor-Price Override</th>
                <th className="p-3 text-right">Incentive Earned (₹)</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="p-0"><TableShimmer rows={6} cols={7} /></td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <Award className="w-8 h-8 mx-auto text-amber-500 mb-1 opacity-60" />
                    <p className="font-bold text-slate-700">No Invoices Found</p>
                    <p className="text-[11px] text-slate-400">Invoices billed with this salesperson will appear here with calculated incentives.</p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map((inv: any) => {
                  const incAmount = Number(inv.salesExecutiveIncentive) || 0;
                  return (
                    <tr key={inv._id || inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono font-bold text-[#30539C]">
                        {inv.invoiceNumber}
                        <span className="block text-[10px] font-sans font-normal text-slate-400">{formatDate(inv.date)}</span>
                      </td>

                      <td className="p-3 font-medium text-slate-900">
                        {inv.customerName}
                        {inv.customerPhone && (
                          <span className="block text-[10px] text-slate-400 font-mono">+91 {inv.customerPhone}</span>
                        )}
                      </td>

                      {!isIndividualSalesman && (
                        <td className="p-3 font-semibold text-slate-700">
                          {inv.salesExecutive || "Counter / Direct"}
                        </td>
                      )}

                      <td className="p-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(Number(inv.total) || 0)}
                      </td>

                      <td className="p-3 text-center">
                        {inv.adminOverridePinUsed ? (
                          <Badge variant="warning" className="text-[9.5px] font-bold">
                            PIN OVERRIDE
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Standard</span>
                        )}
                      </td>

                      <td className="p-3 text-right font-mono font-bold text-emerald-600 text-sm">
                        {incAmount > 0 ? `+${formatCurrency(incAmount)}` : "—"}
                      </td>

                      <td className="p-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setViewInvoice(inv)}
                          className="h-7 px-2 text-[11px] font-bold text-[#30539C] hover:bg-blue-50"
                        >
                          View Bill
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

      {/* INVOICE PREVIEW MODAL */}
      <Dialog open={!!viewInvoice} onOpenChange={() => setViewInvoice(null)}>
        <DialogContent className="max-w-4xl p-0 overflow-y-auto rounded-2xl max-h-[90vh] overflow-y-auto">
          {viewInvoice && <ValueplusInvoice invoiceData={viewInvoice} onBack={() => setViewInvoice(null)} />}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
