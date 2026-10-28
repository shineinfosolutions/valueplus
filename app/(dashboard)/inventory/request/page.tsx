"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Search, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function StockRequestPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newRequest, setNewRequest] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    requestingWarehouseId: "",
    supplyingWarehouseId: "",
    items: [{ itemId: "", itemName: "", requestedQty: 1 }]
  });

  const { data: items = [] } = useQuery({ 
    queryKey: ["items"], 
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: requestData, isLoading } = useQuery({ queryKey: ["stock-requests"], queryFn: async () => (await fetch("/api/inventory/request")).json() });
  const requests = requestData?.data || [];

  const addMutation = useMutation({
    mutationFn: async (req: any) => {
      const res = await fetch("/api/inventory/request", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
      if (!res.ok) throw new Error("Failed to create request");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-requests"] });
      setIsAddOpen(false);
    }
  });

  const handleItemChange = (index: number, field: string, value: any) => {
    const updated = [...newRequest.items];
    if (field === "itemId") {
      const it = items.find((i: any) => i._id === value);
      updated[index].itemId = value;
      updated[index].itemName = it ? (it.itemName || it.name) : "";
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setNewRequest({ ...newRequest, items: updated });
  };

  const filtered = requests.filter((r: any) => 
    r.requestNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const lowStockItems = items.filter((it: any) => Number(it.currentStock) <= (Number(it.reorderLevel || it.minStock || 5) + 5));

  const handleQuickRequest = (it: any) => {
    const min = Number(it.reorderLevel || it.minStock || 5);
    const qtyNeeded = Math.max(1, min - Number(it.currentStock || 0));
    setNewRequest({
      date: format(new Date(), "yyyy-MM-dd"),
      requestingWarehouseId: "",
      supplyingWarehouseId: "",
      items: [{ itemId: it._id, itemName: it.itemName || it.name, requestedQty: qtyNeeded }]
    });
    setIsAddOpen(true);
  };

  return (
    <PageShell title="Stock Request" subtitle="Internal stock indents" breadcrumbs={[{ label: "Inventory" }, { label: "Stock Request" }]}>
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search Requests..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Stock Request"
            subtitle={`${filtered.length} requests`}
            data={filtered.map((row: any) => ({
              "Request No.": row.requestNumber,
              Date: format(new Date(row.date), "dd MMM, yyyy"),
              "Items Requested": (row.items || []).map((line: any) => `${line.requestedQty} x ${line.itemName}`).join(", "),
              Status: row.status,
            }))}
            filename="stock-requests"
          />
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90"><Plus className="w-4 h-4 mr-2" /> New Request</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Stock Request</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); addMutation.mutate(newRequest); }} className="space-y-4 mt-4">
              <div>
                <label className="text-sm font-medium">Date</label>
                <Input type="date" required value={newRequest.date} onChange={e => setNewRequest({...newRequest, date: e.target.value})} className="mt-1" />
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">Requested Items</h4>
                <table className="w-full text-sm border">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Quantity Needed</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newRequest.items.map((line, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <Select value={line.itemId} onValueChange={(val) => handleItemChange(idx, "itemId", val)}>
                            <SelectTrigger className="w-full bg-white">
                              <SelectValue placeholder="Select Item..." />
                            </SelectTrigger>
                            <SelectContent>
                              {items.map((it: any) => (
                                <SelectItem key={it._id} value={it._id}>
                                  {it.itemName || it.name} <span className="text-muted-foreground ml-2">(Stock: {it.currentStock || 0})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2 w-32"><Input type="number" min="1" required value={line.requestedQty} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleItemChange(idx, "requestedQty", Number(e.target.value))} /></td>
                        <td className="p-2 w-10">
                          <button type="button" onClick={() => setNewRequest({...newRequest, items: newRequest.items.filter((_, i) => i !== idx)})} className="text-red-500">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setNewRequest({...newRequest, items: [...newRequest.items, { itemId: "", itemName: "", requestedQty: 1 }]})}>+ Add Line</Button>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#3F63AD] hover:bg-[#3F63AD]/90" disabled={addMutation.isPending}>{addMutation.isPending ? "Saving..." : "Submit Request"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="overflow-hidden border border-red-200 mb-6 bg-red-50/30">
          <div className="p-4 border-b border-red-200 flex justify-between items-center bg-red-50/50">
            <h3 className="font-bold text-red-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" /> Auto-Generated Low Stock Alerts
            </h3>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-red-50 border-b border-red-100 text-red-700 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">VP Code</th>
                  <th className="px-4 py-3 text-left font-semibold">Item Name</th>
                  <th className="px-4 py-3 text-left font-semibold">HSN Code</th>
                  <th className="px-4 py-3 text-right font-semibold">Current Stock</th>
                  <th className="px-4 py-3 text-center font-semibold">Priority</th>
                  <th className="px-4 py-3 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {lowStockItems.map((it: any) => (
                  <tr key={it._id} className="hover:bg-red-50/40">
                    <td className="px-4 py-3 font-mono font-bold text-red-900">{it.vpCode || it.code}</td>
                    <td className="px-4 py-3 text-red-800 font-semibold">{it.itemName || it.name}</td>
                    <td className="px-4 py-3 text-red-800">{it.hsnCode || "-"}</td>
                    <td className="px-4 py-3 text-right font-black text-red-600">{it.currentStock}</td>
                    <td className="px-4 py-3 text-center">
                      {it.currentStock <= 0 ? (
                        <span className="px-2 py-1 rounded bg-red-600 text-white text-[10px] font-black tracking-wider uppercase animate-pulse">Urgent (Out of Stock)</span>
                      ) : (
                        <span className="px-2 py-1 rounded bg-orange-100 text-orange-700 text-[10px] font-bold tracking-wider uppercase">Low Stock</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button size="sm" variant="outline" className="h-7 text-[10px] bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800 border-red-200" onClick={() => handleQuickRequest(it)}>
                        Quick Request
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden border border-slate-200">
        <div className="p-4 border-b bg-slate-50">
          <h3 className="font-semibold text-slate-800">Request History</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Request No.</th>
              <th className="px-4 py-3 text-left font-semibold">Date</th>
              <th className="px-4 py-3 text-left font-semibold">Items Requested</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? <tr><td colSpan={4} className="p-0"><TableShimmer rows={6} cols={4} /></td></tr> : filtered.map((row: any) => (
              <tr key={row._id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-[#3F63AD]">{row.requestNumber}</td>
                <td className="px-4 py-3">{format(new Date(row.date), "dd MMM, yyyy")}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 text-xs">
                    {row.items.map((line:any, i:number) => (
                      <span key={i}>{line.requestedQty} x {line.itemName}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.status === 'Pending' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {row.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PageShell>
  );
}
