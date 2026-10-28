"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Printer, Filter, Receipt, FileText, ArrowUpDown } from "lucide-react";
import { DateRangeFilter, resolveDateRange } from "@/components/shared/date-range-filter";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import Link from "next/link";
import { todayInIndia } from "@/lib/today";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(val || 0);
}

export default function SalesOutReportPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500">Loading Sales Out Report...</div>}>
      <SalesOutReportContent />
    </Suspense>
  );
}

function SalesOutReportContent() {
  const searchParams = useSearchParams();
  const initialDueOnly = searchParams.get("dueOnly") === "false" ? "all" : "due";
  const initialDateFilter = searchParams.get("dateFilter") || "This Month";
  const initialStartDate = searchParams.get("startDate") || resolveDateRange(initialDateFilter).start;
  const initialEndDate = searchParams.get("endDate") || resolveDateRange(initialDateFilter).end;

  const [searchTerm, setSearchTerm] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const [dueOnlyFilter, setDueOnlyFilter] = useState(initialDueOnly);
  const [staffFilter, setStaffFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(initialDateFilter);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [endDate, setEndDate] = useState(initialEndDate);

  useEffect(() => {
    const qDue = searchParams.get("dueOnly");
    if (qDue === "true") setDueOnlyFilter("due");
    else if (qDue === "false") setDueOnlyFilter("all");

    const qDate = searchParams.get("dateFilter");
    if (qDate) {
      setDateFilter(qDate);
      const qStart = searchParams.get("startDate");
      const qEnd = searchParams.get("endDate");
      if (qDate === "Custom Date" && qStart && qEnd) {
        setStartDate(qStart);
        setEndDate(qEnd);
      } else {
        const resolved = resolveDateRange(qDate);
        setStartDate(resolved.start);
        setEndDate(resolved.end);
      }
    }
  }, [searchParams]);

  const handleDateChange = (val: string, s?: string, e?: string) => {
    setDateFilter(val);
    if (val === "Custom Date" && s && e) {
      setStartDate(s);
      setEndDate(e);
    } else {
      const resolved = resolveDateRange(val);
      setStartDate(resolved.start);
      setEndDate(resolved.end);
    }
  };

  const { data: reportResponse, isLoading } = useQuery({
    queryKey: ["salesOutReport", bankFilter, dueOnlyFilter, staffFilter, startDate, endDate],
    queryFn: async () => {
      let url = "/api/reports/sales-out?";
      if (startDate && endDate) url += `startDate=${startDate}&endDate=${endDate}&`;
      if (bankFilter !== "all") url += `bank=${encodeURIComponent(bankFilter)}&`;
      if (dueOnlyFilter === "due") url += `dueOnly=true&`;
      if (staffFilter !== "all") url += `staff=${encodeURIComponent(staffFilter)}&`;
      const res = await fetch(url);
      return res.json();
    },
  });

  const reportData = reportResponse?.data || [];
  const summary = reportResponse?.summary || { totalInvoices: 0, totalAmount: 0, totalPaid: 0, totalDue: 0 };

  const filtered = reportData.filter((item: any) =>
    (item.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.billNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.customerPhone || "").includes(searchTerm) ||
    (item.financeProvider || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (item.staff || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exportData = filtered.map((i: any) => ({
    Due: i.due,
    Date: i.date,
    Amount: i.amount,
    "Bill Number": i.billNumber,
    "Customer Name": i.customerName,
    Mobile: i.customerPhone,
    Staff: i.staff,
    "Payment Mode": i.paymentMode,
    "Finance Bank": i.financeProvider || "N/A",
    "Paid Amount": i.paidAmount,
    "Due Amount": i.dueAmount,
    "Invoice Status": i.invoiceStatus,
    "Finance Status": i.financeStatus,
  }));
  const exportFilename = `ValuePlus_Sales_Out_Report_${todayInIndia()}`;

  return (
    <PageShell
      title="Sales Out Report"
      description="Commercial sales register showing due receivables, bill numbers, customer particulars, payment modes, and finance status."
    >
      <div className="space-y-4">
        {/* SUMMARY CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total Bills</span>
            <p className="text-2xl font-black text-slate-900 mt-1">{summary.totalInvoices}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total Sales Invoiced</span>
            <p className="text-2xl font-black text-[#3F63AD] mt-1">{formatCurrency(summary.totalAmount)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total Collections Received</span>
            <p className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(summary.totalPaid)}</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs font-semibold text-slate-500 uppercase">Total Outstanding Due</span>
            <p className="text-2xl font-black text-red-600 mt-1">{formatCurrency(summary.totalDue)}</p>
          </div>
        </div>

        {/* FILTERS & SEARCH */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search bill number, customer, phone, bank or staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangeFilter
              value={dateFilter}
              onChange={handleDateChange}
              className="w-[145px] h-9 text-xs"
            />

            {/* BANK & FINANCE PROVIDER FILTER */}
            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-[180px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="All Banks / Modes" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">🏦 All Banks & Modes</SelectItem>
                
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 mt-1 border-t border-b">
                  Finance Banks / Providers
                </div>
                <SelectItem value="Bajaj Finance Limited">Bajaj Finance Limited</SelectItem>
                <SelectItem value="HDB Financial Services">HDB Financial Services</SelectItem>
                <SelectItem value="IDFC First Bank">IDFC First Bank</SelectItem>
                <SelectItem value="TVS Credit">TVS Credit</SelectItem>
                <SelectItem value="Kotak Mahindra Prime">Kotak Mahindra Prime</SelectItem>
                <SelectItem value="Finance">All Finance DOs</SelectItem>

                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50 mt-1 border-t border-b">
                  Direct Payment Modes
                </div>
                <SelectItem value="Cash">Cash Counter</SelectItem>
                <SelectItem value="UPI">UPI / QR Code</SelectItem>
                <SelectItem value="Online">NEFT / IMPS</SelectItem>
                <SelectItem value="Card">Card (POS Swipe)</SelectItem>
              </SelectContent>
            </Select>

            <Select value={dueOnlyFilter} onValueChange={setDueOnlyFilter}>
              <SelectTrigger className="w-[125px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="Due Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="due">Due Only</SelectItem>
                <SelectItem value="all">All Bills</SelectItem>
              </SelectContent>
            </Select>

            <ExportMenu
              className="text-xs font-bold gap-1"
              title="Sales Out Report"
              subtitle={`${summary.totalInvoices} bills`}
              data={exportData}
              filename={exportFilename}
            />
            <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs font-bold gap-1">
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
          </div>
        </div>

        {/* PRIMARY SALES OUT TABLE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold">
              <tr>
                <th className="p-3 text-right">Due (₹)</th>
                <th className="p-3">Date</th>
                <th className="p-3 text-right">Amount (₹)</th>
                <th className="p-3">Bill Number</th>
                <th className="p-3">Customer Name</th>
                <th className="p-3">Mobile</th>
                <th className="p-3">Staff</th>
                <th className="p-3">Payment / Bank</th>
                <th className="p-3 text-right">Paid (₹)</th>
                <th className="p-3 text-center">Finance Status</th>
                <th className="p-3 text-center">Invoice Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-sans">
              {isLoading ? (
                <tr><td colSpan={12} className="p-0"><TableShimmer rows={7} cols={12} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={12} className="p-6 text-center text-slate-500">No sales transactions match the criteria.</td></tr>
              ) : (
                filtered.map((r: any, idx: number) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors">
                    {/* Due */}
                    <td className="p-3 text-right font-mono font-bold">
                      {r.due > 0 ? (
                        <span className="text-red-600 font-black">₹{r.due?.toLocaleString("en-IN")}</span>
                      ) : (
                        <span className="text-emerald-700">₹0</span>
                      )}
                    </td>
                    {/* Date */}
                    <td className="p-3 font-mono text-slate-600">{r.date}</td>
                    {/* Amount */}
                    <td className="p-3 text-right font-mono font-black text-slate-900">
                      ₹{r.amount?.toLocaleString("en-IN")}
                    </td>
                    {/* Bill Number */}
                    <td className="p-3 font-mono font-bold text-[#3F63AD]">
                      <Link href={`/invoice?billid=${encodeURIComponent(r.billNumber)}`} className="hover:underline">
                        {r.billNumber}
                      </Link>
                    </td>
                    {/* Customer Name */}
                    <td className="p-3 font-bold text-slate-900">{r.customerName}</td>
                    {/* Mobile */}
                    <td className="p-3 font-mono text-slate-600">{r.customerPhone}</td>
                    {/* Staff */}
                    <td className="p-3 text-slate-700">{r.staff}</td>
                    {/* Payment Mode / Bank */}
                    <td className="p-3">
                      <div className="flex flex-col gap-0.5">
                        <Badge variant="outline" className="font-bold text-slate-800 uppercase text-[10px] w-fit">
                          {r.paymentMode}
                        </Badge>
                        {r.financeProvider && (
                          <span className="text-[10.5px] text-orange-700 font-semibold truncate max-w-[140px]" title={r.financeProvider}>
                            {r.financeProvider}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Paid Amount */}
                    <td className="p-3 text-right font-mono text-emerald-800 font-bold">
                      ₹{r.paidAmount?.toLocaleString("en-IN")}
                    </td>
                    {/* Finance Status */}
                    <td className="p-3 text-center">
                      <Badge className={
                        r.financeStatus === "Approved" ? "bg-emerald-100 text-emerald-800 text-[10px]" :
                        r.financeStatus === "Pending" ? "bg-amber-100 text-amber-800 text-[10px]" :
                        "bg-slate-100 text-slate-600 text-[10px]"
                      }>
                        {r.financeStatus}
                      </Badge>
                    </td>
                    {/* Invoice Status */}
                    <td className="p-3 text-center">
                      <Badge className={r.invoiceStatus === "paid" ? "bg-emerald-100 text-emerald-800" : "bg-blue-100 text-blue-800"}>
                        {r.invoiceStatus}
                      </Badge>
                    </td>
                    {/* Action */}
                    <td className="p-3 text-right">
                      <Link
                        href={`/invoice?billid=${encodeURIComponent(r.billNumber)}`}
                        className="text-xs font-bold text-[#3F63AD] hover:underline"
                      >
                        View Bill
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
