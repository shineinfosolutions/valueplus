"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DollarSign, Plus, Search, CheckCircle2, Lock, ShieldAlert, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";

export default function StaffSalaryPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("August 2026");
  const [isPayModalOpen, setIsPayModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState("Bank Transfer");
  const [txnRef, setTxnRef] = useState("");

  const { data: salaries = [], isLoading } = useQuery({
    queryKey: ["salaries", selectedMonth],
    queryFn: async () => {
      const res = await fetch(`/api/staff/salary?month=${encodeURIComponent(selectedMonth)}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const paySalaryMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/staff/salary", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Payment release failed");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Salary payout recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["salaries"] });
      setIsPayModalOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openPayDialog = (rec: any) => {
    setSelectedRecord(rec);
    setPaymentAmount(rec.payableAmount);
    setIsPayModalOpen(true);
  };

  const filtered = salaries.filter((s: any) =>
    (s.employeeName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.employeeId || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell
      title="Staff Payroll & Salary Management"
      description="Employee compensation, incentives, sales commissions, deductions, and payment disbursement logs."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search employee name or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <ExportMenu
              title="Staff Salary"
              subtitle={`${selectedMonth} • ${filtered.length} employees`}
              data={(filtered as any[]).map((s) => ({
                "Employee Name": s.employeeName,
                "Employee ID": s.employeeId,
                Designation: s.designation,
                "Base Salary": s.monthlySalary || 0,
                "Incentives & Commission": (s.incentives || 0) + (s.commission || 0),
                Deductions: s.deductions || 0,
                "Net Payable": s.payableAmount || 0,
                Status: s.paymentStatus,
              }))}
              filename="staff-salary"
            />
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[180px] text-xs bg-slate-50 border-slate-300 font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="August 2026">August 2026</SelectItem>
                <SelectItem value="July 2026">July 2026</SelectItem>
                <SelectItem value="June 2026">June 2026</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold">
              <tr>
                <th className="p-3">Employee</th>
                <th className="p-3">Designation</th>
                <th className="p-3 text-right">Base Salary</th>
                <th className="p-3 text-right">Incentives & Commission</th>
                <th className="p-3 text-right">Deductions</th>
                <th className="p-3 text-right">Net Payable</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={8} className="p-0"><TableShimmer rows={6} cols={8} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-slate-500">No salary records found for {selectedMonth}.</td></tr>
              ) : (
                filtered.map((s: any) => (
                  <tr key={s._id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-bold text-slate-900">
                      {s.employeeName}
                      <span className="block text-[10px] font-mono text-slate-500 font-normal">{s.employeeId}</span>
                    </td>
                    <td className="p-3 text-slate-700">{s.designation}</td>
                    <td className="p-3 text-right font-mono font-bold">₹{s.monthlySalary?.toLocaleString("en-IN")}</td>
                    <td className="p-3 text-right font-mono text-emerald-700 font-bold">
                      +₹{((s.incentives || 0) + (s.commission || 0)).toLocaleString("en-IN")}
                    </td>
                    <td className="p-3 text-right font-mono text-red-600">
                      -₹{(s.deductions || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="p-3 text-right font-mono font-black text-slate-900 text-sm">
                      ₹{s.payableAmount?.toLocaleString("en-IN")}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={s.paymentStatus === "Paid" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>
                        {s.paymentStatus}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      {s.paymentStatus !== "Paid" ? (
                        <Button
                          size="sm"
                          onClick={() => openPayDialog(s)}
                          className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                        >
                          <CreditCard className="w-3.5 h-3.5 mr-1" /> Pay Salary
                        </Button>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-mono">Paid on {s.paymentDate}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* SALARY PAYOUT MODAL */}
      <Dialog open={isPayModalOpen} onOpenChange={setIsPayModalOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <DollarSign className="w-4 h-4 text-emerald-600" /> Release Salary Payment
            </DialogTitle>
          </DialogHeader>
          {selectedRecord && (
            <div className="space-y-3 text-xs pt-2">
              <div className="p-3 bg-slate-50 rounded-lg space-y-1">
                <p className="font-bold text-slate-900 text-sm">{selectedRecord.employeeName}</p>
                <p className="text-slate-500 font-mono">{selectedRecord.employeeId} • {selectedRecord.month}</p>
              </div>

              <div>
                <Label>Payout Amount (₹) *</Label>
                <Input 
                  type="number" 
                  value={paymentAmount} 
                  onChange={(e) => setPaymentAmount(Number(e.target.value))} 
                  className="mt-1 bg-white font-black text-slate-900" 
                />
              </div>

              <div>
                <Label>Payment Mode *</Label>
                <Select value={paymentMode} onValueChange={setPaymentMode}>
                  <SelectTrigger className="mt-1 bg-white"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bank Transfer">Bank Transfer (NEFT/RTGS)</SelectItem>
                    <SelectItem value="Cheque">Cheque</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="Cash">Cash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Transaction Reference / UTR Number</Label>
                <Input 
                  placeholder="e.g. HDFC2026881923" 
                  value={txnRef} 
                  onChange={(e) => setTxnRef(e.target.value)} 
                  className="mt-1 bg-white font-mono" 
                />
              </div>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsPayModalOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => paySalaryMutation.mutate({
                id: selectedRecord?._id,
                paymentAmount,
                paymentMode,
                txnRef,
                paymentStatus: "Paid",
              })} 
              disabled={paySalaryMutation.isPending} 
              className="bg-emerald-600 text-white font-bold"
            >
              Confirm Disbursement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
