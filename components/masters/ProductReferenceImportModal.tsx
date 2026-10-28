"use client";

import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UploadCloud, FileSpreadsheet, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";
import { CategorySelect } from "@/components/shared/category-select";

/**
 * Upload a stock/accounting reference sheet (Itemcode / Brand / Group Name —
 * e.g. a Tally Stock Report export) and map its Group Names onto this app's
 * real Categories, once. The result lets Purchase Entry PDF import fill in
 * Brand/Category for a brand-new product automatically by its VP code
 * instead of the admin picking them by hand every time (see
 * PurchaseImportModal.tsx, which consults this same data).
 *
 * The sheet's own wording ("AUDIO & VIDEO") never matches this app's real
 * Category names ("Audio & Sound Systems") closely enough to guess safely —
 * so every distinct Group Name is confirmed here, not per-product (there can
 * be hundreds of those) but per group (usually a handful).
 */

interface GroupSuggestion {
  groupName: string;
  suggestedCategory: string | null;
}

export function ProductReferenceImportModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [groupSuggestions, setGroupSuggestions] = useState<GroupSuggestion[]>([]);
  const [groupToCategory, setGroupToCategory] = useState<Record<string, string>>({});

  const reset = () => {
    setRows([]);
    setGroupSuggestions([]);
    setGroupToCategory({});
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/product-reference/parse", { method: "POST", body: form });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not read this file");
      return json.data;
    },
    onSuccess: (data) => {
      setRows(data.rows);
      setGroupSuggestions(data.groupSuggestions);
      const initial: Record<string, string> = {};
      data.groupSuggestions.forEach((g: GroupSuggestion) => {
        if (g.suggestedCategory) initial[g.groupName] = g.suggestedCategory;
      });
      setGroupToCategory(initial);
      toast.success(`Found ${data.totalRows} products across ${data.groupSuggestions.length} groups — confirm the category for each`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRows([]);
    setGroupSuggestions([]);
    parseMutation.mutate(file);
  };

  const commitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/product-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, groupToCategory }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the reference sheet");
      return json.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.total} products linked to their category — ${data.upserted} new, ${data.matched} updated`);
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const allGroupsMapped = groupSuggestions.length > 0 && groupSuggestions.every((g) => groupToCategory[g.groupName]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto max-h-[88vh] flex flex-col">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 flex items-center gap-3 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <UploadCloud className="w-5 h-5 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Import Stock Reference</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              A stock/accounting sheet with Itemcode, Brand and Group Name — lets PDF purchase
              import fill in a new product&apos;s Category/Brand automatically by its VP code
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/50 overflow-y-auto flex-1">
          {groupSuggestions.length === 0 ? (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center bg-white">
              {parseMutation.isPending ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-slate-600">Reading the file…</p>
                </div>
              ) : (
                <>
                  <FileSpreadsheet className="w-8 h-8 text-emerald-500 mx-auto mb-3" />
                  <p className="text-sm font-semibold text-slate-700">Choose a stock/reference Excel sheet</p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    Needs an Itemcode (VP code) column, plus Brand and Group Name — a Tally Stock
                    Report export works as-is.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={handleFilePick}
                  />
                  <Button className="mt-4" onClick={() => fileInputRef.current?.click()}>
                    <UploadCloud className="w-4 h-4 mr-1.5" /> Choose File
                  </Button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  {rows.length} products found
                </Badge>
                <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                  {groupSuggestions.length} group{groupSuggestions.length === 1 ? "" : "s"} to confirm
                </Badge>
                <div className="flex-1" />
                <Button variant="outline" size="sm" onClick={reset}>
                  <X className="w-3.5 h-3.5 mr-1.5" /> Choose a different file
                </Button>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                {groupSuggestions.map((g) => {
                  const count = rows.filter((r) => r.groupName === g.groupName).length;
                  const mapped = groupToCategory[g.groupName];
                  return (
                    <div key={g.groupName} className="flex items-center gap-3 p-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{g.groupName}</p>
                        <p className="text-[11px] text-slate-400">{count} product{count === 1 ? "" : "s"}</p>
                      </div>
                      {mapped && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      )}
                      <CategorySelect
                        value={mapped || ""}
                        onValueChange={(v) => setGroupToCategory((prev) => ({ ...prev, [g.groupName]: v }))}
                        placeholder="Pick a category…"
                        className="w-56 h-9 text-xs bg-slate-50"
                      />
                    </div>
                  );
                })}
              </div>
              {!allGroupsMapped && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Pick a category for every group above before importing.
                </p>
              )}
            </>
          )}
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <p className="text-xs text-slate-500">
            {rows.length > 0
              ? "Nothing is saved until you confirm"
              : "Nothing uploaded yet"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
              Cancel
            </Button>
            <Button
              onClick={() => commitMutation.mutate()}
              disabled={!allGroupsMapped || commitMutation.isPending}
            >
              {commitMutation.isPending ? "Saving…" : `Import ${rows.length || ""} Product${rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
