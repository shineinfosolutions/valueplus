"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Printer, Download, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { printElement } from "@/lib/printUtility";

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount || 0).replace("INR", "₹");
}

function StockTransferChallanContent() {
  const searchParams = useSearchParams();
  const transferNo = searchParams?.get("transferNo") || "";
  const printRef = useRef<HTMLDivElement>(null);

  const [transfer, setTransfer] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!transferNo) return;
    setLoading(true);
    fetch("/api/stock-transfers")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          const found = json.data.find((t: any) => t.transferNo === transferNo);
          setTransfer(found || null);
        }
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [transferNo]);

  const totalValue = useMemo(() => {
    if (!transfer) return 0;
    if (transfer.totalValue) return transfer.totalValue;
    return (transfer.items || []).reduce((sum: number, it: any) => sum + (it.costPrice || 0) * (it.quantity || 0), 0);
  }, [transfer]);

  const totalQty = useMemo(
    () => (transfer?.items || []).reduce((sum: number, it: any) => sum + (Number(it.quantity) || 0), 0),
    [transfer]
  );

  const handlePrint = () => {
    if (printRef.current) {
      printElement(printRef.current, `StockTransferChallan_${transferNo}`);
    } else {
      window.print();
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-xs font-bold text-slate-500">Loading transfer challan...</div>;
  }

  if (!transfer) {
    return (
      <div className="p-8 text-center text-sm text-slate-600">
        Transfer <span className="font-mono font-bold">{transferNo}</span> not found.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 print:p-0 print:min-h-0 print:bg-white text-slate-900 font-sans">
      {/* ─── ACTION BAR (HIDDEN IN PRINT) ────────────────────────── */}
      <div className="max-w-[860px] mx-auto mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <Link href="/inventory/transfer" className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" /> Stock Transfers List
          </Link>
          <span className="text-xs font-mono font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-md">
            Transfer No: {transfer.transferNo}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <Download className="w-3.5 h-3.5" /> Download PDF
          </button>
          <button onClick={handlePrint} className="px-4 py-1.5 rounded-lg bg-[#30539C] hover:bg-[#203a70] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <Printer className="w-3.5 h-3.5" /> Print Challan
          </button>
        </div>
      </div>

      {/* ─── CHALLAN DOCUMENT ───────────────────────────────────── */}
      <div
        ref={printRef}
        className="max-w-[860px] mx-auto bg-white border border-slate-400 p-8 shadow-xl print:border-none print:shadow-none print:p-0 print:m-0 print:max-w-none print:w-full text-[11px] leading-tight"
      >
        <div className="flex flex-col items-center justify-center pb-2 border-b border-slate-300">
          <div className="flex items-center text-3xl font-black tracking-tight">
            <span className="text-[#30539C]">VALUE</span>
            <span className="text-[#76C043]">PLUS</span>
          </div>
          <p className="text-[10px] text-slate-500 tracking-wider mt-0.5">plug into great experience |</p>
        </div>

        <div className="flex items-center justify-between py-2 border-b border-slate-400 font-bold">
          <span className="text-xs text-[#30539C] font-black uppercase tracking-wide">
            INTER-WAREHOUSE STOCK TRANSFER CHALLAN
            <span className="font-normal text-[10px] text-slate-600"> (Internal movement — not a sale)</span>
          </span>
          <span className="text-xs font-mono">
            Transfer No : <span className="text-black font-black">{transfer.transferNo}</span>
          </span>
          <span className="text-xs">
            Dated : <span className="font-mono">{transfer.date}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-400 text-[10px] divide-x divide-slate-400">
          <div className="p-2 space-y-1">
            <p className="font-bold border-b pb-0.5 uppercase text-slate-800">Dispatched From</p>
            <p className="font-black text-xs text-slate-900">{transfer.fromWarehouse}</p>
          </div>
          <div className="p-2 space-y-1">
            <p className="font-bold border-b pb-0.5 uppercase text-slate-800">Delivered To</p>
            <p className="font-black text-xs text-slate-900">{transfer.toWarehouse}</p>
          </div>
        </div>

        <div className="border-b border-slate-400">
          <table className="w-full text-left text-[10px] border-collapse">
            <thead>
              <tr className="border-b border-slate-400 font-bold bg-slate-50 text-slate-800">
                <th className="p-1 border-r border-slate-400 w-8 text-center">S.no</th>
                <th className="p-1 border-r border-slate-400">Item Name</th>
                <th className="p-1 border-r border-slate-400 text-center w-16">Unit</th>
                <th className="p-1 border-r border-slate-400 text-center w-16">Qty</th>
                <th className="p-1 border-r border-slate-400 text-right w-24">Cost Rate</th>
                <th className="p-1 text-right w-28">Cost Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300">
              {(transfer.items || []).map((it: any, idx: number) => (
                <tr key={idx}>
                  <td className="p-1 border-r border-slate-400 text-center font-bold">{idx + 1}</td>
                  <td className="p-1 border-r border-slate-400 font-medium text-slate-900">{it.itemName}</td>
                  <td className="p-1 border-r border-slate-400 text-center">{it.unit || "PCS"}</td>
                  <td className="p-1 border-r border-slate-400 text-center font-bold">{it.quantity}</td>
                  <td className="p-1 border-r border-slate-400 text-right font-mono">{formatCurrency(it.costPrice || 0)}</td>
                  <td className="p-1 text-right font-mono font-bold text-slate-900">
                    {formatCurrency((it.costPrice || 0) * (it.quantity || 0))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 font-bold bg-slate-50">
                <td colSpan={3} className="p-1 text-right border-r border-slate-400">Total</td>
                <td className="p-1 text-center border-r border-slate-400">{totalQty}</td>
                <td className="p-1 border-r border-slate-400"></td>
                <td className="p-1 text-right font-mono text-slate-900">{formatCurrency(totalValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="py-2 border-b border-slate-400 text-[10px]">
          <p>
            <span className="font-bold">Status:</span>{" "}
            <span className="font-bold uppercase">{transfer.status === "received" ? "Delivered & Received" : "In-Transit"}</span>
            {" • "}
            <span className="font-bold">Valuation:</span> At cost price — this is an internal stock movement between the business's own warehouses, not a sale.
          </p>
        </div>

        <div className="pt-2 flex items-center justify-between text-[8.5px] text-slate-500 font-mono">
          <span>Generated: {new Date().toLocaleString("en-IN")}</span>
          <span>Value Plus / Ashoka Enterprises, Gorakhpur</span>
        </div>
      </div>
    </div>
  );
}

export default function StockTransferChallanPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading transfer challan...</div>}>
      <StockTransferChallanContent />
    </Suspense>
  );
}
