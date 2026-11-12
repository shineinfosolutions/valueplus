"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, ArrowRight, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";

/**
 * Upload a sheet with each product's VP code beside its name and put those VP codes on the products.
 *
 * Two steps: the sheet is read first and the changes are listed (old code beside new), and nothing is saved until
 * the update button is pressed. A product that already has a DIFFERENT real VP code is not changed unless it is ticked.
 * Rows that match no product, or several, or give a code another product already shows, are listed and left alone.
 */

interface Matched {
  itemId: string;
  name: string;
  shownNow: string;
  newVpCode: string;
  sheet: string;
  rowNumber: number;
  how: "code" | "name" | "model";
}
interface Report {
  applied: boolean;
  appliedCount: number;
  fileName: string;
  sheetRows: number;
  updates: Matched[];
  different: (Matched & { oldVpCode: string })[];
  unchanged: { itemId: string; name: string; vpCode: string }[];
  conflicts: { name: string; vpCode: string; sheet: string; rowNumber: number; heldBy: string }[];
  ambiguous: { name: string; vpCode: string; sheet: string; rowNumber: number; candidates: string[] }[];
  notFound: { name: string; vpCode: string; sheet: string; rowNumber: number }[];
  skipped: { name: string; sheet: string; message: string }[];
  notes: { sheet: string; message: string }[];
}

const HOW: Record<Matched["how"], string> = { code: "by code", name: "by name", model: "by model" };

