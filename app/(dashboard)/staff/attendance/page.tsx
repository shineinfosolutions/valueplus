"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Clock, CheckCircle2, UserCheck, Calendar,
  LogIn, LogOut, Search, ShieldCheck, User,
  SlidersHorizontal, Plus, AlertCircle,
  Sparkles, Zap, Trash2, Edit3, UserX, Sun, Users
} from "lucide-react";
import { TableShimmer, MetricCardsShimmer } from "@/components/shared/shimmer-skeleton";
import { toast } from "sonner";
import { useSession } from "next-auth/react";
import { useBranch } from "@/context/BranchContext";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

function getISTDateString() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  } catch (e) {
    return todayInIndia();
  }
}

export default function StaffAttendancePage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const { activeLocation } = useBranch();

  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const currentUserName = session?.user?.name || "Staff Member";
  const currentUserEmail = session?.user?.email || "";
  const isIndividualStaff = userRole === "salesman" || userRole === "cashier" || userRole === "sales";
  const isManagerOrAdmin = !isIndividualStaff || userRole === "admin" || userRole === "manager" || userRole === "hr";

  const todayIST = getISTDateString();
  const [selectedDate, setSelectedDate] = useState<string>(todayIST);
  const [selectedStaff, setSelectedStaff] = useState<string>(isIndividualStaff ? currentUserName : "all");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // Shift Settings Modal State
  const [isShiftModalOpen, setIsShiftModalOpen] = useState(false);
  const [shiftForm, setShiftForm] = useState({
    shiftName: "Showroom Shift (10:00 AM - 06:00 PM)",
    startTime: "10:00",
    endTime: "18:00",
    lateGraceMinutes: 15,
    halfDayLateCutoff: "12:00",
    minHoursForFullDay: 7.5,
    minHoursForHalfDay: 4.0,
    allowEarlyCheckoutWithoutPenalty: false,
  });

  // Manual Attendance Modal State
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [manualForm, setManualForm] = useState({
    id: "",
    staffName: "",
    staffRole: "salesman",
    date: todayIST,
    checkInTime: "10:00 AM",
    checkOutTime: "06:00 PM",
    status: "Present" as "Present" | "Late" | "Half-Day" | "Absent" | "On Leave",
    notes: "",
  });

  // 1. Fetch Registered Staff Members from MongoDB
  const { data: usersList = [] } = useQuery({
    queryKey: ["users-for-attendance"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
  });

  // 2. Fetch Active Shift Configuration
  const { data: shiftConfig } = useQuery({
    queryKey: ["active-shift"],
    queryFn: async () => {
      const res = await fetch("/api/staff/shifts");
      const json = await res.json();
      if (json.success && json.data) {
        setShiftForm({
          shiftName: json.data.shiftName || "Showroom Shift (10:00 AM - 06:00 PM)",
          startTime: json.data.startTime || "10:00",
          endTime: json.data.endTime || "18:00",
          lateGraceMinutes: json.data.lateGraceMinutes ?? 15,
          halfDayLateCutoff: json.data.halfDayLateCutoff || "12:00",
          minHoursForFullDay: json.data.minHoursForFullDay ?? 7.5,
          minHoursForHalfDay: json.data.minHoursForHalfDay ?? 4.0,
          allowEarlyCheckoutWithoutPenalty: !!json.data.allowEarlyCheckoutWithoutPenalty,
        });
        return json.data;
      }
      return null;
    },
  });

  // 3. Fetch Attendance Log
  const { data: attendanceList = [], isLoading } = useQuery({
    queryKey: ["attendance", isIndividualStaff ? currentUserName : selectedStaff, selectedDate],
    queryFn: async () => {
      let url = `/api/staff/attendance?`;
      if (isIndividualStaff) {
        url += `staff=${encodeURIComponent(currentUserName)}`;
        if (selectedDate !== "all") url += `&date=${selectedDate}`;
      } else {
        if (selectedStaff !== "all") url += `staff=${encodeURIComponent(selectedStaff)}&`;
        if (selectedDate && selectedDate !== "all") url += `date=${selectedDate}`;
        if (selectedDate === "all") url += `date=all`;
      }
      const res = await fetch(url);
      const json = await res.json();
      return json.success ? json.data : [];
    },
    refetchInterval: 15000,
  });

  // Shift Settings Mutation
  const saveShiftMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/staff/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, updatedBy: currentUserName }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update shift");
      return json;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || "Shift timing rules updated!");
      setIsShiftModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["active-shift"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Attendance Punch Mutation (Check-in / Check-out / Manual / Bulk)
  const attendanceMutation = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload?: any }) => {
      const res = await fetch("/api/staff/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          branchName: activeLocation?.name,
          ...payload,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: (data: any) => {
      toast.success(data.message || "Attendance saved successfully!");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["my-attendance"] });
      setIsManualModalOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete Attendance Mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/staff/attendance?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
      return json;
    },
    onSuccess: () => {
      toast.success("Attendance entry deleted");
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Filtered attendance list
  const filteredList = useMemo(() => {
    return attendanceList.filter((rec: any) => {
      const matchesSearch =
        !searchQuery ||
        rec.staffName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        rec.staffRole?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        rec.notes?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "in_shift" && rec.checkInTime && (!rec.checkOutTime || rec.checkOutTime === "--")) ||
        (statusFilter === "completed" && rec.checkInTime && rec.checkOutTime && rec.checkOutTime !== "--") ||
        rec.status?.toLowerCase() === statusFilter.toLowerCase();

      return matchesSearch && matchesStatus;
    });
  }, [attendanceList, searchQuery, statusFilter]);

  // Derived Summary Metrics for Selected Date
  const metrics = useMemo(() => {
    const totalStaff = usersList.length > 0 ? usersList.length : attendanceList.length;
    const presentRecords = attendanceList.filter((a: any) => a.status === "Present" || a.status === "Late");
    const lateRecords = attendanceList.filter((a: any) => a.status === "Late" || a.isLate);
    const halfDayRecords = attendanceList.filter((a: any) => a.status === "Half-Day");
    const leaveRecords = attendanceList.filter((a: any) => a.status === "On Leave");
    const inShiftRecords = attendanceList.filter((a: any) => a.checkInTime && (!a.checkOutTime || a.checkOutTime === "--"));
    const completedRecords = attendanceList.filter((a: any) => a.checkInTime && a.checkOutTime && a.checkOutTime !== "--");

    return {
      totalStaff,
      presentCount: presentRecords.length,
      lateCount: lateRecords.length,
      halfDayCount: halfDayRecords.length,
      leaveCount: leaveRecords.length,
      inShiftCount: inShiftRecords.length,
      completedCount: completedRecords.length,
    };
  }, [attendanceList, usersList]);

  // Duration label for export (mirrors the table's duration column)
  const durationLabelForExport = (r: any) => {
    if (r.status === "On Leave") return "On Leave";
    if (r.status === "Absent") return "Absent";
    const mins = typeof r.workingDurationMinutes === "number" ? r.workingDurationMinutes : 0;
    if (!mins) return "--";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  return (
    <PageShell
      title={isIndividualStaff ? "My Attendance & Shift Records" : "Staff Daily Attendance & Biometric Log"}
      description={
        isIndividualStaff
          ? `Personal punch history, shift timings, and working hours for ${currentUserName}.`
          : "Super Admin & HR Control: Monitor daily check-in, checkout, auto half-day calculation, and working hours."
      }
    >
      <div className="space-y-5">
        {/* ─── SHIFT CONFIGURATION BANNER ────────────────────────── */}
        <div className="bg-gradient-to-r from-[#1B2537] via-[#233857] to-[#1B2537] text-white p-5 rounded-2xl shadow-lg border border-slate-700/80 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="w-8 h-8 rounded-lg bg-[#76C043]/20 border border-[#76C043]/40 flex items-center justify-center text-[#76C043]">
                <Clock className="w-4 h-4" />
              </span>
              <h3 className="text-base font-black tracking-tight text-white">
                {shiftForm.shiftName}
              </h3>
              <Badge className="bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 text-xs font-mono font-bold px-2 py-0.5">
                ⏰ {shiftForm.startTime} to {shiftForm.endTime}
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-xs font-mono px-2 py-0.5">
                Grace: +{shiftForm.lateGraceMinutes} mins
              </Badge>
            </div>
            <p className="text-xs text-slate-300">
              📌 <strong>Shift Rules:</strong> Check-in after {shiftForm.startTime} (+{shiftForm.lateGraceMinutes}m grace) is marked <strong>Late</strong>. Check-in after {shiftForm.halfDayLateCutoff} or early checkout before {shiftForm.minHoursForFullDay} hrs automatically registers as <strong className="text-amber-400">Half-Day</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {isManagerOrAdmin && (
              <Button
                size="sm"
                onClick={() => setIsShiftModalOpen(true)}
                className="bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-bold h-9 px-3.5 rounded-xl gap-1.5 shadow-sm"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#76C043]" /> Configure Shift Rules
              </Button>
            )}

            {isManagerOrAdmin && (
              <Button
                size="sm"
                onClick={() => {
                  setManualForm({
                    id: "",
                    staffName: usersList.length > 0 ? usersList[0].name : "",
                    staffRole: usersList.length > 0 ? usersList[0].role : "salesman",
                    date: selectedDate === "all" ? todayIST : selectedDate,
                    checkInTime: "10:00 AM",
                    checkOutTime: "06:00 PM",
                    status: "Present",
                    notes: "Manual attendance entry",
                  });
                  setIsManualModalOpen(true);
                }}
                className="bg-[#76C043] hover:bg-[#65aa37] text-slate-950 font-black text-xs h-9 px-3.5 rounded-xl gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Mark / Edit Attendance
              </Button>
            )}

            {isManagerOrAdmin && (
              <Button
                size="sm"
                onClick={() =>
                  attendanceMutation.mutate({
                    action: "bulk_mark_present",
                    payload: { date: selectedDate === "all" ? todayIST : selectedDate },
                  })
                }
                disabled={attendanceMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl gap-1.5 shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" /> 1-Click Mark All Present
              </Button>
            )}
          </div>
        </div>

        {/* ─── SUMMARY KPI METRICS CARDS ────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Total Staff</p>
            <p className="text-xl font-black text-slate-900">{metrics.totalStaff}</p>
            <p className="text-[10px] text-slate-400">Registered active users</p>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/20 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">Present</p>
            <p className="text-xl font-black text-emerald-700">{metrics.presentCount}</p>
            <p className="text-[10px] text-emerald-600 font-medium">On time / Full day</p>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-blue-200 bg-blue-50/20 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-blue-700 uppercase tracking-wider">In Shift</p>
            <p className="text-xl font-black text-blue-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
              {metrics.inShiftCount}
            </p>
            <p className="text-[10px] text-blue-600 font-medium">Active right now</p>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/20 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider">Shift Completed</p>
            <p className="text-xl font-black text-indigo-700">{metrics.completedCount}</p>
            <p className="text-[10px] text-indigo-600 font-medium">Checked in & out</p>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-amber-200 bg-amber-50/20 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">Late / Half-Day</p>
            <p className="text-xl font-black text-amber-700">{metrics.lateCount + metrics.halfDayCount}</p>
            <p className="text-[10px] text-amber-600 font-medium">
              {metrics.lateCount} Late • {metrics.halfDayCount} Half-Day
            </p>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-rose-200 bg-rose-50/20 shadow-sm space-y-1">
            <p className="text-[11px] font-bold text-rose-700 uppercase tracking-wider">Absent / Leave</p>
            <p className="text-xl font-black text-rose-700">
              {metrics.leaveCount + Math.max(0, metrics.totalStaff - metrics.presentCount - metrics.halfDayCount - metrics.leaveCount)}
            </p>
            <p className="text-[10px] text-rose-600 font-medium">{metrics.leaveCount} On Leave</p>
          </div>
        </div>

        {/* ─── QUICK PUNCH CONTROL BAR ────────────────────────── */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-bold text-slate-700">Select Employee:</span>
            {!isIndividualStaff ? (
              <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                <SelectTrigger className="w-[220px] h-9 text-xs font-bold border-slate-300">
                  <SelectValue placeholder="Select Staff" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">👥 All Staff Members ({usersList.length})</SelectItem>
                  {usersList.map((u: any) => (
                    <SelectItem key={u._id || u.email} value={u.name}>
                      {u.name} ({u.role?.toUpperCase() || "STAFF"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Badge className="bg-slate-100 text-slate-800 text-xs font-bold px-2.5 py-1">
                👤 {currentUserName}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() =>
                attendanceMutation.mutate({
                  action: "check_in",
                  payload: {
                    staffName: isIndividualStaff ? currentUserName : selectedStaff === "all" ? currentUserName : selectedStaff,
                    date: selectedDate === "all" ? todayIST : selectedDate,
                  },
                })
              }
              disabled={attendanceMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs h-9 px-4 rounded-xl gap-1.5 shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" /> Check In
            </Button>

            <Button
              size="sm"
              onClick={() =>
                attendanceMutation.mutate({
                  action: "check_out",
                  payload: {
                    staffName: isIndividualStaff ? currentUserName : selectedStaff === "all" ? currentUserName : selectedStaff,
                    date: selectedDate === "all" ? todayIST : selectedDate,
                  },
                })
              }
              disabled={attendanceMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white font-bold text-xs h-9 px-4 rounded-xl gap-1.5 shadow-sm"
            >
              <LogOut className="w-3.5 h-3.5" /> Check Out
            </Button>
          </div>
        </div>

        {/* ─── ATTENDANCE LOG TABLE WITH ADVANCED FILTERS ────────────────────────── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* TABLE TOOLBAR */}
          <div className="p-4 border-b flex flex-col md:flex-row items-start md:items-center justify-between gap-3 bg-slate-50/50">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="relative w-56">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <Input
                  placeholder="Search staff name / role..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-white"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 h-8 text-xs font-semibold bg-white">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="Present">Present</SelectItem>
                  <SelectItem value="in_shift">In Shift</SelectItem>
                  <SelectItem value="completed">Shift Completed</SelectItem>
                  <SelectItem value="Late">Late</SelectItem>
                  <SelectItem value="Half-Day">Half-Day</SelectItem>
                  <SelectItem value="On Leave">On Leave</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 font-medium">Filter Date:</span>
              <Input
                type="date"
                value={selectedDate === "all" ? "" : selectedDate}
                onChange={(e) => setSelectedDate(e.target.value || "all")}
                className="w-36 h-8 text-xs bg-white font-mono font-bold"
              />
              <Button
                size="sm"
                variant={selectedDate === todayIST ? "default" : "outline"}
                onClick={() => setSelectedDate(todayIST)}
                className="h-8 text-xs font-bold"
              >
                Today
              </Button>
              {selectedDate !== "all" && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedDate("all")} className="h-8 text-xs font-semibold">
                  View All
                </Button>
              )}
              <ExportMenu
                title="Staff Attendance"
                subtitle={`${filteredList.length} attendance records${selectedDate !== "all" ? ` for ${selectedDate}` : ""}`}
                data={(filteredList as any[]).map((r) => ({
                  "Employee Name": r.staffName || "",
                  Role: r.staffRole || "Staff",
                  Date: r.date || "",
                  "Check-In Time": r.checkInTime || "--",
                  "Check-Out Time": r.checkOutTime || "--",
                  Duration: durationLabelForExport(r),
                  Status: r.status || "Present",
                  Remarks: r.notes || "",
                }))}
                filename="staff-attendance"
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* TABLE DATA */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100/70 border-b text-slate-700 uppercase font-extrabold tracking-wider">
                <tr>
                  <th className="p-3.5">Staff Name & Role</th>
                  <th className="p-3.5">Date</th>
                  <th className="p-3.5">Check-In Time</th>
                  <th className="p-3.5">Check-Out Time</th>
                  <th className="p-3.5">Shift Working Duration</th>
                  <th className="p-3.5 text-center">Status</th>
                  <th className="p-3.5">Notes / Rule Trigger</th>
                  {isManagerOrAdmin && <th className="p-3.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="p-0">
                      <TableShimmer rows={6} cols={8} />
                    </td>
                  </tr>
                ) : filteredList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-10 text-center text-slate-400">
                      <UserCheck className="w-10 h-10 mx-auto text-slate-300 mb-2" />
                      <p className="font-bold text-slate-700 text-sm">No Attendance Records Found</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {selectedDate === todayIST
                          ? "Staff members can punch Check-In from their dashboard or Store Manager can 1-Click Mark All Present."
                          : "No records found for the selected date filter."}
                      </p>
                      {isManagerOrAdmin && selectedDate === todayIST && (
                        <Button
                          size="sm"
                          onClick={() =>
                            attendanceMutation.mutate({
                              action: "bulk_mark_present",
                              payload: { date: todayIST },
                            })
                          }
                          className="mt-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs"
                        >
                          <Zap className="w-3.5 h-3.5 mr-1" /> Mark All Present For Today
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredList.map((rec: any) => {
                    const isInProgress = !!rec.checkInTime && rec.checkInTime !== "--" && (!rec.checkOutTime || rec.checkOutTime === "--");
                    const isCompleted = !!rec.checkInTime && rec.checkInTime !== "--" && !!rec.checkOutTime && rec.checkOutTime !== "--";

                    const parseTimeToMinutes = (timeStr: string): number => {
                      if (!timeStr || timeStr === "--") return 0;
                      const match12 = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
                      if (match12) {
                        let hours = parseInt(match12[1], 10);
                        const minutes = parseInt(match12[2], 10);
                        const meridiem = match12[3]?.toUpperCase();
                        if (meridiem === "PM" && hours < 12) hours += 12;
                        if (meridiem === "AM" && hours === 12) hours = 0;
                        return hours * 60 + minutes;
                      }
                      const match24 = timeStr.match(/(\d+):(\d+)/);
                      if (match24) {
                        return parseInt(match24[1], 10) * 60 + parseInt(match24[2], 10);
                      }
                      return 0;
                    };

                    let durationLabel = "--";
                    if (rec.status === "On Leave") {
                      durationLabel = "🌴 On Leave (0 hrs)";
                    } else if (rec.status === "Absent") {
                      durationLabel = "❌ Absent (0 hrs)";
                    } else if (isCompleted) {
                      let durationMins = typeof rec.workingDurationMinutes === "number" && rec.workingDurationMinutes > 0
                        ? rec.workingDurationMinutes
                        : 0;

                      if (durationMins <= 0) {
                        const inM = parseTimeToMinutes(rec.checkInTime);
                        const outM = parseTimeToMinutes(rec.checkOutTime);
                        durationMins = Math.max(0, outM - inM);
                      }

                      const h = Math.floor(durationMins / 60);
                      const m = durationMins % 60;
                      durationLabel = `${h}h ${m}m (${(durationMins / 60).toFixed(1)} hrs)`;
                    } else if (isInProgress) {
                      const inM = parseTimeToMinutes(rec.checkInTime);
                      const now = new Date();
                      const nowM = now.getHours() * 60 + now.getMinutes();
                      const elapsed = Math.max(0, nowM - inM);
                      const h = Math.floor(elapsed / 60);
                      const m = elapsed % 60;
                      durationLabel = `🟢 ${h}h ${m}m (In Shift)`;
                    } else if (rec.workingDurationMinutes && rec.workingDurationMinutes > 0) {
                      const h = Math.floor(rec.workingDurationMinutes / 60);
                      const m = rec.workingDurationMinutes % 60;
                      durationLabel = `${h}h ${m}m (${(rec.workingDurationMinutes / 60).toFixed(1)} hrs)`;
                    }

                    return (
                      <tr key={rec._id || `${rec.staffName}-${rec.date}`} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#30539C] flex items-center justify-center font-bold text-xs shrink-0">
                              {rec.staffName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div>
                              <p className="font-bold text-slate-900">{rec.staffName}</p>
                              <p className="text-[10px] text-slate-400 uppercase font-mono">{rec.staffRole || "salesman"}</p>
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5 font-mono text-slate-600 font-medium">{rec.date}</td>

                        <td className="p-3.5">
                          {rec.checkInTime && rec.checkInTime !== "--" ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-emerald-700">{rec.checkInTime}</span>
                              {rec.isLate && (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[9px] px-1 py-0 font-bold">
                                  Late
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">--</span>
                          )}
                        </td>

                        <td className="p-3.5">
                          {rec.checkOutTime && rec.checkOutTime !== "--" ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-bold text-red-700">{rec.checkOutTime}</span>
                              {rec.isEarlyCheckout && (
                                <Badge className="bg-rose-100 text-rose-800 border-rose-300 text-[9px] px-1 py-0 font-bold">
                                  Early
                                </Badge>
                              )}
                            </div>
                          ) : isInProgress ? (
                            <span className="text-blue-600 font-bold flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" /> In Progress
                            </span>
                          ) : (
                            <span className="text-slate-400">--</span>
                          )}
                        </td>

                        <td className="p-3.5 font-medium text-slate-800">
                          <span
                            className={`font-mono text-xs px-2 py-0.5 rounded font-semibold ${
                              isInProgress
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : rec.status === "Half-Day"
                                ? "bg-amber-50 text-amber-800 border border-amber-200"
                                : "bg-slate-100 text-slate-800"
                            }`}
                          >
                            {durationLabel}
                          </span>
                        </td>

                        <td className="p-3.5 text-center">
                          <Badge
                            className={`text-[10px] font-bold px-2 py-0.5 ${
                              rec.status === "Present"
                                ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                : rec.status === "Late"
                                ? "bg-amber-100 text-amber-800 border border-amber-300"
                                : rec.status === "Half-Day"
                                ? "bg-orange-100 text-orange-800 border border-orange-300"
                                : rec.status === "On Leave"
                                ? "bg-blue-100 text-blue-800 border border-blue-300"
                                : "bg-slate-100 text-slate-800 border border-slate-300"
                            }`}
                          >
                            {rec.status || "Present"}
                          </Badge>
                        </td>

                        <td className="p-3.5 text-slate-500 text-[11px] max-w-[200px] truncate" title={rec.notes || ""}>
                          {rec.notes || "--"}
                        </td>

                        {isManagerOrAdmin && (
                          <td className="p-3.5 text-right space-x-1.5 shrink-0">
                            {isInProgress && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  attendanceMutation.mutate({
                                    action: "check_out",
                                    payload: { staffName: rec.staffName, date: rec.date },
                                  })
                                }
                                className="h-7 text-[10px] font-bold text-red-700 border-red-200 hover:bg-red-50"
                              >
                                Check Out
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setManualForm({
                                  id: rec._id,
                                  staffName: rec.staffName,
                                  staffRole: rec.staffRole || "salesman",
                                  date: rec.date,
                                  checkInTime: rec.checkInTime || "10:00 AM",
                                  checkOutTime: rec.checkOutTime || "06:00 PM",
                                  status: rec.status || "Present",
                                  notes: rec.notes || "",
                                });
                                setIsManualModalOpen(true);
                              }}
                              className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                if (confirm(`Delete attendance record for ${rec.staffName} on ${rec.date}?`)) {
                                  deleteMutation.mutate(rec._id);
                                }
                              }}
                              className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ─── MODAL 1: CONFIGURE SHIFT TIMINGS & HALF-DAY RULES ────────────────────────── */}
      <Dialog open={isShiftModalOpen} onOpenChange={setIsShiftModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-[#30539C]" />
              Configure Showroom Shift & Half-Day Rules
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              SuperAdmin & Store Manager controls for showroom working hours, late grace thresholds, and automatic Half-Day penalties.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div>
              <Label className="font-bold text-slate-700">Shift Name</Label>
              <Input
                value={shiftForm.shiftName}
                onChange={(e) => setShiftForm({ ...shiftForm, shiftName: e.target.value })}
                className="h-9 mt-1 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-700">Shift Start Time (24h)</Label>
                <Input
                  type="time"
                  value={shiftForm.startTime}
                  onChange={(e) => setShiftForm({ ...shiftForm, startTime: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Shift End Time (24h)</Label>
                <Input
                  type="time"
                  value={shiftForm.endTime}
                  onChange={(e) => setShiftForm({ ...shiftForm, endTime: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-700">Late Grace Period (Mins)</Label>
                <Input
                  type="number"
                  value={shiftForm.lateGraceMinutes}
                  onChange={(e) => setShiftForm({ ...shiftForm, lateGraceMinutes: Number(e.target.value) })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">e.g. 15 mins (Allowed till 10:15 AM)</p>
              </div>

              <div>
                <Label className="font-bold text-slate-700">Half-Day Cutoff Time</Label>
                <Input
                  type="time"
                  value={shiftForm.halfDayLateCutoff}
                  onChange={(e) => setShiftForm({ ...shiftForm, halfDayLateCutoff: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">Check-in past this = Half-Day</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-700">Min Full-Day Hours</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={shiftForm.minHoursForFullDay}
                  onChange={(e) => setShiftForm({ ...shiftForm, minHoursForFullDay: Number(e.target.value) })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">Early checkout below this = Half-Day</p>
              </div>

              <div>
                <Label className="font-bold text-slate-700">Min Half-Day Hours</Label>
                <Input
                  type="number"
                  step="0.5"
                  value={shiftForm.minHoursForHalfDay}
                  onChange={(e) => setShiftForm({ ...shiftForm, minHoursForHalfDay: Number(e.target.value) })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
                <p className="text-[10px] text-slate-400 mt-0.5">Below this = Absent</p>
              </div>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsShiftModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              onClick={() => saveShiftMutation.mutate(shiftForm)}
              disabled={saveShiftMutation.isPending}
              className="bg-[#30539C] hover:bg-[#203a70] text-white font-bold text-xs"
            >
              Save Shift Settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL 2: MANUAL ATTENDANCE ENTRY / EDIT ────────────────────────── */}
      <Dialog open={isManualModalOpen} onOpenChange={setIsManualModalOpen}>
        <DialogContent className="max-w-md bg-white rounded-2xl shadow-2xl p-6 border border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-base font-black text-slate-900 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-[#76C043]" />
              {manualForm.id ? "Edit Attendance Record" : "Mark Staff Attendance"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Set custom check-in/out times, working status, and administrative remarks.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div>
              <Label className="font-bold text-slate-700">Staff Member</Label>
              <Select
                value={manualForm.staffName}
                onValueChange={(val) => {
                  const user = usersList.find((u: any) => u.name === val);
                  setManualForm({
                    ...manualForm,
                    staffName: val,
                    staffRole: user?.role || "salesman",
                  });
                }}
              >
                <SelectTrigger className="h-9 text-xs font-bold mt-1">
                  <SelectValue placeholder="Select Staff" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {usersList.map((u: any) => (
                    <SelectItem key={u._id || u.email} value={u.name}>
                      {u.name} ({u.role?.toUpperCase() || "STAFF"})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-700">Date</Label>
                <Input
                  type="date"
                  value={manualForm.date}
                  onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono font-bold"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Status</Label>
                <Select
                  value={manualForm.status}
                  onValueChange={(val: any) => setManualForm({ ...manualForm, status: val })}
                >
                  <SelectTrigger className="h-9 text-xs font-bold mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Present">Present (Full Day)</SelectItem>
                    <SelectItem value="Late">Late (On Duty)</SelectItem>
                    <SelectItem value="Half-Day">Half-Day</SelectItem>
                    <SelectItem value="On Leave">On Leave</SelectItem>
                    <SelectItem value="Absent">Absent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="font-bold text-slate-700">Check-In Time</Label>
                <Input
                  placeholder="e.g. 10:00 AM"
                  value={manualForm.checkInTime}
                  onChange={(e) => setManualForm({ ...manualForm, checkInTime: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono"
                />
              </div>

              <div>
                <Label className="font-bold text-slate-700">Check-Out Time</Label>
                <Input
                  placeholder="e.g. 06:00 PM"
                  value={manualForm.checkOutTime}
                  onChange={(e) => setManualForm({ ...manualForm, checkOutTime: e.target.value })}
                  className="h-9 mt-1 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <Label className="font-bold text-slate-700">Admin Remarks</Label>
              <Input
                placeholder="e.g. Regular Showroom Shift / Approved by Manager"
                value={manualForm.notes}
                onChange={(e) => setManualForm({ ...manualForm, notes: e.target.value })}
                className="h-9 mt-1 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="ghost" onClick={() => setIsManualModalOpen(false)} className="text-xs">
              Cancel
            </Button>
            <Button
              onClick={() =>
                attendanceMutation.mutate({
                  action: "manual_entry",
                  payload: {
                    staffName: manualForm.staffName,
                    staffRole: manualForm.staffRole,
                    date: manualForm.date,
                    checkInTime: manualForm.checkInTime,
                    checkOutTime: manualForm.checkOutTime,
                    status: manualForm.status,
                    notes: manualForm.notes,
                  },
                })
              }
              disabled={attendanceMutation.isPending || !manualForm.staffName}
              className="bg-[#76C043] hover:bg-[#65aa37] text-slate-950 font-black text-xs"
            >
              Save Attendance Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
