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
import { toast } from "sonner";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function StockReturnPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newReturn, setNewReturn] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    returnType: "Customer Return",
    referenceId: "",
    invoiceId: "",
    status: "Completed",
    items: [{ itemId: "", itemName: "", quantity: 1, reason: "" }]
  });

  const { data: items = [] } = useQuery({ 
    queryKey: ["items"], 
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: returnData, isLoading } = useQuery({ queryKey: ["stock-returns"], queryFn: async () => (await fetch("/api/inventory/return")).json() });
  const returns = returnData?.data || [];

  const { data: invoicesData } = useQuery({ queryKey: ["invoices"], queryFn: async () => (await fetch("/api/invoices")).json() });
  const invoices = invoicesData?.data || [];

  const { data: purchasesData } = useQuery({ queryKey: ["purchase-entries"], queryFn: async () => (await fetch("/api/purchase-entries")).json() });
  const purchases = purchasesData?.data || [];

  const addMutation = useMutation({
    mutationFn: async (ret: any) => {
      const res = await fetch("/api/inventory/return", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ret) });
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to create return");
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-returns"] });
      queryClient.invalidateQueries({ queryKey: ["items"] }); // Update stock across app
      setIsAddOpen(false);
      toast.success("Stock return processed successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to process stock return");
    }
  });

  const handleItemChange = (index: number, field: string, value: any) => {
    const updated = [...newReturn.items];
    if (field === "itemId") {
      const it = items.find((i: any) => i._id === value);
      updated[index].itemId = value;
      updated[index].itemName = it ? (it.itemName || it.name) : "";
    } else {
      updated[index] = { ...updated[index], [field]: value };
    }
    setNewReturn({ ...newReturn, items: updated });
  };

  const filtered = returns.filter((r: any) => 
    r.returnNumber.toLowerCase().includes(searchTerm.toLowerCase()) || 
    r.returnType.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <PageShell title="Stock Return" subtitle="Process inventory returns" breadcrumbs={[{ label: "Inventory" }, { label: "Stock Return" }]}>
      <div className="flex justify-between items-center mb-6">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Search Returns..." className="pl-9" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
        </div>
        
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Stock Return"
            subtitle={`${filtered.length} returns`}
            data={filtered.map((row: any) => ({
              "Return No.": row.returnNumber,
              Date: format(new Date(row.date), "dd MMM, yyyy"),
              Type: row.returnType,
              "Returned Items": (row.items || []).map((line: any) => `${line.quantity} x ${line.itemName}`).join(", "),
              Status: row.status,
            }))}
            filename="stock-returns"
          />
          <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90"><Plus className="w-4 h-4 mr-2" /> New Return</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Process Stock Return</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { 
              e.preventDefault(); 
              const validItems = newReturn.items.filter(i => i.itemId);
              if (validItems.length === 0) {
                toast.error("Please select valid items to return.");
                return;
              }
              addMutation.mutate({ ...newReturn, items: validItems }); 
            }} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" required value={newReturn.date} onChange={e => setNewReturn({...newReturn, date: e.target.value})} className="mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium">Return Type</label>
                  <Select value={newReturn.returnType} onValueChange={(val) => setNewReturn({...newReturn, returnType: val, invoiceId: "", items: [{ itemId: "", itemName: "", quantity: 1, reason: "" }]})}>
                    <SelectTrigger className="w-full bg-white mt-1">
                      <SelectValue placeholder="Return Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Customer Return">Customer Return (Stock IN)</SelectItem>
                      <SelectItem value="Supplier Return">Supplier Return (Stock OUT)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {newReturn.returnType === "Customer Return" && (
                  <div className="col-span-2">
                    <label className="text-sm font-medium">Link to Sales Invoice *</label>
                    <Input 
                      list="invoice-list"
                      placeholder="Type Bill No or Customer Name to search..."
                      className="w-full bg-white mt-1"
                      onChange={(e) => {
                        const val = e.target.value;
                        const inv = invoices.find((i: any) => `${i.invoiceNumber} - ${i.customerName}` === val);
                        if (inv) {
                          const mappedItems = inv.items.map((line: any) => ({
                            itemId: line.itemId || `UNKNOWN-${Math.random().toString(36).substring(7)}`,
                            itemName: line.itemName || line.name || "Unknown Item",
                            quantity: line.quantity || 1,
                            reason: "Customer Return"
                          }));
                          setNewReturn({...newReturn, invoiceId: inv._id, referenceId: inv.invoiceNumber, items: mappedItems.length > 0 ? mappedItems : [{ itemId: "", itemName: "", quantity: 1, reason: "" }]});
                        }
                      }}
                    />
                    <datalist id="invoice-list">
                      {invoices.map((inv: any) => (
                        <option key={inv._id} value={`${inv.invoiceNumber} - ${inv.customerName}`} />
                      ))}
                    </datalist>
                  </div>
                )}
                {newReturn.returnType === "Supplier Return" && (
                  <div className="col-span-2">
                    <label className="text-sm font-medium">Link to Purchase Entry *</label>
                    <Input 
                      list="purchase-list"
                      placeholder="Type Bill No or Supplier Name to search..."
                      className="w-full bg-white mt-1"
                      onChange={(e) => {
                        const val = e.target.value;
                        const pur = purchases.find((p: any) => `${p.billNo} - ${p.supplierName}` === val);
                        if (pur) {
                          const mappedItems = pur.items.map((line: any) => ({
                            itemId: line.itemId || `UNKNOWN-${Math.random().toString(36).substring(7)}`,
                            itemName: line.itemName || line.name || "Unknown Item",
                            quantity: line.quantity || 1,
                            reason: "Supplier Return"
                          }));
                          setNewReturn({...newReturn, invoiceId: pur._id, referenceId: pur.billNo, items: mappedItems.length > 0 ? mappedItems : [{ itemId: "", itemName: "", quantity: 1, reason: "" }]});
                        }
                      }}
                    />
                    <datalist id="purchase-list">
                      {purchases.map((pur: any) => (
                        <option key={pur._id} value={`${pur.billNo} - ${pur.supplierName}`} />
                      ))}
                    </datalist>
                  </div>
                )}
              </div>
              
              <div>
                <h4 className="font-medium text-sm mb-2">Returned Items</h4>
                <div className="overflow-x-auto">
                <table className="w-full text-sm border">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Item</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-left">Reason</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newReturn.items.map((line, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <Select value={line.itemId} onValueChange={(val) => handleItemChange(idx, "itemId", val)}>
                            <SelectTrigger className="w-full bg-white">
                              <SelectValue placeholder="Select Item..." />
                            </SelectTrigger>
                            <SelectContent>
                              {(newReturn.invoiceId 
                                ? (newReturn.returnType === "Customer Return" 
                                    ? invoices.find((inv: any) => inv._id === newReturn.invoiceId)?.items
                                    : purchases.find((pur: any) => pur._id === newReturn.invoiceId)?.items
                                  )?.map((line: any) => ({
                                    _id: line.itemId,
                                    name: line.itemName || line.name,
                                    currentStock: items.find((i: any) => i._id === line.itemId)?.currentStock || 0
                                  })) || []
                                : items
                              ).map((it: any) => (
                                <SelectItem key={it._id} value={it._id}>
                                  {it.itemName || it.name} <span className="text-muted-foreground ml-2">(Stock: {it.currentStock || 0})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="p-2 w-24"><Input type="number" min="1" required value={line.quantity} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleItemChange(idx, "quantity", Number(e.target.value))} /></td>
                        <td className="p-2"><Input type="text" placeholder="Reason..." value={line.reason} onChange={e => handleItemChange(idx, "reason", e.target.value)} /></td>
                        <td className="p-2 w-10">
                          <button type="button" onClick={() => setNewReturn({...newReturn, items: newReturn.items.filter((_, i) => i !== idx)})} className="text-red-500">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => setNewReturn({...newReturn, items: [...newReturn.items, { itemId: "", itemName: "", quantity: 1, reason: "" }]})}>+ Add Line</Button>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#3F63AD] hover:bg-[#3F63AD]/90" disabled={addMutation.isPending}>{addMutation.isPending ? "Saving..." : "Process Return"}</Button>
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
              <th className="px-4 py-3 text-left font-semibold">Return No.</th>
              <th className="px-4 py-3 text-left font-semibold">Date</th>
              <th className="px-4 py-3 text-left font-semibold">Type</th>
              <th className="px-4 py-3 text-left font-semibold">Returned Items</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? <tr><td colSpan={5} className="p-0"><TableShimmer rows={6} cols={5} /></td></tr> : filtered.map((row: any) => (
              <tr key={row._id} className="hover:bg-slate-50/50">
                <td className="px-4 py-3 font-medium text-[#3F63AD]">{row.returnNumber}</td>
                <td className="px-4 py-3">{format(new Date(row.date), "dd MMM, yyyy")}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.returnType === 'Customer Return' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                    {row.returnType}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1 text-xs">
                    {row.items.map((line:any, i:number) => (
                      <span key={i}>{line.quantity} x {line.itemName}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${row.status === 'Completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {row.status}
                  </span>
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
