"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { 
  DollarSign, 
  Calendar, 
  CreditCard, 
  ArrowDownLeft, 
  ArrowUpRight, 
  ShieldCheck, 
  Clock, 
  AlertCircle, 
  FileText,
  User,
  Plus,
  Landmark
} from "lucide-react";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import Link from "next/link";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function DriverSalaryPage() {
  const { data: session } = useSession();
  const driverName = session?.user?.name || "Ramesh Yadav";

  // Mock driver profile details matching user model
  const monthlySalary = 18000;
  const salaryDay = 7; // Credited on 7th of every month
  const [advanceBalance, setAdvanceBalance] = useState(2500);
  const monthlyDeduction = 1000;
  const netMonthlyPayout = monthlySalary - monthlyDeduction;

  const [advanceRequestOpen, setAdvanceRequestOpen] = useState(false);
  const [requestedAmount, setRequestedAmount] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [ledger, setLedger] = useState([
    {
      id: "SAL-2026-07",
      date: "07/07/2026",
      type: "Salary Credit",
      description: "Monthly Salary for June 2026 (Direct Bank Transfer)",
      credit: 17000,
      debit: 0,
      status: "Paid",
    },
    {
      id: "ADV-2026-01",
      date: "15/07/2026",
      type: "Advance Taken",
      description: "Emergency Medical & Bike Repair Advance (Approved by Store Manager)",
      credit: 0,
      debit: 2500,
      status: "Disbursed",
    },
    {
      id: "SAL-2026-08",
      date: "07/08/2026",
      type: "Salary Credit",
      description: "Monthly Salary for July 2026 (₹18,000 - ₹1,000 Advance EMI)",
      credit: 17000,
      debit: 0,
      status: "Paid",
    },
  ]);

  const handleRequestAdvance = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(requestedAmount);
    if (!amt || amt <= 0) {
      toast.error("Please enter a valid advance amount");
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setAdvanceRequestOpen(false);
      setRequestedAmount("");
      setAdvanceReason("");
      toast.success("✅ Advance Request submitted to Store Manager & Super Admin for approval!");
    }, 600);
  };

  return (
    <PageShell>
      <div className="space-y-6 pb-16 max-w-5xl mx-auto">
        {/* ─── SALARY OVERVIEW BANNER ─────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
              <DollarSign className="w-6 h-6 text-emerald-600" />
              My Salary, Payment Date & Advance Ledger
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Courier Driver: <span className="font-bold text-slate-800">{driverName}</span> • Account Status: <span className="text-emerald-600 font-bold">Active Staff</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={() => setAdvanceRequestOpen(true)}
              className="bg-[#30539C] hover:bg-[#203E78] text-white rounded-xl text-xs font-bold h-9 shadow-xs"
            >
              <Plus className="w-4 h-4 mr-1" /> Request Advance Loan
            </Button>
            <Link href="/driver/deliveries">
              <Button variant="outline" className="rounded-xl text-xs font-semibold h-9">
                Deliveries Dashboard
              </Button>
            </Link>
          </div>
        </div>

        {/* ─── SALARY CARDS ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Card 1: Monthly Base Salary */}
          <Card className="rounded-3xl border-slate-200 bg-white shadow-xs p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Monthly Fixed Salary
              </span>
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                <DollarSign className="w-4 h-4" />
              </div>
            </div>
            <p className="font-mono text-2xl font-black text-slate-900">
              {formatCurrency(monthlySalary)}
            </p>
            <p className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Credited on {salaryDay}th of every month
            </p>
          </Card>

          {/* Card 2: Advance Balance */}
          <Card className="rounded-3xl border-slate-200 bg-white shadow-xs p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                Outstanding Advance
              </span>
              <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center font-bold">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
            </div>
            <p className="font-mono text-2xl font-black text-amber-600">
              {formatCurrency(advanceBalance)}
            </p>
            <p className="text-[11px] font-semibold text-slate-500">
              Deduction: <span className="font-mono font-bold text-slate-800">₹{monthlyDeduction}/month</span> against salary
            </p>
          </Card>

          {/* Card 3: Next Payout */}
          <Card className="rounded-3xl border-slate-200 bg-gradient-to-br from-[#1B2537] to-[#253958] text-white shadow-md p-5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-blue-200 uppercase tracking-wider">
                Estimated Net Next Payout
              </span>
              <div className="w-8 h-8 rounded-xl bg-white/10 text-emerald-400 flex items-center justify-center font-bold">
                <ShieldCheck className="w-4 h-4" />
              </div>
            </div>
            <p className="font-mono text-2xl font-black text-emerald-400">
              {formatCurrency(netMonthlyPayout)}
            </p>
            <p className="text-[11px] text-slate-300">
              Direct Transfer to Bank Account on <span className="font-bold text-white">07 Sep 2026</span>
            </p>
          </Card>
        </div>

        {/* ─── BANK DETAILS & SALARY RULES ───────────────────────────── */}
        <div className="bg-blue-50/60 rounded-3xl p-5 border border-blue-100 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-100 text-[#30539C] flex items-center justify-center font-bold">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900">Registered Salary Bank Account</h4>
              <p className="text-[11px] font-mono text-slate-600">
                HDFC Bank • A/C: <span className="font-bold text-slate-800">XXXX-XXXX-4819</span> • IFSC: <span className="font-bold text-slate-800">HDFC0001234</span>
              </p>
            </div>
          </div>
          <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-100/80 px-3 py-1 rounded-xl border border-emerald-200">
            ✓ Auto Bank NACH / IMPS Enabled
          </span>
        </div>

        {/* ─── PAYOUT & ADVANCE TRANSACTION LEDGER ────────────────────── */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden space-y-1">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="font-black text-sm text-slate-900">Salary & Advance Payout History</h3>
              <p className="text-xs text-slate-400">Chronological transaction record with Store Manager sign-off.</p>
            </div>
            <ExportMenu
              title="Salary & Advance Ledger"
              subtitle={`${ledger.length} transactions`}
              data={ledger.map((row) => ({
                "Txn Ref #": row.id,
                Date: row.date,
                Type: row.type,
                Description: row.description,
                "Credit (Salary)": row.credit,
                "Debit (Advance)": row.debit,
                Status: row.status,
              }))}
              filename="driver-salary-ledger"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-5 py-3">Txn Ref #</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Description / Remarks</th>
                  <th className="px-5 py-3 text-right">Credit (Salary)</th>
                  <th className="px-5 py-3 text-right">Debit (Advance)</th>
                  <th className="px-5 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledger.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5 font-mono font-bold text-[#30539C]">{row.id}</td>
                    <td className="px-5 py-3.5 text-slate-700">{row.date}</td>
                    <td className="px-5 py-3.5 font-bold text-slate-900">{row.type}</td>
                    <td className="px-5 py-3.5 text-slate-600 text-[11px] max-w-xs">{row.description}</td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-emerald-600">
                      {row.credit > 0 ? formatCurrency(row.credit) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-amber-600">
                      {row.debit > 0 ? formatCurrency(row.debit) : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold text-[10px]">
                        ✓ {row.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─── REQUEST ADVANCE MODAL ─────────────────────────────────── */}
        <Dialog open={advanceRequestOpen} onOpenChange={setAdvanceRequestOpen}>
          <DialogContent className="max-w-md p-0 rounded-3xl overflow-y-auto shadow-2xl border-none">
            <div className="bg-[#1B2537] text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-400/30 flex items-center justify-center font-bold">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">Request Advance Loan</h3>
                  <p className="text-[11px] text-slate-300">Deducted from upcoming monthly salaries</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleRequestAdvance} className="p-5 space-y-4 bg-white">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Requested Amount (₹) *</Label>
                <Input
                  type="number"
                  min="500"
                  max="15000"
                  required
                  placeholder="e.g. 3000"
                  value={requestedAmount}
                  onChange={(e) => setRequestedAmount(e.target.value)}
                  className="font-mono text-sm font-bold text-slate-900 h-10 rounded-xl"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700">Reason / Emergency Details *</Label>
                <Input
                  required
                  placeholder="e.g. Bike insurance renewal / Family medical expense"
                  value={advanceReason}
                  onChange={(e) => setAdvanceReason(e.target.value)}
                  className="text-xs h-10 rounded-xl"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-2xl border border-amber-200 text-[11px] text-amber-900 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>Advance request will be sent to Store Manager & Super Admin desk for approval and immediate bank transfer.</span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setAdvanceRequestOpen(false)} className="rounded-xl text-xs h-9">
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting} className="bg-[#30539C] hover:bg-[#203E78] text-white rounded-xl text-xs h-9 font-bold">
                  {isSubmitting ? "Submitting..." : "Submit Advance Request"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </PageShell>
  );
}
