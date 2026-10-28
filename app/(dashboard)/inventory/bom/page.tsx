"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function BOMPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newBom, setNewBom] = useState({
    finishedGoodItemId: "",
    finishedGoodName: "",
    expectedQuantity: 1,
    components: [{ itemId: "", itemName: "", quantity: 1, cost: 0 }]
  });

  const { data: itemsData } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      return res.json();
    }
  });
  const items = itemsData?.data || [];

  const { data: bomData, isLoading } = useQuery({
    queryKey: ["boms"],
    queryFn: async () => {
      const res = await fetch("/api/inventory/bom");
      return res.json();
    }
  });
  const boms = bomData?.data || [];

  const addBomMutation = useMutation({
    mutationFn: async (bom: any) => {
      const res = await fetch("/api/inventory/bom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bom),
      });
      if (!res.ok) throw new Error("Failed to create BOM");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["boms"] });
      setIsAddOpen(false);
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const totalCost = newBom.components.reduce((acc, curr) => acc + (Number(curr.cost) * Number(curr.quantity)), 0);
    addBomMutation.mutate({ ...newBom, totalCost });
  };

  const handleComponentChange = (index: number, field: string, value: any) => {
    const updated = [...newBom.components];
    if (field === "itemId") {
      const it = items.find((i: any) => i._id === value);
      updated[index].itemId = value;
      updated[index].itemName = it ? it.itemName : "";
      updated[index].cost = it ? it.purchasePrice : 0;
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setNewBom({ ...newBom, components: updated });
  };

  const filteredBoms = boms.filter((b: any) => 
    b.finishedGoodName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    b.bomNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell title="Bill of Material" subtitle="Define product assemblies" breadcrumbs={[{ label: "Inventory" }, { label: "Bill of Material" }]}>
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search BOMs..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        
        <div className="flex items-center gap-2">
        <ExportMenu
          title="Bill of Material"
          subtitle={`${filteredBoms.length} BOMs`}
          data={filteredBoms.map((row: any) => ({
            "BOM No.": row.bomNumber,
            "Finished Good": row.finishedGoodName,
            "Expected Qty": row.expectedQuantity,
            "Total Cost (₹)": row.totalCost || 0,
          }))}
          filename="bill-of-material"
        />
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90"><Plus className="w-4 h-4 mr-2" /> New BOM</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Bill of Material</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Finished Good Item</label>
                  <select className="w-full border rounded p-2 text-sm text-slate-900 bg-white" required
                    value={newBom.finishedGoodItemId}
                    onChange={(e) => {
                      const it = items.find((i:any) => i._id === e.target.value);
                      setNewBom({...newBom, finishedGoodItemId: e.target.value, finishedGoodName: it?.itemName || ""})
                    }}
                  >
                    <option className="text-slate-900 bg-white" value="">Select Item...</option>
                    {items.map((it: any) => <option className="text-slate-900 bg-white" key={it._id} value={it._id}>{it.itemName}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium">Expected Quantity</label>
                  <Input type="number" min="1" value={newBom.expectedQuantity} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => setNewBom({...newBom, expectedQuantity: Math.max(1, Number(e.target.value))})} required />
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">Raw Material Components</h4>
                <div className="overflow-x-auto">
                <table className="w-full text-sm border">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Unit Cost</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newBom.components.map((comp, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <select className="w-full border rounded p-2 text-sm text-slate-900 bg-white" required value={comp.itemId} onChange={(e) => handleComponentChange(idx, "itemId", e.target.value)}>
                            <option className="text-slate-900 bg-white" value="">Select Material...</option>
                            {items.map((it: any) => <option className="text-slate-900 bg-white" key={it._id} value={it._id}>{it.itemName}</option>)}
                          </select>
                        </td>
                        <td className="p-2 w-24"><Input type="number" min="0.01" step="0.01" required value={comp.quantity} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleComponentChange(idx, "quantity", Math.max(0, Number(e.target.value)))} /></td>
                        <td className="p-2 w-24"><Input type="number" min="0" step="0.01" required value={comp.cost} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleComponentChange(idx, "cost", Math.max(0, Number(e.target.value)))} /></td>
                        <td className="p-2 w-10">
                          <button type="button" onClick={() => setNewBom({...newBom, components: newBom.components.filter((_, i) => i !== idx)})} className="text-red-500">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setNewBom({...newBom, components: [...newBom.components, { itemId: "", itemName: "", quantity: 1, cost: 0 }]})}>+ Add Component</Button>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#3F63AD] hover:bg-[#3F63AD]/90" disabled={addBomMutation.isPending}>{addBomMutation.isPending ? "Saving..." : "Save BOM"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">BOM No.</th>
              <th className="px-4 py-3 text-left font-semibold">Finished Good</th>
              <th className="px-4 py-3 text-right font-semibold">Expected Qty</th>
              <th className="px-4 py-3 text-right font-semibold">Total Cost (₹)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? <tr><td colSpan={4} className="p-0"><TableShimmer rows={6} cols={4} /></td></tr> : filteredBoms.map((row: any) => (
              <tr key={row._id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-[#3F63AD]">{row.bomNumber}</td>
                <td className="px-4 py-3">{row.finishedGoodName}</td>
                <td className="px-4 py-3 text-right">{row.expectedQuantity}</td>
                <td className="px-4 py-3 text-right font-semibold">₹{row.totalCost?.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </PageShell>
  );
}
