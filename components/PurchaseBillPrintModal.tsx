"use client";

import React, { useRef } from "react";
import { 
  Printer, 
  Download, 
  Share2, 
  MessageSquare, 
  Building2, 
  Truck, 
  FileText, 
  Calendar, 
  CheckCircle2, 
  X,
  CreditCard
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/utils";
import { printElement } from "@/lib/printUtility";

function numberToWordsIndian(num: number): string {
  const a = ['', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ', 'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ', 'Seventeen ', 'Eighteen ', 'Nineteen '];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    const digit = n % 10;
    return b[Math.floor(n / 10)] + (digit ? ' ' + a[digit] : '');
  };

  if (num === 0) return 'Rupees Zero Only';

  let n = Math.floor(Math.abs(num));
  let str = '';

  if (Math.floor(n / 10000000) > 0) {
    str += inWords(Math.floor(n / 10000000)) + 'Crore ';
    n %= 10000000;
  }
  if (Math.floor(n / 100000) > 0) {
    str += inWords(Math.floor(n / 100000)) + 'Lakh ';
    n %= 100000;
  }
  if (Math.floor(n / 1000) > 0) {
    str += inWords(Math.floor(n / 1000)) + 'Thousand ';
    n %= 1000;
  }
  if (Math.floor(n / 100) > 0) {
    str += inWords(Math.floor(n / 100)) + 'Hundred ';
    n %= 100;
  }
  if (n > 0) {
    if (str !== '') str += 'and ';
    str += inWords(n);
  }

  return `${str.trim()} Rupees Only`;
}

interface PurchaseBillPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  billData: any;
}

