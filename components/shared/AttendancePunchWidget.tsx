"use client";

import React, { useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Clock,
  LogIn,
  LogOut,
  UserCheck,
  Calendar,
  Coins,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { todayInIndia } from "@/lib/today";

function getISTDateString() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (e) {
    return todayInIndia();
  }
}

// Not shown on Admin / Super Admin panels. The check sits in this small wrapper
// so it runs before any of the widget's own hooks: returning early from inside
// the widget changed its hook count once the session loaded (role "salesman"
// while loading, then "admin"), which crashed every page that shows it.
export function AttendancePunchWidget() {
  const { data: session } = useSession();
  const roleLower = String((session?.user as any)?.role || "salesman").toLowerCase();
  if (roleLower.includes("admin") || roleLower === "super admin") {
    return null;
  }
  return <AttendancePunchWidgetBody />;
}

function AttendancePunchWidgetBody() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { activeLocation } = useBranch();

  const userName = session?.user?.name || "Staff Member";
  const userEmail = session?.user?.email || "";
  const userRole = ((session?.user as any)?.role || "salesman").toUpperCase();

  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<"Casual" | "Sick" | "Paid">("Casual");
  const [leaveReason, setLeaveReason] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");

  const today = getISTDateString();

  // Fetch active shift configuration
  const { data: shiftConfig } = useQuery({
    queryKey: ["active-shift"],
    queryFn: async () => {
      const res = await fetch("/api/staff/shifts");
      const json = await res.json();
      return json.success ? json.data : null;
    },
    staleTime: 60000,
  });

  // Fetch today's attendance for current user
  const { data: attendanceList = [] } = useQuery({
    queryKey: ["my-attendance", today, userName],
    queryFn: async () => {
      const res = await fetch(`/api/staff/attendance?date=${today}&staff=${encodeURIComponent(userName)}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    refetchInterval: 15000,
  });

  const todayRecord = attendanceList.length > 0 ? attendanceList[0] : null;
  const isCheckedIn = !!todayRecord && !!todayRecord.checkInTime && todayRecord.checkInTime !== "--";
  const isCheckedOut = !!todayRecord && !!todayRecord.checkOutTime && todayRecord.checkOutTime !== "--";
  const isOnLeave = todayRecord?.status === "On Leave";
  const isHalfDay = todayRecord?.status === "Half-Day";
  const isLate = !!todayRecord?.isLate;

  // Punch Action Mutation
  const punchMutation = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload?: any }) => {
      const res = await fetch("/api/staff/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffName: userName,
          staffEmail: userEmail,
          staffRole: userRole.toLowerCase(),
          action,
          date: today,
          branchName: activeLocation.name,
          ...payload,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || "Attendance updated!");
      queryClient.invalidateQueries({ queryKey: ["my-attendance"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["my-attendance-summary"] });
      setIsLeaveModalOpen(false);
      setIsAdvanceModalOpen(false);
      setAdvanceAmount("");
      setLeaveReason("");
    },
    onError: (err: any) => toast.error(err.message),
  });

  const shiftDisplay = shiftConfig
    ? `${shiftConfig.startTime} - ${shiftConfig.endTime}`
    : "10:00 AM - 06:00 PM";

  return (
    <div className="p-4 bg-gradient-to-r from-[#1B2537] via-[#243753] to-[#1B2537] text-white rounded-2xl shadow-md border border-slate-700/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
      {/* User Info & Status */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#76C043] to-emerald-400 text-white flex items-center justify-center font-black text-sm shadow-md shrink-0">
          <Clock className="w-5 h-5" />
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-black text-white tracking-tight leading-none">{userName}</p>
            <span className="px-2 py-0.5 rounded text-[9.5px] font-mono font-extrabold bg-white/15 text-[#76C043] border border-white/10 shrink-0">
              {userRole}
            </span>
            <span className="px-2 py-0.5 rounded text-[9.5px] font-mono bg-blue-500/20 text-blue-300 border border-blue-400/20 shrink-0">
              🕒 Shift: {shiftDisplay}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300 flex-wrap">
            {isOnLeave ? (
              <span className="text-amber-400 font-bold flex items-center gap-1">
                🌴 On Leave ({todayRecord?.leaveType || "Casual"})
              </span>
            ) : isCheckedOut ? (
              (() => {
                const durationMins = todayRecord?.workingDurationMinutes || 0;
                const h = Math.floor(durationMins / 60);
                const m = durationMins % 60;
                const display = h > 0 ? `${h}h ${m}m` : `${m} mins`;
                return (
                  <span className={isHalfDay ? "text-amber-400 font-bold flex items-center gap-1" : "text-emerald-400 font-bold flex items-center gap-1"}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {isHalfDay ? `⚠️ Half-Day Shift (${display})` : `Shift Completed (${display})`}
                  </span>
                );
              })()
            ) : isCheckedIn ? (
              <span className="text-[#76C043] font-bold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#76C043] animate-ping" />
                In Shift (Since {todayRecord?.checkInTime})
                {isLate && <Badge className="bg-amber-500/30 text-amber-300 border-amber-400/40 text-[9px] px-1 py-0">Late</Badge>}
                {isHalfDay && <Badge className="bg-orange-500/30 text-orange-300 border-orange-400/40 text-[9px] px-1 py-0">Half-Day Cutoff</Badge>}
              </span>
            ) : (
              <span className="text-slate-400 font-medium">Shift Not Started Today</span>
            )}
            <span className="text-white/40">•</span>
            <span className="text-slate-300 font-medium text-[11px] truncate max-w-[220px]">
              📍 {activeLocation.name.split("(")[0]}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5 flex-wrap shrink-0">
        {!isCheckedIn && !isOnLeave ? (
          <Button
            size="sm"
            onClick={() => punchMutation.mutate({ action: "check_in" })}
            disabled={punchMutation.isPending}
            className="bg-[#76C043] hover:bg-[#68ac3b] text-slate-950 font-black text-xs h-9 px-4 rounded-xl shadow-md gap-1.5"
          >
            <LogIn className="w-4 h-4" /> Check In
          </Button>
        ) : isCheckedIn && !isCheckedOut ? (
          <Button
            size="sm"
            onClick={() => punchMutation.mutate({ action: "check_out" })}
            disabled={punchMutation.isPending}
            className="bg-red-500 hover:bg-red-600 text-white font-bold text-xs h-9 px-4 rounded-xl shadow-md gap-1.5"
          >
            <LogOut className="w-4 h-4" /> Check Out
          </Button>
        ) : null}

        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsLeaveModalOpen(true)}
          className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-bold h-9 px-3 rounded-xl gap-1.5"
        >
          <Calendar className="w-3.5 h-3.5 text-amber-400" /> Apply Leave
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={() => setIsAdvanceModalOpen(true)}
          className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-bold h-9 px-3 rounded-xl gap-1.5"
        >
          <Coins className="w-3.5 h-3.5 text-emerald-400" /> Request Advance
        </Button>
      </div>

      {/* LEAVE MODAL */}
      <Dialog open={isLeaveModalOpen} onOpenChange={setIsLeaveModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#30539C]" />
              Apply for Leave
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Submit your leave application for HR and Store Manager approval.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Leave Type</Label>
              <Select value={leaveType} onValueChange={(val: any) => setLeaveType(val)}>
                <SelectTrigger className="h-9 text-xs font-bold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Casual">Casual Leave (Personal Work)</SelectItem>
                  <SelectItem value="Sick">Sick Leave (Medical/Health)</SelectItem>
                  <SelectItem value="Paid">Paid Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Reason</Label>
              <Input
                placeholder="e.g. Urgent family matter / doctor visit"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsLeaveModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              onClick={() => punchMutation.mutate({ action: "apply_leave", payload: { leaveType, leaveReason } })}
              disabled={punchMutation.isPending}
              className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold text-xs"
            >
              Submit Leave Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ADVANCE MODAL */}
      <Dialog open={isAdvanceModalOpen} onOpenChange={setIsAdvanceModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <Coins className="w-5 h-5 text-emerald-600" />
              Request Salary Advance Loan
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Request an advance salary loan to be deducted in upcoming monthly payroll cycles.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold text-slate-700">Advance Amount Required (₹)</Label>
              <Input
                type="number"
                placeholder="e.g. 5000"
                value={advanceAmount}
                onChange={(e) => setAdvanceAmount(e.target.value)}
                className="h-9 text-xs font-mono font-bold"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsAdvanceModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              onClick={() => punchMutation.mutate({ action: "request_advance", payload: { advanceRequested: advanceAmount } })}
              disabled={punchMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
            >
              Submit Advance Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
export default AttendancePunchWidget;
