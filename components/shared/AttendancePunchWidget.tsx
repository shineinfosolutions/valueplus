"use client";

import { AttendanceCheckInDialog } from "@/components/shared/AttendanceCheckInDialog";
import { BreakControl } from "@/components/shared/BreakControl";
import { LeaveRequestDialog } from "@/components/shared/LeaveRequestDialog";
import React, { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
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
  MapPin,
  Clock,
  LogIn,
  LogOut,
  UserCheck,
  Calendar,
  Coins,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { todayInIndia } from "@/lib/today";
import { ATTENDANCE_LIVE_PATHS } from "@/components/providers/RealtimeProvider";

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
  const router = useRouter();
  const { data: session } = useSession();
  const { activeLocation } = useBranch();

  const userName = session?.user?.name || "Staff Member";
  const userEmail = session?.user?.email || "";
  const userRole = ((session?.user as any)?.role || "salesman").toUpperCase();

  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [isCheckInOpen, setIsCheckInOpen] = useState(false);
  const [isAdvanceModalOpen, setIsAdvanceModalOpen] = useState(false);
  const [leaveType, setLeaveType] = useState<"Casual" | "Sick" | "Paid">("Casual");
  const [leaveReason, setLeaveReason] = useState("");
  const [advanceAmount, setAdvanceAmount] = useState("");

  const today = getISTDateString();

  // Location is needed to check in, so a person who has not allowed it is asked again and again (every minute while
  // the app is open) until they do. A phone that has blocked it for good cannot be prompted, so a banner says what to do.
  const [locState, setLocState] = useState<string>("unknown");
  const askLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      () => setLocState("granted"),
      (e) => { if (e.code === 1) setLocState("denied"); },
      { timeout: 15000, maximumAge: 60000 }
    );
  }, []);
  useEffect(() => {
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const st = await (navigator as any).permissions.query({ name: "geolocation" });
        setLocState(st.state);
        st.onchange = () => setLocState(st.state);
        if (st.state !== "granted") askLocation();
      } catch {
        // No Permissions API on this phone: asking directly still shows the prompt.
        askLocation();
      }
    };
    check();
    // Looked at again when the app comes back to the front (st.onchange covers a change while it is open).
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [askLocation]);

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
    meta: { live: ATTENDANCE_LIVE_PATHS },
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
    : "10:00 AM - 09:00 PM";

  return (
    <div className="p-4 bg-gradient-to-br from-[#1B2537] via-[#243753] to-[#1B2537] text-white rounded-2xl shadow-md border border-slate-700/80 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      {/* Who, shift and today's status */}
      <div className="flex items-start gap-3 min-w-0">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-[#76C043] to-emerald-400 text-white flex items-center justify-center shadow-md shrink-0">
          <Clock className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <p className="text-base font-bold text-white leading-tight truncate" title={userName}>{String(userName).replace(/\s*\(.*\)\s*$/, "")}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold capitalize bg-white/15 text-[#9BDB6B] border border-white/10">
              {String(userRole || "").toLowerCase()}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-500/20 text-blue-200 border border-blue-400/20">
              <Clock className="w-3 h-3" aria-hidden="true" /> Shift {shiftDisplay}
            </span>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 text-xs text-slate-300 flex-wrap">
            {isOnLeave ? (
              <span className="text-amber-300 font-semibold flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> On leave ({todayRecord?.leaveType || "Casual"})
              </span>
            ) : isCheckedOut ? (
              (() => {
                const durationMins = todayRecord?.workingDurationMinutes || 0;
                const h = Math.floor(durationMins / 60);
                const m = durationMins % 60;
                const display = h > 0 ? `${h}h ${m}m` : `${m} mins`;
                return (
                  <span className={isHalfDay ? "text-amber-300 font-semibold flex items-center gap-1" : "text-emerald-300 font-semibold flex items-center gap-1"}>
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {isHalfDay ? `Half-day shift (${display})` : `Shift completed (${display})`}
                  </span>
                );
              })()
            ) : isCheckedIn ? (
              <span className="text-[#9BDB6B] font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#76C043] animate-pulse" aria-hidden="true" />
                On shift since {todayRecord?.checkInTime}
                {isLate && <Badge className="bg-amber-500/30 text-amber-200 border-amber-400/40 text-[11px] px-1.5 py-0">Late</Badge>}
                {isHalfDay && <Badge className="bg-orange-500/30 text-orange-200 border-orange-400/40 text-[11px] px-1.5 py-0">Half-day cutoff</Badge>}
              </span>
            ) : (
              <span className="text-slate-300 font-medium">Shift not started today</span>
            )}
            <span className="inline-flex items-center gap-1 text-slate-300 min-w-0">
              <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate max-w-[210px]">{activeLocation.name.split("(")[0].trim()}</span>
            </span>
          </div>
          {locState === "denied" && (
            <div className="rounded-lg border border-amber-400/50 bg-amber-500/20 px-2.5 py-1.5 text-[11px] text-amber-100">
              Location is off, so you cannot check in.{" "}
              <button type="button" onClick={askLocation} className="font-bold underline">Allow location</button>
              <span className="block text-amber-200/90">If no question appears: phone Settings → this app / site → Location → Allow.</span>
            </div>
          )}
        </div>
      </div>

      {/* Check in / out first, then the two secondary actions */}
      <div className="grid grid-cols-2 gap-2 md:flex md:items-center md:gap-2.5 shrink-0">
        {!isCheckedIn && !isOnLeave ? (
          <Button
            onClick={() => setIsCheckInOpen(true)}
            disabled={punchMutation.isPending}
            className="col-span-2 md:col-span-1 h-12 md:h-10 px-5 bg-[#76C043] hover:bg-[#68ac3b] text-slate-950 font-bold text-sm rounded-xl shadow-md gap-2 cursor-pointer"
          >
            <LogIn className="w-5 h-5" aria-hidden="true" /> Check In
          </Button>
        ) : isCheckedIn && !isCheckedOut ? (
          <Button
            onClick={() => punchMutation.mutate({ action: "check_out" })}
            disabled={punchMutation.isPending}
            className="col-span-2 md:col-span-1 h-12 md:h-10 px-5 bg-red-500 hover:bg-red-600 text-white font-bold text-sm rounded-xl shadow-md gap-2 cursor-pointer"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" /> {punchMutation.isPending ? "Checking out..." : "Check Out"}
          </Button>
        ) : null}

        {isCheckedIn && !isCheckedOut && <BreakControl />}

        <Button
          variant="outline"
          onClick={() => setIsLeaveModalOpen(true)}
          className="h-11 md:h-10 px-3 bg-white/10 hover:bg-white/20 text-white border-white/20 text-sm font-semibold rounded-xl gap-1.5 cursor-pointer"
        >
          <Calendar className="w-4 h-4 text-amber-300" aria-hidden="true" /> Leave / Break
        </Button>

        <Button
          variant="outline"
          onClick={() => router.push("/marketing/leads?new=true")}
          className="h-11 md:h-10 px-3 bg-white/10 hover:bg-white/20 text-white border-white/20 text-sm font-semibold rounded-xl gap-1.5 cursor-pointer"
        >
          <UserPlus className="w-4 h-4 text-emerald-300" aria-hidden="true" /> New Lead
        </Button>
      </div>

      <AttendanceCheckInDialog open={isCheckInOpen} onClose={() => setIsCheckInOpen(false)} branchName={activeLocation.name} />
      <LeaveRequestDialog open={isLeaveModalOpen} onClose={() => setIsLeaveModalOpen(false)} />

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