export function PurchaseBillPrintModal({ isOpen, onClose, billData }: PurchaseBillPrintModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  if (!billData) return null;

  const items = Array.isArray(billData.items) && billData.items.length > 0
    ? billData.items
    : [
        {
          name: billData.itemName || "Inward Goods / Electronic Appliance Supplies",
          quantity: billData.quantity || 1,
          rate: Number(billData.rate || billData.subtotal || billData.total || 0),
          gstRate: Number(billData.gstRate || 18),
          hsnCode: "8528",
        }
      ];

  // Calculate dynamic totals from items so it never displays ₹0 when items are present
  const computedTaxableSubtotal = items.reduce((sum: number, line: any) => {
    const qty = Number(line.quantity || line.qty || 1);
    const rate = Number(line.rate || line.purchasePrice || line.price || 0);
    return sum + (qty * rate);
  }, 0);

  const computedGst = items.reduce((sum: number, line: any) => {
    const qty = Number(line.quantity || line.qty || 1);
    const rate = Number(line.rate || line.purchasePrice || line.price || 0);
    const gstRate = Number(line.gstRate ?? line.taxRate ?? 18);
    return sum + ((qty * rate * gstRate) / 100);
  }, 0);

  const subtotal = Number(billData.subtotal) > 0 ? Number(billData.subtotal) : (Number(billData.taxableAmount) > 0 ? Number(billData.taxableAmount) : computedTaxableSubtotal);
  const gst = Number(billData.gst) > 0 ? Number(billData.gst) : (Number(billData.totalTax) > 0 ? Number(billData.totalTax) : computedGst);
  const total = Number(billData.total) > 0 ? Number(billData.total) : (Number(billData.totalAmount) > 0 ? Number(billData.totalAmount) : (subtotal + gst));
  const paid = Number(billData.paid ?? (billData.status === "paid" ? total : 0));
  const balance = Number(billData.balance ?? Math.max(0, total - paid));

  // Debit notes are stored as the same PurchaseEntry document with
  // type: "debit-note", so this already tells the two apart with no new prop —
  // an ordinary purchase entry's `type` is "entry" and every existing caller
  // keeps seeing the exact wording it always has.
  const isDebitNote = billData.type === "debit-note";
  const docLabel = isDebitNote ? "DEBIT NOTE / RETURN VOUCHER" : "PURCHASE INWARD VOUCHER";

  const handlePrint = () => {
    if (printRef.current) {
      printElement(printRef.current, `${isDebitNote ? "DebitNote" : "PurchaseInvoice"}_${billData.billNo || billData.billNumber || "ValuePlus"}`);
    } else {
      window.print();
    }
  };

  const handleWhatsAppShare = () => {
    const text = `*${docLabel} - VALUE PLUS*\nBill No: ${billData.billNo || billData.billNumber}\nSupplier: ${billData.supplierName}\nDate: ${billData.billDate || billData.date || "Today"}\nTotal Amount: ${formatCurrency(total)}\nStatus: ${billData.status || "Paid"}\nThank you!`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[96vh] p-0 overflow-y-auto border-none shadow-2xl rounded-2xl print:m-0 print:p-0 print:max-w-none print:shadow-none print:bg-white">
        {/* Top Floating Action Bar (Hidden during Print) */}
        <div className="sticky top-0 z-50 bg-[#1B2537] text-white px-6 py-3.5 flex items-center justify-between shadow-md print:hidden border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <span className="font-mono font-black text-xs bg-[#76C043] text-white px-2.5 py-1 rounded-md shadow-xs">
              {billData.billNo || billData.billNumber || "BILL-001"}
            </span>
            <span className="text-sm font-bold text-slate-100">
              {isDebitNote ? "Debit Note / Return Voucher" : "Supplier Purchase Invoice Voucher"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold h-8 text-xs px-3.5 shadow-sm flex items-center gap-1.5"
            >
              <Printer className="w-3.5 h-3.5" />
              Print / Save PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleWhatsAppShare}
              className="bg-white/10 hover:bg-white/20 text-white border-white/20 h-8 text-xs px-3"
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              WhatsApp
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 text-slate-400 hover:text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* ─── PRINTABLE BILL CONTAINER ──────────────────────────────── */}
        <div 
          ref={printRef}
          className="p-8 bg-white text-slate-900 font-sans text-xs leading-tight space-y-4 print:p-0 print:m-0"
        >
          {/* TOP HEADER: BRAND LOGO */}
          <div className="flex flex-col items-center justify-center pb-2 border-b border-slate-300">
            <div className="flex items-center text-3xl font-black tracking-tight">
              <span className="text-[#30539C]">VALUE</span>
              <span className="text-[#76C043]">PLUS</span>
            </div>
            <p className="text-[10px] text-slate-500 tracking-wider mt-0.5">plug into great experience |</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-[1px] w-6 bg-slate-400" />
              <span className="text-xs font-bold text-slate-800 tracking-wider font-hindi">— रिश्ता विश्वास का —</span>
              <span className="h-[1px] w-6 bg-slate-400" />
            </div>
          </div>

          {/* DOCUMENT TITLE & META ROW */}
          <div className="flex items-center justify-between py-2 border-b border-slate-400 font-bold">
            <span className="text-xs text-slate-900 font-black uppercase tracking-wide">
              {isDebitNote ? (
                <>DEBIT NOTE / RETURN VOUCHER <span className="font-normal text-[10px] text-slate-600">(Goods Returned to Supplier)</span></>
              ) : (
                <>PURCHASE INWARD INVOICE VOUCHER <span className="font-normal text-[10px] text-slate-600">(Goods Receipt Note)</span></>
              )}
            </span>
            <span className="text-xs font-mono">
              Voucher / Bill No: <span className="text-[#30539C] font-black">{billData.billNo || billData.billNumber}</span>
            </span>
            <span className="text-xs">Dated: <span className="font-mono">{formatDate(billData.billDate || billData.date || new Date())}</span></span>
          </div>

          {/* COMPANY & STORE LOCATION DETAILS */}
          <div className="grid grid-cols-12 border-b border-slate-400 py-2 gap-2 text-[10px]">
            <div className="col-span-6 pr-2">
              <p className="font-black text-xs text-slate-900">M/S ASHOKA ENTERPRISES (VALUE PLUS)</p>
              <p className="text-slate-700 uppercase mt-0.5">H. NO. 116, NEAR SHANTI MARRIAGE HOUSE DEORIA ROAD, KUNRAGHAT GORAKHPUR, UP – 273008</p>
              <p className="text-slate-800 mt-1">
                Ph: <span className="font-mono font-bold">9140860604</span> · Web: <span className="font-mono">www.valueplus.in</span>
              </p>
            </div>

            <div className="col-span-6 pl-2 border-l border-slate-300 space-y-0.5">
              <p><span className="font-semibold">GSTIN :</span> <span className="font-mono font-bold">09ANHPJ7242D1Z2</span></p>
              <p><span className="font-semibold">State :</span> Uttar Pradesh(09)</p>
              <p><span className="font-semibold">PAN :</span> <span className="font-mono font-bold">ANHPJ7242D</span></p>
              <p><span className="font-semibold">Inward Destination :</span> <span className="font-bold text-[#30539C]">{billData.warehouse || "Ashoka Enterprises (Kunraghat Showroom)"}</span></p>
            </div>
          </div>

          {/* SUPPLIER & PAYMENT META STRIP (3 COLUMNS) */}
          <div className="grid grid-cols-12 border-b border-slate-400 text-[10px] divide-x divide-slate-400">
            {/* Col 1: Supplier */}
            <div className="col-span-5 p-2 space-y-1">
              <p className="font-bold border-b pb-0.5 uppercase text-slate-800">Supplier (Billed From)</p>
              <p className="font-black text-xs text-slate-900">{billData.supplierName || "Authorized Supplier Partner"}</p>
              <p className="text-slate-700">
                Mobile / Phone: <span className="font-mono font-bold">{billData.supplierPhone || "N/A"}</span>
              </p>
            </div>

            {/* Col 2: PO References */}
            <div className="col-span-4 p-2 space-y-1">
              <p className="font-bold border-b pb-0.5 uppercase text-slate-800">Voucher & PO Reference</p>
              <p>Linked PO No: <span className="font-mono font-bold text-amber-800">{billData.linkedPoNo || "Direct Inward"}</span></p>
              <p>Due Date: <span className="font-mono font-semibold">{billData.dueDate ? formatDate(billData.dueDate) : "Immediate / On Delivery"}</span></p>
            </div>

            {/* Col 3: Payment Status */}
            <div className="col-span-3 p-2 space-y-1 text-right">
              <p className="font-bold border-b pb-0.5 uppercase text-slate-800 text-left">Status</p>
              <p className="text-xs">
                <span className={`inline-block px-2 py-0.5 rounded font-black uppercase text-[10px] ${
                  billData.status === "paid" 
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                    : "bg-amber-100 text-amber-800 border border-amber-300"
                }`}>
                  {billData.status || "Paid"}
                </span>
              </p>
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-slate-300 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold uppercase text-[10px] border-b border-slate-300">
                <tr>
                  <th className="px-3 py-2.5 text-center w-10">#</th>
                  <th className="px-3 py-2.5 text-left">Item Description & Specifications</th>
                  <th className="px-2 py-2.5 text-center w-20">HSN</th>
                  <th className="px-2 py-2.5 text-center w-16">Qty</th>
                  <th className="px-3 py-2.5 text-right w-24">Purchase Rate</th>
                  <th className="px-2 py-2.5 text-center w-16">GST %</th>
                  <th className="px-3 py-2.5 text-right w-28">Total (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((line: any, idx: number) => {
                  const qty = Number(line.quantity || 1);
                  const rate = Number(line.rate || 0);
                  const gstPercent = Number(line.gstRate || 18);
                  const lineTaxable = qty * rate;
                  const lineTotal = lineTaxable + (lineTaxable * gstPercent) / 100;

                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-center font-mono font-semibold text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-bold text-slate-900 text-xs">{line.name || line.itemName}</p>
                        {Array.isArray(line.serialNumbers) && line.serialNumbers.length > 0 && (
                          <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                            Serials: {line.serialNumbers.join(", ")}
                          </p>
                        )}
                      </td>
                      <td className="px-2 py-2.5 text-center font-mono text-slate-600">
                        {line.hsnCode || line.hsn || "8528"}
                      </td>
                      <td className="px-2 py-2.5 text-center font-bold text-slate-900 font-mono">
                        {qty} {line.unit || "Pcs"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-800">
                        {formatCurrency(rate)}
                      </td>
                      <td className="px-2 py-2.5 text-center font-mono text-slate-600">
                        {gstPercent}%
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold font-mono text-slate-900">
                        {formatCurrency(lineTotal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Amount In Words & Financial Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
            {/* Left: Amount in Words & Terms */}
            <div className="space-y-3">
              <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  TOTAL AMOUNT IN WORDS
                </span>
                <p className="text-xs font-bold text-slate-800 italic mt-0.5">
                  {numberToWordsIndian(total)}
                </p>
              </div>

              <div className="text-[10.5px] text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700">Verification & Inward Notes:</p>
                <p>1. All products received in good physical condition and verified with serial numbers.</p>
                <p>2. Stock successfully credited to Value Plus ERP Inventory Master.</p>
              </div>
            </div>

            {/* Right: Calculations */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Taxable Subtotal:</span>
                <span className="font-mono font-bold text-slate-800">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>CGST Input Tax (9%):</span>
                <span className="font-mono font-bold text-slate-800">{formatCurrency(gst / 2)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>SGST Input Tax (9%):</span>
                <span className="font-mono font-bold text-slate-800">{formatCurrency(gst / 2)}</span>
              </div>
              <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-200 pt-1">
                <span>Total GST Input:</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(gst)}</span>
              </div>
              <div className="border-t-2 border-slate-400 pt-2 flex justify-between text-sm font-black text-slate-900">
                <span>Grand Total:</span>
                <span className="font-mono text-[#30539C] text-base">{formatCurrency(total)}</span>
              </div>
              {paid > 0 && (
                <div className="flex justify-between text-xs text-emerald-700 pt-1">
                  <span>Amount Paid / Settled:</span>
                  <span className="font-mono font-bold">{formatCurrency(paid)}</span>
                </div>
              )}
              {balance > 0 && (
                <div className="flex justify-between text-xs text-amber-700">
                  <span>Payable Balance:</span>
                  <span className="font-mono font-bold">{formatCurrency(balance)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-8 pt-8 border-t border-slate-300 text-center">
            <div>
              <div className="h-12"></div>
              <p className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-700">
                Received & Verified By (Store Manager)
              </p>
            </div>
            <div>
              <div className="h-12"></div>
              <p className="border-t border-slate-400 pt-1 text-xs font-semibold text-slate-700">
                For M/S ASHOKA ENTERPRISES (Authorised Signatory)
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
