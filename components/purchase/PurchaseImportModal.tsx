"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BrandSelect } from "@/components/shared/brand-select";
import {
  UploadCloud,
  FileSpreadsheet,
  FileText,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  X,
  Link2,
  Pencil,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { formatCurrency, cn } from "@/lib/utils";
import { findMatchingItem } from "@/lib/purchase-import/match-item";

/**
 * Upload an Excel sheet or a text-based PDF, review what was found, then hand
 * the reviewed rows to PurchaseCreationModal for the actual save.
 *
 * This modal never writes a purchase entry itself — parsing (server) and
 * matching (here, live) only produce a list of rows the admin has looked at
 * and confirmed. Any row whose name is edited here is re-matched against the
 * live product catalog on every keystroke, using the same matching function
 * the server used at parse time, so fixing a misread name to match an
 * existing product re-links it without a separate "search and relink" UI —
 * and once handed off, every row is still fully editable inside
 * PurchaseCreationModal's own product search, the same as manual entry.
 */

interface PreviewRow {
  key: string;
  sourceRow: number;
  name: string;
  quantity: number;
  rate: number;
  gstRate: number;
  lowConfidence: boolean;
  matchedItem: any | null;
  serialNumbers?: string[];
  /** The HSN code resolveRows found on the invoice itself — used as the real
   *  code for a new product instead of a generic placeholder, and carried
   *  onto the purchase entry line even when matched to an existing item. */
  hsn?: string;
  /** Only meaningful for a "New item" row — a matched row always keeps the
   *  catalog item's own category/brand, shown read-only. Empty string means
   *  "use the blanket default below", so a single-category invoice still
   *  needs just one selection while a mixed one can override per row. */
  category?: string;
  brand?: string;
  /** True when category/brand above came from the Stock Reference table
   *  (Masters > Items > Import Stock Reference) by VP code, not a guess —
   *  shown so the admin knows it's vetted data, still fully editable. */
  fromReference?: boolean;
  /** The supplier's own item code on this line ("VP0012023"); remembered on the
   *  product once the rows are confirmed, so the next bill matches by code. */
  supplierCode?: string;
  /** Set once the product was picked by hand: editing the name no longer
   *  re-links the row on its own. */
  manualLink?: boolean;
  /** Corrections to the LINKED product's own name/brand/category, saved on confirm. */
  fixProduct?: { name: string; brand: string; category?: string } | null;
  /** A real category (from the Categories master) suggested for this product. */
  suggestedCategory?: string;
  /** False when the linked product is filed under a non-master category such
   *  as a brand group ("LLOYD") left over from the old stock sheet. */
  categoryIsMaster?: boolean;
}

/** Pick the product a row belongs to, or "create new", by searching the catalog. */
function ProductPicker({
  items,
  onPick,
  onClose,
}: {
  items: any[];
  onPick: (item: any | null) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = q
    ? items
        .filter((it: any) =>
          [it.name, it.code, it.vpCode, it.brand, ...(it.supplierCodes || [])]
            .some((v) => String(v || "").toLowerCase().includes(q))
        )
        .slice(0, 8)
    : [];
  return (
    <div className="mt-1.5 rounded-lg border border-slate-200 bg-white shadow-lg p-2 space-y-1.5 w-[260px]">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, model or code"
          className="h-8 text-xs pl-7"
        />
      </div>
      <div className="max-h-48 overflow-y-auto space-y-0.5">
        {results.map((it: any) => (
          <button
            key={it._id}
            type="button"
            onClick={() => onPick(it)}
            className="w-full text-left px-2 py-1.5 rounded-md hover:bg-blue-50 text-xs"
          >
            <span className="font-semibold text-slate-800 block truncate">{it.name}</span>
            <span className="text-[10px] text-slate-400">
              {it.brand || "—"} · {it.vpCode || it.code} · stock {Number(it.currentStock) || 0}
            </span>
          </button>
        ))}
        {q && results.length === 0 && <p className="text-[11px] text-slate-400 px-2 py-1">No product found.</p>}
      </div>
      <div className="flex items-center justify-between pt-1 border-t border-slate-100">
        <button type="button" onClick={() => onPick(null)} className="text-[11px] font-semibold text-amber-700 hover:underline">
          Create as new product
        </button>
        <button type="button" onClick={onClose} className="text-[11px] text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function PurchaseImportModal({
  open,
  onOpenChange,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Items ready for PurchaseCreationModal's `preloadedItems` prop, plus
   *  whatever supplier name/phone/GSTIN was read off the invoice's own
   *  letterhead (PDF only — undefined for an Excel/CSV upload). */
  onResolved: (items: any[], supplier?: { name?: string; phone?: string; gstin?: string }) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [meta, setMeta] = useState<{
    sourceType: "excel" | "pdf";
    usedTableExtraction: boolean;
  } | null>(null);
  const [defaultCategory, setDefaultCategory] = useState("");
  const [defaultBrand, setDefaultBrand] = useState("");
  const [supplier, setSupplier] = useState<{ name?: string; phone?: string; gstin?: string } | undefined>(undefined);
  const [pickerFor, setPickerFor] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: open,
  });

  const { data: allItems = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setRows([]);
      setMeta(null);
      setDefaultCategory("");
      setDefaultBrand("");
      setSupplier(undefined);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [open]);

  const parseMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/purchase-entries/import", { method: "POST", body: form });
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          res.status === 413
            ? "This file is too large for the server to accept."
            : `The server hit an unexpected error (status ${res.status}). Try again, or use a smaller/simpler file.`
        );
      }
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not read this file");
      return json.data;
    },
    onSuccess: (data) => {
      setMeta(data.meta);
      setSupplier(data.supplier);
      setRows(
        data.rows.map((r: any, i: number) => ({
          key: `${r.sourceRow}-${i}`,
          sourceRow: r.sourceRow,
          // "GLS19I3AGAHF- LLOYD", not "VP0012023 - GLS19I3AGAHF- LLOYD": the code
          // is kept separately below and the brand goes in its own column.
          name: r.suggestedName || r.name,
          supplierCode: r.supplierCode || "",
          quantity: r.quantity,
          rate: r.rate,
          gstRate: r.gstRate,
          lowConfidence: r.lowConfidence,
          matchedItem: r.matchedItem,
          serialNumbers: r.serialNumbers,
          hsn: r.hsn,
          category: r.matchedItem ? "" : r.suggestedCategory || r.referenceMatch?.category || "",
          brand: r.referenceMatch?.brand || r.parsedBrand || "",
          fromReference: Boolean(r.referenceMatch) && !r.suggestedCategory,
          suggestedCategory: r.suggestedCategory || "",
          categoryIsMaster: r.categoryIsMaster !== false,
          // A linked product filed under a brand group ("LLOYD") instead of a real
          // category opens already corrected to the suggested one — visible, and
          // undone with "Cancel edit".
          fixProduct:
            r.matchedItem && r.categoryIsMaster === false && r.suggestedCategory
              ? { name: r.matchedItem.name || "", brand: r.matchedItem.brand || "", category: r.suggestedCategory }
              : null,
        }))
      );
      const referenceCount = data.rows.filter((r: any) => r.referenceMatch).length;
      toast.success(
        `Found ${data.rows.length} row(s) — review before adding` +
          (referenceCount > 0 ? ` (${referenceCount} auto-filled from stock reference)` : "")
      );
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRows([]);
    setMeta(null);
    parseMutation.mutate(file);
  };

  const updateRow = (key: string, patch: Partial<PreviewRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Re-match live whenever the name changes, using the same function
        // the server used, so correcting a misread name to an existing
        // product's name re-links it without any extra step.
        if ((patch.name !== undefined || patch.supplierCode !== undefined) && !next.manualLink) {
          next.matchedItem =
            (next.supplierCode ? findMatchingItem(next.supplierCode, allItems) : null) ||
            findMatchingItem(next.name, allItems);
          next.fixProduct = null;
          next.categoryIsMaster = next.matchedItem
            ? categories.some((c: any) => c.name === next.matchedItem.category) &&
              (!next.suggestedCategory || next.suggestedCategory === next.matchedItem.category)
            : true;
        }
        return next;
      })
    );
  };

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const matchedCount = rows.filter((r) => r.matchedItem).length;
  const newCount = rows.length - matchedCount;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (rows.length === 0) throw new Error("No rows to add");
      // Each new row can carry its own category (for a mixed-category
      // invoice); the blanket picker only needs to cover whichever rows
      // didn't get one of their own.
      const uncategorised = rows.filter((r) => !r.matchedItem && !(r.category || defaultCategory));
      if (uncategorised.length > 0) {
        throw new Error(
          `Pick a category for "${uncategorised[0].name}"${uncategorised.length > 1 ? ` and ${uncategorised.length - 1} other new row(s)` : ""} — either per-row or via the default above.`
        );
      }

      const resolved: any[] = [];
      const codeLinks: { itemId: string; code: string }[] = [];

      for (const row of rows) {
        if (row.matchedItem && row.fixProduct) {
          // The product this row is linked to had a wrong name or brand — fixed
          // here, on the product itself, so every screen shows it right.
          const name = row.fixProduct.name.trim();
          const brand = row.fixProduct.brand.trim();
          const category = String(row.fixProduct.category || "").trim();
          if (
            name &&
            (name !== row.matchedItem.name ||
              brand !== (row.matchedItem.brand || "") ||
              (category && category !== (row.matchedItem.category || "")))
          ) {
            const res = await fetch("/api/items", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: row.matchedItem.code, name, ...(brand ? { brand } : {}), ...(category ? { category } : {}) }),
            });
            const json = await res.json();
            if (!json.success) throw new Error(`Could not update "${row.matchedItem.name}": ${json.error}`);
            row.matchedItem = { ...row.matchedItem, name, brand: brand || row.matchedItem.brand, category: category || row.matchedItem.category };
          }
        }
        if (row.matchedItem && row.supplierCode) {
          codeLinks.push({ itemId: row.matchedItem._id, code: row.supplierCode });
        }
        if (row.matchedItem) {
          resolved.push({
            code: row.matchedItem.code,
            vpCode: row.matchedItem.vpCode,
            _id: row.matchedItem._id,
            name: row.matchedItem.name,
            purchasePrice: row.rate,
            gstRate: row.gstRate || row.matchedItem.gstRate || 18,
            orderQty: row.quantity,
            serialNumbers: row.serialNumbers,
          });
          continue;
        }

        // New product — created through the same endpoint Masters > Items
        // uses, so it shows up there exactly like any manually added item.
        const res = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: `ITM-${Date.now().toString().slice(-8)}-${resolved.length}`,
            name: row.name,
            category: row.category || defaultCategory,
            brand: row.brand || defaultBrand || "Unbranded",
            unit: "PCS",
            // The invoice itself already told us this product's real HSN —
            // "8528" (a generic electronics fallback) only applies when the
            // sheet genuinely had no HSN column to read one from.
            hsnCode: row.hsn || "8528",
            gstRate: row.gstRate || 18,
            purchasePrice: row.rate,
            sellingPrice: Math.round(row.rate * 1.25),
            mrp: Math.round(row.rate * 1.3),
            ...(row.supplierCode ? { supplierCodes: [row.supplierCode] } : {}),
            openingStock: 0,
            currentStock: 0,
            status: "active",
          }),
        });
        const json = await res.json();
        if (!json.success) {
          throw new Error(`Could not create "${row.name}": ${json.error}`);
        }
        if (row.supplierCode && json.data?._id) codeLinks.push({ itemId: json.data._id, code: row.supplierCode });
        resolved.push({
          code: json.data.code,
          vpCode: json.data.vpCode,
          _id: json.data._id,
          name: json.data.name,
          purchasePrice: row.rate,
          gstRate: row.gstRate,
          orderQty: row.quantity,
          serialNumbers: row.serialNumbers,
        });
      }

      // Best-effort: remembering the supplier codes only speeds up the next
      // import; the purchase itself does not depend on it.
      if (codeLinks.length > 0) {
        try {
          await fetch("/api/items/supplier-codes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ links: codeLinks }),
          });
        } catch (linkErr) {
          console.warn("Notice: could not remember supplier codes:", linkErr);
        }
      }

      return resolved;
    },
    onSuccess: (resolved) => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success(`${resolved.length} row(s) ready — opening the purchase entry`);
      onResolved(resolved, supplier);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto max-h-[90vh] flex flex-col">
        <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 flex items-center gap-3 shrink-0">
          <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center border border-white/20">
            <UploadCloud className="w-5 h-5 text-[#76C043]" />
          </div>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Import Purchase Sheet</h3>
            <p className="text-xs text-slate-300 mt-0.5">
              Excel (.xlsx, .csv) or a text-based PDF invoice — review every row before it's added
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4 bg-slate-50/50 overflow-y-auto flex-1">
          {rows.length === 0 ? (
            <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center bg-white">
              {parseMutation.isPending ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm font-semibold text-slate-600">Reading the file…</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-center gap-3 mb-3">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-500" />
                    <FileText className="w-8 h-8 text-red-500" />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">
                    Choose an Excel sheet or a PDF invoice
                  </p>
                  <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                    Scanned or photographed PDFs aren't supported — only ones with real, selectable
                    text. Every row is shown for review below before anything is saved.
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
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
                <Badge variant="secondary" className="text-xs">
                  {meta?.sourceType === "pdf" ? "PDF" : "Excel"}
                </Badge>
                {meta?.sourceType === "pdf" && !meta.usedTableExtraction && (
                  <Badge variant="warning" className="text-[10px]">
                    No table structure found — read from plain text, double-check every row
                  </Badge>
                )}
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">
                  {matchedCount} matched to existing products
                </Badge>
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                  {newCount} will be created new
                </Badge>
                {meta?.sourceType === "pdf" && (
                  supplier?.name || supplier?.phone ? (
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                      Supplier: {supplier.name || "Name not found"}{supplier.phone ? ` • ${supplier.phone}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="warning" className="text-[10px]">
                      Supplier not detected on this invoice — enter it in the next step
                    </Badge>
                  )
                )}
                <div className="flex-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRows([]);
                    setMeta(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                >
                  <X className="w-3.5 h-3.5 mr-1.5" /> Choose a different file
                </Button>
              </div>

              {newCount > 0 && (
                <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3.5 flex flex-wrap items-end gap-3">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mb-2" />
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold text-amber-800">
                      Default Category for new products
                    </Label>
                    <Select value={defaultCategory} onValueChange={setDefaultCategory}>
                      <SelectTrigger className="w-[200px] bg-white h-8 text-xs">
                        <SelectValue placeholder="Select category…" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c: any) => (
                          <SelectItem key={c._id || c.name} value={c.name}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold text-amber-800">
                      Default Brand for new products
                    </Label>
                    <BrandSelect
                      value={defaultBrand}
                      onValueChange={setDefaultBrand}
                      className="w-[200px] bg-white h-8 text-xs"
                      placeholder="Optional"
                    />
                  </div>
                  <p className="text-[11px] text-amber-700 max-w-xs">
                    Used for every "New Item" row below that doesn't have its own Category/Brand
                    picked in the table — a single-category invoice needs just this. Matched rows
                    always keep their existing product's category and brand.
                  </p>
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full min-w-[1080px] text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                      <th className="px-3 py-2.5 text-left min-w-[240px]">Product Name</th>
                      <th className="px-3 py-2.5 text-right w-20">Qty</th>
                      <th className="px-3 py-2.5 text-right w-28">Rate (₹)</th>
                      <th className="px-3 py-2.5 text-right w-20">GST %</th>
                      <th className="px-3 py-2.5 text-left w-36">Category</th>
                      <th className="px-3 py-2.5 text-left w-32">Brand</th>
                      <th className="px-3 py-2.5 text-left w-60">Linked Product</th>
                      <th className="px-3 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((row) => (
                      <tr
                        key={row.key}
                        className={cn(row.lowConfidence && "bg-amber-50/40")}
                      >
                        <td className="px-3 py-2">
                          <Input
                            value={row.name}
                            onChange={(e) => updateRow(row.key, { name: e.target.value })}
                            className="h-8 text-xs"
                          />
                          <div className="flex items-center gap-1 mt-1">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Supplier code</span>
                            <Input
                              value={row.supplierCode || ""}
                              onChange={(e) => updateRow(row.key, { supplierCode: e.target.value.trim().toUpperCase() })}
                              placeholder="e.g. VP0012023"
                              className="h-6 text-[10px] font-mono w-28 px-1.5"
                            />
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={row.quantity}
                            onChange={(e) =>
                              updateRow(row.key, { quantity: Number(e.target.value) || 0 })
                            }
                            className="h-8 text-xs text-right min-w-[64px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={row.rate}
                            onChange={(e) => updateRow(row.key, { rate: Number(e.target.value) || 0 })}
                            className={cn(
                              "h-8 text-xs text-right min-w-[96px]",
                              !(row.rate > 0) && "border-red-300 bg-red-50"
                            )}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            value={row.gstRate}
                            onChange={(e) =>
                              updateRow(row.key, { gstRate: Number(e.target.value) || 0 })
                            }
                            className="h-8 text-xs text-right min-w-[64px]"
                          />
                        </td>
                        <td className="px-3 py-2">
                          {row.matchedItem && row.fixProduct ? (
                            // Fixing the linked product: its category can be set
                            // to a real one here, saved on the product on confirm.
                            <div className="space-y-0.5">
                              {row.matchedItem.category !== row.fixProduct.category && (
                                <span className="block text-[9px] font-bold text-rose-600 line-through truncate max-w-[150px]" title={row.matchedItem.category || ""}>
                                  {row.matchedItem.category || "—"}
                                </span>
                              )}
                              <Select
                                value={row.fixProduct.category || ""}
                                onValueChange={(v) => updateRow(row.key, { fixProduct: { ...row.fixProduct!, category: v } })}
                              >
                                <SelectTrigger className="h-8 text-xs w-full border-emerald-300 bg-emerald-50/50">
                                  <SelectValue placeholder="Pick a category…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.map((c: any) => (
                                    <SelectItem key={c._id || c.name} value={c.name}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ) : row.matchedItem ? (
                            <span
                              className={cn(
                                "truncate block max-w-[150px]",
                                row.categoryIsMaster === false ? "text-rose-600 font-semibold" : "text-slate-500"
                              )}
                              title={row.categoryIsMaster === false ? "Not a product category — use Fix details" : row.matchedItem.category || ""}
                            >
                              {row.categoryIsMaster === false && "⚠ "}
                              {row.matchedItem.category || "—"}
                            </span>
                          ) : (
                            <div className="space-y-0.5">
                              {row.fromReference && (
                                <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-600">
                                  <CheckCircle2 className="w-2.5 h-2.5" /> Stock reference
                                </span>
                              )}
                              <Select
                                value={row.category || ""}
                                onValueChange={(v) => updateRow(row.key, { category: v, fromReference: false })}
                              >
                                <SelectTrigger
                                  className={cn(
                                    "h-8 text-xs w-full",
                                    !(row.category || defaultCategory) && "border-red-300 bg-red-50"
                                  )}
                                >
                                  <SelectValue placeholder={defaultCategory ? `Default: ${defaultCategory}` : "Pick one…"} />
                                </SelectTrigger>
                                <SelectContent>
                                  {categories.map((c: any) => (
                                    <SelectItem key={c._id || c.name} value={c.name}>
                                      {c.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.matchedItem && row.fixProduct ? (
                            <BrandSelect
                              value={row.fixProduct.brand}
                              onValueChange={(v) => updateRow(row.key, { fixProduct: { ...row.fixProduct!, brand: v } })}
                              className="h-8 text-xs w-full"
                            />
                          ) : row.matchedItem ? (
                            <span
                              className={cn(
                                "truncate block max-w-[110px]",
                                /^unbranded$/i.test(row.matchedItem.brand || "") ? "text-red-600 font-semibold" : "text-slate-500"
                              )}
                              title={row.matchedItem.brand || ""}
                            >
                              {row.matchedItem.brand || "—"}
                            </span>
                          ) : (
                            <BrandSelect
                              value={row.brand || ""}
                              onValueChange={(v) => updateRow(row.key, { brand: v, fromReference: false })}
                              placeholder={defaultBrand || "Optional"}
                              className="h-8 text-xs w-full"
                            />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.matchedItem && row.fixProduct ? (
                            <div className="space-y-1">
                              <span className="text-[9px] font-bold text-slate-400 uppercase block">Product name</span>
                              <Input
                                value={row.fixProduct.name}
                                onChange={(e) => updateRow(row.key, { fixProduct: { ...row.fixProduct!, name: e.target.value } })}
                                className="h-7 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => updateRow(row.key, { fixProduct: null })}
                                className="text-[10px] text-slate-500 hover:underline"
                              >
                                Cancel edit
                              </button>
                            </div>
                          ) : row.matchedItem ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate max-w-[200px]" title={row.matchedItem.name}>
                                {row.matchedItem.name}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-semibold">
                              <Sparkles className="w-3.5 h-3.5 shrink-0" /> New item
                            </span>
                          )}
                          {row.matchedItem && (/^\s*VP-?\d{4,}\s*-/i.test(row.matchedItem.name || "") || /^unbranded$/i.test(row.matchedItem.brand || "") || row.categoryIsMaster === false) && !row.fixProduct && (
                            <span className="flex items-center gap-1 text-red-600 text-[10px] font-semibold mt-0.5">
                              <AlertTriangle className="w-3 h-3" /> Product name/brand/category looks wrong
                            </span>
                          )}
                          {row.matchedItem && row.fixProduct && row.fixProduct.category && row.fixProduct.category !== row.matchedItem.category && (
                            <span className="block text-emerald-700 text-[10px] font-semibold mt-0.5">
                              Category will be corrected to {row.fixProduct.category}
                            </span>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => setPickerFor(pickerFor === row.key ? null : row.key)}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#3F63AD] hover:underline"
                            >
                              <Link2 className="w-3 h-3" /> {row.matchedItem ? "Change product" : "Link to product"}
                            </button>
                            {row.matchedItem && !row.fixProduct && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateRow(row.key, {
                                    fixProduct: {
                                      name: row.matchedItem.name || "",
                                      brand: row.matchedItem.brand || "",
                                      category:
                                        row.categoryIsMaster === false && row.suggestedCategory
                                          ? row.suggestedCategory
                                          : row.matchedItem.category || "",
                                    },
                                  })
                                }
                                className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 hover:underline"
                              >
                                <Pencil className="w-3 h-3" /> Fix details
                              </button>
                            )}
                          </div>
                          {pickerFor === row.key && (
                            <ProductPicker
                              items={allItems}
                              onClose={() => setPickerFor(null)}
                              onPick={(item) => {
                                updateRow(row.key, {
                                  matchedItem: item
                                    ? {
                                        _id: String(item._id),
                                        code: item.code,
                                        vpCode: item.vpCode,
                                        name: item.name,
                                        category: item.category,
                                        brand: item.brand,
                                        gstRate: item.gstRate,
                                      }
                                    : null,
                                  manualLink: true,
                                  fixProduct: null,
                                });
                                setPickerFor(null);
                              }}
                            />
                          )}
                          {row.lowConfidence && (
                            <span className="flex items-center gap-1 text-red-500 text-[10px] mt-0.5">
                              <AlertTriangle className="w-3 h-3" /> Check this row
                            </span>
                          )}
                          {row.serialNumbers && row.serialNumbers.length > 0 && (
                            <span className="flex items-center gap-1 text-[#3F63AD] text-[10px] font-bold mt-0.5">
                              {row.serialNumbers.length} serial{row.serialNumbers.length === 1 ? "" : "s"} found
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500 hover:bg-red-50"
                            onClick={() => removeRow(row.key)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="bg-white px-5 py-4 border-t border-slate-200 flex items-center justify-between gap-2 shrink-0">
          <p className="text-xs text-slate-500">
            {rows.length > 0
              ? `${rows.length} row(s) — nothing is saved until you confirm`
              : "Nothing uploaded yet"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => resolveMutation.mutate()}
              disabled={rows.length === 0 || resolveMutation.isPending}
            >
              {resolveMutation.isPending
                ? "Adding…"
                : `Add ${rows.length || ""} Row${rows.length === 1 ? "" : "s"} to Purchase Entry`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
