"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ArrowLeftRight, Warehouse, Trash2, AlertTriangle, X, Check, Package, FileText } from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { formatDate, formatCurrency } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useBranch } from "@/context/BranchContext";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { todayInIndia } from "@/lib/today";

interface TransferItem {
  id: string;
  transferNo: string;
  fromWarehouse: string;
  toWarehouse: string;
  itemName: string;
  quantity: number;
  unit: string;
  date: string;
  status: "received" | "in-transit" | "draft";
}

function SearchableItemSelect({
  items,
  selectedItemId,
  onSelect,
}: {
  items: any[];
  selectedItemId: string;
  onSelect: (item: any) => void;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedItem = items.find((i) => i._id === selectedItemId);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return items.slice(0, 15);
    const q = query.toLowerCase().trim();
    return items.filter((it: any) => {
      const name = (it.name || "").toLowerCase();
      const hsn = String(it.hsnCode || it.hsn || "").toLowerCase();
      const code = (it.code || "").toLowerCase();
      const vpCode = (it.vpCode || "").toLowerCase();
      const brand = (it.brand || "").toLowerCase();
      const category = (it.category || "").toLowerCase();
      return (
        name.includes(q) ||
        hsn.includes(q) ||
        code.includes(q) ||
        vpCode.includes(q) ||
        brand.includes(q) ||
        category.includes(q)
      );
    }).slice(0, 20);
  }, [items, query]);

  if (selectedItem && !isOpen) {
    const isOut = (selectedItem.currentStock || 0) <= 0;
    return (
      <div 
        onClick={() => {
          setQuery("");
          setIsOpen(true);
        }}
        className={`flex items-center justify-between p-2 rounded-lg border transition-colors cursor-pointer ${
          isOut 
            ? "border-red-300 bg-red-50/70 hover:bg-red-100/80" 
            : "border-slate-200 bg-slate-50 hover:bg-slate-100/80"
        }`}
      >
        <div className="flex-1 min-w-0 pr-2">
          <div className="font-bold text-xs text-slate-900 truncate">{selectedItem.name}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
            <span className="font-mono font-bold text-[#3F63AD] bg-blue-50 px-1 rounded border border-blue-200">
              {selectedItem.vpCode || selectedItem.code}
            </span>
            <span className="text-slate-600 font-mono bg-slate-200/70 px-1 rounded">
              HSN: <b className="text-slate-800">{selectedItem.hsnCode || selectedItem.hsn || "8528"}</b>
            </span>
            <span className="text-slate-400">•</span>
            {isOut ? (
              <span className="text-red-700 font-bold bg-red-100 px-1.5 py-0.2 rounded border border-red-300">
                OUT OF STOCK (0 {selectedItem.unit || "Pcs"})
              </span>
            ) : (
              <span className="text-emerald-700 font-semibold">
                Live Stock: {selectedItem.currentStock} {selectedItem.unit || "Pcs"}
              </span>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-slate-500 hover:text-blue-600">
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="relative w-full" ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          placeholder="Search by Product Name, HSN Code (e.g. 8418, 8516), VP Code, Brand..."
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          className="pl-8 h-8 text-xs bg-white border-slate-300 focus:border-[#3F63AD]"
          autoFocus={isOpen}
        />
        {selectedItem && (
          <button 
            type="button" 
            onClick={() => setIsOpen(false)} 
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 hover:text-slate-600"
          >
            Cancel
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white rounded-lg border border-slate-200 shadow-xl max-h-56 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-3 text-center text-xs text-slate-400">
              No matching products found for "{query}"
            </div>
          ) : (
            filtered.map((it: any) => {
              const isOut = (it.currentStock || 0) <= 0;
              return (
                <div
                  key={it._id}
                  onClick={() => {
                    if (isOut) {
                      toast.error(`"${it.name}" is OUT OF STOCK. Cannot be transferred.`);
                      return;
                    }
                    onSelect(it);
                    setIsOpen(false);
                    setQuery("");
                  }}
                  className={`p-2.5 cursor-pointer transition-colors flex items-center justify-between gap-2 ${
                    isOut 
                      ? "bg-red-50/40 hover:bg-red-50/80 opacity-75" 
                      : "hover:bg-blue-50/80"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-xs text-slate-900 truncate">{it.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                      <span className="font-mono font-bold text-[#3F63AD] bg-blue-50 px-1 py-0.2 rounded border border-blue-200">
                        {it.vpCode || it.code}
                      </span>
                      <span className="text-slate-600 font-mono bg-slate-100 px-1 py-0.2 rounded">
                        HSN: <b className="text-slate-800">{it.hsnCode || it.hsn || "8528"}</b>
                      </span>
                      <span className="text-slate-500 font-medium">{it.brand}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {isOut ? (
                      <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-300">
                        OUT OF STOCK
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-bold font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                        {it.currentStock} {it.unit || "Pcs"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

export default function StockTransferPage() {
  const queryClient = useQueryClient();
  const { activeLocation, locations } = useBranch();
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [transferToDelete, setTransferToDelete] = useState<string | null>(null);
  
  const defaultSource = activeLocation?.name || "Ashoka Enterprises (Kunraghat Showroom)";
  const defaultDest = locations.find(l => l.name !== defaultSource)?.name || "Value Plus (Deoria Road Branch)";

  const [formData, setFormData] = useState({
    fromWarehouse: defaultSource,
    toWarehouse: defaultDest,
    items: [{ itemId: "", itemName: "", quantity: 1, unit: "PCS", hsn: "", currentStock: 0, costPrice: 0 }],
  });

  // Loads the full catalog rather than filtering by `fromWarehouse` server-side —
  // /api/items' warehouse param only matches a few hardcoded name patterns, and
  // most stored `Item.warehouse` values don't match any real branch/godown name
  // in this system, so that filter was silently returning zero items for most
  // source warehouses and making the search box always say "not found".
  const { data: items = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const handleItemSelect = (index: number, it: any) => {
    if ((it.currentStock || 0) <= 0) {
      toast.error(`"${it.name}" is OUT OF STOCK. Cannot be transferred.`);
      return;
    }
    const updated = [...formData.items];
    updated[index] = {
      ...updated[index],
      itemId: it._id,
      itemName: it.name,
      unit: it.unit || "PCS",
      hsn: it.hsnCode || it.hsn || "8528",
      currentStock: it.currentStock || 0,
      costPrice: Number(it.purchasePrice) || 0,
      quantity: 1,
    };
    setFormData({ ...formData, items: updated });
  };

  const handleItemChange = (index: number, field: string, value: any) => {
    const updated = [...formData.items];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, items: updated });
  };

  const { data: transfers = [], isLoading: loading } = useQuery({
    queryKey: ["stock-transfers"],
    queryFn: async () => {
      const res = await fetch("/api/stock-transfers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const filtered = useMemo(() => {
    return transfers.filter((t) => {
      if (!search) return true;
      const q = search.toLowerCase();
      const matchHeader = 
        t.transferNo?.toLowerCase().includes(q) ||
        t.fromWarehouse?.toLowerCase().includes(q) ||
        t.toWarehouse?.toLowerCase().includes(q);
      
      const matchItems = t.items?.some((line: any) => 
        line.itemName?.toLowerCase().includes(q) ||
        (line.hsn && String(line.hsn).toLowerCase().includes(q))
      );

      return matchHeader || matchItems;
    });
  }, [transfers, search]);

  const createTransferMutation = useMutation({
    mutationFn: async (payload: any) => {
      const res = await fetch("/api/stock-transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to create stock transfer");
      return json.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      toast.success(`Stock Transfer ${data.transferNo || ""} initiated!`);
      setIsFormOpen(false);
      setFormData({ fromWarehouse: "Main Store - Mumbai", toWarehouse: "Pune Branch", items: [{ itemId: "", itemName: "", quantity: 1, unit: "PCS", hsn: "", currentStock: 0, costPrice: 0 }] });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const deleteTransferMutation = useMutation({
    mutationFn: async (transferNo: string) => {
      const res = await fetch(`/api/stock-transfers?transferNo=${encodeURIComponent(transferNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete stock transfer");
      return json.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
      toast.success("Stock Transfer deleted successfully");
      setTransferToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });

  const handleSave = () => {
    if (formData.items.length === 0 || !formData.items[0].itemId) {
      toast.error("Please add at least one item to transfer");
      return;
    }

    for (const line of formData.items) {
      if (!line.itemId) {
        toast.error("Please select a valid product item for all rows");
        return;
      }
      if ((line.currentStock ?? 0) <= 0) {
        toast.error(`"${line.itemName}" is OUT OF STOCK. Cannot transfer.`);
        return;
      }
      if (line.quantity > (line.currentStock ?? 0)) {
        toast.error(`Transfer quantity for "${line.itemName}" (${line.quantity}) exceeds available stock (${line.currentStock}).`);
        return;
      }
    }

    const payload = {
      fromWarehouse: formData.fromWarehouse,
      toWarehouse: formData.toWarehouse,
      items: formData.items,
      date: todayInIndia(),
      status: "in-transit",
    };

    createTransferMutation.mutate(payload);
  };

  return (
    <PageShell
      title="Stock Transfer"
      subtitle="Transfer stock between stores and warehouses"
      breadcrumbs={[{ label: "Inventory" }, { label: "Stock Transfer" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Stock Transfers"
            subtitle={`${filtered.length} transfers`}
            data={filtered.map((t: any) => ({
              "Transfer #": t.transferNo,
              "From Store": t.fromWarehouse,
              "To Store": t.toWarehouse,
              "Item Name": (t.items || []).map((line: any) => `${line.quantity} x ${line.itemName}`).join(", "),
              Quantity: (t.items || []).reduce((acc: number, item: any) => acc + item.quantity, 0),
              "Cost Value": t.totalValue ?? (t.items || []).reduce((sum: number, item: any) => sum + (item.costPrice || 0) * (item.quantity || 0), 0),
              Date: formatDate(t.date),
              Status: t.status === "received" ? "Delivered & Received" : "In-Transit",
            }))}
            filename="stock-transfers"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New Stock Transfer
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total Transfers", value: transfers.length }, { label: "In-Transit", value: transfers.filter(t => t.status === "in-transit").length }, { label: "Received", value: transfers.filter(t => t.status === "received").length }, { label: "Active Warehouses", value: 4 }].map((s) => (
          <div key={s.label} className="metric-card">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search transfers, stores, products, HSN..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 text-xs" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Transfer #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">From Store → To Store</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Item Name</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Quantity</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Value</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase w-10">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <TableShimmer rows={6} cols={8} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No stock transfers found</td>
                </tr>
              ) : (
                filtered.map((t: any) => (
                <tr key={t._id || t.id || t.transferNo || Math.random().toString()} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{t.transferNo}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-foreground">{t.fromWarehouse}</p>
                    <p className="text-xs text-muted-foreground">→ <span className="font-medium text-slate-700">{t.toWarehouse}</span></p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1 text-xs">
                      {t.items?.map((line: any, i: number) => (
                        <span key={i} className="text-slate-700">
                          <span className="font-bold">{line.quantity}</span> x {line.itemName}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-bold">{t.items?.reduce((acc: number, item: any) => acc + item.quantity, 0)} Items</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-slate-700">
                    {formatCurrency(t.totalValue ?? (t.items || []).reduce((sum: number, item: any) => sum + (item.costPrice || 0) * (item.quantity || 0), 0))}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(t.date)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={t.status === "received" ? "success" : "info"}>
                      {t.status === "received" ? "Delivered & Received" : "In-Transit"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-slate-500 hover:text-[#3F63AD] hover:bg-blue-50"
                        title="View/Print Challan"
                        onClick={() => window.open(`/stock-transfer-challan?transferNo=${encodeURIComponent(t.transferNo)}`, "_blank")}
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                      {t.status !== "received" && (
                        <Button
                          size="sm"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/stock-transfers?transferNo=${t.transferNo}`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "received" }),
                              });
                              const json = await res.json();
                              if (json.success) {
                                toast.success(`Transfer ${t.transferNo} Received & Stock credited to ${t.toWarehouse}!`);
                                queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
                                queryClient.invalidateQueries({ queryKey: ["items"] });
                              } else {
                                toast.error(json.error || "Failed to receive transfer");
                              }
                            } catch (e: any) {
                              toast.error(e.message || "Network error");
                            }
                          }}
                          className="h-7 px-2.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
                        >
                          <Check className="w-3.5 h-3.5 mr-1" /> Receive Stock
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => setTransferToDelete(t.transferNo)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <ArrowLeftRight className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">Inter-Store Stock Transfer</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Transfer stock items between central hubs, regional warehouses & branch outlets
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Source Store (From Warehouse) *</Label>
                  <Select value={formData.fromWarehouse} onValueChange={(v) => setFormData({ ...formData, fromWarehouse: v })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={`from-${loc.id}`} value={loc.name}>
                          {loc.name} ({loc.type === "warehouse" ? "Godown" : "Showroom"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Destination Store (To Warehouse) *</Label>
                  <Select value={formData.toWarehouse} onValueChange={(v) => setFormData({ ...formData, toWarehouse: v })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={`to-${loc.id}`} value={loc.name}>
                          {loc.name} ({loc.type === "warehouse" ? "Godown" : "Showroom"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

              </div>

              <div>
                <h4 className="font-medium text-sm mb-2 text-slate-700">Items to Transfer *</h4>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">Product Item (Search Name, HSN, VP Code)</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 w-24">Quantity</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600 w-28">Cost Value</th>
                        <th className="px-3 py-2 text-center text-xs font-semibold text-slate-600 w-12"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {formData.items.map((line, idx) => (
                        <tr key={idx} className="bg-white">
                          <td className="p-2">
                            <SearchableItemSelect
                              items={items}
                              selectedItemId={line.itemId}
                              onSelect={(it) => handleItemSelect(idx, it)}
                            />
                          </td>
                          <td className="p-2 align-top">
                            <Input
                              type="number"
                              min="1"
                              max={line.currentStock || undefined}
                              className={`h-8 text-right bg-transparent text-xs font-bold ${
                                line.currentStock !== undefined && line.quantity > line.currentStock
                                  ? "border-red-500 text-red-600 bg-red-50"
                                  : ""
                              }`}
                              value={line.quantity}
                              onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()}
                              onChange={(e) => handleItemChange(idx, "quantity", Math.max(1, Number(e.target.value)))}
                            />
                            {line.currentStock !== undefined && line.currentStock > 0 && (
                              <span className={`text-[9.5px] font-mono block text-right mt-0.5 ${
                                line.quantity > line.currentStock ? "text-red-600 font-bold" : "text-slate-400"
                              }`}>
                                Max: {line.currentStock}
                              </span>
                            )}
                          </td>
                          <td className="p-2 text-right align-top text-xs font-mono font-bold text-slate-600 whitespace-nowrap">
                            {formatCurrency((line.costPrice || 0) * (line.quantity || 0))}
                          </td>
                          <td className="p-2 text-center align-top">
                            <button
                              type="button"
                              onClick={() => setFormData({ ...formData, items: formData.items.filter((_, i) => i !== idx) })}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50 p-1.5 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 border-t">
                        <td className="px-3 py-2 text-right text-xs font-semibold text-slate-600" colSpan={2}>
                          Total Cost Value
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-mono font-black text-slate-800">
                          {formatCurrency(formData.items.reduce((sum, l) => sum + (l.costPrice || 0) * (l.quantity || 0), 0))}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                  <div className="bg-slate-50 p-2 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-dashed text-slate-600"
                      onClick={() => setFormData({ ...formData, items: [...formData.items, { itemId: "", itemName: "", quantity: 1, unit: "PCS", hsn: "", currentStock: 0, costPrice: 0 }] })}
                    >
                      <Plus className="w-3 h-3 mr-1" /> Add Product
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20">
              Initiate Stock Transfer
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={!!transferToDelete} onOpenChange={(open) => !open && setTransferToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete transfer <span className="font-bold">{transferToDelete}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setTransferToDelete(null)} disabled={deleteTransferMutation.isPending}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => transferToDelete && deleteTransferMutation.mutate(transferToDelete)}
              disabled={deleteTransferMutation.isPending}
            >
              {deleteTransferMutation.isPending ? "Deleting..." : "Delete Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
