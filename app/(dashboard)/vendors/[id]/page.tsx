"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import {
  Building2,
  Receipt,
  WalletCards,
  Phone,
  MapPin,
  FileText,
  Printer,
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { RoleGuard, usePermissions } from "@/components/shared/role-guard";
import { PartyLedgerPanel } from "@/components/PartyLedgerPanel";
import { VendorBillModal } from "@/components/vendor/VendorBillModal";
import { VendorPaymentModal } from "@/components/vendor/VendorPaymentModal";
import { VendorBillPrintModal } from "@/components/vendor/VendorBillPrintModal";
import { VendorPaymentReceiptModal } from "@/components/vendor/VendorPaymentReceiptModal";

/**
 * One vendor, answering the four questions the counter actually asks:
 * who is this, what did they order, what have they paid (and how), what is left.
 *
 * The combined running-balance ledger is still here as its own tab, but it is no
 * longer the only view — a bill-by-bill and payment-by-payment breakdown reads
 * far more directly than a single interleaved account.
 */

const MODE_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  online: "NEFT / IMPS / Bank",
  card: "Card",
  finance: "Finance",
  due: "Due",
};

export default function VendorDetailPage() {
  return (
    <RoleGuard permission="ledger.vendor.view">
      <VendorDetailInner />
    </RoleGuard>
  );
}

