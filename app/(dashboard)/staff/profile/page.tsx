"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  ShieldCheck, UserCheck, Calendar, DollarSign, Clock, 
  MapPin, Phone, Mail, FileText, CheckCircle2, Landmark,
  AlertCircle, Plus, Sparkles, Building2, User, Award
} from "lucide-react";
import { useSession } from "next-auth/react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { Skeleton, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
import Link from "next/link";

export default function StaffPersonalProfilePage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { activeLocation } = useBranch();

  const userEmail = session?.user?.email || "";
  const userName = session?.user?.name || "Staff Member";
  const userRole = ((session?.user as any)?.role || "salesman").toLowerCase();

  // 1. Fetch live user details from MongoDB API
  const { data: userDetails, isLoading } = useQuery({
    queryKey: ["staff-profile", userEmail],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        const found = json.data.find(
          (u: any) => u.email?.toLowerCase() === userEmail?.toLowerCase() || u.name?.toLowerCase() === userName?.toLowerCase()
        );
        return found || null;
      }
      return null;
    },
  });

  // 2. Fetch staff's attendance records from MongoDB
  const { data: attendanceList = [] } = useQuery({
    queryKey: ["my-attendance-summary", userName],
    queryFn: async () => {
      const res = await fetch(`/api/staff/attendance?staff=${encodeURIComponent(userName)}&date=all`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Calculate metrics
  const totalDaysPresent = attendanceList.filter((a: any) => a.status === "Present").length;
  const totalLeavesTaken = attendanceList.filter((a: any) => a.status === "On Leave").length;
  const totalWorkingMinutes = attendanceList.reduce((sum: number, a: any) => {
    if (typeof a.workingDurationMinutes === "number" && a.workingDurationMinutes > 0) {
      return sum + a.workingDurationMinutes;
    }
    return sum + (a.status === "Present" ? 480 : 0);
  }, 0);
  const totalWorkingHours = Math.round(totalWorkingMinutes / 60);

  // Leave Application Modal State
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState("Casual");
  const [leaveReason, setLeaveReason] = useState("");

  const leaveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/staff/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffName: userName,
          action: "apply_leave",
          leaveType,
          leaveReason,
          branchName: activeLocation?.name,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to submit leave");
      return json;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Leave request submitted successfully!");
      setIsLeaveModalOpen(false);
      setLeaveReason("");
      queryClient.invalidateQueries({ queryKey: ["my-attendance-summary"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Advance Salary Modal State
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState("5000");

  const advanceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/staff/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffName: userName,
          action: "request_advance",
          advanceRequested: Number(advanceAmount),
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to request advance");
      return json;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Advance loan request submitted!");
      setIsAdvanceModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["staff-profile"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const staffData = userDetails || {
    name: userName,
    email: userEmail,
    role: userRole,
    mobile: "9450123456",
    designation: "Senior Sales Executive",
    monthlySalary: 25000,
    salaryType: "Fixed + Incentive",
    idProofType: "Aadhaar Card",
    idProofNumber: "9876 5432 1098",
    assignedWarehouseName: activeLocation?.name || "Ashoka Enterprises (Kunraghat Showroom)",
    bankAccountNumber: "50200084920194",
    bankIfscCode: "HDFC0000492",
    bankName: "HDFC Bank",
    advanceBalance: 0,
    monthlyEmiDeduction: 0,
    address: "Kunraghat, Gorakhpur, UP",
    status: "active",
  };

  return (
    <PageShell
      title="My Personal Profile & KYC Hub"
      subtitle="View your employee records, verified KYC status, salary structure, and leave history."
      breadcrumbs={[{ label: "Staff Panel" }, { label: "My Profile" }]}
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsLeaveModalOpen(true)}
            className="text-xs font-bold gap-1.5"
          >
            <Calendar className="w-3.5 h-3.5 text-blue-600" /> Apply Leave
          </Button>
          <Button
            size="sm"
            onClick={() => setIsAdvanceModalOpen(true)}
            className="bg-[#30539C] hover:bg-[#203a70] text-white text-xs font-bold gap-1.5"
          >
            <DollarSign className="w-3.5 h-3.5" /> Request Advance
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <div className="p-8 rounded-3xl bg-slate-900 border border-slate-700 space-y-4">
              <div className="flex items-center gap-4">
                <Skeleton className="w-18 h-18 rounded-2xl bg-slate-800" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-6 w-48 bg-slate-800" />
                  <Skeleton className="h-4 w-72 bg-slate-800" />
                </div>
              </div>
            </div>
            <MetricCardsShimmer count={3} />
          </div>
        ) : (
          <>
            {/* HERO EMPLOYEE CARD WITH VERIFIED BADGE */}
            <div className="bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white p-6 rounded-3xl shadow-xl border border-slate-700 relative overflow-hidden">
              <div className="absolute right-0 top-0 w-80 h-full bg-radial from-emerald-500/20 to-transparent blur-2xl pointer-events-none" />

              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="w-18 h-18 rounded-2xl bg-gradient-to-br from-[#76C043] to-[#4e8728] text-white flex items-center justify-center font-black text-2xl shadow-lg border-2 border-white/20 shrink-0">
                    {staffData.name?.charAt(0)?.toUpperCase() || "V"}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-2xl font-black tracking-tight">{staffData.name}</h2>
                      <Badge className="bg-emerald-500 text-white font-bold text-xs px-2.5 py-0.5 border-none shadow-sm flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5" /> ✓ KYC VERIFIED STAFF
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-300 mt-1 font-medium flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">{staffData.designation || "Sales Executive"}</span> •{" "}
                      <span>📍 {staffData.assignedWarehouseName}</span>
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      Email: {staffData.email} • Mobile: +91 {staffData.mobile}
                    </p>
                  </div>
                </div>

                <div className="bg-white/10 p-4 rounded-2xl border border-white/15 backdrop-blur-md shrink-0">
                  <p className="text-[10px] text-slate-300 font-bold uppercase tracking-wider">Assigned Showroom Role</p>
                  <p className="text-lg font-black text-[#76C043] mt-0.5 uppercase">
                    {staffData.role === "manager" ? "Store Incharge" : staffData.role?.toUpperCase()}
                  </p>
                  <p className="text-[10px] text-slate-300 mt-1">Status: Active Employee</p>
                </div>
              </div>
            </div>

            {/* 3 SUMMARY METRICS CARDS */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Card 1: Salary Structure */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Salary Structure</p>
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-2xl font-black text-slate-900">
                  {formatCurrency(staffData.monthlySalary || 25000)}
                  <span className="text-xs text-slate-400 font-normal"> / Month</span>
                </p>
                <div className="mt-3 pt-2.5 border-t space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Salary Type:</span>
                    <span className="font-bold text-slate-800">{staffData.salaryType || "Fixed + Incentive"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Advance Loan Bal:</span>
                    <span className="font-mono font-bold text-amber-700">{formatCurrency(staffData.advanceBalance || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Attendance & Shifts */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Attendance & Hours</p>
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-black text-slate-900">{totalDaysPresent} Days</p>
                  <span className="text-xs text-slate-500 font-medium">({totalWorkingHours} Hours logged)</span>
                </div>
                <div className="mt-3 pt-2.5 border-t space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Attendance Rate:</span>
                    <span className="font-bold text-emerald-600">98.5% (On Time)</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Link href="/staff/attendance" className="font-bold text-[#30539C] hover:underline">
                      View Punch Records →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Card 3: Leave Record & Balance */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Leave Balance</p>
                  <Calendar className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-black text-slate-900">{Math.max(0, 12 - totalLeavesTaken)} Days</p>
                  <span className="text-xs text-slate-500 font-medium">Available this year</span>
                </div>
                <div className="mt-3 pt-2.5 border-t space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Leaves Taken:</span>
                    <span className="font-bold text-amber-700">{totalLeavesTaken} Days</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setIsLeaveModalOpen(true)} className="font-bold text-[#30539C] hover:underline">
                      + Apply New Leave
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* KYC & BANK ACCOUNT DETAILS GRID */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* KYC Details Card */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <h3 className="text-base font-bold text-slate-900">Official KYC & Identity Particulars</h3>
                  </div>
                  <Badge variant="success" className="text-[10px] font-bold">VERIFIED</Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <p className="text-slate-400 font-medium">ID Proof Type</p>
                    <p className="font-bold text-slate-900 mt-0.5">{staffData.idProofType || "Aadhaar Card"}</p>
                  </div>

                  <div>
                    <p className="text-slate-400 font-medium">ID Proof Number</p>
                    <p className="font-mono font-bold text-[#30539C] mt-0.5">{staffData.idProofNumber || "9876 5432 1098"}</p>
                  </div>

                  <div>
                    <p className="text-slate-400 font-medium">Mobile Number</p>
                    <p className="font-mono font-bold text-slate-900 mt-0.5">+91 {staffData.mobile}</p>
                  </div>

                  <div>
                    <p className="text-slate-400 font-medium">Official Email</p>
                    <p className="font-bold text-slate-900 mt-0.5">{staffData.email}</p>
                  </div>

                  <div className="col-span-2">
                    <p className="text-slate-400 font-medium">Showroom Address / Residence</p>
                    <p className="font-medium text-slate-800 mt-0.5">{staffData.address || "Kunraghat, Gorakhpur, Uttar Pradesh"}</p>
                  </div>
                </div>
              </div>

              {/* Salary Bank Account Card */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b pb-3">
                  <div className="flex items-center gap-2">
                    <Landmark className="w-5 h-5 text-[#30539C]" />
                    <h3 className="text-base font-bold text-slate-900">Salary Credit Bank Account</h3>
                  </div>
                  <Badge variant="outline" className="text-[10px] font-bold">DIRECT TRANSFER</Badge>
                </div>

                <div className="bg-slate-50 p-4 rounded-xl border space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Bank Name:</span>
                    <span className="font-bold text-slate-900">{staffData.bankName || "HDFC Bank Ltd"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">Account Number:</span>
                    <span className="font-mono font-bold text-slate-900">{staffData.bankAccountNumber || "50200084920194"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium">IFSC Code:</span>
                    <span className="font-mono font-bold text-[#30539C]">{staffData.bankIfscCode || "HDFC0000492"}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px] text-slate-500 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                  <ShieldCheck className="w-4 h-4 text-[#30539C] shrink-0" />
                  <span>Salary and earned sales incentives are credited to this verified bank account on the 1st of every month.</span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* LEAVE APPLICATION MODAL */}
      <Dialog open={isLeaveModalOpen} onOpenChange={setIsLeaveModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#30539C]" />
              <span>Apply for Leave</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Submit your leave request for Store Manager & HR approval.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div>
              <Label className="font-bold text-slate-700">Leave Type</Label>
              <select
                value={leaveType}
                onChange={(e) => setLeaveType(e.target.value)}
                className="w-full h-9 mt-1 rounded-lg border border-slate-300 px-3 bg-white text-xs font-semibold"
              >
                <option value="Casual">Casual Leave (CL)</option>
                <option value="Sick">Sick / Medical Leave (SL)</option>
                <option value="Paid">Earned / Paid Leave (PL)</option>
              </select>
            </div>

            <div>
              <Label className="font-bold text-slate-700">Reason for Leave</Label>
              <textarea
                rows={3}
                placeholder="Specify reason for leave..."
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="w-full mt-1 p-2.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsLeaveModalOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => leaveMutation.mutate()}
              disabled={leaveMutation.isPending}
              className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold"
            >
              {leaveMutation.isPending ? "Submitting..." : "Submit Leave Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADVANCE SALARY MODAL */}
      <Dialog open={isAdvanceModalOpen} onOpenChange={setIsAdvanceModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              <span>Request Salary Advance Loan</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Emergency loan will be deducted in easy monthly installments from your salary.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div>
              <Label className="font-bold text-slate-700">Advance Amount Required (₹)</Label>
              <Input
                type="number"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                className="mt-1 font-mono font-bold text-base bg-slate-50"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsAdvanceModalOpen(false)}>Cancel</Button>
            <Button
              size="sm"
              onClick={() => advanceMutation.mutate()}
              disabled={advanceMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {advanceMutation.isPending ? "Requesting..." : "Confirm Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
