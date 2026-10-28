"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { toast } from "sonner";

export default function StockJournalPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newJournal, setNewJournal] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    purpose: "Adjustment",
    items: [{ itemId: "", itemName: "", quantity: 1, type: "in", warehouseId: "" }]
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

  const { data: journalData, isLoading } = useQuery({ queryKey: ["stock-journals"], queryFn: async () => (await fetch("/api/inventory/journal")).json() });
  const journals = journalData?.data || [];

  const addMutation = useMutation({
    mutationFn: async (journal: any) => {
      const res = await fetch("/api/inventory/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(journal) });
      if (!res.ok) throw new Error("Failed to create journal");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-journals"] });
      queryClient.invalidateQueries({ queryKey: ["items"] }); // Update stock across app
      setIsAddOpen(false);
    }
  });

  const handleItemChange = (index: number, field: string, value: any) => {
    const updated = [...newJournal.items];
    if (field === "itemId") {
      const it = items.find((i: any) => i._id === value);
      updated[index].itemId = value;
      updated[index].itemName = it ? it.name : "";
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setNewJournal({ ...newJournal, items: updated });
  };

  const filtered = journals.filter((j: any) => 
    j.purpose.toLowerCase().includes(searchTerm.toLowerCase()) || 
    j.journalNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell title="Stock Journal" subtitle="Adjust inventory manually" breadcrumbs={[{ label: "Inventory" }, { label: "Stock Journal" }]}>
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search Journals..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Stock Journal"
            subtitle={`${filtered.length} journal entries`}
            data={filtered.map((row: any) => ({
              "Journal No.": row.journalNumber,
              Date: format(new Date(row.date), "dd MMM, yyyy"),
              Purpose: row.purpose,
              "Affected Items": (row.items || []).map((line: any) => `${line.type === 'in' ? '+' : '-'}${line.quantity} ${line.itemName}`).join(", "),
            }))}
            filename="stock-journal"
          />
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90"><Plus className="w-4 h-4 mr-2" /> New Entry</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create Stock Journal</DialogTitle></DialogHeader>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (newJournal.items.some((line) => !line.warehouseId)) {
                toast.error("Select a warehouse for every line item.");
                return;
              }
              addMutation.mutate(newJournal);
            }} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" required value={newJournal.date} onChange={e => setNewJournal({...newJournal, date: e.target.value})} />
                </div>
                <div>
                  <label className="text-sm font-medium">Reason (Purpose)</label>
                  <Select value={newJournal.purpose} onValueChange={(val) => setNewJournal({...newJournal, purpose: val})}>
                    <SelectTrigger className="w-full bg-white mt-1">
                      <SelectValue placeholder="Select Reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Adjustment">Adjustment (Correction)</SelectItem>
                      <SelectItem value="Manufacturing">Manufacturing (Assembly)</SelectItem>
                      <SelectItem value="Write-off">Write-off (Damaged/Lost)</SelectItem>
                      <SelectItem value="Internal Use">Internal Use (Consumed by Staff)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">Items</h4>
                <div className="overflow-x-auto">
                <table className="w-full text-sm border">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-left">Warehouse</th>
                      <th className="px-3 py-2 text-left">Type</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newJournal.items.map((line, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <Select value={line.itemId} onValueChange={(val) => handleItemChange(idx, "itemId", val)}>
                            <SelectTrigger className="w-full bg-white">
                              <SelectValue placeholder="Select Item..." />
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
                          <Select value={line.warehouseId} onValueChange={(val) => handleItemChange(idx, "warehouseId", val)}>
                            <SelectTrigger className="w-full bg-white">
                              <SelectValue placeholder="Select Warehouse..." />
                            </SelectTrigger>
                            <SelectContent>
                              {warehouses.map((w: any) => (
                                <SelectItem key={w._id} value={w._id}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2 w-32">
                          <Select value={line.type} onValueChange={(val) => handleItemChange(idx, "type", val)}>
                            <SelectTrigger className="w-full bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="in">Stock IN (+)</SelectItem>
                              <SelectItem value="out">Stock OUT (-)</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2 w-24"><Input type="number" min="1" required value={line.quantity} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleItemChange(idx, "quantity", Math.max(1, Number(e.target.value)))} /></td>
                        <td className="p-2 w-10">
                          <button type="button" onClick={() => setNewJournal({...newJournal, items: newJournal.items.filter((_, i) => i !== idx)})} className="text-red-500">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setNewJournal({...newJournal, items: [...newJournal.items, { itemId: "", itemName: "", quantity: 1, type: "in", warehouseId: "" }]})}>+ Add Line</Button>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#3F63AD] hover:bg-[#3F63AD]/90" disabled={addMutation.isPending}>{addMutation.isPending ? "Saving..." : "Save Journal"}</Button>
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
              <th className="px-4 py-3 text-left font-semibold">Journal No.</th>
              <th className="px-4 py-3 text-left font-semibold">Date</th>
              <th className="px-4 py-3 text-left font-semibold">Purpose</th>
              <th className="px-4 py-3 text-left font-semibold">Affected Items</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? <tr><td colSpan={4} className="p-0"><TableShimmer rows={6} cols={4} /></td></tr> : filtered.map((row: any) => (
              <tr key={row._id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-[#3F63AD]">{row.journalNumber}</td>
                <td className="px-4 py-3">{format(new Date(row.date), "dd MMM, yyyy")}</td>
                <td className="px-4 py-3">{row.purpose}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 text-xs">
                    {row.items.map((line:any, i:number) => (
                      <span key={i} className={line.type === 'in' ? 'text-emerald-600' : 'text-red-600'}>
                        {line.type === 'in' ? '+' : '-'}{line.quantity} {line.itemName}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </Card>
    </PageShell>
  );
}
