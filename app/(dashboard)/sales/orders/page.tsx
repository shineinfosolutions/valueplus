"use client";

import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, ShoppingCart, CheckCircle, Clock, Truck, Printer, Eye, User, FileText, CalendarDays, WalletCards, ShieldCheck } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { InvoiceCreationModal } from "@/components/InvoiceCreationModal";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { useSession } from "next-auth/react";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function SalesOrdersPage() {
  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const currentUserName = session?.user?.name || "Staff Member";
  const isSuperAdminOrAdmin = userRole === "admin" || userRole === "superadmin" || userRole === "manager";
  const isIndividualStaff = !isSuperAdminOrAdmin;

  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);

  const fetchOrders = async () => {
    try {
      let url = "/api/orders";
      if (isIndividualStaff) {
        url += `?staff=${encodeURIComponent(currentUserName)}`;
      }
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setOrders(json.data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [isIndividualStaff, currentUserName]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  // Strict user isolation filter for staff
  const userScopedOrders = useMemo(() => {
    if (!isIndividualStaff) return orders;
    const firstName = currentUserName.toLowerCase().split(" ")[0];
    return orders.filter((o: any) => {
      const exec = (o.salesExecutive || o.createdBy || "").toLowerCase();
      return (
        exec.includes(firstName) ||
        exec === currentUserName.toLowerCase() ||
        exec.includes("sales")
      );
    });
  }, [orders, isIndividualStaff, currentUserName]);

  const filtered = useMemo(() => {
    return userScopedOrders.filter((o) => {
      const matchesSearch =
        !search ||
        o.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
        o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        (o.salesExecutive && o.salesExecutive.toLowerCase().includes(search.toLowerCase()));

      const matchesDate = isDateInRange(o.date || o.createdAt, dateRange.start, dateRange.end);
      return matchesSearch && matchesDate;
    });
  }, [userScopedOrders, search, dateRange]);

  const totalOrdersCount = userScopedOrders.length;
  const confirmedCount = userScopedOrders.filter((o) => o.status === "confirmed" || o.orderStatus === "confirmed").length || totalOrdersCount;
  const processingCount = userScopedOrders.filter((o) => o.status === "processing" || o.orderStatus === "processing").length;
  const totalSalesValue = userScopedOrders.reduce((a, b) => a + (b.total || b.totalAmount || 0), 0);

  return (
    <PageShell
      title={isIndividualStaff ? `My Sales Orders (${currentUserName})` : "Sales Orders & Delivery Schedules"}
      subtitle={
        isIndividualStaff
          ? `Personal sales orders and bookings logged by ${currentUserName}.`
          : "Track customer sales orders, delivery schedules, and store-wide bookings."
      }
      breadcrumbs={[{ label: "Sales" }, { label: "Sales Orders" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title={isIndividualStaff ? `My Sales Orders (${currentUserName})` : "Sales Orders"}
            subtitle={`${filtered.length} orders`}
            data={(filtered as any[]).map((o) => ({
              "Order #": o.invoiceNumber || o.orderNo,
              Date: formatDate(o.date),
              Customer: o.customerName,
              ...(isIndividualStaff ? {} : { "Sales Exec": o.salesExecutive || o.createdBy || "Admin" }),
              Items: o.items?.length ?? o.itemsCount ?? 0,
              "Order Value": formatCurrency(o.total || o.totalAmount),
              "Adv. Paid": formatCurrency(o.paidAmount || 0),
              Balance: formatCurrency(o.balanceAmount || o.total || o.totalAmount),
              Status: o.balanceAmount === 0 ? "Paid" : o.paidAmount > 0 ? "Partial" : "Pending",
            }))}
            filename="sales-orders"
          />
          {isIndividualStaff && (
            <Badge className="bg-blue-50 text-[#30539C] border border-blue-200 text-xs font-bold px-3 py-1">
              👤 {currentUserName} (Sales Executive)
            </Badge>
          )}
          <Button size="sm" onClick={() => setIsFormOpen(true)} className="bg-[#76C043] hover:bg-[#60a82c] text-slate-950 font-black text-xs">
            <Plus className="w-4 h-4 mr-1.5" /> New Sales Order
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: isIndividualStaff ? "My Total Orders" : "Total Orders", value: totalOrdersCount },
          { label: isIndividualStaff ? "My Confirmed" : "Confirmed", value: confirmedCount },
          { label: isIndividualStaff ? "My Processing" : "Processing", value: processingCount },
          { label: isIndividualStaff ? "My Sales Revenue" : "Total Order Value", value: formatCurrency(totalSalesValue) },
        ].map((s) => (
          <div key={s.label} className="metric-card">
            <p className="text-2xl font-bold text-slate-900">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="data-table-container">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders, customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <DateRangeFilter
            value={dateFilter}
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-40"
            showIcon={true}
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Order #</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                {!isIndividualStaff && (
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Sales Exec</th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">Items</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Order Value</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Adv. Paid</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase">Balance</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-0">
                    <TableShimmer rows={6} cols={9} />
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center p-8 text-muted-foreground">
                    No sales orders found for this view.
                  </td>
                </tr>
              ) : (
                filtered.map((o) => (
                  <tr key={o._id || o.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-[#3F63AD]">
                      {o.invoiceNumber || o.orderNo}
                      <div className="text-[10px] text-muted-foreground font-sans font-normal mt-0.5">
                        {formatDate(o.date)}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">{o.customerName}</td>
                    {!isIndividualStaff && (
                      <td className="px-4 py-3 text-xs font-semibold text-slate-700">
                        👤 {o.salesExecutive || o.createdBy || "Admin"}
                      </td>
                    )}
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {o.items?.length > 0 ? (
                        <span title={o.items.map((i: any) => i.name || i.itemName).join(", ")}>
                          {o.items.length} Items ({o.items.map((i: any) => i.name || i.itemName).join(", ")})
                        </span>
                      ) : (
                        o.itemsCount + " Items"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">
                      {formatCurrency(o.total || o.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                      {formatCurrency(o.paidAmount || 0)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-600">
                      {formatCurrency(o.balanceAmount || o.total || o.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={o.balanceAmount === 0 ? "success" : o.paidAmount > 0 ? "info" : "warning"}>
                        {o.balanceAmount === 0 ? "Paid" : o.paidAmount > 0 ? "Partial" : "Pending"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[#3F63AD] hover:bg-blue-50"
                        onClick={() => setSelectedOrder(o)}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <InvoiceCreationModal
        mode="sales-order"
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          fetchOrders();
        }}
      />
    </PageShell>
  );
}
