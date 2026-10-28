"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils";

/**
 * Upload a brand price list (one tab per product family, each with a "Model",
 * a "New V+NLC" and a "New VSP" column) and update the products it names:
 * New V+NLC becomes the purchase price and New VSP the VSP.
 *
 * Two steps on purpose: the sheet is read first and the changes are listed —
 * old price beside new — and nothing is saved until "Update prices" is pressed.
 * Only those two fields change. A model in the sheet that is not in the product
 * list is reported as "Product not added" and left alone.
 */

interface VspReport {
  applied: boolean;
  appliedCount: number;
  billsCostFrozen?: number;
  fileName: string;
  sheetRows: number;
  updates: {
    itemId: string;
    name: string;
    code: string;
    model: string;
    sheet: string;
    oldCost: number;
    newCost: number | null;
    oldVsp: number;
    newVsp: number | null;
  }[];
  unchanged: { itemId: string; name: string; model: string; sheet: string; cost: number | null; vsp: number | null }[];
  notAdded: { model: string; sapCode: string; sheet: string; cost: number | null; vsp: number | null; message: string }[];
  skipped: { model: string; sheet: string; message: string }[];
  notes: { sheet: string; message: string }[];
}

/** Old → new, or the current value in grey when this price is not changing. */
function PriceChange({ oldValue, newValue }: { oldValue: number; newValue: number | null }) {
  if (newValue === null) {
    return <span className="font-mono text-slate-400">{formatCurrency(oldValue)}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1 font-mono">
      <span className="text-slate-400 line-through">{formatCurrency(oldValue)}</span>
      <ArrowRight className="w-3 h-3 text-slate-300" />
      <span className="font-black text-emerald-700">{formatCurrency(newValue)}</span>
    </span>
  );
}

export function VspSheetImportModal({
  open,
  onOpenChange,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApplied?: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<VspReport | null>(null);

  const reset = () => {
    setFile(null);
    setReport(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async (target: File, apply: boolean): Promise<VspReport> => {
    const form = new FormData();
    form.append("file", target);
    if (apply) form.append("apply", "true");
    const res = await fetch("/api/items/vsp-import", { method: "POST", body: form });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Could not read this sheet");
    return json as VspReport;
  };

  const previewMutation = useMutation({
    mutationFn: (target: File) => send(target, false),
    onSuccess: (data) => setReport(data),
    onError: (err: any) => {
      toast.error(err.message || "Could not read this sheet");
      reset();
    },
  });

  const applyMutation = useMutation({
    mutationFn: () => send(file as File, true),
    onSuccess: (data) => {
      setReport(data);
      toast.success(`Prices updated for ${data.appliedCount} product${data.appliedCount === 1 ? "" : "s"}.`);
      onApplied?.();
    },
    onError: (err: any) => toast.error(err.message || "Price update failed"),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setReport(null);
    previewMutation.mutate(picked);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const busy = previewMutation.isPending || applyMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0 rounded-2xl overflow-y-auto border-none shadow-2xl">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5">
          <DialogTitle className="text-lg font-black tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#76C043]" /> Update Prices from Sheet
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-300 mt-1">
            Upload the brand price list. Products are matched by model number. New V+NLC becomes the purchase
            price and New VSP the VSP; nothing else is changed.
          </DialogDescription>
        </div>

        <div className="p-5 bg-slate-50 max-h-[68vh] overflow-y-auto space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleFile}
          />

          {!report && (
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-10 rounded-xl border-2 border-dashed border-slate-300 bg-white hover:border-[#3F63AD] hover:bg-blue-50/40 transition-colors text-center disabled:opacity-60"
            >
              <UploadCloud className="w-8 h-8 text-[#3F63AD] mx-auto mb-3" />
              <p className="text-sm font-semibold text-slate-700">
                {previewMutation.isPending ? "Reading the sheet..." : "Choose the price list Excel sheet"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Each tab needs a "Model" (or "Product") column and a "New V+NLC" and/or "New VSP" column. Nothing is saved until you
                confirm.
              </p>
            </button>
          )}

          {report && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className="bg-white text-slate-700 border-slate-300 font-semibold">{report.fileName}</Badge>
                <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 font-bold">
                  {report.applied ? `${report.appliedCount} updated` : `${report.updates.length} to update`}
                </Badge>
                <Badge className="bg-slate-100 text-slate-700 border-slate-200 font-bold">{report.unchanged.length} already correct</Badge>
                <Badge className="bg-amber-50 text-amber-800 border-amber-200 font-bold">{report.notAdded.length} not added</Badge>
              </div>

              {report.applied && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Prices updated for {report.appliedCount} product{report.appliedCount === 1 ? "" : "s"}. MRP, selling
                  price and floor price were not changed. Past bills keep the cost they were sold at.
                </div>
              )}

              {/* Products whose purchase price or VSP changes */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 text-xs font-black text-slate-700 uppercase tracking-wider">
                  {report.applied ? "Prices updated" : "Prices will be updated"} ({report.updates.length})
                </div>
                {report.updates.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-400 font-medium">
                    No product needs a price change from this sheet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr>
                          <th className="p-2.5">Product</th>
                          <th className="p-2.5">Sheet</th>
                          <th className="p-2.5 text-right">Purchase price (V+NLC)</th>
                          <th className="p-2.5 text-right">VSP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {report.updates.map((u) => (
                          <tr key={u.itemId}>
                            <td className="p-2.5">
                              <p className="font-bold text-slate-900">{u.name}</p>
                              <p className="text-[10px] font-mono text-slate-400">{u.code}</p>
                            </td>
                            <td className="p-2.5 text-slate-500">{u.sheet}</td>
                            <td className="p-2.5 text-right">
                              <PriceChange oldValue={u.oldCost} newValue={u.newCost} />
                            </td>
                            <td className="p-2.5 text-right">
                              <PriceChange oldValue={u.oldVsp} newValue={u.newVsp} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Models in the sheet with no product in the list */}
              {report.notAdded.length > 0 && (
                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50/70 text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Product not added ({report.notAdded.length})
                  </div>
                  <p className="px-4 pt-2.5 text-[11px] text-slate-500">
                    These models are in the sheet but not in the product list, so their prices were not updated. Add
                    the product first, then upload the sheet again.
                  </p>
                  <div className="max-h-48 overflow-y-auto px-4 py-2.5 space-y-1">
                    {report.notAdded.map((n, idx) => (
                      <div key={`${n.sheet}-${n.model}-${idx}`} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0 truncate">
                          <span className="font-bold text-slate-800">Product not added:</span>{" "}
                          <span className="font-mono text-slate-700">{n.model}</span>
                          <span className="text-slate-400"> · {n.sheet}</span>
                        </span>
                        <span className="font-mono text-slate-400 shrink-0">
                          {n.cost !== null && <>V+NLC {formatCurrency(n.cost)}</>}
                          {n.cost !== null && n.vsp !== null && " · "}
                          {n.vsp !== null && <>VSP {formatCurrency(n.vsp)}</>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(report.notes.length > 0 || report.skipped.length > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 space-y-1">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Notes</p>
                  {[...report.notes, ...report.skipped].map((n, idx) => (
                    <p key={idx} className="text-[11px] text-slate-500">{n.message}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)} className="text-slate-600">
            Close
          </Button>
          {report && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>
                Upload another sheet
              </Button>
              {!report.applied && (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || report.updates.length === 0}
                  onClick={() => applyMutation.mutate()}
                  className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold"
                >
                  {applyMutation.isPending ? "Updating..." : `Update prices for ${report.updates.length} product${report.updates.length === 1 ? "" : "s"}`}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
