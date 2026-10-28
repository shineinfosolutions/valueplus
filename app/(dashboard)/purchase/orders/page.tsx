"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ShoppingBag, Truck, Trash2, AlertTriangle, Sparkles } from "lucide-react";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PurchaseCreationModal } from "@/components/PurchaseCreationModal";
import { ViewPurchaseOrderModal } from "@/components/ViewPurchaseOrderModal";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { Eye } from "lucide-react";
import { ExportMenu } from "@/components/shared/ExportMenu";

interface POItem {
  id: string;
  poNo: string;
  supplierName: string;
  date: string;
  expectedDate: string;
  totalAmount: number;
  status: "sent" | "received" | "partial" | "pending";
}

const INITIAL_POS: POItem[] = [
  { id: "1", poNo: "PO-2026-0112", supplierName: "Apple India Pvt Ltd", date: "2026-08-01", expectedDate: "2026-08-06", totalAmount: 1850000, status: "sent" },
  { id: "2", poNo: "PO-2026-0111", supplierName: "Samsung Electronics India", date: "2026-07-28", expectedDate: "2026-08-02", totalAmount: 1240000, status: "received" },
  { id: "3", poNo: "PO-2026-0110", supplierName: "boAt Lifestyle Audio", date: "2026-07-25", expectedDate: "2026-07-30", totalAmount: 450000, status: "received" },
  { id: "4", poNo: "PO-2026-0109", supplierName: "Sony India Distribution", date: "2026-07-22", expectedDate: "2026-07-29", totalAmount: 890000, status: "partial" },
];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [poToDelete, setPoToDelete] = useState<string | null>(null);
  const [poToView, setPoToView] = useState<any | null>(null);

  const { data: pos = [], isLoading: loading } = useQuery({
    queryKey: ["purchase-orders"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-orders");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const filtered = useMemo(() => {
    return pos.filter(
      (p) =>
        !search ||
        (p.poNo && p.poNo.toLowerCase().includes(search.toLowerCase())) ||
        (p.supplierName && p.supplierName.toLowerCase().includes(search.toLowerCase()))
    );
  }, [pos, search]);



  const deletePOMutation = useMutation({
    mutationFn: async (poNo: string) => {
      const res = await fetch(`/api/purchase-orders?poNo=${encodeURIComponent(poNo)}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete PO");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast.success("Purchase Order deleted successfully");
      setPoToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred while deleting");
    }
  });



  return (
    <>
      <PageShell
        title="Purchase Orders"
        subtitle="Manage inventory restock purchase orders to suppliers"
        breadcrumbs={[{ label: "Purchase", href: "/purchase/orders" }, { label: "Purchase Orders" }]}
        actions={
          <div className="flex items-center gap-2">
            <ExportMenu
              title="Purchase Orders"
              subtitle={`${filtered.length} purchase orders`}
              data={(filtered as any[]).map((p) => ({
                "PO #": p.poNo,
                "Supplier Name": p.supplierName,
                "Order Date": formatDate(p.date),
                "Expected Date": formatDate(p.expectedDate),
                "PO Amount": p.totalAmount,
                Status: p.status,
              }))}
              filename="purchase-orders"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/purchase/low-stock")}
              className="border-amber-300 text-amber-900 bg-amber-50/70 hover:bg-amber-100 font-bold text-xs shadow-2xs"
            >
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-amber-600" /> Low Stock Auto Reorder
            </Button>
            <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white">
              <Plus className="w-4 h-4 mr-1.5" /> New Purchase Order
            </Button>
          </div>
        }
      >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total POs", value: pos.length }, { label: "Received", value: pos.filter(p => p.status === "received").length }, { label: "In-Transit / Sent", value: pos.filter(p => p.status === "sent").length }, { label: "Total PO Value", value: formatCurrency(pos.reduce((a, b) => a + b.totalAmount, 0)) }].map((s) => (
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
            <Input placeholder="Search PO #, supplier..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">PO #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Supplier Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Order Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Expected Date</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">PO Amount</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase w-10">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={7} className="p-0"><TableShimmer rows={5} cols={7} /></td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No purchase orders found</td>
                </tr>
              ) : (
                filtered.map((p: any, idx: number) => (
                <tr key={p._id || p.id || p.poNo || idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">{p.poNo}</td>
                  <td className="px-4 py-3 font-medium text-foreground">{p.supplierName}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(p.date)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(p.expectedDate)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(p.totalAmount)}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={p.status === "received" ? "success" : p.status === "partial" ? "info" : "warning"}>{p.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-center flex justify-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-[#3F63AD] hover:text-[#2E4F95] hover:bg-blue-50"
                      onClick={() => setPoToView(p)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                      onClick={() => setPoToDelete(p.poNo)}
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

      <PurchaseCreationModal 
        isOpen={isFormOpen} 
        onClose={() => setIsFormOpen(false)} 
        mode="order" 
      />

      <ViewPurchaseOrderModal 
        isOpen={!!poToView} 
        onClose={() => setPoToView(null)} 
        purchaseOrder={poToView} 
      />

      {/* DELETE CONFIRMATION MODAL */}
      <Dialog open={!!poToDelete} onOpenChange={(open) => !open && setPoToDelete(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Confirm Deletion
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete purchase order <span className="font-bold">{poToDelete}</span>? 
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setPoToDelete(null)} disabled={deletePOMutation.isPending}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => poToDelete && deletePOMutation.mutate(poToDelete)}
              disabled={deletePOMutation.isPending}
            >
              {deletePOMutation.isPending ? "Deleting..." : "Delete PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </PageShell>
    </>
  );
}

