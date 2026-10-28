"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Truck,
  ShoppingCart,
  Package,
  Wallet,
  FileText
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ValueplusInvoice from "@/app/invoice/page";
import { formatDate } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";

const REPORT_TAB_META: Record<string, { title: string; filenamePrefix: string }> = {
  sales: { title: "Sales Report", filenamePrefix: "sales-report" },
  challans: { title: "Delivery Challans Report", filenamePrefix: "challans-report" },
  purchases: { title: "Purchases Report", filenamePrefix: "purchases-report" },
  inventory: { title: "Inventory Report", filenamePrefix: "inventory-report" },
  expenses: { title: "Expenses Report", filenamePrefix: "expenses-report" },
};

export default function ReportsPage() {
  const [period, setPeriod] = useState("All Time");
  const [activeTab, setActiveTab] = useState("sales");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [activePrintInvoice, setActivePrintInvoice] = useState<any | null>(null);

  // Fetching data
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["reports", "invoices"],
    queryFn: async () => {
      const res = await fetch("/api/invoices");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: challans = [], isLoading: loadingChallans } = useQuery({
    queryKey: ["reports", "delivery-challans"],
    queryFn: async () => {
      const res = await fetch("/api/delivery-challans");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: purchases = [], isLoading: loadingPurchases } = useQuery({
    queryKey: ["reports", "purchase-entries"],
    queryFn: async () => {
      const res = await fetch("/api/purchase-entries");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: items = [], isLoading: loadingItems } = useQuery({
    queryKey: ["reports", "items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: expenses = [], isLoading: loadingExpenses } = useQuery({
    queryKey: ["reports", "expenses"],
    queryFn: async () => {
      const res = await fetch("/api/expenses");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["reports", "customers"],
    queryFn: async () => {
      const res = await fetch("/api/customers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["reports", "suppliers"],
    queryFn: async () => {
      const res = await fetch("/api/suppliers");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Filtering Logic
  const filterByPeriod = (data: any[], dateField: string = "date") => {
    if (period === "All Time") return data;
    const now = new Date();
    return data.filter(item => {
      const itemDate = new Date(item[dateField] || item.createdAt);
      if (period === "This Month") {
        return itemDate.getMonth() === now.getMonth() && itemDate.getFullYear() === now.getFullYear();
      } else if (period === "Last Month") {
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return itemDate.getMonth() === lastMonth.getMonth() && itemDate.getFullYear() === lastMonth.getFullYear();
      } else if (period === "This Year") {
        return itemDate.getFullYear() === now.getFullYear();
      } else if (period === "Last Year") {
        return itemDate.getFullYear() === now.getFullYear() - 1;
      }
      return true;
    });
  };

  const filteredInvoices = filterByPeriod(invoices);
  const filteredChallans = filterByPeriod(challans);
  const filteredPurchases = filterByPeriod(purchases);
  const filteredExpenses = filterByPeriod(expenses);

  // Calculate Summaries
  const totalSales = filteredInvoices.reduce((acc: any, curr: any) => acc + (curr.type === 'credit-note' ? -(curr.total || 0) : (curr.total || 0)), 0);
  
  // Pending Balance is the total outstanding balance from all customers, not from invoices
  const totalBalance = customers.reduce((acc: any, curr: any) => acc + Math.max(0, curr.outstandingBalance || 0), 0);
  
  const totalPurchases = filteredPurchases.reduce((acc: any, curr: any) => acc + (curr.total || curr.totalAmount || 0), 0);
  const totalExpenses = filteredExpenses.reduce((acc: any, curr: any) => acc + (curr.amount || 0), 0);
  
  const totalStockValue = items.reduce((acc: any, curr: any) => acc + ((curr.currentStock || 0) * (curr.purchasePrice || 0)), 0);
  const lowStockCount = items.filter((item: any) => item.currentStock <= (item.minStock || 5)).length;

  // Export data mirrors the columns shown in the active tab's table.
  const exportData: Record<string, unknown>[] = (() => {
    switch (activeTab) {
      case "sales":
        return filteredInvoices.map((row: any) => ({
          "Invoice No": row.invoiceNumber,
          Date: formatDate(row.date),
          Customer: row.customerName,
          Taxable: row.taxableAmount || 0,
          Tax: row.totalGST || 0,
          Total: row.total || 0,
          Status: row.type === "credit-note" ? (row.status === "paid" ? "Refunded" : "Pending") : (row.status || (row.balanceAmount === 0 ? "paid" : row.balanceAmount === row.total ? "unpaid" : "partial")),
        }));
      case "challans":
        return filteredChallans.map((row: any) => ({
          "Challan No": row.challanNo,
          Date: formatDate(row.date),
          Customer: row.customerName,
          "Vehicle No": row.vehicleNo || "-",
          "Items Count": row.items?.length || 0,
        }));
      case "purchases":
        return filteredPurchases.map((row: any) => ({
          "Bill No": row.billNo,
          Date: formatDate(row.billDate || row.createdAt),
          Supplier: row.supplierName,
          Taxable: row.subtotal || 0,
          Total: row.total || 0,
          Status: row.balance === 0 ? "Paid" : row.balance === row.total ? "Unpaid" : "Partial",
        }));
      case "inventory":
        return items.map((row: any) => ({
          "VP Code": row.code || "-",
          "Item Name": row.name,
          Category: row.category?.name || "General",
          "Unit Price": row.salesPrice || 0,
          "Current Stock": `${row.currentStock} ${row.unit}`,
          Value: (row.currentStock || 0) * (row.purchasePrice || 0),
        }));
      case "expenses":
        return filteredExpenses.map((row: any) => ({
          Date: formatDate(row.date),
          Category: row.category,
          Description: row.description || "-",
          "Payment Mode": row.paymentMode,
          Amount: row.amount || 0,
        }));
      default:
        return [];
    }
  })();
  const activeReportMeta = REPORT_TAB_META[activeTab] || { title: "Report", filenamePrefix: "report" };

  return (
    <PageShell
      title="Comprehensive Reports"
      subtitle="Business intelligence & analytics across all modules"
      breadcrumbs={[{ label: "Reports" }]}
      actions={
        <div className="flex items-center gap-3">
          <select 
            value={period} 
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 px-3 py-1 rounded-lg border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#3F63AD]"
          >
            <option>All Time</option>
            <option>This Month</option>
            <option>Last Month</option>
            <option>This Year</option>
            <option>Last Year</option>
          </select>
          <ExportMenu
            title={activeReportMeta.title}
            subtitle={`${exportData.length} records • ${period}`}
            data={exportData}
            filename={activeReportMeta.filenamePrefix}
          />
        </div>
      }
    >
      <Tabs defaultValue="sales" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap w-full md:max-w-4xl h-auto p-1 bg-slate-100 rounded-xl mb-6">
          <TabsTrigger value="sales" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <TrendingUp className="w-4 h-4 mr-2" /> Sales
          </TabsTrigger>
          <TabsTrigger value="challans" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Truck className="w-4 h-4 mr-2" /> Challans
          </TabsTrigger>
          <TabsTrigger value="purchases" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <ShoppingCart className="w-4 h-4 mr-2" /> Purchases
          </TabsTrigger>
          <TabsTrigger value="inventory" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Package className="w-4 h-4 mr-2" /> Inventory
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex-1 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm">
            <Wallet className="w-4 h-4 mr-2" /> Expenses
          </TabsTrigger>
        </TabsList>

        {/* Sales Report Tab */}
        <TabsContent value="sales" className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Sales</p>
              <h3 className="text-2xl font-bold mt-2">₹{totalSales.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-emerald-600 mt-2 font-medium">{filteredInvoices.length} Invoices generated</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Pending Balance</p>
              <h3 className="text-2xl font-bold mt-2 text-amber-600">₹{totalBalance.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-muted-foreground mt-2">Amount to be collected</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Cash Sales</p>
              <h3 className="text-2xl font-bold mt-2">
                ₹{filteredInvoices.filter((i: any) => i.paymentMode === 'Cash' || i.paymentMode === 'Cash Counter').reduce((a: any, c: any) => a + (c.type === 'credit-note' ? -(c.total || 0) : (c.total || 0)), 0).toLocaleString('en-IN')}
              </h3>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Bank/Online Sales</p>
              <h3 className="text-2xl font-bold mt-2">
                ₹{filteredInvoices.filter((i: any) => i.paymentMode !== 'Cash' && i.paymentMode !== 'Cash Counter').reduce((a: any, c: any) => a + (c.type === 'credit-note' ? -(c.total || 0) : (c.total || 0)), 0).toLocaleString('en-IN')}
              </h3>
            </Card>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">Sales Transactions</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-slate-50 border-b uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Invoice No</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3 text-right">Taxable</th>
                    <th className="px-4 py-3 text-right">Tax</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingInvoices ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Loading sales data...</td></tr>
                  ) : filteredInvoices.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No sales found</td></tr>
                  ) : (
                    filteredInvoices.map((row: any) => (
                      <tr key={row._id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium">
                          <button
                            className="text-[#3F63AD] hover:underline flex items-center gap-1.5"
                            onClick={() => {
                              setActivePrintInvoice(row);
                              setIsPreviewOpen(true);
                            }}
                          >
                            {row.invoiceNumber}
                            <FileText className="w-3 h-3 text-muted-foreground" />
                          </button>
                        </td>
                        <td className="px-4 py-3">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 font-medium">{row.customerName}</td>
                        <td className="px-4 py-3 text-right">₹{row.taxableAmount?.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right">₹{row.totalGST?.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-semibold">
                          <span className={row.type === 'credit-note' ? 'text-red-600' : 'text-slate-900'}>
                            {row.type === 'credit-note' ? '-' : ''}₹{row.total?.toLocaleString('en-IN')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                            row.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            row.status === 'partial' ? 'bg-amber-100 text-amber-700' :
                            'bg-red-100 text-red-700'
                          }`}>
                            {row.type === 'credit-note' ? (row.status === 'paid' ? 'Refunded' : 'Pending') : (row.status || (row.balanceAmount === 0 ? 'paid' : row.balanceAmount === row.total ? 'unpaid' : 'partial'))}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Delivery Challans Tab */}
        <TabsContent value="challans" className="space-y-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card className="p-5 flex flex-col justify-between border-l-4 border-l-[#3F63AD]">
              <p className="text-sm font-medium text-muted-foreground">Total Challans Issued</p>
              <h3 className="text-2xl font-bold mt-2">{filteredChallans.length}</h3>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Challans this Month</p>
              <h3 className="text-2xl font-bold mt-2">
                {filteredChallans.filter((c: any) => new Date(c.date).getMonth() === new Date().getMonth()).length}
              </h3>
            </Card>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">Delivery Challans</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-slate-50 border-b uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Challan No</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Vehicle No</th>
                    <th className="px-4 py-3 text-center">Items Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingChallans ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading challans...</td></tr>
                  ) : filteredChallans.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No delivery challans found</td></tr>
                  ) : (
                    filteredChallans.map((row: any) => (
                      <tr key={row._id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium text-[#3F63AD]">{row.challanNo}</td>
                        <td className="px-4 py-3">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 font-medium">{row.customerName}</td>
                        <td className="px-4 py-3">{row.vehicleNo || "-"}</td>
                        <td className="px-4 py-3 text-center">{row.items?.length || 0} items</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Purchases Report Tab */}
        <TabsContent value="purchases" className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Purchases</p>
              <h3 className="text-2xl font-bold mt-2">₹{totalPurchases.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-muted-foreground mt-2">{filteredPurchases.length} Purchase entries</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Pending Payables</p>
              <h3 className="text-2xl font-bold mt-2 text-red-600">
                ₹{suppliers.reduce((acc: any, curr: any) => acc + Math.max(0, curr.outstandingBalance || 0), 0).toLocaleString('en-IN')}
              </h3>
              <p className="text-xs text-muted-foreground mt-2">Amount to be paid to suppliers</p>
            </Card>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">Purchase Entries</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-slate-50 border-b uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Bill No</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3 text-right">Taxable</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingPurchases ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading purchases...</td></tr>
                  ) : filteredPurchases.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No purchases found</td></tr>
                  ) : (
                    filteredPurchases.map((row: any) => (
                      <tr key={row._id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-medium">{row.billNo}</td>
                        <td className="px-4 py-3">{formatDate(row.billDate || row.createdAt)}</td>
                        <td className="px-4 py-3 font-medium">{row.supplierName}</td>
                        <td className="px-4 py-3 text-right">₹{row.subtotal?.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-right font-semibold">₹{(row.total)?.toLocaleString('en-IN')}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            row.balance === 0 ? 'bg-emerald-100 text-emerald-700' :
                            row.balance === row.total ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {row.balance === 0 ? 'Paid' : row.balance === row.total ? 'Unpaid' : 'Partial'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Inventory Report Tab */}
        <TabsContent value="inventory" className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Stock Valuation</p>
              <h3 className="text-2xl font-bold mt-2">₹{totalStockValue.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-muted-foreground mt-2">Based on purchase price</p>
            </Card>
            <Card className="p-5 flex flex-col justify-between border-l-4 border-l-red-500">
              <p className="text-sm font-medium text-muted-foreground">Low Stock Alerts</p>
              <h3 className="text-2xl font-bold mt-2 text-red-600">{lowStockCount}</h3>
              <p className="text-xs text-muted-foreground mt-2">Items below minimum stock level</p>
            </Card>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">Inventory Status</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-slate-50 border-b uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">VP Code</th>
                    <th className="px-4 py-3">Item Name</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3 text-right">Unit Price</th>
                    <th className="px-4 py-3 text-right">Current Stock</th>
                    <th className="px-4 py-3 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingItems ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading items...</td></tr>
                  ) : items.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No items found</td></tr>
                  ) : (
                    items.map((row: any) => {
                      const isLowStock = row.currentStock <= (row.minStock || 5);
                      return (
                        <tr key={row._id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3 font-medium">{row.code || "-"}</td>
                          <td className="px-4 py-3">
                            <span className="font-medium">{row.name}</span>
                            {isLowStock && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 font-semibold">LOW</span>}
                          </td>
                          <td className="px-4 py-3">{row.category?.name || "General"}</td>
                          <td className="px-4 py-3 text-right">₹{row.salesPrice?.toLocaleString()}</td>
                          <td className={`px-4 py-3 text-right font-medium ${isLowStock ? 'text-red-600' : ''}`}>
                            {row.currentStock} {row.unit}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold">
                            ₹{((row.currentStock || 0) * (row.purchasePrice || 0)).toLocaleString('en-IN')}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* Expenses Report Tab */}
        <TabsContent value="expenses" className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="p-5 flex flex-col justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Expenses</p>
              <h3 className="text-2xl font-bold mt-2 text-orange-600">₹{totalExpenses.toLocaleString('en-IN')}</h3>
              <p className="text-xs text-muted-foreground mt-2">{filteredExpenses.length} Expense records</p>
            </Card>
          </div>

          <div className="bg-white border rounded-2xl overflow-hidden shadow-sm">
            <div className="p-4 border-b bg-slate-50/50">
              <h3 className="font-semibold text-slate-800">Expenses</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-muted-foreground bg-slate-50 border-b uppercase font-medium">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">Payment Mode</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {loadingExpenses ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading expenses...</td></tr>
                  ) : filteredExpenses.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No expenses found</td></tr>
                  ) : (
                    filteredExpenses.map((row: any) => (
                      <tr key={row._id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 font-medium">
                          <span className="inline-block px-2 py-1 rounded bg-slate-100 text-xs text-slate-700">{row.category}</span>
                        </td>
                        <td className="px-4 py-3">{row.description || "-"}</td>
                        <td className="px-4 py-3">{row.paymentMode}</td>
                        <td className="px-4 py-3 text-right font-semibold text-orange-600">₹{row.amount?.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* FULL INVOICE PREVIEW MODAL */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-2">
          {activePrintInvoice && (() => {
            const enrichedData = { ...activePrintInvoice };
            if (!enrichedData.customerAddress) enrichedData.customerAddress = "Address not provided";
            if (!enrichedData.customerCity) enrichedData.customerCity = "City not specified";
            if (!enrichedData.placeOfSupply) enrichedData.placeOfSupply = enrichedData.placeOfSupply || "Unknown State";
            return <ValueplusInvoice invoiceData={enrichedData} />;
          })()}
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