export function VpCodeImportModal({ open, onOpenChange, onApplied }: { open: boolean; onOpenChange: (open: boolean) => void; onApplied?: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  const reset = () => {
    setFile(null);
    setReport(null);
    setTicked(new Set());
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const send = async (target: File, apply: boolean, overrideIds: string[] = []): Promise<Report> => {
    const form = new FormData();
    form.append("file", target);
    if (apply) {
      form.append("apply", "true");
      form.append("overrideIds", JSON.stringify(overrideIds));
    }
    const res = await fetch("/api/items/vp-code-import", { method: "POST", body: form });
    const json = await res.json();
    if (!json.success) throw new Error(json.error || "Could not read this sheet");
    return json as Report;
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
    mutationFn: () => send(file as File, true, Array.from(ticked)),
    onSuccess: (data) => {
      setReport(data);
      toast.success(`VP code updated for ${data.appliedCount} product${data.appliedCount === 1 ? "" : "s"}.`);
      onApplied?.();
    },
    onError: (err: any) => toast.error(err.message || "Update failed"),
  });

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setFile(picked);
    setReport(null);
    setTicked(new Set());
    previewMutation.mutate(picked);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const busy = previewMutation.isPending || applyMutation.isPending;
  const toApply = (report?.updates.length || 0) + ticked.size;

  const downloadSample = () => {
    const rows = [
      ["VP Code", "Product Name", "Brand"],
      ["VP0002116", "EI3V-C1(I)-P IVORY- HAIER", "HAIER"],
      ["VP0011921", "HIL2002CSSH- HAIER", "HAIER"],
    ];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [{ wch: 14 }, { wch: 44 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "VP Codes");
    XLSX.writeFile(wb, "vp-code-sample.xlsx");
  };

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl p-0 rounded-2xl overflow-y-auto border-none shadow-2xl">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5">
          <DialogTitle className="text-lg font-black tracking-tight flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-[#76C043]" /> Update VP Codes from Sheet
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-300 mt-1">
            Upload a sheet with the VP code and the product name. Each product is found by a code it already has, by its name, or by its
            model number (only when one product has it). Nothing else on a product is changed.
          </DialogDescription>
        </div>

        <div className="p-5 bg-slate-50 max-h-[68vh] overflow-y-auto space-y-4">
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

          {!report && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-10 rounded-xl border-2 border-dashed border-slate-300 bg-white hover:border-[#3F63AD] hover:bg-blue-50/40 transition-colors text-center disabled:opacity-60"
              >
                <UploadCloud className="w-8 h-8 text-[#3F63AD] mx-auto mb-3" />
                <p className="text-sm font-semibold text-slate-700">{previewMutation.isPending ? "Reading the sheet..." : "Choose the Excel sheet"}</p>
                <p className="text-xs text-slate-400 mt-1">Columns: "VP Code" and "Product Name" (a "Brand" column is optional). Nothing is saved until you confirm.</p>
              </button>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-600">Not sure about the format? Download a sample sheet, fill it in and upload it.</p>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={downloadSample}>
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Sample sheet
                </Button>
              </div>
            </>
          )}

          {report && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge className="bg-white text-slate-700 border-slate-300 font-semibold">{report.fileName}</Badge>
                <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 font-bold">{report.applied ? `${report.appliedCount} updated` : `${report.updates.length} to update`}</Badge>
                {report.different.length > 0 && <Badge className="bg-sky-50 text-sky-800 border-sky-200 font-bold">{report.different.length} with another code</Badge>}
                <Badge className="bg-slate-100 text-slate-700 border-slate-200 font-bold">{report.unchanged.length} already correct</Badge>
                <Badge className="bg-amber-50 text-amber-800 border-amber-200 font-bold">{report.notFound.length + report.ambiguous.length + report.conflicts.length} need a look</Badge>
              </div>

              {report.applied && (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs font-semibold text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  VP code updated for {report.appliedCount} product{report.appliedCount === 1 ? "" : "s"}. The old code still finds the product.
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50/70 text-xs font-black text-slate-700 uppercase tracking-wider">
                  {report.applied ? "VP code set" : "VP code will be set"} ({report.updates.length})
                </div>
                {report.updates.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-slate-400 font-medium">No product needs a new VP code from this sheet.</p>
                ) : (
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full min-w-[560px] text-xs text-left">
                      <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                        <tr><th className="p-2.5">Product</th><th className="p-2.5">VP code</th><th className="p-2.5">Found</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-medium">
                        {report.updates.map((u) => (
                          <tr key={u.itemId}>
                            <td className="p-2.5 font-bold text-slate-900">{u.name}</td>
                            <td className="p-2.5 font-mono">
                              <span className="text-slate-400 line-through">{u.shownNow || "-"}</span> <ArrowRight className="inline w-3 h-3 text-slate-300" /> <span className="font-black text-emerald-700">{u.newVpCode}</span>
                            </td>
                            <td className="p-2.5 text-slate-500">{HOW[u.how]} · row {u.rowNumber}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {report.different.length > 0 && (
                <div className="bg-white rounded-xl border border-sky-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-sky-100 bg-sky-50/70 text-xs font-black text-sky-900 uppercase tracking-wider">
                    Already has a different VP code ({report.different.length})
                  </div>
                  <p className="px-4 pt-2.5 text-[11px] text-slate-500">These are NOT changed unless you tick them. The old code keeps finding the product.</p>
                  <div className="max-h-48 overflow-y-auto px-4 py-2.5 space-y-1.5">
                    {report.different.map((d) => (
                      <label key={d.itemId} className="flex items-center gap-2 text-xs cursor-pointer">
                        <input type="checkbox" disabled={report.applied} checked={ticked.has(d.itemId)} onChange={() => toggle(d.itemId)} />
                        <span className="min-w-0 truncate"><b>{d.name}</b></span>
                        <span className="ml-auto shrink-0 font-mono">
                          <span className="text-slate-400 line-through">{d.oldVpCode}</span> → <span className="font-black text-sky-800">{d.newVpCode}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {(report.conflicts.length > 0 || report.ambiguous.length > 0 || report.notFound.length > 0) && (
                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-amber-100 bg-amber-50/70 text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" /> Left alone ({report.conflicts.length + report.ambiguous.length + report.notFound.length})
                  </div>
                  <div className="max-h-56 overflow-y-auto px-4 py-2.5 space-y-1 text-xs">
                    {report.conflicts.map((c, i) => (
                      <p key={`c${i}`}><b className="text-red-700">Code already used:</b> {c.vpCode} for {c.name} (shown by {c.heldBy}) · row {c.rowNumber}</p>
                    ))}
                    {report.ambiguous.map((a, i) => (
                      <p key={`a${i}`}><b className="text-amber-800">Several products fit:</b> {a.name} ({a.vpCode}) · row {a.rowNumber} → {a.candidates.slice(0, 3).join(" / ")}{a.candidates.length > 3 ? "..." : ""}</p>
                    ))}
                    {report.notFound.map((n, i) => (
                      <p key={`n${i}`}><b className="text-red-700">Product not found:</b> {n.name} ({n.vpCode}) · row {n.rowNumber}</p>
                    ))}
                  </div>
                </div>
              )}

              {(report.notes.length > 0 || report.skipped.length > 0) && (
                <div className="bg-white rounded-xl border border-slate-200 px-4 py-2.5 space-y-1">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Notes</p>
                  {[...report.notes, ...report.skipped].map((n: any, idx) => (
                    <p key={idx} className="text-[11px] text-slate-500">{n.message}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="bg-white px-5 py-3 border-t border-slate-200 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)} className="text-slate-600">Close</Button>
          {report && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reset}>Upload another sheet</Button>
              {!report.applied && (
                <Button type="button" size="sm" disabled={busy || toApply === 0} onClick={() => applyMutation.mutate()} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold">
                  {applyMutation.isPending ? "Updating..." : `Update VP code for ${toApply} product${toApply === 1 ? "" : "s"}`}
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
