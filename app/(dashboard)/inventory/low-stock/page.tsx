"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Package, ArrowLeft, Search, AlertTriangle } from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";

export default function LowStockPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    }
  });

  const lowStockItems = items.filter((item: any) => {
    const stock = Number(item.currentStock);
    const reorder = Number(item.reorderLevel);
    // Show items that are strictly below reorder level, OR within a +5 buffer of the reorder level
    return stock <= (reorder + 5);
  });
  const filteredItems = lowStockItems.filter((item: any) => 
    (item.name || "").toLowerCase().includes(search.toLowerCase()) ||
    (item.code || "").toLowerCase().includes(search.toLowerCase())
  );

  const exportData = filteredItems.map((i: any) => ({
    Code: i.code,
    Name: i.name,
    Category: i.category,
    CurrentStock: i.currentStock,
    ReorderLevel: i.reorderLevel,
    PurchasePrice: i.purchasePrice
  }));

  return (
    <PageShell
      title="Low Stock Alerts"
      description="Items that have fallen below their reorder level or are approaching it."
      icon={Package}
      actions={
        <>
          <Button variant="outline" onClick={() => router.push('/dashboard')} className="rounded-xl shadow-sm h-10">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
          </Button>
          <ExportMenu
            className="rounded-xl shadow-sm h-10"
            title="Low Stock Alerts"
            subtitle={`${lowStockItems.length} items require attention`}
            data={exportData}
            filename="Low_Stock_Report"
          />
        </>
      }
    >
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="relative w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search items..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 border-slate-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            <span className="text-sm font-bold text-rose-500">{lowStockItems.length} items require attention</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-50 border-b border-slate-100 text-xs uppercase text-slate-500 font-bold">
              <tr>
                <th className="px-6 py-4">VP Code</th>
                <th className="px-6 py-4">Item Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Current Stock</th>
                <th className="px-6 py-4 text-right">Reorder Level</th>
                <th className="px-6 py-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="p-0">
                    <TableShimmer rows={6} cols={6} />
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    No low stock items found.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item: any) => {
                  const stock = Number(item.currentStock);
                  const isZero = stock <= 0;
                  return (
                    <tr key={item.code} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-mono font-bold text-blue-600">{item.vpCode || item.code}</td>
                      <td className="px-6 py-4 font-medium text-[#2E3192]">{item.name}</td>
                      <td className="px-6 py-4 text-slate-600">{item.category}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={`font-bold ${isZero ? 'text-rose-600' : stock <= Number(item.reorderLevel) ? 'text-amber-600' : 'text-blue-600'}`}>
                          {item.currentStock} {item.unit}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-slate-600">
                        {item.reorderLevel} {item.unit}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${isZero ? 'bg-rose-100 text-rose-700' : stock <= Number(item.reorderLevel) ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                          {isZero ? 'Out of Stock' : stock <= Number(item.reorderLevel) ? 'Low Stock' : 'Approaching Low'}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
