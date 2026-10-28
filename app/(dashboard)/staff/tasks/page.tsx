"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { 
  CheckSquare, Plus, Search, Clock, Calendar, CheckCircle2, 
  AlertCircle, Trash2, Crown, Users, Check, Target, 
  Sparkles, FileText, ArrowRight, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { todayInIndia } from "@/lib/today";

export default function StaffTasksPage() {
  const queryClient = useQueryClient();
  const { data: session, status: sessionStatus } = useSession();
  // Unknown until the session has loaded — never assumed to be "admin", which
  // used to fetch every staff member's tasks for whoever was logging in.
  const userRole = String((session?.user as any)?.role || "").toLowerCase();
  const currentUserName = session?.user?.name || "Staff Member";
  const isSuperAdminOrAdmin = userRole === "admin" || userRole === "superadmin" || userRole === "manager" || userRole === "hr";
  const isIndividualStaff = !isSuperAdminOrAdmin;

  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState<string>("all");
  const [isNewTaskOpen, setIsNewTaskOpen] = useState(false);
  const [selectedTaskForDone, setSelectedTaskForDone] = useState<any | null>(null);
  const [completionRemarks, setCompletionRemarks] = useState("");

  const todayStr = todayInIndia();

  const [form, setForm] = useState({
    taskTitle: "",
    assignedStaff: isIndividualStaff ? currentUserName : "Admin (Self)",
    priority: "Medium" as "Low" | "Medium" | "High" | "Urgent",
    assignedDate: todayStr,
    dueDate: todayStr,
    dueTime: "18:00",
    description: "",
    status: "Pending" as "Pending" | "In Progress" | "Completed" | "Overdue",
    taskType: "general" as "general" | "sales_target" | "follow_up" | "product_demo",
    targetProduct: "",
    targetBrand: "",
    targetQty: 1,
    targetAmount: 0,
    createdBy: currentUserName,
  });

  // Fetch real registered users from MongoDB
  const { data: usersList = [] } = useQuery({
    queryKey: ["users-for-tasks"],
    queryFn: async () => {
      const res = await fetch("/api/users");
      const json = await res.json();
      return json.success && Array.isArray(json.data) ? json.data : [];
    },
  });

  // Fetch tasks
  const { data: rawTasks = [], isLoading, refetch } = useQuery({
    queryKey: ["staffTasks", isIndividualStaff ? currentUserName : "all"],
    enabled: sessionStatus === "authenticated" && Boolean(userRole),
    queryFn: async () => {
      let url = "/api/staff/tasks";
      if (isIndividualStaff) {
        url += `?staff=${encodeURIComponent(currentUserName)}`;
      }
      const res = await fetch(url);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Strict isolation for individual staff
  const userScopedTasks = useMemo(() => {
    if (!isIndividualStaff) return rawTasks;
    const me = currentUserName.trim().toLowerCase();
    const myId = String((session?.user as any)?.id || "");
    return rawTasks.filter((t: any) => {
      const assigned = (t.assignedStaff || "").trim().toLowerCase();
      return (
        (myId && String(t.assignedStaffId || "") === myId) ||
        assigned === me ||
        assigned === "all staff" ||
        assigned === "sales staff" ||
        String(t.createdBy || "").trim().toLowerCase() === me
      );
    });
  }, [rawTasks, isIndividualStaff, currentUserName, session]);

  // Create Task Mutation
  const createTaskMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/staff/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, createdBy: currentUserName }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create task");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(
        data.taskType === "sales_target"
          ? `🎯 Sales Target Task assigned! It will automatically complete when invoices are billed.`
          : `Task "${data.taskTitle}" created successfully!`
      );
      queryClient.invalidateQueries({ queryKey: ["staffTasks"] });
      setIsNewTaskOpen(false);
      setForm({
        taskTitle: "",
        assignedStaff: isIndividualStaff ? currentUserName : "Admin (Self)",
        priority: "Medium",
        assignedDate: todayStr,
        dueDate: todayStr,
        dueTime: "18:00",
        description: "",
        status: "Pending",
        taskType: "general",
        targetProduct: "",
        targetBrand: "",
        targetQty: 1,
        targetAmount: 0,
        createdBy: currentUserName,
      });
    },
    onError: (err: any) => toast.error(err.message || "Failed to create task"),
  });

  // Update Status / Mark Done Mutation
  const updateStatusMutation = useMutation({
    mutationFn: async (payload: { id: string; status: string; completionRemarks?: string }) => {
      const res = await fetch("/api/staff/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to update task");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`Task marked as ${data.status}!`);
      queryClient.invalidateQueries({ queryKey: ["staffTasks"] });
      setSelectedTaskForDone(null);
      setCompletionRemarks("");
    },
    onError: (err: any) => toast.error(err.message || "Failed to update status"),
  });

  // Delete Task Mutation
  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/staff/tasks?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete task");
      return json;
    },
    onSuccess: () => {
      toast.success("Task deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["staffTasks"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to delete task"),
  });

  // Filtering
  const filtered = useMemo(() => {
    return userScopedTasks.filter((t: any) => {
      const matchesSearch =
        (t.taskTitle || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.assignedStaff || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.description || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
        (t.targetProduct || "").toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      if (activeTab === "sales_targets") return t.taskType === "sales_target";
      if (activeTab === "pending") return t.status === "Pending" || t.status === "In Progress";
      if (activeTab === "completed") return t.status === "Completed";
      if (activeTab === "overdue") {
        const isPastDue = t.dueDate && t.dueDate < todayStr && t.status !== "Completed";
        return t.status === "Overdue" || isPastDue;
      }
      return true;
    });
  }, [userScopedTasks, searchTerm, activeTab, todayStr]);

  // Metrics
  const totalCount = userScopedTasks.length;
  const pendingCount = userScopedTasks.filter((t: any) => t.status === "Pending" || t.status === "In Progress").length;
  const completedCount = userScopedTasks.filter((t: any) => t.status === "Completed").length;
  const targetTasksCount = userScopedTasks.filter((t: any) => t.taskType === "sales_target").length;

  return (
    <PageShell
      title={isIndividualStaff ? "My Tasks & Sales Targets" : "Staff Tasks & Sales Delegation"}
      description="Manage staff tasks with assigned dates, target deadlines, and automated invoice completion hooks."
      breadcrumbs={[
        { label: "Staff & Attendance", href: "/staff/attendance" },
        { label: "Tasks & Targets" },
      ]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title={isIndividualStaff ? "My Tasks" : "Staff Tasks"}
            subtitle={`${filtered.length} tasks`}
            data={(filtered as any[]).map((t) => ({
              "Task Title": t.taskTitle,
              Description: t.description || "",
              "Assigned To": t.assignedStaff,
              "Assigned Date": t.assignedDate || "",
              "Due Date": t.dueDate || "",
              "Due Time": t.dueTime || "",
              Priority: t.priority,
              Status:
                t.status === "Completed"
                  ? "Completed"
                  : t.dueDate && t.dueDate < todayStr && t.status !== "Completed"
                  ? "Overdue"
                  : t.status,
            }))}
            filename="staff-tasks"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-1.5" /> Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setIsNewTaskOpen(true)}
            className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold"
          >
            <Plus className="w-4 h-4 mr-1.5" /> {isIndividualStaff ? "+ Add My Task" : "Assign New Task"}
          </Button>
        </div>
      }
    >
      {/* ─── KPI METRIC CARDS ──────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Tasks</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{totalCount}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
            <CheckSquare className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-purple-200 dark:border-purple-900/40 shadow-sm flex items-center justify-between bg-gradient-to-br from-purple-500/5 to-transparent">
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">🎯 Sales Targets</p>
              <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-800">Auto Invoice</Badge>
            </div>
            <p className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">{targetTasksCount}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center">
            <Target className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">Pending / In Progress</p>
            <p className="text-2xl font-black text-amber-600 dark:text-amber-400 mt-1">{pendingCount}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/40 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Completed</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{completedCount}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* ─── TABS & SEARCH ──────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {[
            { id: "all", label: "📋 All Tasks" },
            { id: "sales_targets", label: "🎯 Sales Targets (Auto-Invoice)", badge: targetTasksCount },
            { id: "pending", label: "⏳ Pending", badge: pendingCount },
            { id: "completed", label: "✅ Completed" },
          ].map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-lg text-xs font-bold shrink-0 ${
                activeTab === tab.id
                  ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow"
                  : "text-slate-600 dark:text-slate-400 hover:bg-slate-100"
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-purple-600 text-white font-extrabold">
                  {tab.badge}
                </span>
              )}
            </Button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search task, staff, target product..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 text-xs h-9 bg-white dark:bg-slate-900 rounded-lg"
          />
        </div>
      </div>

      {/* ─── TASKS TABLE ──────────────── */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-x-auto">
        <table className="w-full min-w-[720px] text-xs text-left">
          <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 uppercase font-bold text-[10.5px]">
            <tr>
              <th className="p-3 w-10 text-center">Done</th>
              <th className="p-3">Task Details & Targets</th>
              {!isIndividualStaff && <th className="p-3">Assigned To</th>}
              <th className="p-3">Timeline (Assigned & Due)</th>
              <th className="p-3">Priority</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="p-0">
                  <TableShimmer rows={6} cols={7} />
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-12 text-center text-slate-500 font-medium">
                  No tasks found in this view. Click &quot;{isIndividualStaff ? "Add My Task" : "Assign New Task"}&quot; to create one.
                </td>
              </tr>
            ) : (
              filtered.map((t: any) => {
                const isDone = t.status === "Completed";
                const isSalesTarget = t.taskType === "sales_target";
                const isOverdue = t.dueDate && t.dueDate < todayStr && !isDone;

                return (
                  <tr
                    key={t._id}
                    className={cn(
                      "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors",
                      isDone && "bg-slate-50/40 dark:bg-slate-900/40 opacity-80",
                      isSalesTarget && !isDone && "bg-purple-50/20 dark:bg-purple-950/10"
                    )}
                  >
                    {/* Done Checkbox */}
                    <td className="p-3 text-center">
                      <button
                        onClick={() => {
                          if (isDone) {
                            updateStatusMutation.mutate({ id: t._id, status: "Pending" });
                          } else {
                            setSelectedTaskForDone(t);
                          }
                        }}
                        className={cn(
                          "w-5 h-5 rounded-md flex items-center justify-center border transition-colors mx-auto",
                          isDone
                            ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                            : "border-slate-300 hover:border-slate-500 bg-white dark:bg-slate-800"
                        )}
                        title={isDone ? "Mark as Pending" : "Mark as Done"}
                      >
                        {isDone && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </button>
                    </td>

                    {/* Task Title & Target Details */}
                    <td className="p-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={cn("font-bold text-slate-900 dark:text-slate-100", isDone && "line-through text-slate-400")}>
                            {t.taskTitle}
                          </p>
                          {isSalesTarget && (
                            <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 text-[10px] flex items-center gap-1">
                              <Target className="w-3 h-3" /> Auto-Invoice Target
                            </Badge>
                          )}
                        </div>

                        {t.description && <p className="text-[11px] text-slate-500 line-clamp-2">{t.description}</p>}

                        {/* Sales Target Progress Bar */}
                        {isSalesTarget && (
                          <div className="mt-1.5 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800/50 space-y-1 text-[11px]">
                            <div className="flex justify-between font-bold text-purple-900 dark:text-purple-200">
                              <span>
                                Target: {t.targetProduct || t.targetBrand || "Sales"}
                                {t.targetQty > 0 ? ` (${t.currentQty || 0}/${t.targetQty} Qty)` : ""}
                              </span>
                              <span>
                                {t.targetAmount > 0 ? `₹${(t.currentAmount || 0).toLocaleString("en-IN")} / ₹${t.targetAmount.toLocaleString("en-IN")}` : ""}
                              </span>
                            </div>

                            {t.linkedInvoiceNumber && (
                              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono font-bold flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> Linked Invoice: {t.linkedInvoiceNumber}
                              </p>
                            )}

                            {t.completionRemarks && (
                              <p className="text-[10.5px] text-slate-600 dark:text-slate-400 italic">
                                Note: {t.completionRemarks}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Assigned Staff */}
                    {!isIndividualStaff && (
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono inline-flex items-center gap-1 border bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800">
                          👤 {t.assignedStaff}
                        </span>
                      </td>
                    )}

                    {/* Assigned Date & Due Date */}
                    <td className="p-3">
                      <div className="space-y-1 font-mono text-[11px]">
                        <p className="text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-400" /> 
                          <span className="text-[10px] uppercase font-bold text-slate-400">Assigned:</span> {t.assignedDate || "Today"}
                        </p>
                        <p className={cn("font-bold flex items-center gap-1", isOverdue ? "text-red-600" : "text-slate-800 dark:text-slate-200")}>
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span className="text-[10px] uppercase font-bold text-slate-400">Due:</span> {t.dueDate} {t.dueTime ? `· ${t.dueTime}` : ""}
                          {isOverdue && <span className="text-[10px] px-1 py-0.2 rounded bg-red-100 text-red-700">Overdue</span>}
                        </p>
                      </div>
                    </td>

                    {/* Priority */}
                    <td className="p-3">
                      <Badge
                        className={
                          t.priority === "Urgent"
                            ? "bg-rose-100 text-rose-800 border-rose-200"
                            : t.priority === "High"
                            ? "bg-orange-100 text-orange-800 border-orange-200"
                            : t.priority === "Low"
                            ? "bg-slate-100 text-slate-700"
                            : "bg-blue-100 text-blue-800 border-blue-200"
                        }
                      >
                        {t.priority}
                      </Badge>
                    </td>

                    {/* Status */}
                    <td className="p-3">
                      <Badge
                        className={
                          t.status === "Completed"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : t.status === "In Progress"
                            ? "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300"
                            : isOverdue
                            ? "bg-rose-100 text-rose-800"
                            : "bg-amber-100 text-amber-800"
                        }
                      >
                        {isOverdue ? "Overdue" : t.status}
                      </Badge>
                    </td>

                    {/* Actions */}
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {!isDone ? (
                          <Button
                            size="sm"
                            onClick={() => setSelectedTaskForDone(t)}
                            className="h-7 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                          >
                            <Check className="w-3 h-3 mr-1" /> Mark Done
                          </Button>
                        ) : (
                          <span className="text-[10.5px] text-emerald-600 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Done
                          </span>
                        )}
                        {isSuperAdminOrAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteTaskMutation.mutate(t._id)}
                            className="h-7 w-7 text-slate-400 hover:text-rose-600"
                            title="Delete Task"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ─── MODAL: ASSIGN / CREATE TASK ──────────────── */}
      <Dialog open={isNewTaskOpen} onOpenChange={setIsNewTaskOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-black flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-[#30539C]" />
              {isIndividualStaff ? "Add Personal Task" : "Assign Staff Task & Sales Target"}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Set task deadlines with assigned dates and automatic POS invoice sales target completion.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              createTaskMutation.mutate(form);
            }}
            className="space-y-3.5 pt-2 text-xs"
          >
            {/* Task Type Toggle */}
            <div>
              <Label className="text-xs font-bold">Task Type *</Label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, taskType: "general" })}
                  className={`p-2.5 rounded-xl border text-left font-bold ${
                    form.taskType === "general"
                      ? "border-blue-500 bg-blue-50 text-blue-900 ring-2 ring-blue-500/20"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="text-xs font-bold">📝 General Task</p>
                  <p className="text-[10px] text-slate-500 font-normal mt-0.5">Checklist, DO verification, customer follow-up</p>
                </button>

                <button
                  type="button"
                  onClick={() => setForm({ ...form, taskType: "sales_target" })}
                  className={`p-2.5 rounded-xl border text-left font-bold ${
                    form.taskType === "sales_target"
                      ? "border-purple-500 bg-purple-50 text-purple-900 ring-2 ring-purple-500/20"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <p className="text-xs font-bold">🎯 Sales Target (Auto-Invoice)</p>
                  <p className="text-[10px] text-purple-600 font-normal mt-0.5">Auto-completes as soon as salesman bills in POS</p>
                </button>
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold">Task Title *</Label>
              <Input
                placeholder={
                  form.taskType === "sales_target"
                    ? "e.g. Sell 2 Haier 1.5 Ton ACs today"
                    : "e.g. Verify Bajaj Finance DO Settlement / Showroom Audit"
                }
                value={form.taskTitle}
                onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
                required
                className="mt-1 text-xs h-9 font-medium"
              />
            </div>

            {/* Target Fields (If Sales Target) */}
            {form.taskType === "sales_target" && (
              <div className="p-3 bg-purple-50/80 rounded-xl border border-purple-200 space-y-3 animate-in fade-in">
                <div className="flex items-center gap-1.5 text-purple-900 font-bold text-xs">
                  <Target className="w-4 h-4 text-purple-600" /> Sales Target Automation Criteria
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-purple-950 font-semibold">Target Product / Keyword</Label>
                    <Input
                      placeholder="e.g. Haier 1.5T / Smart TV"
                      value={form.targetProduct}
                      onChange={(e) => setForm({ ...form, targetProduct: e.target.value })}
                      className="mt-1 h-8 text-xs bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-purple-950 font-semibold">Target Brand (Optional)</Label>
                    <Input
                      placeholder="e.g. Haier / Sony / Daikin"
                      value={form.targetBrand}
                      onChange={(e) => setForm({ ...form, targetBrand: e.target.value })}
                      className="mt-1 h-8 text-xs bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-purple-950 font-semibold">Target Quantity (Units)</Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.targetQty}
                      onChange={(e) => setForm({ ...form, targetQty: Number(e.target.value) })}
                      className="mt-1 h-8 text-xs bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-purple-950 font-semibold">Target Revenue (₹ Optional)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 50000"
                      value={form.targetAmount || ""}
                      onChange={(e) => setForm({ ...form, targetAmount: Number(e.target.value) })}
                      className="mt-1 h-8 text-xs bg-white"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-bold">Assign To *</Label>
                {isIndividualStaff ? (
                  <Input value={currentUserName} disabled className="mt-1 bg-slate-100 text-xs h-9 font-bold" />
                ) : (
                  <select
                    value={form.assignedStaff}
                    onChange={(e) => setForm({ ...form, assignedStaff: e.target.value })}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-xs font-bold shadow-xs"
                  >
                    <option value="Admin (Self)">👑 Admin (Self)</option>
                    <option value="All Staff">👥 All Showroom Staff</option>
                    <option value="Sales Staff">💼 All Sales Staff</option>
                    {usersList.map((u: any) => (
                      <option key={u._id || u.email} value={u.name}>
                        👤 {u.name} ({u.role?.toUpperCase() || "STAFF"}) {u.assignedBrand ? `• 🏷️ ${u.assignedBrand}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <Label className="text-xs font-bold">Priority</Label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: e.target.value as any })}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-white px-3 py-1 text-xs font-bold shadow-xs"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Urgent">🔥 Urgent</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-bold">Assigned Date *</Label>
                <Input
                  type="date"
                  required
                  value={form.assignedDate}
                  onChange={(e) => setForm({ ...form, assignedDate: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>

              <div>
                <Label className="text-xs font-bold">Due Date *</Label>
                <Input
                  type="date"
                  required
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>

              <div>
                <Label className="text-xs font-bold">Due Time</Label>
                <Input
                  type="time"
                  value={form.dueTime}
                  onChange={(e) => setForm({ ...form, dueTime: e.target.value })}
                  className="mt-1 bg-white text-xs h-9 font-medium"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs font-bold">Description / Instructions</Label>
              <textarea
                placeholder="Add actionable instructions for staff member..."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={2}
                className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-xs font-medium shadow-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsNewTaskOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createTaskMutation.isPending}
                className="bg-[#30539C] hover:bg-[#1E3A8A] text-white font-bold px-4"
              >
                {createTaskMutation.isPending ? "Assigning..." : "Save & Assign Task"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL: STAFF MARK AS DONE WITH REMARKS ──────────────── */}
      <Dialog open={!!selectedTaskForDone} onOpenChange={(open) => !open && setSelectedTaskForDone(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-black flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="w-5 h-5" /> Mark Task as Completed
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Confirm completion and add any notes, invoice references, or customer feedback.
            </DialogDescription>
          </DialogHeader>

          {selectedTaskForDone && (
            <div className="space-y-3 py-2 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border">
                <p className="font-bold text-slate-900 dark:text-white">{selectedTaskForDone.taskTitle}</p>
                <p className="text-slate-500 text-[11px] mt-0.5">Assigned to: {selectedTaskForDone.assignedStaff}</p>
              </div>

              <div>
                <Label className="text-xs font-bold">Completion Remarks / Notes (Optional)</Label>
                <Input
                  placeholder="e.g. Followed up with customer / DO settlement verified / Target completed"
                  value={completionRemarks}
                  onChange={(e) => setCompletionRemarks(e.target.value)}
                  className="mt-1 text-xs h-9"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setSelectedTaskForDone(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={updateStatusMutation.isPending}
              onClick={() =>
                updateStatusMutation.mutate({
                  id: selectedTaskForDone._id,
                  status: "Completed",
                  completionRemarks: completionRemarks || `Completed by ${currentUserName}`,
                })
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
            >
              {updateStatusMutation.isPending ? "Completing..." : "Confirm Done ✅"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
