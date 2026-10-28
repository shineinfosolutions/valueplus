"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Dialog, DialogContent, DialogHeader, DialogTitle 
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Package, ShoppingBag, Truck, DollarSign, TrendingUp,
  ArrowDownRight, ArrowUpRight, Barcode, Calendar, RefreshCw,
  FileText, CheckCircle2, AlertTriangle, XCircle, Store, Warehouse
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";

interface ProductLedgerModalProps {
  isOpen: boolean;
  onClose: () => void;
  productIdentifier: {
    id?: string;
    code?: string;
    vpCode?: string;
    name?: string;
  } | null;
  startDate?: string;
  endDate?: string;
}

export function ProductLedgerModal({
  isOpen,
  onClose,
  productIdentifier,
  startDate,
  endDate,
}: ProductLedgerModalProps) {
  const [activeTab, setActiveTab] = useState("all");

  const queryParam = productIdentifier
    ? `code=${encodeURIComponent(productIdentifier.code || "")}&vpCode=${encodeURIComponent(productIdentifier.vpCode || "")}&name=${encodeURIComponent(productIdentifier.name || "")}&id=${encodeURIComponent(productIdentifier.id || "")}`
    : "";

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["product-ledger", productIdentifier?.id, productIdentifier?.code, productIdentifier?.vpCode, startDate, endDate],
    queryFn: async () => {
      if (!productIdentifier) return null;
      let url = `/api/reports/product-ledger?${queryParam}`;
      if (startDate && endDate) {
        url += `&startDate=${startDate}&endDate=${endDate}`;
      }
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to load product ledger");
      return json.data;
    },
    enabled: isOpen && !!productIdentifier,
  });

  const product = data?.product;
  const summary = data?.summary || {
    totalInwardQty: 0,
    totalInwardAmount: 0,
    totalSoldQty: 0,
    totalSoldRevenue: 0,
    totalProfit: 0,
    avgPurchaseRate: 0,
    avgSellingRate: 0,
    grossMarginPct: 0,
  };
  const transactions: any[] = data?.transactions || [];
  const serials: any[] = data?.serials || [];

  const salesTransactions = transactions.filter(t => t.type === "SALE_INVOICE");
  const purchaseTransactions = transactions.filter(t => t.type === "PURCHASE_INWARD" || t.type === "PURCHASE_RETURN");

  const isProfitable = summary.totalProfit >= 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 rounded-2xl border-none shadow-2xl bg-slate-50">
        {/* MODAL HEADER */}
        <div className="bg-[#30539C] text-white p-5 rounded-t-2xl relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-[#76C043] text-white font-mono font-bold text-xs">
                  {product?.vpCode || product?.code || "VP-ITEM"}
                </Badge>
                <Badge variant="outline" className="text-white/90 border-white/30 text-xs font-semibold">
                  {product?.brand}
                </Badge>
                <Badge variant="outline" className="text-white/90 border-white/30 text-xs font-semibold">
                  {product?.category}
                </Badge>
              </div>
              <h2 className="text-lg font-black tracking-tight mt-1.5 leading-snug">
                {product?.name || productIdentifier?.name || "Product Ledger"}
              </h2>
              <p className="text-xs text-white/80 mt-0.5">
                Complete financial history, unit purchases, retail sales & profit margin tracking
              </p>
            </div>

            <div className="flex items-center gap-2 self-start md:self-auto">
              <ExportMenu
                className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold"
                title={`${product?.name || productIdentifier?.name || "Product"} — Ledger`}
                subtitle={`${transactions.length} transactions`}
                data={transactions.map((t, idx) => ({
                  "#": idx + 1,
                  "Date": formatDate(t.date),
                  "Type": t.type,
                  "Ref #": t.refNo,
                  "Party (Customer/Supplier)": t.party,
                  "Qty In": t.qtyIn || 0,
                  "Qty Out": t.qtyOut || 0,
                  "Rate (₹)": t.rate,
                  "Cost Rate (₹)": t.costRate,
                  "Total Amount (₹)": t.amount,
                  "Profit on Sale (₹)": t.profit || 0,
                  "Margin %": t.marginPct ? `${t.marginPct}%` : "-",
                  "Payment Mode": t.paymentMode || "-",
                }))}
                filename={`product_ledger_${product?.vpCode || product?.code || "item"}`}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                disabled={isFetching}
                className="h-8 text-xs bg-white/10 hover:bg-white/20 text-white border-white/20 font-semibold"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 mr-1", isFetching && "animate-spin")} /> Refresh
              </Button>
            </div>
          </div>

          {/* STOCK STATUS BAR */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 pt-3 border-t border-white/15 text-xs">
            <div className="bg-black/20 p-2 rounded-lg">
              <span className="text-[10px] text-white/70 block uppercase font-bold">Total Stock</span>
              <span className="font-mono text-sm font-black text-white">{product?.currentStock ?? 0} {product?.unit}</span>
            </div>
            <div className="bg-black/20 p-2 rounded-lg">
              <span className="text-[10px] text-white/70 block uppercase font-bold flex items-center gap-1">
                <Store className="w-3 h-3 text-[#76C043]" /> Showroom Stock
              </span>
              <span className="font-mono text-sm font-black text-white">{product?.showroomStock ?? 0} {product?.unit}</span>
            </div>
            <div className="bg-black/20 p-2 rounded-lg">
              <span className="text-[10px] text-white/70 block uppercase font-bold flex items-center gap-1">
                <Warehouse className="w-3 h-3 text-amber-300" /> Godown Stock
              </span>
              <span className="font-mono text-sm font-black text-white">{product?.godownStock ?? 0} {product?.unit}</span>
            </div>
            <div className="bg-black/20 p-2 rounded-lg">
              <span className="text-[10px] text-white/70 block uppercase font-bold">Base Purchase Cost</span>
              <span className="font-mono text-sm font-black text-amber-300">{formatCurrency(product?.purchasePrice || 0)}</span>
            </div>
          </div>
        </div>

        {/* SUMMARY KPI CARDS */}
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total Inward */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <Truck className="w-3 h-3 text-blue-600" /> Total Inward (Purchased)
              </span>
              <p className="font-mono text-base font-black text-slate-900 mt-1">
                {summary.totalInwardQty} {product?.unit}
              </p>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                Cost: {formatCurrency(summary.totalInwardAmount)}
              </p>
            </div>

            {/* Total Sold */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <ShoppingBag className="w-3 h-3 text-purple-600" /> Total Sold Out
              </span>
              <p className="font-mono text-base font-black text-slate-900 mt-1">
                {summary.totalSoldQty} {product?.unit}
              </p>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                Revenue: {formatCurrency(summary.totalSoldRevenue)}
              </p>
            </div>

            {/* Avg Selling Price */}
            <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-emerald-600" /> Avg Selling Realized
              </span>
              <p className="font-mono text-base font-black text-slate-900 mt-1">
                {formatCurrency(summary.avgSellingRate)}
              </p>
              <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
                Cost Rate: {formatCurrency(summary.avgPurchaseRate)}
              </p>
            </div>

            {/* Total Profit */}
            <div className={cn(
              "p-3.5 rounded-xl border shadow-xs",
              isProfitable ? "bg-emerald-50/70 border-emerald-300" : "bg-rose-50/70 border-rose-300"
            )}>
              <span className="text-[10px] font-bold text-slate-600 uppercase flex items-center justify-between">
                <span>Net Generated Profit</span>
                <span className={cn("font-bold text-[10px]", isProfitable ? "text-emerald-700" : "text-rose-700")}>
                  {summary.grossMarginPct}%
                </span>
              </span>
              <p className={cn("font-mono text-base font-black mt-1", isProfitable ? "text-emerald-800" : "text-rose-800")}>
                {isProfitable ? "+" : ""}{formatCurrency(summary.totalProfit)}
              </p>
              <p className="text-[11px] text-slate-600 font-semibold mt-0.5">
                {isProfitable ? "Profitable Item" : "Loss-Making Margin"}
              </p>
            </div>
          </div>

          {/* TABS VIEW */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
            <TabsList className="bg-slate-200/80 p-1">
              <TabsTrigger value="all" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                All Transactions ({transactions.length})
              </TabsTrigger>
              <TabsTrigger value="sales" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                Sales Invoices ({salesTransactions.length})
              </TabsTrigger>
              <TabsTrigger value="purchases" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                Purchases Inward ({purchaseTransactions.length})
              </TabsTrigger>
              <TabsTrigger value="serials" className="text-xs font-bold data-[state=active]:bg-[#3F63AD] data-[state=active]:text-white">
                Serial / IMEI Units ({serials.length})
              </TabsTrigger>
            </TabsList>

            {/* TAB: ALL TRANSACTIONS */}
            <TabsContent value="all" className="m-0">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/90 text-slate-700 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Type</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Ref / Bill #</th>
                        <th className="px-3 py-2.5">Party (Customer / Supplier)</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">In</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Out</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Rate</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Total (₹)</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Profit / Loss (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {isLoading ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-500">
                            <RefreshCw className="w-4 h-4 animate-spin mx-auto text-[#3F63AD] mb-1" />
                            Loading product ledger transactions...
                          </td>
                        </tr>
                      ) : transactions.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-400 font-medium">
                            No purchase or sales transactions recorded for this product yet.
                          </td>
                        </tr>
                      ) : (
                        transactions.map((t, idx) => {
                          const isSale = t.type === "SALE_INVOICE";
                          const isPur = t.type === "PURCHASE_INWARD";
                          return (
                            <tr key={t.id || idx} className="hover:bg-slate-50">
                              <td className="px-3 py-2 font-mono text-[11px] text-slate-600 font-semibold whitespace-nowrap">
                                {formatDate(t.date)}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                {isSale && (
                                  <Badge className="bg-purple-50 text-purple-800 hover:bg-purple-50 text-[10px] font-bold border border-purple-200">
                                    SALE INVOICE
                                  </Badge>
                                )}
                                {isPur && (
                                  <Badge className="bg-blue-50 text-blue-800 hover:bg-blue-50 text-[10px] font-bold border border-blue-200">
                                    PURCHASE INWARD
                                  </Badge>
                                )}
                                {t.type === "PURCHASE_RETURN" && (
                                  <Badge className="bg-rose-50 text-rose-800 hover:bg-rose-50 text-[10px] font-bold border border-rose-200">
                                    DEBIT NOTE
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-slate-800 whitespace-nowrap">
                                {t.refNo}
                              </td>
                              <td className="px-3 py-2 font-semibold text-slate-700 max-w-[200px] truncate">
                                {t.party}
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-bold text-blue-700 whitespace-nowrap">
                                {t.qtyIn ? `+${t.qtyIn}` : "-"}
                              </td>
                              <td className="px-3 py-2 text-center font-mono font-bold text-rose-700 whitespace-nowrap">
                                {t.qtyOut ? `-${t.qtyOut}` : "-"}
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-slate-600 whitespace-nowrap">
                                {formatCurrency(t.rate)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                                {formatCurrency(t.amount)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">
                                {isSale ? (
                                  <span className={t.profit >= 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold"}>
                                    {t.profit >= 0 ? "+" : ""}{formatCurrency(t.profit)}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* TAB: SALES HISTORY */}
            <TabsContent value="sales" className="m-0">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/90 text-slate-700 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Invoice #</th>
                        <th className="px-3 py-2.5">Customer</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Qty</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Selling Rate</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Purchase Cost</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Net Profit (₹)</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Margin %</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Pay Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {salesTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-8 text-center text-slate-400">
                            No retail sales invoices recorded for this product yet.
                          </td>
                        </tr>
                      ) : (
                        salesTransactions.map((s, idx) => (
                          <tr key={s.id || idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600 font-semibold whitespace-nowrap">{formatDate(s.date)}</td>
                            <td className="px-3 py-2 font-mono font-bold text-[#3F63AD] whitespace-nowrap">{s.refNo}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800 max-w-[180px] truncate">{s.party}</td>
                            <td className="px-3 py-2 text-center font-mono font-bold whitespace-nowrap">{s.qtyOut}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">{formatCurrency(s.rate)}</td>
                            <td className="px-3 py-2 text-right font-mono text-slate-500 whitespace-nowrap">{formatCurrency(s.costRate)}</td>
                            <td className="px-3 py-2 text-right font-mono font-black text-emerald-700 whitespace-nowrap">
                              +{formatCurrency(s.profit)}
                            </td>
                            <td className="px-3 py-2 text-center font-mono font-bold text-slate-700 whitespace-nowrap">{s.marginPct}%</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <Badge variant="outline" className="text-[10px] uppercase font-bold text-slate-600 bg-slate-50">
                                {s.paymentMode}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* TAB: PURCHASES INWARD */}
            <TabsContent value="purchases" className="m-0">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/90 text-slate-700 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Bill / Inward #</th>
                        <th className="px-3 py-2.5">Supplier / Vendor</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Qty In</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Purchase Rate</th>
                        <th className="px-3 py-2.5 text-right whitespace-nowrap">Total Inward Cost</th>
                        <th className="px-3 py-2.5">Serials Logged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {purchaseTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            No inward purchase bills recorded for this product yet.
                          </td>
                        </tr>
                      ) : (
                        purchaseTransactions.map((p, idx) => (
                          <tr key={p.id || idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-[11px] text-slate-600 font-semibold whitespace-nowrap">{formatDate(p.date)}</td>
                            <td className="px-3 py-2 font-mono font-bold text-blue-900 whitespace-nowrap">{p.refNo}</td>
                            <td className="px-3 py-2 font-semibold text-slate-800 max-w-[180px] truncate">{p.party}</td>
                            <td className="px-3 py-2 text-center font-mono font-bold text-blue-700 whitespace-nowrap">+{p.qtyIn}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 whitespace-nowrap">{formatCurrency(p.rate)}</td>
                            <td className="px-3 py-2 text-right font-mono font-black text-amber-800 whitespace-nowrap">{formatCurrency(p.amount)}</td>
                            <td className="px-3 py-2 font-mono text-[10px] text-slate-600">
                              {p.serials?.length ? p.serials.join(", ") : "No IMEI"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>

            {/* TAB: SERIALS / IMEI INVENTORY */}
            <TabsContent value="serials" className="m-0">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="max-h-[380px] overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100/90 text-slate-700 font-bold uppercase text-[10px] sticky top-0 border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2.5 whitespace-nowrap">#</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Serial / IMEI Barcode</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Batch</th>
                        <th className="px-3 py-2.5 whitespace-nowrap">Stock Location</th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {serials.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-400">
                            No serial or IMEI numbers registered for this product yet.
                          </td>
                        </tr>
                      ) : (
                        serials.map((s, idx) => (
                          <tr key={s.serialNumber || idx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 font-mono text-slate-400 font-bold">{idx + 1}</td>
                            <td className="px-3 py-2 font-mono font-bold uppercase text-[#3F63AD]">{s.serialNumber}</td>
                            <td className="px-3 py-2 font-mono text-slate-600">{s.batchNo || "-"}</td>
                            <td className="px-3 py-2 font-medium text-slate-700">{s.warehouse || "Showroom"}</td>
                            <td className="px-3 py-2 text-center">
                              <Badge className={cn(
                                "text-[10px] font-bold uppercase border",
                                s.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-800 border-emerald-300" :
                                s.status === "SOLD" ? "bg-blue-50 text-blue-800 border-blue-300" :
                                s.status === "DEFECTIVE" ? "bg-rose-50 text-rose-800 border-rose-300" :
                                "bg-amber-50 text-amber-800 border-amber-300"
                              )}>
                                {s.status}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* MODAL FOOTER */}
        <div className="bg-slate-100 px-6 py-3 border-t border-slate-200 flex items-center justify-end rounded-b-2xl">
          <Button onClick={onClose} className="px-5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs">
            Close Ledger Window
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
