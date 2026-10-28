"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  Search, Printer, Eye, Sparkles, FileText, CheckCircle2, Clock, Plus,
  Building2, User, CreditCard, Receipt, MessageCircle, X, ShieldCheck,
  ExternalLink, ArrowDownLeft, Landmark, Tag, Calendar, Paperclip
} from "lucide-react";
import { FinanceDODocument } from "@/components/FinanceDODocument";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import Link from "next/link";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

const FINANCE_PROVIDERS = [
  "Bajaj Finance Limited",
  "HDB Financial Services",
  "IDFC First Bank",
  "TVS Credit",
  "Kotak Mahindra Prime",
  "PineLabs Consumer Finance",
  "HDFC Consumer Durable",
  "Home Credit India",
  "In-House Store EMI / Khata",
];

const ASSET_CATEGORIES = [
  "LED TV",
  "Smartphones / Mobile",
  "Air Conditioners (AC)",
  "Refrigerator",
  "Washing Machine",
  "Laptop / IT",
  "Audio / Home Theatre",
  "Microwave / Oven",
];

export default function FinanceLedgerStandalonePage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [bankFilter, setBankFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [startDate, setStartDate] = useState(() => resolveDateRange("This Month").start);
  const [endDate, setEndDate] = useState(() => resolveDateRange("This Month").end);
  
  const [selectedDO, setSelectedDO] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: financeRecords = [], isLoading } = useQuery({
    queryKey: ["financeRecords"],
    queryFn: async () => {
      const res = await fetch("/api/finance");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // New DO Form State
  const [form, setForm] = useState({
    financeProvider: "Bajaj Finance Limited",
    dealerName: "ASHOKA ENTERPRISES#GORAKHPUR UP#BPES CD#28900",
    customerId: `A${Math.floor(100000000 + Math.random() * 900000000)}`,
    atosDealId: `CS${Math.floor(100000000000 + Math.random() * 900000000000)}`,
    doId: `B${Math.floor(100000000 + Math.random() * 900000000)}`,
    date: new Date().toLocaleDateString("en-GB") + " " + new Date().toLocaleTimeString("en-US", { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    invoiceNumber: "",
    
    customerName: "",
    customerMobile: "",
    deliveryAddress: "H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR, 273008",
    
    assetCategory: "LED TV",
    oemCategory: "LLOYD - LED",
    manufacturer: "HAVELLS INDIA LTD(Lloyd)",
    brand: "Havells (Lloyd)",
    model: "LLOYD - LED - GL40F5L2RC",
    schemeCode: "5089897 (8/0)",
    
    productPrice: 21800,
    grossLoanAmount: 21800,
    netLoanAmount: 21800,
    marginMoney: 0,
    advanceEmi: 0,
    dealerInterestSubsidy: 772,
    dealerSubsidyPercent: "3.54%",
    totalEmi: 2725,
    totalGst: 118,
    convenienceFee: 270,
    customerDownPayment: 270,
    totalDeductions: 1042,
    netDisbursement: 20758,
    
    approvalStatus: "Approved",
    signatoryName: "Aditya Saini (Finance Desk)",
  });

  const updateFinancials = (price: number, dp: number, subsidy: number, fee: number) => {
    const grossLoan = price;
    const netLoan = Math.max(0, price - dp);
    const deductions = subsidy + fee;
    const netDisburse = Math.max(0, grossLoan - dp - subsidy);
    const totalEmiCalc = Math.round(netLoan / 8);

    setForm(prev => ({
      ...prev,
      productPrice: price,
      grossLoanAmount: grossLoan,
      netLoanAmount: netLoan,
      customerDownPayment: dp,
      dealerInterestSubsidy: subsidy,
      convenienceFee: fee,
      totalDeductions: deductions,
      netDisbursement: netDisburse,
      totalEmi: totalEmiCalc > 0 ? totalEmiCalc : prev.totalEmi,
    }));
  };

  const createDOMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create Finance DO");
      return json.data;
    },
    onSuccess: (savedDO) => {
      toast.success(`Finance Delivery Order ${savedDO.doId} generated successfully!`);
      queryClient.invalidateQueries({ queryKey: ["financeRecords"] });
      setIsModalOpen(false);
      setSelectedDO(savedDO);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save Finance DO");
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName.trim()) {
      toast.error("Customer Name is required");
      return;
    }
    if (!form.customerMobile || form.customerMobile.replace(/\D/g, '').length !== 10) {
      toast.error("10-digit Customer Mobile Number is required");
      return;
    }
    if (!form.model.trim()) {
      toast.error("Product Model Name is required");
      return;
    }

    createDOMutation.mutate(form);
  };

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

  // Filter logic
  const filtered = financeRecords.filter((rec: any) => {
    const matchesSearch = 
      (rec.doId || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.customerName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.customerMobile || "").includes(searchTerm) ||
      (rec.invoiceNumber || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.financeProvider || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.brand || rec.manufacturer || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (rec.model || rec.productModel || "").toLowerCase().includes(searchTerm.toLowerCase());

    const matchesBank = bankFilter === "all" || rec.financeProvider === bankFilter;
    const matchesStatus = statusFilter === "all" || rec.approvalStatus === statusFilter;
    const matchesDate = isDateInRange(rec.date || rec.createdAt, startDate, endDate);

    return matchesSearch && matchesBank && matchesStatus && matchesDate;
  });

  const totalDeals = filtered.length;
  const totalLoanVolume = filtered.reduce((acc: number, r: any) => acc + Number(r.grossLoanAmount || r.netLoanAmount || r.productPrice || 0), 0);
  const totalDownPayment = filtered.reduce((acc: number, r: any) => acc + Number(r.customerDownPayment || 0), 0);
  const totalDisbursement = filtered.reduce((acc: number, r: any) => acc + Number(r.netDisbursement || 0), 0);

  if (selectedDO) {
    return (
      <FinanceDODocument 
        data={selectedDO} 
        onBack={() => setSelectedDO(null)} 
      />
    );
  }

  return (
    <PageShell
      title="Finance Ledger & Delivery Orders"
      description="Official consumer loan ledger tracking finance banks, brands, DA numbers, customer down payments, and verified disbursement sheets."
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            size="sm"
            className="text-xs font-bold gap-1 shadow-xs"
            title="Finance Ledger & Delivery Orders"
            subtitle={`${filtered.length} records`}
            data={filtered.map((r: any, idx: number) => ({
              "S.No.": idx + 1,
              "Date": r.date,
              "Customer Name": r.customerName,
              "Mobile": r.customerMobile || "N/A",
              "Finance Bank": r.financeProvider,
              "Brand Name": r.brand || r.manufacturer || "N/A",
              "DA No / DO ID": r.doId,
              "Tax Invoice No": r.invoiceNumber || "N/A",
              "Product Model": r.model || r.productModel || "N/A",
              "Down Payment": r.customerDownPayment || 0,
              "Gross Loan": r.grossLoanAmount || r.productPrice || 0,
              "Net Disbursement": r.netDisbursement || 0,
              "Status": r.approvalStatus || "Approved",
            }))}
            filename={`ValuePlus_Finance_Ledger_${todayInIndia()}`}
          />
          <Button onClick={() => window.print()} variant="outline" size="sm" className="text-xs font-bold gap-1 shadow-xs">
            <Printer className="w-3.5 h-3.5" /> Print Ledger
          </Button>
          <Button onClick={() => setIsModalOpen(true)} className="bg-[#30539C] hover:bg-[#233e75] text-white text-xs font-bold gap-1.5 shadow-md">
            <Plus className="w-4 h-4" /> + Manual Finance DO
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* SUMMARY KPI CARDS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Finance Deals</span>
              <p className="text-2xl font-black text-slate-900 mt-1">{totalDeals}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#30539C] flex items-center justify-center">
              <Landmark className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Financed Volume</span>
              <p className="text-2xl font-black text-[#30539C] mt-1">{formatCurrency(totalLoanVolume)}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Down Payment Collected</span>
              <p className="text-2xl font-black text-emerald-700 mt-1">{formatCurrency(totalDownPayment)}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Net Bank Disbursement</span>
              <p className="text-2xl font-black text-orange-600 mt-1">{formatCurrency(totalDisbursement)}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
              <Sparkles className="w-5 h-5" />
            </div>
          </div>
        </div>

        {/* FILTERS & SEARCH TOOLBAR */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search customer, brand, DA No, invoice #, phone, bank..."
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

            <Select value={bankFilter} onValueChange={setBankFilter}>
              <SelectTrigger className="w-[185px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="All Finance Banks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🏦 All Finance Banks</SelectItem>
                {FINANCE_PROVIDERS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[125px] h-9 text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Under Review">Under Review</SelectItem>
                <SelectItem value="Disbursed">Disbursed</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* FINANCE LEDGER TABLE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="bg-slate-50/90 border-b border-slate-200 text-slate-600 uppercase font-bold text-[11px] tracking-wider">
                <tr>
                  <th className="py-3.5 px-3 text-center w-12 whitespace-nowrap align-middle">S.No.</th>
                  <th className="py-3.5 px-3 whitespace-nowrap align-middle">Date</th>
                  <th className="py-3.5 px-3 whitespace-nowrap align-middle">Customer Name</th>
                  <th className="py-3.5 px-3 whitespace-nowrap align-middle">Finance Bank</th>
                  <th className="py-3.5 px-3 whitespace-nowrap align-middle">Brand Name</th>
                  <th className="py-3.5 px-3 whitespace-nowrap align-middle">DA No. / DO ID</th>
                  <th className="py-3.5 px-3 text-right whitespace-nowrap align-middle">Down Payment (₹)</th>
                  <th className="py-3.5 px-3 text-right whitespace-nowrap align-middle">Finance Amount (₹)</th>
                  <th className="py-3.5 px-3 text-center whitespace-nowrap align-middle">Status</th>
                  <th className="py-3.5 px-3 text-right whitespace-nowrap align-middle">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-500 font-medium">
                      Loading Finance Ledger records...
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-12 text-center text-slate-500">
                      <Landmark className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                      <p className="font-bold text-sm text-slate-700">No finance records found</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                        Invoices with payment mode = Finance automatically populate here with full bank, brand and DA breakdown.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filtered.map((rec: any, idx: number) => {
                    const brandDisplay = rec.brand || rec.manufacturer || "Havells (Lloyd)";
                    const loanAmt = Number(rec.grossLoanAmount || rec.netLoanAmount || rec.productPrice || 0);
                    const dpAmt = Number(rec.customerDownPayment || 0);
                    const hasInvoice = Boolean(rec.invoiceNumber);

                    return (
                      <tr key={rec._id || rec.doId || idx} className="hover:bg-slate-50/90 transition-colors">
                        <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-500 align-middle whitespace-nowrap">
                          {idx + 1}
                        </td>
                        <td className="py-3.5 px-3 font-mono text-slate-600 whitespace-nowrap align-middle">
                          {rec.date ? rec.date.split(" ")[0] : "N/A"}
                        </td>
                        <td className="py-3.5 px-3 align-middle whitespace-nowrap">
                          <div className="font-bold text-slate-900 leading-tight">
                            {rec.customerName}
                          </div>
                          {rec.customerMobile && (
                            <span className="text-[10.5px] font-mono text-slate-500 block mt-0.5">
                              {rec.customerMobile}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 align-middle whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-50 text-[#30539C] border border-blue-200 shadow-2xs whitespace-nowrap">
                            🏦 {rec.financeProvider || "Bajaj Finance"}
                          </span>
                        </td>
                        <td className="py-3.5 px-3 align-middle whitespace-nowrap">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <span className="font-semibold text-slate-800 text-xs">
                              {brandDisplay}
                            </span>
                          </div>
                          {rec.model && (
                            <span className="text-[10px] text-slate-500 truncate max-w-[140px] block mt-0.5" title={rec.model}>
                              {rec.model}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 align-middle whitespace-nowrap">
                          <div className="flex flex-col">
                            <span 
                              onClick={() => setSelectedDO(rec)}
                              className="font-mono font-bold text-xs text-[#30539C] bg-blue-50/80 border border-blue-200 hover:bg-blue-100 px-2 py-0.5 rounded cursor-pointer transition-colors w-fit whitespace-nowrap"
                              title="Click to preview official DO Sheet"
                            >
                              {rec.doId}
                            </span>
                            {rec.atosDealId && (
                              <span className="text-[9.5px] text-slate-400 font-mono whitespace-nowrap mt-0.5">
                                Deal: {rec.atosDealId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-bold text-emerald-700 align-middle whitespace-nowrap">
                          ₹{dpAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono font-black text-slate-900 align-middle whitespace-nowrap">
                          ₹{loanAmt.toLocaleString("en-IN")}
                        </td>
                        <td className="py-3.5 px-3 text-center align-middle whitespace-nowrap">
                          <Badge className={
                            rec.approvalStatus === "Approved" ? "bg-emerald-100 text-emerald-800 border-emerald-200 text-[10.5px] px-2.5 py-0.5 whitespace-nowrap" :
                            rec.approvalStatus === "Disbursed" ? "bg-blue-100 text-blue-800 border-blue-200 text-[10.5px] px-2.5 py-0.5 whitespace-nowrap" :
                            rec.approvalStatus === "Under Review" ? "bg-purple-100 text-purple-800 border-purple-200 text-[10.5px] px-2.5 py-0.5 whitespace-nowrap" :
                            "bg-amber-100 text-amber-800 border-amber-200 text-[10.5px] px-2.5 py-0.5 whitespace-nowrap"
                          }>
                            {rec.approvalStatus || "Approved"}
                          </Badge>
                        </td>
                        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <Link
                              href="/finance/emi-cycles"
                              className="h-8 px-2.5 text-[11px] font-bold text-[#30539C] border border-blue-200 bg-white hover:bg-blue-50 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-2xs whitespace-nowrap shrink-0"
                            >
                              <Calendar className="w-3.5 h-3.5 text-[#30539C]" />
                              <span>EMI Schedule</span>
                            </Link>

                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedDO(rec)}
                              className="h-8 px-2.5 text-[11px] font-bold text-orange-800 border-orange-200 bg-orange-50/70 hover:bg-orange-100 rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <FileText className="w-3.5 h-3.5 text-orange-600" />
                              <span>DA Sheet</span>
                            </Button>

                            {hasInvoice && (
                              <Link
                                href={`/invoice?billid=${encodeURIComponent(rec.invoiceNumber)}`}
                                target="_blank"
                                className="h-8 px-2.5 text-[11px] font-bold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-2xs whitespace-nowrap shrink-0"
                              >
                                <Receipt className="w-3.5 h-3.5 text-[#30539C]" />
                                <span>Bill</span>
                              </Link>
                            )}

                            {rec.uploadedPdfUrl && (
                              <a
                                href={rec.uploadedPdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="h-8 px-2.5 text-[11px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-2xs whitespace-nowrap shrink-0"
                                title="View uploaded DO attachment"
                              >
                                <Paperclip className="w-3.5 h-3.5 text-emerald-600" />
                                <span>Attachment</span>
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MANUAL FINANCE DO MODAL */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 rounded-2xl shadow-2xl border-none">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-6 rounded-t-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Sparkles className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight flex items-center gap-2">
                  Create Finance Delivery Order (DO)
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#76C043]/20 text-[#76C043] border border-[#76C043]/30 font-mono font-bold">
                    OFFICIAL SPEC
                  </span>
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Generate verified DO sheets for Bajaj, HDB, IDFC, TVS & Kotak consumer durables
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsModalOpen(false)}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-6 bg-slate-50/50">
            {/* SECTION 1 */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#30539C]" /> 1. Provider & Identification
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <Label className="font-semibold text-slate-700">Finance Provider *</Label>
                  <Select value={form.financeProvider} onValueChange={(v) => setForm({ ...form, financeProvider: v })}>
                    <SelectTrigger className="mt-1 bg-slate-50 border-slate-300 font-bold text-[#30539C]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FINANCE_PROVIDERS.map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">DO ID (Reference) *</Label>
                  <Input value={form.doId} onChange={(e) => setForm({ ...form, doId: e.target.value })} className="mt-1 font-mono font-bold bg-slate-50" />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Customer ID (LAN)</Label>
                  <Input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} className="mt-1 font-mono bg-slate-50" />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">ATOS Deal ID</Label>
                  <Input value={form.atosDealId} onChange={(e) => setForm({ ...form, atosDealId: e.target.value })} className="mt-1 font-mono bg-slate-50" />
                </div>
              </div>
            </div>

            {/* SECTION 2 */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-[#30539C]" /> 2. Customer Particulars
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <Label className="font-semibold text-slate-700">Customer Name *</Label>
                  <Input 
                    placeholder="Full name as on Aadhaar/PAN"
                    value={form.customerName} 
                    onChange={(e) => setForm({ ...form, customerName: e.target.value })} 
                    className="mt-1 bg-slate-50" 
                  />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Mobile Number *</Label>
                  <Input 
                    placeholder="10-digit mobile"
                    value={form.customerMobile} 
                    onChange={(e) => setForm({ ...form, customerMobile: e.target.value })} 
                    className="mt-1 font-mono bg-slate-50" 
                  />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Linked Invoice #</Label>
                  <Input 
                    placeholder="e.g. SVAK2026RI00602"
                    value={form.invoiceNumber} 
                    onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })} 
                    className="mt-1 font-mono bg-slate-50 uppercase" 
                  />
                </div>
                <div className="sm:col-span-3">
                  <Label className="font-semibold text-slate-700">Delivery Address</Label>
                  <Input 
                    value={form.deliveryAddress} 
                    onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} 
                    className="mt-1 bg-slate-50" 
                  />
                </div>
              </div>
            </div>

            {/* SECTION 3 */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#30539C]" /> 3. Brand & Product Specifications
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <Label className="font-semibold text-slate-700">Brand Name *</Label>
                  <Input 
                    placeholder="e.g. Havells (Lloyd), Samsung, LG, Daikin"
                    value={form.brand} 
                    onChange={(e) => setForm({ ...form, brand: e.target.value, manufacturer: e.target.value })} 
                    className="mt-1 font-bold bg-slate-50" 
                  />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Asset Category</Label>
                  <Select value={form.assetCategory} onValueChange={(v) => setForm({ ...form, assetCategory: v })}>
                    <SelectTrigger className="mt-1 bg-slate-50"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSET_CATEGORIES.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Model Description *</Label>
                  <Input 
                    value={form.model} 
                    onChange={(e) => setForm({ ...form, model: e.target.value })} 
                    className="mt-1 font-bold bg-slate-50" 
                  />
                </div>
              </div>
            </div>

            {/* SECTION 4 */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-4">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-[#30539C]" /> 4. Financial Calculations & Net Disbursement
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <Label className="font-bold text-slate-700">Product Price (₹) *</Label>
                  <Input 
                    type="number" 
                    value={form.productPrice} 
                    onChange={(e) => updateFinancials(Number(e.target.value), form.customerDownPayment, form.dealerInterestSubsidy, form.convenienceFee)} 
                    className="mt-1 font-mono font-bold bg-slate-50" 
                  />
                </div>
                <div>
                  <Label className="font-bold text-emerald-800">Customer Down Payment (₹)</Label>
                  <Input 
                    type="number" 
                    value={form.customerDownPayment} 
                    onChange={(e) => updateFinancials(form.productPrice, Number(e.target.value), form.dealerInterestSubsidy, form.convenienceFee)} 
                    className="mt-1 font-mono font-bold text-emerald-800 bg-emerald-50/50" 
                  />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Dealer Subsidy (₹)</Label>
                  <Input 
                    type="number" 
                    value={form.dealerInterestSubsidy} 
                    onChange={(e) => updateFinancials(form.productPrice, form.customerDownPayment, Number(e.target.value), form.convenienceFee)} 
                    className="mt-1 font-mono bg-slate-50" 
                  />
                </div>
                <div>
                  <Label className="font-semibold text-slate-700">Convenience Fee (₹)</Label>
                  <Input 
                    type="number" 
                    value={form.convenienceFee} 
                    onChange={(e) => updateFinancials(form.productPrice, form.customerDownPayment, form.dealerInterestSubsidy, Number(e.target.value))} 
                    className="mt-1 font-mono bg-slate-50" 
                  />
                </div>
              </div>

              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between mt-2">
                <div>
                  <span className="text-xs font-semibold text-emerald-800 uppercase block">Net Store Disbursement (AA)</span>
                  <span className="text-[10.5px] text-emerald-600">Calculated after down payment & dealer deductions</span>
                </div>
                <span className="text-xl font-black font-mono text-emerald-900">
                  {formatCurrency(form.netDisbursement)}
                </span>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createDOMutation.isPending} className="bg-[#30539C] hover:bg-[#233e75] text-white font-bold px-6">
                {createDOMutation.isPending ? "Saving..." : "Save Finance DO"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
