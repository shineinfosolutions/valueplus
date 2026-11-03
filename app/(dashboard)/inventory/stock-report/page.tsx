"use client";

import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, X } from "lucide-react";
import { ExportMenu } from "@/components/shared/ExportMenu";

const PAGE_SIZE = 100;
type StockView = "all" | "in" | "low" | "out";

const indianNumberFormat = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-IN");
const stockOf = (it: any) => Number(it.currentStock) || 0;

export default function StockReportPage() {
  const [brand, setBrand] = useState("all");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState<StockView>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["stockReportItems"],
    queryFn: async () => {
      const json = await (await fetch("/api/items")).json();
      // Items folded into another during the warehouse migration are inactive duplicates.
      return json.success ? json.data.filter((i: any) => i.status !== "inactive") : [];
    },
  });

  const brands = useMemo(
    () => [...new Set<string>(items.map((i: any) => String(i.brand || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const categories = useMemo(
    () => [...new Set<string>(items.map((i: any) => String(i.category || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((i: any) => {
        if (brand !== "all" && String(i.brand || "").trim().toLowerCase() !== brand.toLowerCase()) return false;
        if (category !== "all" && String(i.category || "").trim().toLowerCase() !== category.toLowerCase()) return false;
        const s = stockOf(i);
        if (view === "in" && s <= 0) return false;
        if (view === "out" && s > 0) return false;
        if (view === "low" && !(s > 0 && s <= (Number(i.reorderLevel) || 5))) return false;
        if (q && !`${i.name} ${i.vpCode || ""} ${i.code || ""} ${i.brand || ""} ${i.category || ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a: any, b: any) => String(a.brand || "").localeCompare(String(b.brand || "")) || String(a.name).localeCompare(String(b.name)));
  }, [items, brand, category, view, search]);

  const totals = useMemo(
    () => ({
      qty: rows.reduce((s: number, i: any) => s + stockOf(i), 0),
      value: rows.reduce((s: number, i: any) => s + stockOf(i) * (Number(i.sellingPrice) || 0), 0),
      vspValue: rows.reduce((s: number, i: any) => s + stockOf(i) * (Number(i.vsp) || Number(i.sellingPrice) || 0), 0),
    }),
    [rows]
  );

  const filtered = brand !== "all" || category !== "all" || view !== "all" || search.trim() !== "";
  const reset = () => { setBrand("all"); setCategory("all"); setView("all"); setSearch(""); setLimit(PAGE_SIZE); };

  return (
    <PageShell title="Stock Report" description="Stock, selling price and VSP of every product — filter by brand and product type, or search.">
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Products", value: indianNumberFormat(rows.length) },
            { label: "Units in stock", value: indianNumberFormat(totals.qty) },
            { label: "Stock value @ selling price", value: `₹${indianNumberFormat(Math.round(totals.value))}` },
            { label: "Stock value @ VSP", value: `₹${indianNumberFormat(Math.round(totals.vspValue))}` },
          ].map((c) => (
            <div key={c.label} className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{c.label}</p>
              <p className="text-xl font-black text-slate-900 mt-0.5">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Label className="text-[10px] uppercase font-bold text-slate-500">Search</Label>
            <Search className="w-4 h-4 absolute left-3 bottom-2.5 text-slate-400" />
            <Input
              placeholder="Product, VP code, brand or category..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }}
              className="pl-9 mt-1 bg-slate-50 border-slate-300 text-xs h-9"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase font-bold text-slate-500">Brand</Label>
            <Select value={brand} onValueChange={(v) => { setBrand(v); setLimit(PAGE_SIZE); }}>
              <SelectTrigger className="w-[170px] mt-1 h-9 text-xs bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase font-bold text-slate-500">Product type</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setLimit(PAGE_SIZE); }}>
              <SelectTrigger className="w-[190px] mt-1 h-9 text-xs bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase font-bold text-slate-500">Stock</Label>
            <Select value={view} onValueChange={(v) => { setView(v as StockView); setLimit(PAGE_SIZE); }}>
              <SelectTrigger className="w-[140px] mt-1 h-9 text-xs bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="in">In stock</SelectItem>
                <SelectItem value="low">Low stock</SelectItem>
                <SelectItem value="out">Out of stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filtered && (
            <Button variant="ghost" size="sm" onClick={reset} className="h-9 text-xs"><X className="w-3.5 h-3.5 mr-1" /> Clear</Button>
          )}
          <div className="ml-auto">
            <ExportMenu
              title="Stock Report"
              subtitle={`${rows.length} products${brand !== "all" ? ` · ${brand}` : ""}${category !== "all" ? ` · ${category}` : ""}`}
              data={rows.map((i: any) => ({
                Product: i.name,
                "VP Code": i.vpCode || i.code || "",
                Brand: i.brand || "",
                Category: i.category || "",
                "Total Stock": stockOf(i),
                Showroom: Number(i.showroomStock) || 0,
                Godown: Number(i.godownStock) || 0,
                "Selling Price": Number(i.sellingPrice) || 0,
                VSP: Number(i.vsp) || 0,
                MRP: Number(i.mrp) || 0,
                "Stock Value (Selling)": stockOf(i) * (Number(i.sellingPrice) || 0),
              }))}
              filename="stock-report"
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 border-b text-slate-700 uppercase font-bold text-[10px]">
                <tr>
                  <th className="p-3">Product</th>
                  <th className="p-3">Brand</th>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-right">Stock</th>
                  <th className="p-3 text-right">Showroom</th>
                  <th className="p-3 text-right">Godown</th>
                  <th className="p-3 text-right">Selling Price</th>
                  <th className="p-3 text-right">VSP</th>
                  <th className="p-3 text-right">MRP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={9} className="p-8 text-center text-slate-500">Loading stock...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-slate-500"><Package className="w-5 h-5 mx-auto mb-1 text-slate-300" />No products match these filters.</td></tr>
                ) : (
                  rows.slice(0, limit).map((i: any) => {
                    const s = stockOf(i);
                    return (
                      <tr key={i._id} className="hover:bg-slate-50">
                        <td className="p-3">
                          <p className="font-bold text-slate-900">{i.name}</p>
                          <span className="font-mono text-[10px] text-blue-600">VP: {i.vpCode || i.code || "—"}</span>
                        </td>
                        <td className="p-3 font-semibold text-slate-700">{i.brand || "—"}</td>
                        <td className="p-3 text-slate-600">{i.category || "—"}</td>
                        <td className={`p-3 text-right font-mono font-black ${s <= 0 ? "text-red-600" : s <= (Number(i.reorderLevel) || 5) ? "text-amber-600" : "text-slate-900"}`}>{s}</td>
                        <td className="p-3 text-right font-mono text-slate-600">{Number(i.showroomStock) || 0}</td>
                        <td className="p-3 text-right font-mono text-slate-600">{Number(i.godownStock) || 0}</td>
                        <td className="p-3 text-right font-mono font-bold">₹{indianNumberFormat(Number(i.sellingPrice) || 0)}</td>
                        <td className="p-3 text-right font-mono font-bold text-emerald-700">{Number(i.vsp) > 0 ? `₹${indianNumberFormat(Number(i.vsp))}` : <span className="text-slate-300">—</span>}</td>
                        <td className="p-3 text-right font-mono text-slate-500">₹{indianNumberFormat(Number(i.mrp) || 0)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {rows.length > limit && (
            <div className="p-2 text-center border-t">
              <Button size="sm" variant="ghost" onClick={() => setLimit(limit + PAGE_SIZE)} className="text-xs">Show more ({rows.length - limit} left)</Button>
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
