"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  ShieldCheck, CheckCircle2, XCircle, Clock, AlertTriangle, 
  Store, User, DollarSign, ArrowRight, Sparkles, Filter, RefreshCw
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function SuperAdminApprovalsPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [filterStatus, setFilterStatus] = useState("all");
  const [selectedActivity, setSelectedActivity] = useState<any | null>(null);
  const [actionNotes, setActionNotes] = useState("");
  const [isActionModalOpen, setIsActionModalOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<"approve" | "reject">("approve");

  const { data: approvalsData, isLoading, refetch } = useQuery({
    queryKey: ["store-approvals", filterStatus],
    queryFn: async () => {
      const res = await fetch(`/api/approvals?status=${filterStatus}`);
      const json = await res.json();
      return json.success ? json : { data: [], pendingCount: 0 };
    },
    refetchInterval: 10000, // Live poll every 10s
  });

  const approvals = approvalsData?.data || [];
  const pendingCount = approvalsData?.pendingCount || 0;

  const actionMutation = useMutation({
    mutationFn: async ({ activityId, action, notes }: { activityId: string; action: "approve" | "reject"; notes: string }) => {
      const res = await fetch("/api/approvals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId, action, notes }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: (data) => {
      toast.success(data.message || "Approval status updated!");
      queryClient.invalidateQueries({ queryKey: ["store-approvals"] });
      setIsActionModalOpen(false);
      setSelectedActivity(null);
      setActionNotes("");
    },
    onError: (err: any) => {
      toast.error(err.message || "Something went wrong");
    },
  });

  const handleOpenActionModal = (activity: any, action: "approve" | "reject") => {
    setSelectedActivity(activity);
    setPendingAction(action);
    setActionNotes("");
    setIsActionModalOpen(true);
  };

  const handleConfirmAction = () => {
    if (!selectedActivity) return;
    actionMutation.mutate({
      activityId: selectedActivity.activityId,
      action: pendingAction,
      notes: actionNotes,
    });
  };

  return (
    <PageShell
      title="Store Incharge Activity Approvals"
      subtitle="Super Admin Master Control: Review and authorize branch manager activities"
      breadcrumbs={[{ label: "Super Admin" }, { label: "Activity Approvals" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Store Incharge Activity Approvals"
            subtitle={`${approvals.length} requests (${filterStatus})`}
            data={approvals.map((act: any) => ({
              "Request ID": act.activityId,
              Date: formatDate(act.createdAt),
              Store: act.storeName,
              Incharge: act.storeInchargeName,
              "Incharge Email": act.storeInchargeEmail,
              "Activity Type": act.activityType?.replace("_", " "),
              Title: act.title,
              Description: act.description,
              "Value (₹)": act.amount > 0 ? act.amount : 0,
              Status: act.status,
            }))}
            filename="activity-approvals"
          />
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh Live Requests
          </Button>
        </div>
      }
    >
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Pending Action Required</p>
            <Clock className="w-5 h-5 text-amber-600 animate-pulse" />
          </div>
          <p className="text-3xl font-black text-amber-900 mt-2">{pendingCount}</p>
          <p className="text-xs text-amber-700 mt-1">Requires Super Admin sign-off</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/30 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Approved Activities</p>
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-900 mt-2">
            {approvals.filter((a: any) => a.status === "approved").length}
          </p>
          <p className="text-xs text-emerald-700 mt-1">Authorized store operations</p>
        </div>

        <div className="bg-gradient-to-br from-red-500/10 to-rose-500/10 border border-red-500/30 rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-red-700 uppercase tracking-wider">Rejected Requests</p>
            <XCircle className="w-5 h-5 text-red-600" />
          </div>
          <p className="text-3xl font-black text-red-900 mt-2">
            {approvals.filter((a: any) => a.status === "rejected").length}
          </p>
          <p className="text-xs text-red-700 mt-1">Blocked or returned for revision</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 mb-4 bg-slate-100 p-1.5 rounded-xl w-fit">
        {["all", "pending", "approved", "rejected"].map((st) => (
          <button
            key={st}
            onClick={() => setFilterStatus(st)}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
              filterStatus === st
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {st === "all" ? "All Requests" : st}
            {st === "pending" && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-amber-500 text-white text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Approvals Table */}
      <div className="data-table-container">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Request ID & Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Store & Incharge</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Activity Details</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Value (₹)</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase w-32">Super Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading approval queue...</td>
                </tr>
              ) : approvals.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-2 opacity-60" />
                    <p className="font-bold text-slate-700">No Pending Store Incharge Requests</p>
                    <p className="text-xs text-slate-400 mt-1">All branch activities are currently reviewed and in order.</p>
                  </td>
                </tr>
              ) : (
                approvals.map((act: any) => (
                  <tr key={act.activityId} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-mono font-bold text-[#30539C]">{act.activityId}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{formatDate(act.createdAt)}</p>
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Store className="w-3.5 h-3.5 text-slate-500" />
                        <p className="font-semibold text-slate-900">{act.storeName}</p>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                        <User className="w-3 h-3 text-slate-400" />
                        {act.storeInchargeName} ({act.storeInchargeEmail})
                      </p>
                    </td>

                    <td className="px-4 py-3">
                      <Badge variant="outline" className="text-[10px] font-bold uppercase mb-1">
                        {act.activityType?.replace("_", " ")}
                      </Badge>
                      <p className="font-bold text-slate-900 text-xs">{act.title}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{act.description}</p>
                    </td>

                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">
                      {act.amount > 0 ? formatCurrency(act.amount) : "—"}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={
                          act.status === "approved"
                            ? "success"
                            : act.status === "rejected"
                            ? "destructive"
                            : "warning"
                        }
                      >
                        {act.status.toUpperCase()}
                      </Badge>
                    </td>

                    <td className="px-4 py-3 text-center">
                      {act.status === "pending" ? (
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleOpenActionModal(act, "approve")}
                            className="h-7 px-2.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleOpenActionModal(act, "reject")}
                            className="h-7 px-2.5 text-[11px] font-bold border-red-200 text-red-600 hover:bg-red-50"
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                          </Button>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 font-medium">
                          {act.superAdminNotes || "Resolved"}
                        </p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Modal */}
      <Dialog open={isActionModalOpen} onOpenChange={setIsActionModalOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingAction === "approve" ? (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  <span>Authorize Store Activity</span>
                </>
              ) : (
                <>
                  <XCircle className="w-5 h-5 text-red-600" />
                  <span>Reject Store Activity</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {selectedActivity && (
                <span className="text-xs text-slate-500">
                  Request #{selectedActivity.activityId} from {selectedActivity.storeName}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {selectedActivity && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 p-3 rounded-xl border space-y-1.5 text-xs">
                <p className="font-bold text-slate-800">{selectedActivity.title}</p>
                <p className="text-slate-600">{selectedActivity.description}</p>
                {selectedActivity.amount > 0 && (
                  <p className="font-mono font-bold text-emerald-700 pt-1">
                    Value: {formatCurrency(selectedActivity.amount)}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Super Admin Remarks / Instructions</Label>
                <Textarea
                  placeholder={
                    pendingAction === "approve"
                      ? "Optional: Approval remarks or conditions..."
                      : "Reason for rejecting this request..."
                  }
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsActionModalOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmAction}
              disabled={actionMutation.isPending}
              className={
                pendingAction === "approve"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                  : "bg-red-600 hover:bg-red-700 text-white font-bold"
              }
            >
              {actionMutation.isPending
                ? "Processing..."
                : pendingAction === "approve"
                ? "Confirm & Approve"
                : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