function VendorDetailInner() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { can } = usePermissions();

  const vendorId = String(params?.id || "");
  const [tab, setTab] = useState("bills");
  const [billModalOpen, setBillModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [billToPrint, setBillToPrint] = useState<any | null>(null);
  const [paymentToPrint, setPaymentToPrint] = useState<any | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["vendor-detail", vendorId],
    queryFn: async () => {
      const res = await fetch(`/api/vendors/ledger?party=vendor&id=${vendorId}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load this vendor");
      return json.data;
    },
    enabled: Boolean(vendorId),
  });

  const party = data?.party;
  const summary = data?.summary;
  const bills = data?.bills || [];
  const payments = data?.payments || [];
  const cancelledBills = data?.cancelledBills || [];

  const modeBreakdown = Object.entries(summary?.byBucket || {}).filter(
    ([, v]) => (v as number) > 0
  );

  if (error) {
    return (
      <PageShell title="Vendor" breadcrumbs={[{ label: "Vendors & Ledger" }]}>
        <div className="py-16 text-center bg-white rounded-xl border border-slate-200">
          <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
          <p className="text-sm font-semibold text-slate-800">{(error as Error).message}</p>
          <Button variant="outline" className="mt-4" onClick={() => router.push("/vendors")}>
            Back to vendors
          </Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title={party?.name || "Loading…"}
      subtitle={party ? `${party.code} • ${party.phone || "no phone"}` : ""}
      breadcrumbs={[
        { label: "Vendors & Ledger", href: "/vendors" },
        { label: party?.name || "Vendor" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/vendors")}>
            <ArrowLeft className="w-3.5 h-3.5 mr-1.5" /> All Vendors
          </Button>
          <Button variant="outline" size="sm" onClick={() => setLedgerOpen(true)}>
            <FileText className="w-3.5 h-3.5 mr-1.5" /> Statement
          </Button>
          {can("vendor.manage") && (
            <Button variant="outline" size="sm" onClick={() => setBillModalOpen(true)}>
              <Receipt className="w-3.5 h-3.5 mr-1.5" /> New Bill
            </Button>
          )}
          {can("payment.record") && (
            <Button size="sm" onClick={() => setPaymentModalOpen(true)}>
              <WalletCards className="w-3.5 h-3.5 mr-1.5" /> Record Payment
            </Button>
          )}
        </div>
      }
    >
      {/* ── Who is this vendor ─────────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/10 border border-white/20 flex items-center justify-center">
            <Building2 className="w-7 h-7 text-[#76C043]" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight">{party?.name}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-300">
              <span className="font-mono font-bold text-[#76C043]">{party?.code}</span>
              {party?.phone && (
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" /> {party.phone}
                </span>
              )}
              {(party?.city || party?.state) && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {[party.city, party.state].filter(Boolean).join(", ")}
                </span>
              )}
              {party?.gstNumber && <span>GST {party.gstNumber}</span>}
              {party?.creditDays != null && <span>{party.creditDays} days credit</span>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">
            Payment Pending
          </p>
          <p
            className={cn(
              "text-3xl font-black tabular-nums",
              (summary?.closingBalance || 0) > 0 ? "text-amber-300" : "text-emerald-300"
            )}
          >
            {formatCurrency(summary?.closingBalance || 0)}
          </p>
          {(summary?.overdueAmount || 0) > 0 && (
            <p className="text-[11px] font-bold text-red-300 mt-0.5">
              {formatCurrency(summary.overdueAmount)} overdue
            </p>
          )}
        </div>
      </div>

      {/* ── The four numbers ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Total Ordered"
          value={formatCurrency(summary?.totalBilled || 0)}
          sub={`${summary?.billCount || 0} bills raised`}
        />
        <Stat
          label="Total Paid"
          value={formatCurrency(summary?.totalPaid || 0)}
          sub={`${summary?.paymentCount || 0} payments received`}
          tone="emerald"
        />
        <Stat
          label="Payment Pending"
          value={formatCurrency(summary?.closingBalance || 0)}
          sub={
            summary?.openingBalance
              ? `includes opening ${formatCurrency(summary.openingBalance)}`
              : "no opening balance"
          }
          tone="amber"
        />
        <Stat
          label="Last Payment"
          value={
            summary?.lastPaymentDate ? formatCurrency(summary.lastPaymentAmount) : "—"
          }
          sub={
            summary?.lastPaymentDate
              ? `${formatDate(summary.lastPaymentDate)} • ${summary.lastPaymentMode || "Cash"}`
              : "never paid"
          }
        />
      </div>

      {/* ── How they pay ───────────────────────────────────────────────────── */}
      {modeBreakdown.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2.5">
            Payments Received by Mode
          </p>
          <div className="flex flex-wrap gap-2">
            {modeBreakdown.map(([bucket, amount]) => (
              <div
                key={bucket}
                className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 min-w-[130px]"
              >
                <p className="text-[10px] font-bold uppercase text-slate-500">
                  {MODE_LABELS[bucket] || bucket}
                </p>
                <p className="text-sm font-black text-slate-800 tabular-nums">
                  {formatCurrency(amount as number)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="bills">Orders &amp; Bills ({bills.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({payments.length})</TabsTrigger>
          {cancelledBills.length > 0 && (
            <TabsTrigger value="cancelled">Cancelled ({cancelledBills.length})</TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {/* ── Orders & Bills: what they took, and what is still owed on each ──── */}
      {tab === "bills" && (
        <div className="data-table-container">
          <div className="flex items-center justify-between p-4 border-b">
            <p className="text-xs text-muted-foreground">
              Click a bill to see the items on it
            </p>
            {can("ledger.export") && (
              <ExportMenu
                className="h-8 text-xs"
                title={`${party?.name || "Vendor"} — Bills`}
                subtitle={`${bills.length} bills`}
                data={bills.map((b: any) => ({
                  "Bill No": b.billNo,
                  Date: b.date,
                  "Due Date": b.dueDate,
                  Amount: b.total,
                  Paid: b.paid,
                  Balance: b.balance,
                  Status: b.status,
                }))}
                filename={`${party?.code}-bills`}
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr className="text-xs font-semibold text-muted-foreground uppercase">
                  <th className="px-4 py-3 text-left">Bill / Invoice #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Due Date</th>
                  <th className="px-4 py-3 text-right">Bill Amount</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <TableShimmer rows={5} cols={8} />
                    </td>
                  </tr>
                ) : bills.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="text-center p-10 text-muted-foreground">
                      <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      No bills raised on this vendor yet.
                    </td>
                  </tr>
                ) : (
                  bills.map((b: any) => (
                    <>
                      <tr
                        key={b.billNo}
                        className="hover:bg-slate-50 cursor-pointer"
                        onClick={() =>
                          setExpandedBill(expandedBill === b.billNo ? null : b.billNo)
                        }
                      >
                        <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">
                          <span className="inline-flex items-center gap-1">
                            {expandedBill === b.billNo ? (
                              <ChevronDown className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" />
                            )}
                            {b.billNo}
                          </span>
                          {b.reference && (
                            <p className="text-[10px] text-slate-400 font-sans ml-4.5">
                              ref {b.reference}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{formatDate(b.date)}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {b.dueDate ? formatDate(b.dueDate) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">
                          {formatCurrency(b.total)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-emerald-600 font-medium">
                          {formatCurrency(b.paid)}
                        </td>
                        <td
                          className={cn(
                            "px-4 py-3 text-right font-bold tabular-nums",
                            b.balance > 0 ? "text-amber-600" : "text-slate-400"
                          )}
                        >
                          {formatCurrency(b.balance)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={
                              b.status === "paid"
                                ? "success"
                                : b.status === "overdue"
                                ? "destructive"
                                : "warning"
                            }
                          >
                            {b.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-slate-500 hover:text-[#3F63AD]"
                            title="Print / Share"
                            onClick={() => setBillToPrint(b)}
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                      {expandedBill === b.billNo && (
                        <tr key={`${b.billNo}-items`} className="bg-slate-50/70">
                          <td colSpan={8} className="px-8 py-3">
                            {b.items?.length ? (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase text-slate-500 font-bold">
                                    <th className="text-left py-1">Item</th>
                                    <th className="text-right py-1">Qty</th>
                                    <th className="text-right py-1">Rate</th>
                                    <th className="text-right py-1">Amount</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.items.map((it: any, i: number) => (
                                    <tr key={i} className="border-t border-slate-200">
                                      <td className="py-1.5 text-slate-700">{it.name}</td>
                                      <td className="py-1.5 text-right tabular-nums">{it.quantity}</td>
                                      <td className="py-1.5 text-right tabular-nums">
                                        {formatCurrency(it.rate)}
                                      </td>
                                      <td className="py-1.5 text-right tabular-nums font-semibold">
                                        {formatCurrency(it.amount)}
                                      </td>
                                    </tr>
                                  ))}
                                  <tr className="border-t border-slate-300">
                                    <td colSpan={3} className="py-1.5 text-right text-slate-500">
                                      Subtotal + GST {formatCurrency(b.gstAmount)}
                                    </td>
                                    <td className="py-1.5 text-right font-black tabular-nums">
                                      {formatCurrency(b.total)}
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-xs text-slate-400">
                                No line items were recorded on this bill.
                              </p>
                            )}
                            {b.notes && (
                              <p className="text-[11px] text-slate-500 mt-2">Note: {b.notes}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Payments: how much, when, which mode, against which bill ────────── */}
      {tab === "payments" && (
        <div className="data-table-container">
          <div className="flex items-center justify-between p-4 border-b">
            <p className="text-xs text-muted-foreground">
              {data?.unallocated > 0
                ? `${formatCurrency(data.unallocated)} received on account, not yet tied to a bill`
                : "Every payment is applied to a bill"}
            </p>
            {can("ledger.export") && (
              <ExportMenu
                className="h-8 text-xs"
                title={`${party?.name || "Vendor"} — Payments`}
                subtitle={`${payments.length} payments`}
                data={payments.map((p: any) => ({
                  Date: p.date,
                  Amount: p.amount,
                  Mode: p.mode,
                  Reference: p.refNo,
                  "Against Bill": p.againstBillNo,
                  "Received By": p.receivedBy,
                  Direction: p.type,
                }))}
                filename={`${party?.code}-payments`}
              />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr className="text-xs font-semibold text-muted-foreground uppercase">
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Payment Mode</th>
                  <th className="px-4 py-3 text-left">Txn / Cheque Ref</th>
                  <th className="px-4 py-3 text-left">Against Bill</th>
                  <th className="px-4 py-3 text-left">Received By</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <TableShimmer rows={5} cols={7} />
                    </td>
                  </tr>
                ) : payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center p-10 text-muted-foreground">
                      <WalletCards className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      No payments received from this vendor yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p: any) => (
                    <tr key={p.paymentId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-[10px] font-bold">
                          {p.mode}
                        </Badge>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {MODE_LABELS[p.bucket] || p.bucket}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">
                        {p.refNo || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {p.againstBillNo ? (
                          <span className="text-[#3F63AD] font-bold">{p.againstBillNo}</span>
                        ) : (
                          <span className="text-slate-400">On account</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {p.receivedBy || "—"}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 text-right font-bold tabular-nums",
                          p.type === "paid" ? "text-red-600" : "text-emerald-600"
                        )}
                      >
                        {p.type === "paid" ? "−" : ""}
                        {formatCurrency(p.amount)}
                        {p.type === "paid" && (
                          <p className="text-[10px] font-medium text-red-400">refund out</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-slate-500 hover:text-[#3F63AD]"
                          title="Print / Share"
                          onClick={() => setPaymentToPrint(p)}
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "cancelled" && (
        <div className="data-table-container">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr className="text-xs font-semibold text-muted-foreground uppercase">
                  <th className="px-4 py-3 text-left">Bill #</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Reason</th>
                  <th className="px-4 py-3 text-left">Cancelled By</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {cancelledBills.map((b: any) => (
                  <tr key={b.billNo} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono font-bold text-slate-500 line-through">
                      {b.billNo}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(b.date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {formatCurrency(b.total)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{b.cancelReason || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      <p className="font-semibold text-slate-800">{b.cancelledBy || "—"}</p>
                      {b.cancelledAt && (
                        <p className="text-slate-400">{formatDate(b.cancelledAt)}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <VendorBillModal
        open={billModalOpen}
        onOpenChange={(o) => {
          setBillModalOpen(o);
          if (!o) queryClient.invalidateQueries({ queryKey: ["vendor-detail", vendorId] });
        }}
        vendorId={vendorId}
      />

      <VendorPaymentModal
        open={paymentModalOpen}
        onOpenChange={(o) => {
          setPaymentModalOpen(o);
          if (!o) queryClient.invalidateQueries({ queryKey: ["vendor-detail", vendorId] });
        }}
        vendorId={vendorId}
      />

      <Dialog open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <DialogContent className="max-w-5xl p-0 overflow-y-auto rounded-2xl border-none shadow-2xl">
          <PartyLedgerPanel party="vendor" partyId={vendorId} />
        </DialogContent>
      </Dialog>

      <VendorBillPrintModal
        isOpen={!!billToPrint}
        onClose={() => setBillToPrint(null)}
        bill={billToPrint}
        vendor={party}
      />

      <VendorPaymentReceiptModal
        isOpen={!!paymentToPrint}
        onClose={() => setPaymentToPrint(null)}
        payment={paymentToPrint}
        vendor={party}
      />
    </PageShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "emerald" | "amber";
}) {
  const toneClass = { slate: "", emerald: "text-emerald-600", amber: "text-amber-600" }[tone];
  return (
    <div className="metric-card">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}
