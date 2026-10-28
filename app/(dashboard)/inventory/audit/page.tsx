"use client";

import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  ClipboardCheck, Plus, AlertTriangle, CheckCircle2, Search, 
  Package, Sparkles, ShieldAlert, ArrowRight
} from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/context/BranchContext";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

export default function InventoryAuditPage() {
  const queryClient = useQueryClient();
  const { activeLocation } = useBranch();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);

  const { data: items = [] } = useQuery({
    queryKey: ["items", activeLocation?.name],
    queryFn: async () => {
      const whParam = activeLocation?.name ? `?warehouse=${encodeURIComponent(activeLocation.name)}` : "";
      const res = await fetch(`/api/items${whParam}`);
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const { data: audits = [], isLoading } = useQuery({
    queryKey: ["audits", activeLocation?.name],
    queryFn: async () => {
      const res = await fetch("/api/inventory/audit");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const [auditItems, setAuditItems] = useState<any[]>([]);
  const [auditorName, setAuditorName] = useState("Amit Singh (Store Manager)");

  const startNewAudit = () => {
    const initialList = items.map((it: any) => ({
      productId: it._id,
      productName: it.name,
      vpCode: it.vpCode || it.code,
      category: it.category || "Electronics",
      expectedStock: it.currentStock || 0,
      physicalStock: it.currentStock || 0,
      difference: 0,
      condition: "Good" as any,
      remarks: "",
    }));
    setAuditItems(initialList);
    setIsAuditModalOpen(true);
  };

  const handleStockChange = (idx: number, physicalVal: number) => {
    const updated = [...auditItems];
    const expected = updated[idx].expectedStock;
    updated[idx].physicalStock = physicalVal;
    updated[idx].difference = physicalVal - expected;
    setAuditItems(updated);
  };

  const submitAuditMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/inventory/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to submit audit");
      return json.data;
    },
    onSuccess: (data: any) => {
      toast.success("Daily Inventory Audit successfully completed & recorded!");
      queryClient.invalidateQueries({ queryKey: ["audits"] });
      queryClient.invalidateQueries({ queryKey: ["auditPending"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setIsAuditModalOpen(false);
    },
    onError: (err: any) => toast.error(err.message),
  });

  return (
    <PageShell
      title="Daily Inventory Inspection Audit"
      description="Perform daily physical showroom stock counts, identify discrepancies between expected and physical inventory, and resolve leakage."
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[260px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search past audit records..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-300 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <ExportMenu
              title="Daily Inventory Inspection Audit"
              subtitle={`${audits.length} audit records`}
              data={audits.map((a: any) => ({
                "Audit Date": a.auditDate,
                Auditor: a.auditor,
                "Expected Stock": a.totalExpected,
                "Physical Count": a.totalPhysical,
                "Discrepancy (Units)": a.totalDiscrepancy,
                Status: a.status,
                "Completion Time": a.completionTime || "",
              }))}
              filename="inventory-audits"
            />
            <Button
              onClick={startNewAudit}
              className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold shadow-sm"
            >
              <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> Start Daily Physical Audit
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold">
              <tr>
                <th className="p-3">Audit Date</th>
                <th className="p-3">Auditor</th>
                <th className="p-3 text-right">Expected Stock</th>
                <th className="p-3 text-right">Physical Count</th>
                <th className="p-3 text-right">Discrepancy (Units)</th>
                <th className="p-3 text-center">Status</th>
                <th className="p-3 text-right">Completion Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={7} className="p-6 text-center text-slate-500">Loading audit history...</td></tr>
              ) : audits.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-slate-500">No audits logged yet. Start today's audit above.</td></tr>
              ) : (
                audits.map((a: any) => (
                  <tr key={a._id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 font-mono font-bold text-slate-900">{a.auditDate}</td>
                    <td className="p-3 font-semibold text-slate-700">{a.auditor}</td>
                    <td className="p-3 text-right font-mono font-bold">{a.totalExpected}</td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">{a.totalPhysical}</td>
                    <td className="p-3 text-right font-mono font-bold">
                      {a.totalDiscrepancy === 0 ? (
                        <span className="text-emerald-600">0 (Match)</span>
                      ) : (
                        <span className="text-red-600 font-black">{a.totalDiscrepancy > 0 ? `+${a.totalDiscrepancy}` : a.totalDiscrepancy}</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={a.status === "Completed" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                        {a.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right font-mono text-slate-500">{a.completionTime || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      {/* DAILY AUDIT EXECUTION MODAL */}
      <Dialog open={isAuditModalOpen} onOpenChange={setIsAuditModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
              <ClipboardCheck className="w-4 h-4 text-[#3F63AD]" /> Execute Physical Showroom Stock Audit
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 text-xs pt-2">
            <div className="flex items-center justify-between p-3 bg-blue-50/60 rounded-xl border border-blue-200">
              <div>
                <span className="font-bold text-slate-900 block">Date: {new Date().toLocaleDateString("en-IN")}</span>
                <span className="text-[11px] text-slate-500">Auditing {auditItems.length} active inventory items in Value Plus Gorakhpur</span>
              </div>
              <div className="w-60">
                <Label className="text-[10px] uppercase font-bold text-slate-600">Auditor Name</Label>
                <Input value={auditorName} onChange={(e) => setAuditorName(e.target.value)} className="h-7 text-xs bg-white mt-0.5" />
              </div>
            </div>

            <div className="border rounded-xl overflow-hidden max-h-[50vh] overflow-y-auto">
              <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 border-b text-slate-700 uppercase font-bold sticky top-0">
                  <tr>
                    <th className="p-2">Item & VP Code</th>
                    <th className="p-2 text-center w-24">Expected</th>
                    <th className="p-2 text-center w-28">Physical Count</th>
                    <th className="p-2 text-center w-24">Difference</th>
                    <th className="p-2 w-32">Condition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditItems.map((item, idx) => (
                    <tr key={idx} className={item.difference !== 0 ? "bg-red-50/40" : "hover:bg-slate-50"}>
                      <td className="p-2">
                        <p className="font-bold text-slate-900">{item.productName}</p>
                        <span className="font-mono text-[10px] text-blue-600">VP: {item.vpCode}</span>
                      </td>
                      <td className="p-2 text-center font-mono font-bold text-slate-700">{item.expectedStock}</td>
                      <td className="p-2 text-center">
                        <Input
                          type="number"
                          min="0"
                          value={item.physicalStock}
                          onChange={(e) => handleStockChange(idx, Number(e.target.value))}
                          className="h-7 w-20 mx-auto text-center font-bold bg-white border-slate-300"
                        />
                      </td>
                      <td className="p-2 text-center font-mono font-bold">
                        {item.difference === 0 ? (
                          <span className="text-emerald-700">0</span>
                        ) : (
                          <span className="text-red-600">{item.difference > 0 ? `+${item.difference}` : item.difference}</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Select
                          value={item.condition}
                          onValueChange={(val: any) => {
                            const updated = [...auditItems];
                            updated[idx].condition = val;
                            setAuditItems(updated);
                          }}
                        >
                          <SelectTrigger className="h-7 text-xs bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Good">Good</SelectItem>
                            <SelectItem value="Damaged">Damaged</SelectItem>
                            <SelectItem value="Missing">Missing</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => setIsAuditModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => submitAuditMutation.mutate({
                auditDate: todayInIndia(),
                auditor: auditorName,
                items: auditItems,
              })}
              disabled={submitAuditMutation.isPending}
              className="bg-[#3F63AD] text-white font-bold"
            >
              Submit & Finalize Daily Audit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
