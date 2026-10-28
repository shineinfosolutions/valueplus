"use client";

import React from "react";
import { Printer, Download, ArrowLeft, CheckCircle2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

function formatCurrency(val: number) {
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(val || 0);
}

interface FinanceDODocumentProps {
  data?: any;
  onBack?: () => void;
}

export function FinanceDODocument({ data, onBack }: FinanceDODocumentProps) {
  const doData = data || {
    financeProvider: "Bajaj Finance Limited",
    dealerName: "ASHOKA ENTERPRISES#GORAKHPUR UP#BPES CD#28900",
    customerId: "A144658860",
    atosDealId: "CS289666676227",
    date: "15/08/2026 01:08:44 PM",
    customerName: "Mohd Dilshad",
    doId: "B432262868",
    assetCategory: "LED",
    oemCategory: "LLOYD - LED",
    manufacturer: "HAVELLS INDIA LTD(Lloyd)",
    model: "LLOYD - LED - GL40F5L2RC",
    schemeCode: "5089897 (8/0)",
    productPrice: 21800.00,
    grossLoanAmount: 21800.00,
    netLoanAmount: 21800.00,
    marginMoney: 0,
    advanceEmi: 0,
    serviceCharge: 0,
    upfrontInterest: 0,
    dealerInterestSubsidy: 772.00,
    dealerSubsidyPercent: "3.54%",
    totalEmi: 2925.00,
    totalGst: 118.00,
    convenienceFee: 270.00,
    customerDownPayment: 270.00,
    totalDeductions: 1042.00,
    netDisbursement: 20758.00,
    deliveryAddress: "S/O NIZAMUDDIN 920 TURKMANPUR GITA,PRESS NEAR POST OFFICE GORAKHPUR, GORAKHPUR UTTAR PRADESH, Gita Press, 273005",
    customerMobile: "7525881666",
    signatoryName: "Aditya Saini5",
  };

  const handlePrint = () => {
    window.print();
  };

  const handleWhatsApp = () => {
    const phone = (doData.customerMobile || "").replace(/\D/g, "");
    const ph = phone.length === 10 ? `91${phone}` : phone;
    const msg = encodeURIComponent(
      `*VALUE PLUS / ASHOKA ENTERPRISES*\nOfficial Finance Delivery Order #${doData.doId}\nProvider: ${doData.financeProvider}\nCustomer: ${doData.customerName}\nProduct: ${doData.model || doData.productModel}\nLoan Approved: ₹${Number(doData.grossLoanAmount || 0).toLocaleString("en-IN")}\nDown Payment: ₹${Number(doData.customerDownPayment || 0).toLocaleString("en-IN")}\nDisbursement to Store: ₹${Number(doData.netDisbursement || 0).toLocaleString("en-IN")}\n\nYour product is ready for delivery at Value Plus Kunraghat Gorakhpur!`
    );
    window.open(ph ? `https://wa.me/${ph}?text=${msg}` : `https://wa.me/?text=${msg}`, "_blank");
  };

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 print:p-0 print:bg-white text-slate-900 font-sans">
      {/* ─── ACTION BAR (HIDDEN IN PRINT) ────────────────────────── */}
      <div className="max-w-[840px] mx-auto mb-6 bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button onClick={onBack} className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to List
            </button>
          ) : (
            <Link href="/finance/ledger" className="px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Back to Finance DOs
            </Link>
          )}
          <span className="text-xs font-mono font-bold text-slate-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-md">
            DO ID: {doData.doId}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleWhatsApp} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
          </button>
          <button onClick={handlePrint} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <Download className="w-3.5 h-3.5" /> Download PDF
          </button>
          <button onClick={handlePrint} className="px-4 py-1.5 rounded-lg bg-[#30539C] hover:bg-[#203a70] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm">
            <Printer className="w-3.5 h-3.5" /> Print Delivery Order
          </button>
        </div>
      </div>

      {/* ─── OFFICIAL DELIVERY ORDER DOCUMENT SPECIFICATION ─────── */}
      <div className="max-w-[840px] mx-auto bg-white border border-slate-400 p-8 shadow-xl print:border-none print:shadow-none print:p-0 print:m-0 text-[10px] leading-tight space-y-4">
        
        {/* PROVIDER HEADER */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold tracking-tight text-slate-900">{doData.financeProvider}</h2>
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 underline">DELIVERY ORDER</h3>
        </div>

        {/* METADATA BLOCK */}
        <div className="grid grid-cols-12 gap-2 pt-2 border-t border-slate-300">
          <div className="col-span-6 space-y-0.5">
            <p className="font-bold">Dear {doData.dealerName}</p>
          </div>
          <div className="col-span-6 grid grid-cols-2 text-right gap-1">
            <div>
              <span className="text-slate-500 block">Customer ID:</span>
              <span className="font-mono font-bold">{doData.customerId}</span>
            </div>
            <div>
              <span className="text-slate-500 block">ATOS Deal ID:</span>
              <span className="font-mono font-bold">{doData.atosDealId}</span>
            </div>
            <div className="col-span-2 text-right">
              <span className="text-slate-500">Date: </span>
              <span className="font-mono font-bold">{doData.date}</span>
            </div>
          </div>
        </div>

        <p className="text-slate-700 leading-normal">
          We are pleased to inform you that the loan application of <strong>Mr/Miss/Mrs. {doData.customerName}</strong> has been approved by {doData.financeProvider}. Disbursement Details are as follows:
        </p>

        {/* ASSET & FINANCIAL TABLE */}
        <table className="w-full border-collapse border border-slate-400 text-[9.5px]">
          <tbody>
            <tr className="border-b border-slate-400 bg-slate-50 font-bold">
              <td className="p-1 border-r border-slate-400 w-10"></td>
              <td className="p-1 border-r border-slate-400">DO ID:</td>
              <td className="p-1 border-r border-slate-400 font-mono font-black">{doData.doId}</td>
              <td className="p-1 text-right w-24">Total</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400"></td>
              <td className="p-1 border-r border-slate-400">Asset Category</td>
              <td className="p-1 border-r border-slate-400">{doData.assetCategory}</td>
              <td className="p-1 text-right"></td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400"></td>
              <td className="p-1 border-r border-slate-400">OEM Asset Category</td>
              <td className="p-1 border-r border-slate-400">{doData.oemCategory}</td>
              <td className="p-1 text-right"></td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400"></td>
              <td className="p-1 border-r border-slate-400">Manufacturer</td>
              <td className="p-1 border-r border-slate-400">{doData.manufacturer}</td>
              <td className="p-1 text-right"></td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400"></td>
              <td className="p-1 border-r border-slate-400">Model</td>
              <td className="p-1 border-r border-slate-400 font-bold">{doData.model}</td>
              <td className="p-1 text-right"></td>
            </tr>
            <tr className="border-b border-slate-400">
              <td className="p-1 border-r border-slate-400"></td>
              <td className="p-1 border-r border-slate-400">Scheme Code (GT/AE)</td>
              <td className="p-1 border-r border-slate-400 font-mono">{doData.schemeCode}</td>
              <td className="p-1 text-right"></td>
            </tr>

            {/* FINANCIAL ROWS */}
            <tr className="border-b border-slate-300 font-semibold">
              <td className="p-1 border-r border-slate-400 text-center font-bold">A</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Product Price</td>
              <td className="p-1 text-right font-mono font-bold">{formatCurrency(doData.productPrice)}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">B</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Gross Loan Amount</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.grossLoanAmount)}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">C</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Net Loan Amount</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.netLoanAmount)}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">D</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Margin Money</td>
              <td className="p-1 text-right font-mono">0.00</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">H</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Dealer Interest Subsidy value (%)</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.dealerInterestSubsidy)} ({doData.dealerSubsidyPercent})</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">P</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Total EMI</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.totalEmi)}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">U</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Total GST</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.totalGst)}</td>
            </tr>
            <tr className="border-b border-slate-300">
              <td className="p-1 border-r border-slate-400 text-center font-bold">W</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Convenience Fee Charges</td>
              <td className="p-1 text-right font-mono">{formatCurrency(doData.convenienceFee)}</td>
            </tr>
            <tr className="border-b border-slate-300 bg-amber-50/50 font-bold">
              <td className="p-1 border-r border-slate-400 text-center font-bold">Y</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>DP from Customer</td>
              <td className="p-1 text-right font-mono text-emerald-800">{formatCurrency(doData.customerDownPayment)}</td>
            </tr>
            <tr className="border-b border-slate-300 bg-slate-100 font-bold">
              <td className="p-1 border-r border-slate-400 text-center font-bold">Z</td>
              <td className="p-1 border-r border-slate-400" colSpan={2}>Total Deductions</td>
              <td className="p-1 text-right font-mono text-red-700">{formatCurrency(doData.totalDeductions)}</td>
            </tr>
            <tr className="border-b-2 border-slate-400 bg-emerald-50 font-black text-xs">
              <td className="p-1 border-r border-slate-400 text-center">AA</td>
              <td className="p-1 border-r border-slate-400 text-emerald-950" colSpan={2}>Net Disbursement</td>
              <td className="p-1 text-right font-mono text-emerald-900">{formatCurrency(doData.netDisbursement)}</td>
            </tr>
          </tbody>
        </table>

        {/* CALCULATION FORMULAS REFERENCE BOX (FIXED OVERLAPPING) */}
        <div className="border border-slate-400 bg-slate-50 p-2.5 rounded-sm text-[8px] font-mono leading-relaxed space-y-1.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
            <div className="break-words">
              <span className="font-bold text-slate-900">Margin Money (D): </span>
              <span className="text-slate-700">A − B</span>
            </div>
            <div className="break-words">
              <span className="font-bold text-slate-900">Down Payment (Y): </span>
              <span className="text-slate-700">D + E + F + G + J + AC + AD + K + M + N + V + W + AAB + CS − X − T − YY</span>
            </div>
            <div className="break-words">
              <span className="font-bold text-slate-900">Total Deductions (Z): </span>
              <span className="text-slate-700">D + E + F + G + H + I + J + AC + AD + L + M + N + V + W + AE + AAC + BBB + AB + XBA + YA + BA + TDS + CS</span>
            </div>
            <div className="break-words">
              <span className="font-bold text-slate-900">Net Disbursement (AA): </span>
              <span className="text-slate-700 font-bold text-emerald-900">A + X + YY − Z − TDS − CS − BB + BC</span>
            </div>
          </div>
        </div>

        {/* INSTRUCTIONS & DELIVERY ADDRESS */}
        <div className="space-y-2 pt-2 text-[9px] leading-relaxed">
          <p>
            The required formalities with the customer has been completed and hence we now request you to kindly collect the mentioned down payment and deliver the product.
          </p>
          <div className="p-2 bg-slate-50 border border-slate-300 rounded">
            <span className="font-bold block">Address of the customer for delivery:</span>
            <p className="text-slate-800">{doData.deliveryAddress}</p>
            <p className="mt-0.5"><span className="font-bold">Mobile Number:</span> <span className="font-mono">{doData.customerMobile}</span></p>
          </div>
          <p className="text-slate-700">
            On the delivery of the product kindly submit to us the invoice, with the agreed number of products duly receipted delivery challan and the down payment receipt for enabling us to release the disbursement.
          </p>
          <p className="text-slate-500 italic">
            Standard Delivery Fee is not part of the Loan and has to be collected by Dealer before delivery OR at the time of Delivery for Marketplace cases only.
          </p>
          <div className="pt-4 flex justify-between items-end">
            <div>
              <p>Thanking you.</p>
              <p className="font-bold mt-2">{doData.signatoryName}</p>
            </div>
            <div className="text-right">
              <span className="text-[8px] text-slate-400 font-mono">Verified Finance Authorization Record</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
