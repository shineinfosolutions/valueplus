"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AuthorizePinDialog, type PinAuthResult } from "@/components/AuthorizePinDialog";
import { useChangeRole } from "@/components/shared/pending-changes";
import { todayInIndia } from "@/lib/today";

/**
 * Correct a saved purchase bill's details: the bill date, due date, the supplier's GSTIN
 * and the "why no PO" note. Money, products, bill number and supplier are not changed
 * here — for those the bill is cancelled (PIN protected) and entered again.
 *
 * Admin: made as soon as the PIN and reason are given. Store Manager: sent to the Admin,
 * and the bill stays exactly as it is until it is approved.
 */
export function PurchaseCorrectionDialog({ entry, onClose }: { entry: any | null; onClose: () => void }) {
  const { isManager } = useChangeRole();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<"edit" | "pin">("edit");
  const [form, setForm] = useState({ billDate: "", dueDate: "", supplierGST: "", noPoReason: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    setForm({
      billDate: String(entry.billDate || "").slice(0, 10),
      dueDate: String(entry.dueDate || "").slice(0, 10),
      supplierGST: entry.supplierGST || "",
      noPoReason: entry.noPoReason || "",
    });
    setStage("edit");
    setError(null);
  }, [entry]);

  const mutation = useMutation({
    mutationFn: async ({ pin, reason }: PinAuthResult) => {
      const res = await fetch(`/api/purchase-entries?billNo=${encodeURIComponent(entry.billNo)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "correct", pin, reason, changes: form }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || "Could not save the correction");
      return json;
    },
    onSuccess: (json) => {
      toast.success(json.pending ? "Sent to the Admin for approval. The bill stays as it is until then." : "Purchase bill corrected");
      for (const key of ["purchase-entries", "pending-changes", "profit-loss-report", "reports"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (e: any) => setError(e.message || "Could not save the correction"),
  });

  if (!entry) return null;
  const who = isManager ? "The Admin will be asked to approve it; until then the bill does not change." : "It is made as soon as you confirm, and recorded in the audit log.";

  return (
    <>
      <Dialog open={stage === "edit"} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Correct bill {entry.billNo}</DialogTitle>
            <DialogDescription>
              {entry.supplierName} · only the bill's details can be corrected here. A wrong amount, product, bill number or supplier
              means cancelling the bill and entering it again. {who}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Bill date</Label>
                <Input type="date" value={form.billDate} readOnly disabled title="A bill's date cannot be changed" className="mt-1 bg-slate-100" />
              </div>
              <div>
                <Label>Due date</Label>
                <Input type="date" min={form.billDate || undefined} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Supplier GSTIN</Label>
              <Input
                value={form.supplierGST}
                maxLength={15}
                onChange={(e) => setForm({ ...form, supplierGST: e.target.value.toUpperCase() })}
                className="mt-1 font-mono"
                placeholder="15 characters, or leave empty"
              />
            </div>
            <div>
              <Label>Why there is no PO (note)</Label>
              <Input value={form.noPoReason} onChange={(e) => setForm({ ...form, noPoReason: e.target.value })} className="mt-1" />
            </div>
            {form.billDate && form.billDate !== String(entry.billDate || "").slice(0, 10) && form.billDate < todayInIndia() && (
              <p className="text-[11px] font-semibold text-amber-700">An earlier bill date — {isManager ? "the Admin must approve it." : "it is recorded as a back-dated bill."}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-[#3F63AD] hover:bg-[#2E4F95]" onClick={() => { setError(null); setStage("pin"); }}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AuthorizePinDialog
        open={stage === "pin"}
        onOpenChange={(o) => !o && onClose()}
        onConfirm={(r) => mutation.mutate(r)}
        title={`Confirm the correction to ${entry.billNo}`}
        description={`The old and new details are kept in the audit log with your reason. ${who}`}
        confirmLabel={isManager ? "Send for approval" : "Save Correction"}
        destructive={false}
        isPending={mutation.isPending}
        errorMessage={error}
      />
    </>
  );
}
