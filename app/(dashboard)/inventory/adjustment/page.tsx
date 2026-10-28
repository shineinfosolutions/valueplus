"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Scale, Trash2, AlertTriangle, X } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

export default function StockAdjustmentPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [adjustmentToDelete, setAdjustmentToDelete] = useState<string | null>(null);

  const [newAdjustment, setNewAdjustment] = useState({
    date: todayInIndia(),
    reason: "Opening Stock",
    warehouseId: "",
    items: [{ itemId: "", itemName: "", quantity: 1, type: "in", remarks: "" }]
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => {
      const res = await fetch("/api/warehouses");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: items = [] } = useQuery({
    queryKey: ["items"], 
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: adjustmentsData, isLoading } = useQuery({ 
    queryKey: ["stock-adjustments"], 
    queryFn: async () => (await fetch("/api/inventory/adjustment")).json() 
  });
  const adjustments = adjustmentsData?.data || [];

  const filtered = useMemo(() => {
    return adjustments.filter(
      (a: any) =>
        !search ||
        a.adjustmentNo.toLowerCase().includes(search.toLowerCase()) ||
        a.reason.toLowerCase().includes(search.toLowerCase()) ||
        a.items.some((i: any) => i.itemName.toLowerCase().includes(search.toLowerCase()))
    );
  }, [adjustments, search]);

  const handleItemChange = (index: number, field: string, value: any) => {
    const updated = [...newAdjustment.items];
    if (field === "itemId") {
      const it = items.find((i: any) => i._id === value);
      updated[index].itemId = value;
      updated[index].itemName = it ? it.name : "";
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setNewAdjustment({ ...newAdjustment, items: updated });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/inventory/adjustment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create adjustment");
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["items"] }); // Update stock across app
      toast.success(`Stock Adjustment ${data.adjustmentNo} created successfully!`);
      setIsFormOpen(false);
      setNewAdjustment({
        date: todayInIndia(),
        reason: "Opening Stock",
        warehouseId: "",
        items: [{ itemId: "", itemName: "", quantity: 1, type: "in", remarks: "" }]
      });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (adjustmentNo: string) => {
      const res = await fetch(`/api/inventory/adjustment?adjustmentNo=${encodeURIComponent(adjustmentNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete adjustment");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["items"] }); // Revert stock across app
      toast.success("Stock Adjustment deleted successfully");
      setAdjustmentToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });

  const handleSave = () => {
    if (!newAdjustment.warehouseId) {
      toast.error("Please select which warehouse this adjustment applies to");
      return;
    }
    if (newAdjustment.items.length === 0 || !newAdjustment.items[0].itemId) {
      toast.error("Please add at least one item to adjust");
      return;
    }

    createMutation.mutate(newAdjustment);
  };

  return (
    <PageShell
      title="Stock Adjustment"
      subtitle="Record stock additions and reductions."
      breadcrumbs={[{ label: "Inventory" }, { label: "Stock Adjustment" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Stock Adjustments"
            subtitle={`${filtered.length} adjustments`}
            data={filtered.map((a: any) => ({
              "Adjustment #": a.adjustmentNo,
              Date: formatDate(a.date),
              Reason: a.reason,
              "Items Adjusted": (a.items || [])
                .map((line: any) => `${line.itemName} (${line.type === "in" ? "+" : "-"}${line.quantity})`)
                .join(", "),
            }))}
            filename="stock-adjustments"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Adjustment
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Adjustments", value: adjustments.length },
          { label: "Stock IN (Qty)", value: adjustments.reduce((acc: number, a: any) => acc + a.items.filter((i: any) => i.type === "in").reduce((s: number, i: any) => s + i.quantity, 0), 0) },
          { label: "Stock OUT (Qty)", value: adjustments.reduce((acc: number, a: any) => acc + a.items.filter((i: any) => i.type === "out").reduce((s: number, i: any) => s + i.quantity, 0), 0) },
        ].map((s, idx) => (
          <div key={idx} className="metric-card">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search adjustments..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Adjustment #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Reason</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Items Adjusted</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase w-10">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-0">
                    <TableShimmer rows={6} cols={5} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No stock adjustments found</td>
                </tr>
              ) : (
                filtered.map((a: any) => (
                <tr key={a._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{a.adjustmentNo}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(a.date)}</td>
                  <td className="px-4 py-3 font-medium">
                    <Badge variant="outline" className="bg-slate-100">{a.reason}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5 text-xs">
                      {a.items?.map((line: any, i: number) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="font-medium text-slate-700 w-32 truncate" title={line.itemName}>{line.itemName}</span>
                          <Badge variant={line.type === "in" ? "success" : "destructive"} className="px-1.5 py-0">
                            {line.type === "in" ? "+" : "-"}{line.quantity}
                          </Badge>
                          {line.remarks && <span className="text-muted-foreground truncate max-w-[120px]">- {line.remarks}</span>}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setAdjustmentToDelete(a.adjustmentNo)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Scale className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">New Stock Adjustment</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Record physical stock mismatch, breakage, theft, or opening stock.
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6 bg-slate-50/50 max-h-[70vh] overflow-y-auto">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs font-semibold text-slate-700 mb-1.5 block">Adjustment Date *</Label>
                  <Input type="date" required value={newAdjustment.date} onChange={e => setNewAdjustment({...newAdjustment, date: e.target.value})} className="bg-slate-50" />
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-700 mb-1.5 block">Warehouse *</Label>
                  <Select value={newAdjustment.warehouseId} onValueChange={(val) => setNewAdjustment({...newAdjustment, warehouseId: val})}>
                    <SelectTrigger className="bg-slate-50">
                      <SelectValue placeholder="Select Warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w: any) => (
                        <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs font-semibold text-slate-700 mb-1.5 block">Reason / Purpose *</Label>
                  <Select value={newAdjustment.reason} onValueChange={(val) => setNewAdjustment({...newAdjustment, reason: val})}>
                    <SelectTrigger className="bg-slate-50">
                      <SelectValue placeholder="Select Reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Opening Stock">Opening Stock (Addition)</SelectItem>
                      <SelectItem value="Physical Count Mismatch">Physical Count Mismatch</SelectItem>
                      <SelectItem value="Damaged / Broken">Damaged / Broken (Write-off)</SelectItem>
                      <SelectItem value="Theft / Lost">Theft / Lost (Write-off)</SelectItem>
                      <SelectItem value="Internal Consumption">Internal Consumption</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h4 className="font-semibold text-sm text-slate-800">Items to Adjust</h4>
                <Badge variant="outline" className="bg-white">
                  {newAdjustment.items.length} Product(s)
                </Badge>
              </div>
              
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Product Item *</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600 w-32">Type *</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-600 w-28">Qty *</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Remarks</th>
                    <th className="px-4 py-2.5 text-center text-xs font-semibold text-slate-600 w-12"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {newAdjustment.items.map((line, idx) => (
                    <tr key={idx} className="bg-white group">
                      <td className="p-2">
                        <Select value={line.itemId} onValueChange={(val) => handleItemChange(idx, "itemId", val)}>
                          <SelectTrigger className="w-full bg-transparent border-slate-200 h-9">
                            <SelectValue placeholder="Select Product..." />
                          </SelectTrigger>
                          <SelectContent>
                            {items.map((it: any) => (
                              <SelectItem key={it._id} value={it._id}>
                                {it.name} <span className="text-muted-foreground ml-2">(Stock: {it.currentStock || 0})</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Select value={line.type} onValueChange={(val) => handleItemChange(idx, "type", val)}>
                          <SelectTrigger className={`w-full h-9 font-medium ${line.type === 'in' ? 'text-green-600' : 'text-red-600'}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in" className="text-green-600 font-medium">Stock IN (+)</SelectItem>
                            <SelectItem value="out" className="text-red-600 font-medium">Stock OUT (-)</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          min="1"
                          className="h-9 text-right font-bold bg-transparent"
                          value={line.quantity}
                          onChange={(e) => handleItemChange(idx, "quantity", Number(e.target.value))}
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          placeholder="Optional remark..."
                          className="h-9 bg-transparent"
                          value={line.remarks}
                          onChange={(e) => handleItemChange(idx, "remarks", e.target.value)}
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => setNewAdjustment({ ...newAdjustment, items: newAdjustment.items.filter((_, i) => i !== idx) })}
                          className="text-red-400 hover:text-red-600 hover:bg-red-50 p-2 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="bg-slate-50 p-3 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-dashed text-slate-600 w-full sm:w-auto"
                  onClick={() => setNewAdjustment({ ...newAdjustment, items: [...newAdjustment.items, { itemId: "", itemName: "", quantity: 1, type: "in", remarks: "" }] })}
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Another Row
                </Button>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20">
              {createMutation.isPending ? "Saving..." : "Save Stock Adjustment"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjustmentToDelete} onOpenChange={(open) => !open && setAdjustmentToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete adjustment <span className="font-bold">{adjustmentToDelete}</span>? 
              This will reverse the inventory changes. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setAdjustmentToDelete(null)} disabled={deleteMutation.isPending}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => adjustmentToDelete && deleteMutation.mutate(adjustmentToDelete)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Adjustment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </PageShell>
  );
}
