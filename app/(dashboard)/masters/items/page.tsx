"use client";

import { useState, useMemo, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Search, Filter, Upload, UploadCloud, Printer, MoreHorizontal,
  Edit, Trash2, Eye, Package, TrendingUp, AlertTriangle, CheckCircle,
  X, Sparkles, ShoppingBag, Store, Warehouse, Building2, Layers, RefreshCw,
  Barcode, Hash, PlusCircle, Check, Trash, Gift, ChevronDown, ChevronUp
} from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { AutocompleteSearch } from "@/components/shared/autocomplete-search";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { BrandLogo } from "@/components/shared/brand-logo";
import { useBranch } from "@/context/BranchContext";
import { Switch } from "@/components/ui/switch";
import { BulkIncentiveModal } from "@/components/items/BulkIncentiveModal";
import { ProductReferenceImportModal } from "@/components/masters/ProductReferenceImportModal";
import { VspSheetImportModal } from "@/components/masters/VspSheetImportModal";
import { BillingEntityBadge } from "@/components/shared/BillingEntityPicker";
import { BILLING_ENTITY_LIST, entityOf } from "@/lib/billing-entity";
import { BrandSelect } from "@/components/shared/brand-select";
import { useSession } from "next-auth/react";

interface ItemFormData {
  name: string;
  code: string;
  category: string;
  brand: string;
  unit: string;
  hsn: string;
  gstRate: string;
  purchasePrice: string;
  sellingPrice: string;
  vsp: string;
  billingEntity: string;
  minSellingPrice: string;
  maxDiscountPercent: string;
  maxDiscountAmount: string;
  incentiveTargetAmount: string;
  incentiveAmount: string;
  incentiveType: string;
  incentiveValue: string;
  mrp: string;
  currentStock: string;
  showroomStock: string;
  godownStock: string;
  reorderLevel: string;
  warehouse: string;
  status: string;
}

const EMPTY_FORM: ItemFormData = {
  name: "",
  code: "",
  category: "",
  brand: "",
  unit: "PCS",
  hsn: "",
  gstRate: "18",
  purchasePrice: "",
  sellingPrice: "",
  vsp: "",
  billingEntity: "valueplus",
  minSellingPrice: "",
  maxDiscountPercent: "",
  maxDiscountAmount: "",
  incentiveTargetAmount: "",
  incentiveAmount: "0",
  incentiveType: "none",
  incentiveValue: "0",
  mrp: "",
  currentStock: "0",
  showroomStock: "0",
  godownStock: "0",
  reorderLevel: "5",
  warehouse: "Ashoka Enterprises (Kunraghat Showroom)",
  status: "active",
};

function ItemsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryCategory = searchParams?.get("category");
  const { activeLocation } = useBranch();

  const { data: session } = useSession();
  const userRole = ((session?.user as any)?.role || "admin").toLowerCase();
  const isSuperAdminOrAdmin = userRole === "admin" || userRole === "superadmin" || userRole === "manager" || userRole === "warehouse";
  const isSalesperson = !isSuperAdminOrAdmin;

  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(queryCategory || "all");
  // Value Plus / Ashoka Enterprises — which company's products to list.
  const [entityFilter, setEntityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [stockLocationFilter, setStockLocationFilter] = useState<"all" | "in_showroom" | "in_godown">("all");
  const [stockViewDisplay, setStockViewDisplay] = useState<"both" | "showroom" | "godown">("both");

  useEffect(() => {
    if (queryCategory) {
      setCategoryFilter(queryCategory);
    }
  }, [queryCategory]);

  interface FormSerialItem {
    id: string;
    serialNumber: string;
    status: "AVAILABLE" | "SOLD" | "RETURNED" | "DEFECTIVE";
    warehouse: string;
    batchNo: string;
    isExisting: boolean;
  }

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [viewingItem, setViewingItem] = useState<any | null>(null);
  const [ledgerTab, setLedgerTab] = useState<string>("all");
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [formData, setFormData] = useState<ItemFormData>(EMPTY_FORM);
  // Collapsed by default so a product with no incentive scheme keeps the form
  // short; opened automatically when editing an item that already has one.
  const [incentiveOpen, setIncentiveOpen] = useState(false);
  const [bulkIncentiveOpen, setBulkIncentiveOpen] = useState(false);
  const [productReferenceOpen, setProductReferenceOpen] = useState(false);
  const [vspImportOpen, setVspImportOpen] = useState(false);
  const [formSerials, setFormSerials] = useState<FormSerialItem[]>([]);
  const [newSerialInput, setNewSerialInput] = useState("");
  const [batchNoInput, setBatchNoInput] = useState("");
  const [serialWarehouseInput, setSerialWarehouseInput] = useState("Showroom");
  const [serialStatusInput, setSerialStatusInput] = useState<"AVAILABLE" | "SOLD" | "RETURNED" | "DEFECTIVE">("AVAILABLE");
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;

  // Fetch all serial numbers for live editing
  const { data: allDbSerials = [], refetch: refetchSerials } = useQuery({
    queryKey: ["all-serial-numbers"],
    queryFn: async () => {
      const res = await fetch("/api/serial-numbers?status=ALL");
      const json = await res.json();
      return json.success ? json.data : [];
    }
  });

  // Fetch all items
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await fetch("/api/items");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    }
  });

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      if (!json.success) return [];
      return json.data;
    }
  });

  const { data: ledgerData, isLoading: historyLoading } = useQuery({
    queryKey: ["item-ledger", viewingItem?.code],
    queryFn: async () => {
      if (!viewingItem?.code) return null;
      const res = await fetch(`/api/reports/product-ledger?code=${encodeURIComponent(viewingItem.code)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    enabled: !!viewingItem
  });
  const allLedgerTransactions = ledgerData?.transactions || [];
  const ledgerSummary = ledgerData?.summary;
  // "other" groups opening balance, adjustments, returns, journals and transfers —
  // the movements that explain a stock change with no bill behind it.
  const ledgerTransactions = allLedgerTransactions.filter((t: any) => {
    if (ledgerTab === "all") return true;
    if (ledgerTab === "purchase") return t.source === "purchase";
    if (ledgerTab === "sales") return t.source === "sales";
    return !["purchase", "sales"].includes(t.source);
  });

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      if (!json.success) return [];
      return json.data;
    }
  });

  // Calculate live summary stats
  const summaryStats = useMemo(() => {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    let showroomTotal = 0;
    let godownTotal = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const it of list) {
      const sQty = Number(it.showroomStock ?? it.currentStock ?? 0);
      const gQty = Number(it.godownStock ?? it.currentStock ?? 0);
      const totalQty = sQty + gQty;
      const reorder = Number(it.reorderLevel || 5);

      showroomTotal += sQty;
      godownTotal += gQty;

      if (totalQty === 0) {
        outOfStockCount++;
      } else if (totalQty <= reorder) {
        lowStockCount++;
      }
    }

    return {
      total: list.length,
      active: list.filter((i: any) => i.status === "active").length,
      showroomTotal,
      godownTotal,
      lowStock: lowStockCount,
      outOfStock: outOfStockCount,
    };
  }, [items]);

  // Filter items based on search, category, status, and stockLocationFilter
  const filtered = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return items.filter((item: any) => {
      if (!item) return false;
      const matchSearch = !search || 
        (item.name && item.name.toLowerCase().includes(search.toLowerCase())) ||
        (item.code && item.code.toLowerCase().includes(search.toLowerCase())) ||
        (item.vpCode && item.vpCode.toLowerCase().includes(search.toLowerCase())) ||
        (item.brand && item.brand.toLowerCase().includes(search.toLowerCase()));
      
      const matchCategory = categoryFilter === "all" || item.category === categoryFilter;

      const showroomQty = Number(item.showroomStock ?? item.currentStock ?? 0);
      const godownQty = Number(item.godownStock ?? item.currentStock ?? 0);
      const totalQty = showroomQty + godownQty;
      const reorder = Number(item.reorderLevel || 5);

      let matchLocation = true;
      if (stockLocationFilter === "in_showroom") {
        matchLocation = showroomQty > 0;
      } else if (stockLocationFilter === "in_godown") {
        matchLocation = godownQty > 0;
      }

      let matchStatus = true;
      if (statusFilter === "low_stock") {
        matchStatus = totalQty > 0 && totalQty <= reorder;
      } else if (statusFilter === "out_of_stock") {
        matchStatus = totalQty === 0;
      } else if (statusFilter === "active") {
        matchStatus = item.status === "active";
      } else if (statusFilter === "inactive") {
        matchStatus = item.status === "inactive";
      }

      const matchEntity = entityFilter === "all" || entityOf(item) === entityFilter;

      return matchSearch && matchCategory && matchLocation && matchStatus && matchEntity;
    });
  }, [items, search, categoryFilter, stockLocationFilter, statusFilter, entityFilter]);

  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const totalPages = Math.ceil(filtered.length / PER_PAGE);

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? paginated.map((i: any) => i.code) : []);
  };

  const handleSelect = (code: string, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...prev, code] : prev.filter((id) => id !== code));
  };

  const openAdd = () => {
    if (isSalesperson) {
      toast.error("Sales staff cannot add new items. Adding products is restricted to Admin.");
      return;
    }
    setEditingItem(null);
    setFormData({ 
      ...EMPTY_FORM, 
      code: `ITM-${String(items.length + 1).padStart(4, "0")}`,
      warehouse: activeLocation?.name || "Ashoka Enterprises (Kunraghat Showroom)"
    });
    setFormSerials([]);
    setNewSerialInput("");
    setBatchNoInput("");
    setIncentiveOpen(false);
    setIsFormOpen(true);
  };

  const openEdit = (item: any) => {
    if (isSalesperson) {
      toast.error("Sales staff cannot edit catalog items. Editing is restricted to Admin.");
      return;
    }
    setEditingItem(item);
    const itemBrand = item.brand ? item.brand.trim() : "";
    const matchedBrand = brands.find((b: any) => b.name?.toLowerCase().trim() === itemBrand.toLowerCase())?.name || itemBrand;
    const itemCategory = item.category ? item.category.trim() : "";
    const matchedCategory = categories.find((c: any) => c.name?.toLowerCase().trim() === itemCategory.toLowerCase())?.name || itemCategory;

    const sStock = item.showroomStock !== undefined ? item.showroomStock : (item.currentStock || 0);
    const gStock = item.godownStock !== undefined ? item.godownStock : (item.currentStock || 0);

    setFormData({
      name: item.name || "", 
      code: item.code || "", 
      category: matchedCategory, 
      brand: matchedBrand,
      unit: item.unit || "PCS", 
      hsn: item.hsnCode || item.hsn || "", 
      gstRate: String(item.gstRate || 18),
      purchasePrice: String(item.purchasePrice || ""),
      sellingPrice: String(item.sellingPrice || ""),
      vsp: String(item.vsp || item.sellingPrice || ""),
      billingEntity: entityOf(item),
      minSellingPrice: String(item.minSellingPrice || item.purchasePrice || ""),
      maxDiscountPercent: String(item.maxDiscountPercent || ""),
      maxDiscountAmount: String(item.maxDiscountAmount || ""),
      incentiveTargetAmount: String(item.incentiveTargetAmount || ""),
      incentiveAmount: String(item.incentiveAmount || item.incentiveValue || 0),
      incentiveType: item.incentiveType && item.incentiveType !== "none" ? item.incentiveType : "none",
      incentiveValue: String(item.incentiveValue || item.incentiveAmount || 0),
      mrp: String(item.mrp || ""), 
      currentStock: String(sStock),
      showroomStock: String(sStock),
      godownStock: String(gStock),
      reorderLevel: String(item.reorderLevel || 5), 
      warehouse: item.warehouse || activeLocation?.name || "Ashoka Enterprises (Kunraghat Showroom)", 
      status: item.status || "active",
    });
    setIncentiveOpen(Boolean(Number(item.incentiveValue) || Number(item.incentiveAmount)));

    const matching = (allDbSerials || []).filter((s: any) =>
      (s.vpCode && (s.vpCode === item.vpCode || s.vpCode === item.code)) ||
      (s.itemId && (s.itemId === item._id || s.itemId === item.id)) ||
      (s.itemName && s.itemName.toLowerCase().trim() === item.name.toLowerCase().trim())
    );

    setFormSerials(matching.map((s: any) => ({
      id: s._id || s.serialNumber,
      serialNumber: s.serialNumber,
      status: s.status || "AVAILABLE",
      warehouse: s.warehouse || "Showroom",
      batchNo: s.batchNo || "",
      isExisting: true
    })));
    setNewSerialInput("");
    setBatchNoInput("");
    setIsFormOpen(true);
  };

  const handleAddSerials = () => {
    if (!newSerialInput.trim()) {
      toast.error("Please enter a serial or IMEI number");
      return;
    }
    const rawTokens = newSerialInput.split(/[\n,;]+/).map(t => t.trim().toUpperCase()).filter(Boolean);
    if (rawTokens.length === 0) return;

    const existingSerialsSet = new Set(formSerials.map(s => s.serialNumber.toUpperCase()));
    const newItemsToAdd: FormSerialItem[] = [];

    for (const sn of rawTokens) {
      if (existingSerialsSet.has(sn)) {
        toast.warning(`Serial ${sn} is already in the list`);
        continue;
      }
      existingSerialsSet.add(sn);
      newItemsToAdd.push({
        id: `temp-${Date.now()}-${Math.random()}`,
        serialNumber: sn,
        status: serialStatusInput,
        warehouse: serialWarehouseInput || "Showroom",
        batchNo: batchNoInput.trim(),
        isExisting: false,
      });
    }

    if (newItemsToAdd.length > 0) {
      setFormSerials(prev => [...prev, ...newItemsToAdd]);
      setNewSerialInput("");
      toast.success(`Added ${newItemsToAdd.length} Serial / IMEI Number(s)`);
    }
  };

  const handleRemoveSerial = async (index: number) => {
    const itemToRemove = formSerials[index];
    if (itemToRemove?.isExisting) {
      try {
        await fetch(`/api/serial-numbers?serialNumber=${encodeURIComponent(itemToRemove.serialNumber)}`, {
          method: "DELETE"
        });
        toast.success(`Serial ${itemToRemove.serialNumber} deleted from database`);
      } catch (err) {
        console.warn("Delete serial error:", err);
      }
    }
    setFormSerials(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleUpdateSerialField = (index: number, field: keyof FormSerialItem, value: any) => {
    setFormSerials(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const method = editingItem ? "PUT" : "POST";
      const res = await fetch("/api/items", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save item");
      return json.data;
    },
    onSuccess: () => {
      toast.success(editingItem ? "Item and serial numbers updated successfully" : "Item added successfully");
      setIsFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["all-serial-numbers"] });
      queryClient.invalidateQueries({ queryKey: ["serialNumbers"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await fetch(`/api/items?code=${code}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete item");
      return json;
    },
    onSuccess: () => {
      toast.success("Item deleted");
      queryClient.invalidateQueries({ queryKey: ["items"] });
      setIsDeleteOpen(false);
      setDeletingCode(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
      setIsDeleteOpen(false);
      setDeletingCode(null);
    }
  });

  const handleSave = async () => {
    if (!formData.name || !formData.sellingPrice) {
      toast.error("Please fill all required fields");
      return;
    }
    if (incentiveOpen && !(Number(formData.incentiveValue) > 0)) {
      toast.error("Incentive is switched on — enter a reward value, or switch it off.");
      return;
    }

    const sStock = Number(formData.showroomStock || formData.currentStock || 0);
    const gStock = Number(formData.godownStock || formData.currentStock || 0);

    const payload = {
      ...formData,
      code: formData.code || `ITM-${String(items.length + 1).padStart(4, "0")}`,
      gstRate: Number(formData.gstRate),
      purchasePrice: Number(formData.purchasePrice),
      sellingPrice: Number(formData.sellingPrice),
      // Untouched, this mirrors Selling Price — editing it independently is what
      // lets VSP diverge from whatever the actual billing price ends up being.
      vsp: Number(formData.vsp) || Number(formData.sellingPrice) || 0,
      billingEntity: entityOf(formData.billingEntity),
      minSellingPrice: Number(formData.minSellingPrice) || Number(formData.purchasePrice) || 0,
      maxDiscountPercent: Number(formData.maxDiscountPercent) || 0,
      maxDiscountAmount: Number(formData.maxDiscountAmount) || 0,
      // A collapsed section means "no incentive on this product" even if a value
      // was typed in before the admin closed it, so the rule is force-cleared
      // rather than trusting whatever formData still holds.
      incentiveTargetAmount: incentiveOpen ? (Number(formData.incentiveTargetAmount) || 0) : 0,
      incentiveAmount: incentiveOpen ? (Number(formData.incentiveAmount) || Number(formData.incentiveValue) || 0) : 0,
      incentiveType: incentiveOpen ? (formData.incentiveType === "percentage" ? "percentage" : "fixed") : "none",
      incentiveValue: incentiveOpen ? (Number(formData.incentiveValue) || Number(formData.incentiveAmount) || 0) : 0,
      mrp: Number(formData.mrp),
      showroomStock: sStock,
      godownStock: gStock,
      currentStock: sStock,
      reorderLevel: Number(formData.reorderLevel)
    };

    // Save newly added serial numbers
    const serialsToCreate = formSerials.filter(s => !s.isExisting && s.serialNumber.trim()).map(s => ({
      serialNumber: s.serialNumber.trim().toUpperCase(),
      itemId: editingItem?._id || "",
      vpCode: formData.code || editingItem?.vpCode || "VP-GEN",
      itemName: formData.name,
      status: s.status || "AVAILABLE",
      warehouse: s.warehouse || activeLocation?.name || "Kunraghat Showroom",
      batchNo: s.batchNo || "",
    }));

    if (serialsToCreate.length > 0) {
      try {
        await fetch("/api/serial-numbers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(serialsToCreate)
        });
      } catch (err) {
        console.warn("Error creating serials:", err);
      }
    }

    // Update existing serial numbers
    for (const s of formSerials.filter(s => s.isExisting)) {
      try {
        await fetch("/api/serial-numbers", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serialNumber: s.serialNumber,
            status: s.status,
            notes: "Updated from Product Master Edit Form"
          })
        });
      } catch (err) {
        console.warn("Error updating serial:", err);
      }
    }

    saveMutation.mutate(payload);
  };

  const confirmDelete = (code: string) => {
    setDeletingCode(code);
    setIsDeleteOpen(true);
  };

  const handleDelete = () => {
    if (deletingCode) {
      deleteMutation.mutate(deletingCode);
    }
  };

  const handleBulkDelete = () => {
    toast.error("Bulk delete not fully implemented via API yet");
    setSelectedIds([]);
  };

  const getStockStatus = (item: any) => {
    const sQty = Number(item.showroomStock ?? item.currentStock ?? 0);
    const gQty = Number(item.godownStock ?? item.currentStock ?? 0);
    const totalQty = sQty + gQty;
    const reorder = Number(item.reorderLevel || 5);

    if (totalQty === 0) return { label: "Out of Stock", variant: "destructive" as const, low: true };
    if (totalQty <= reorder) return { label: "Reorder Needed", variant: "destructive" as const, low: true };
    return { label: "In Stock", variant: "success" as const, low: false };
  };

  return (
    <PageShell
      title="Master Stock & Products"
      subtitle={`${summaryStats.total} products in catalog · Live Showroom & Godown stock overview`}
      breadcrumbs={[{ label: "Masters", href: "/masters/items" }, { label: "Master Stock" }]}
      actions={
        isSuperAdminOrAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <ExportMenu
              className="text-xs"
              title="Master Stock Report"
              subtitle={`${items.length} products`}
              data={items.map((i: any) => ({
                name: i.name,
                code: i.code,
                vpCode: i.vpCode,
                brand: i.brand,
                category: i.category,
                showroomStock: i.showroomStock ?? i.currentStock ?? 0,
                godownStock: i.godownStock ?? i.currentStock ?? 0,
                totalStock: (i.showroomStock ?? i.currentStock ?? 0) + (i.godownStock ?? i.currentStock ?? 0),
                sellingPrice: i.sellingPrice,
                mrp: i.mrp,
                purchasePrice: i.purchasePrice,
                unit: i.unit,
              }))}
              filename="master_stock_report"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBulkIncentiveOpen(true)}
              className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
            >
              <Gift className="w-3.5 h-3.5 mr-1.5" /> Bulk Apply Incentive
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setVspImportOpen(true)}
              className="text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              title="Upload a brand price list to update the VSP of the products it names"
            >
              <UploadCloud className="w-3.5 h-3.5 mr-1.5" /> Update Prices from Sheet
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setProductReferenceOpen(true)}
              className="text-xs border-[#3F63AD]/40 text-[#3F63AD] hover:bg-[#3F63AD]/5"
              title="Upload a stock/accounting sheet so PDF purchase import can auto-fill Category/Brand for new products by VP code"
            >
              <UploadCloud className="w-3.5 h-3.5 mr-1.5" /> Import Stock Reference
            </Button>
            <Button
              size="sm"
              onClick={() => router.push("/purchase/entries?action=create")}
              className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" /> + Inward Stock / Purchase Entry
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-50 text-[#30539C] border border-blue-200 text-xs font-bold px-3 py-1.5">
              👁️ Product Catalog & Stock View
            </Badge>
            <ExportMenu
              className="text-xs"
              title="Product Catalog & Price List"
              subtitle={`${items.length} products`}
              data={items.map((i: any) => ({
                name: i.name,
                code: i.code,
                vpCode: i.vpCode,
                category: i.category,
                brand: i.brand,
                showroomStock: i.showroomStock ?? i.currentStock ?? 0,
                godownStock: i.godownStock ?? i.currentStock ?? 0,
                sellingPrice: i.sellingPrice,
                mrp: i.mrp,
                unit: i.unit
              }))}
              filename="product_catalog_prices"
            />
          </div>
        )
      }
    >
      {isSalesperson && (
        <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3.5 flex items-center justify-between text-xs text-slate-700 mb-2">
          <div className="flex items-center gap-2">
            <Badge className="bg-[#30539C] text-white text-[10px]">Sales Staff View</Badge>
            <span>You have real-time access to check live stock in your logged-in Showroom and Central Godown.</span>
          </div>
        </div>
      )}

      {/* Clean Standard Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { 
            label: "Total Items", 
            value: summaryStats.total, 
            icon: Package, 
            color: "text-[#3F63AD]", 
            bg: "bg-[#3F63AD]/10", 
            filterKey: "all",
            activeBorder: "ring-2 ring-[#3F63AD] border-[#3F63AD] bg-blue-50/40" 
          },
          { 
            label: "Active", 
            value: summaryStats.active, 
            icon: CheckCircle, 
            color: "text-emerald-600", 
            bg: "bg-emerald-50", 
            filterKey: "active",
            activeBorder: "ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/40" 
          },
          { 
            label: "Low Stock", 
            value: summaryStats.lowStock, 
            icon: AlertTriangle, 
            color: "text-amber-600", 
            bg: "bg-amber-50", 
            filterKey: "low_stock",
            activeBorder: "ring-2 ring-amber-500 border-amber-500 bg-amber-50/60" 
          },
          { 
            label: "Out of Stock", 
            value: summaryStats.outOfStock, 
            icon: AlertTriangle, 
            color: "text-red-600", 
            bg: "bg-red-50", 
            filterKey: "out_of_stock",
            activeBorder: "ring-2 ring-red-500 border-red-500 bg-red-50/60" 
          },
        ].map((stat) => {
          const isSelected = statusFilter === stat.filterKey;
          return (
            <button
              key={stat.label}
              type="button"
              onClick={() => {
                setStatusFilter(stat.filterKey);
                setPage(1);
              }}
              className={cn(
                "metric-card flex items-center justify-between p-4 text-left transition-all duration-200 cursor-pointer rounded-2xl border shadow-xs hover:shadow-md hover:scale-[1.02]",
                isSelected ? stat.activeBorder : "bg-white border-slate-200 hover:border-slate-300"
              )}
              title={`Click to filter by ${stat.label}`}
            >
              <div className="flex items-center gap-3.5">
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${stat.bg}`}>
                  <stat.icon className={`w-5 h-5 ${stat.color}`} />
                </div>
                <div>
                  <p className="text-2xl font-black text-slate-900 tracking-tight">{stat.value}</p>
                  <p className="text-xs font-semibold text-slate-500">{stat.label}</p>
                </div>
              </div>
              {isSelected && (
                <Badge className={cn("text-[10px] font-bold uppercase", stat.filterKey === "low_stock" ? "bg-amber-500" : stat.filterKey === "out_of_stock" ? "bg-red-600" : "bg-[#3F63AD]")}>
                  Active
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Table Container */}
      <div className="data-table-container">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b bg-slate-50/40">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Search */}
            <AutocompleteSearch
              data={items}
              searchKeys={["name", "code", "vpCode", "brand", "category"]}
              displayKey="name"
              subDisplayKey="vpCode"
              placeholder="Search by product name, VP Code, SKU, brand..."
              value={search}
              onSearchChange={(val) => { setSearch(val); setPage(1); }}
              className="min-w-[240px] max-w-sm flex-1"
            />

            {/* Quick Active Location Filter Indicator if applied */}
            {stockLocationFilter !== "all" && (
              <Badge className={cn("text-xs font-bold py-1 px-2.5 flex items-center gap-1.5", stockLocationFilter === "in_showroom" ? "bg-blue-600 text-white" : "bg-amber-600 text-white")}>
                {stockLocationFilter === "in_showroom" ? <Store className="w-3 h-3" /> : <Warehouse className="w-3 h-3" />}
                {stockLocationFilter === "in_showroom" ? "Showing Showroom In-Stock (>0)" : "Showing Godown In-Stock (>0)"}
                <button
                  type="button"
                  onClick={() => setStockLocationFilter("all")}
                  className="ml-1 hover:opacity-80 font-black"
                  title="Clear location filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Company Filter */}
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-44 bg-white">
                <SelectValue placeholder="Company" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Companies</SelectItem>
                {BILLING_ENTITY_LIST.map((e) => <SelectItem key={e.key} value={e.key}>{e.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-40 bg-white">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c: any) => <SelectItem key={c._id || c.id || c.name} value={c.name}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* Status Filter */}
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-[calc(50%-0.25rem)] sm:w-32 bg-white">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="low_stock">Low Stock</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
              </SelectContent>
            </Select>

            {isSuperAdminOrAdmin && selectedIds.length > 0 && (
              <div className="flex items-center gap-2 ml-2">
                <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
                <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b">
              <tr>
                {isSuperAdminOrAdmin && (
                  <th className="w-10 px-4 py-3">
                    <Checkbox
                      checked={selectedIds.length === paginated.length && paginated.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </th>
                )}
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Item Particulars</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">HSN / GST</th>
                {!isSalesperson && (
                  <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Purchase ₹</th>
                )}
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide">Selling ₹</th>
                
                {/* Excel-Like Filter Button in Live Stock Header */}
                <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide min-w-[170px]">
                  <div className="flex items-center justify-end gap-1.5">
                    <span>
                      {stockViewDisplay === "showroom" && "🏪 Showroom Stock"}
                      {stockViewDisplay === "godown" && "🏭 Godown Stock"}
                      {stockViewDisplay === "both" && "Live Stock"}
                    </span>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={cn(
                            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-all shadow-2xs cursor-pointer",
                            stockLocationFilter !== "all" || stockViewDisplay !== "both" 
                              ? "bg-blue-600 text-white border-blue-700 hover:bg-blue-700" 
                              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-100 hover:text-slate-900"
                          )}
                          title="Excel Filter: Filter Showroom & Godown Stock"
                        >
                          <Filter className="w-3 h-3" />
                          <span>Filter</span>
                          <span className="text-[8px] opacity-70">▼</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-60 p-2 space-y-1 z-50">
                        <div className="px-2 py-1 text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                          Stock Column View
                        </div>
                        <DropdownMenuItem 
                          onClick={() => setStockViewDisplay("both")}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockViewDisplay === "both" && "font-bold text-blue-700 bg-blue-50")}
                        >
                          <span className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Both (Showroom & Godown)</span>
                          {stockViewDisplay === "both" && <CheckCircle className="w-3.5 h-3.5 text-blue-600" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => setStockViewDisplay("showroom")}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockViewDisplay === "showroom" && "font-bold text-blue-700 bg-blue-50")}
                        >
                          <span className="flex items-center gap-1.5"><Store className="w-3.5 h-3.5 text-blue-600" /> Showroom Stock Only</span>
                          {stockViewDisplay === "showroom" && <CheckCircle className="w-3.5 h-3.5 text-blue-600" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => setStockViewDisplay("godown")}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockViewDisplay === "godown" && "font-bold text-amber-800 bg-amber-50")}
                        >
                          <span className="flex items-center gap-1.5"><Warehouse className="w-3.5 h-3.5 text-amber-600" /> Godown Stock Only</span>
                          {stockViewDisplay === "godown" && <CheckCircle className="w-3.5 h-3.5 text-amber-600" />}
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />

                        <div className="px-2 py-1 text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                          Filter Product Rows
                        </div>
                        <DropdownMenuItem 
                          onClick={() => { setStockLocationFilter("all"); setPage(1); }}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockLocationFilter === "all" && "font-bold bg-slate-100")}
                        >
                          <span>All Products ({items.length})</span>
                          {stockLocationFilter === "all" && <CheckCircle className="w-3.5 h-3.5" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setStockLocationFilter("in_showroom"); setPage(1); }}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockLocationFilter === "in_showroom" && "font-bold text-blue-700 bg-blue-50")}
                        >
                          <span className="flex items-center gap-1.5"><Store className="w-3.5 h-3.5 text-blue-600" /> In Showroom Stock (&gt; 0)</span>
                          {stockLocationFilter === "in_showroom" && <CheckCircle className="w-3.5 h-3.5 text-blue-600" />}
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => { setStockLocationFilter("in_godown"); setPage(1); }}
                          className={cn("flex items-center justify-between text-xs cursor-pointer", stockLocationFilter === "in_godown" && "font-bold text-amber-800 bg-amber-50")}
                        >
                          <span className="flex items-center gap-1.5"><Warehouse className="w-3.5 h-3.5 text-amber-600" /> In Godown Stock (&gt; 0)</span>
                          {stockLocationFilter === "in_godown" && <CheckCircle className="w-3.5 h-3.5 text-amber-600" />}
                        </DropdownMenuItem>

                        {(stockLocationFilter !== "all" || stockViewDisplay !== "both") && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem 
                              onClick={() => { setStockLocationFilter("all"); setStockViewDisplay("both"); setPage(1); }}
                              className="text-xs text-red-600 font-bold focus:bg-red-50 focus:text-red-600 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5 mr-1" /> Reset Filter & View
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </th>

                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={isSuperAdminOrAdmin ? 9 : 7} className="p-0">
                    <TableShimmer rows={6} cols={isSuperAdminOrAdmin ? 9 : 7} />
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={isSuperAdminOrAdmin ? 9 : 7} className="px-4 py-16 text-center">
                    <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">No items found</p>
                    <p className="text-xs text-muted-foreground mt-1">Try adjusting your search or category filter</p>
                  </td>
                </tr>
              ) : (
                paginated.map((item: any) => {
                  const stockStatus = getStockStatus(item);
                  const isSelected = selectedIds.includes(item.code);
                  const showroomQty = Number(item.showroomStock ?? item.currentStock ?? 0);
                  const godownQty = Number(item.godownStock ?? item.currentStock ?? 0);
                  const totalQty = showroomQty + godownQty;
                  const rowBg = isSelected ? "bg-blue-50/50" : (stockStatus.low ? "bg-red-50/40 hover:bg-red-50/60" : "hover:bg-slate-50/70");

                  return (
                    <tr
                      key={item.code}
                      onClick={() => setViewingItem(item)}
                      title="Open full product ledger"
                      className={`transition-colors cursor-pointer ${rowBg}`}
                    >
                      {isSuperAdminOrAdmin && (
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(v) => handleSelect(item.code, v as boolean)}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <BrandLogo name={item.brand || "VP"} size="sm" className="w-9 h-9 rounded-xl shadow-none" />
                          <div>
                            <p className="font-medium text-foreground">{item.name}</p>
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                              <BillingEntityBadge entity={entityOf(item)} />
                              <span className="font-mono text-blue-600 font-bold bg-blue-50 px-1.5 py-0.2 rounded border border-blue-200">
                                VP: {item.vpCode || item.code}
                              </span>
                              <span>·</span>
                              <span className="font-semibold">{item.brand}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-medium">{item.category}</td>
                      <td className="px-4 py-3">
                        <p className="text-sm font-mono font-medium">{item.hsnCode || item.hsn}</p>
                        <p className="text-xs text-muted-foreground">GST {item.gstRate}%</p>
                      </td>
                      {!isSalesperson && (
                        <td className="px-4 py-3 text-right font-medium">{formatCurrency(item.purchasePrice)}</td>
                      )}
                      <td className="px-4 py-3 text-right">
                        <p className="font-semibold text-foreground">{formatCurrency(item.sellingPrice)}</p>
                        <p className="text-xs text-muted-foreground">MRP {formatCurrency(item.mrp)}</p>
                        <p className="text-[10px] text-emerald-600 font-medium">VSP {formatCurrency(item.vsp || item.sellingPrice)}</p>
                        {item.incentiveType && item.incentiveType !== "none" && Number(item.incentiveValue || item.incentiveAmount) > 0 && (
                          <span
                            className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"
                            title={
                              Number(item.incentiveTargetAmount) > 0
                                ? `Incentive applies at ₹${item.incentiveTargetAmount}+`
                                : "Incentive applies on every sale"
                            }
                          >
                            <Gift className="w-2.5 h-2.5" />
                            {item.incentiveType === "percentage"
                              ? `${item.incentiveValue}%`
                              : formatCurrency(item.incentiveValue || item.incentiveAmount)}
                          </span>
                        )}
                      </td>

                      {/* Clickable Live Stock Cell: Opens Showroom & Godown Stock Breakdown Popover */}
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="group text-right p-1.5 -mr-1.5 rounded-xl hover:bg-blue-50/90 border border-transparent hover:border-blue-200 transition-all cursor-pointer outline-none focus:ring-2 focus:ring-[#3F63AD]/30"
                              title="Click to view Showroom & Godown stock breakdown"
                            >
                              <div className="flex flex-col items-end">
                                <div className="flex items-center gap-1">
                                  <span className={cn(
                                    "text-xs font-black font-mono tracking-tight group-hover:text-[#3F63AD] transition-colors",
                                    totalQty === 0 ? "text-red-600" : totalQty <= (item.reorderLevel || 5) ? "text-amber-600" : "text-slate-900"
                                  )}>
                                    {stockViewDisplay === "showroom" 
                                      ? `${showroomQty} ${item.unit || "PCS"}` 
                                      : stockViewDisplay === "godown" 
                                      ? `${godownQty} ${item.unit || "PCS"}` 
                                      : `${totalQty} ${item.unit || "PCS"}`}
                                  </span>
                                  <span className="text-[9px] text-slate-400 group-hover:text-[#3F63AD]">▾</span>
                                </div>

                                <div className="flex items-center gap-1 text-[10px] mt-0.5">
                                  <span className={cn("px-1 py-0.2 rounded font-bold border text-[9px]", showroomQty > 0 ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-400 border-slate-200")}>
                                    🏪 {showroomQty}
                                  </span>
                                  <span className={cn("px-1 py-0.2 rounded font-bold border text-[9px]", godownQty > 0 ? "bg-amber-50 text-amber-800 border-amber-200" : "bg-slate-50 text-slate-400 border-slate-200")}>
                                    🏭 {godownQty}
                                  </span>
                                </div>
                                {/* Sold on a bill but kept in the store till its delivery date —
                                    already off the stock above; not to be sold again. */}
                                {Number(item.awaitingDeliveryQty) > 0 && (
                                  <span
                                    className="mt-0.5 px-1 rounded font-bold border text-[9px] bg-orange-50 text-orange-800 border-orange-300 whitespace-nowrap"
                                    title={`Sold – awaiting delivery on ${(item.awaitingDeliveryBills || []).join(", ")}`}
                                  >
                                    🚚 +{item.awaitingDeliveryQty} sold, awaiting delivery
                                  </span>
                                )}
                              </div>
                            </button>
                          </PopoverTrigger>

                          <PopoverContent align="end" className="w-80 p-0 rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50">
                            {/* Popover Header */}
                            <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-3.5 flex items-center justify-between">
                              <div className="max-w-[190px]">
                                <p className="font-bold text-xs line-clamp-1">{item.name}</p>
                                <p className="text-[10px] text-slate-300 font-mono mt-0.5">
                                  VP: <span className="text-amber-300 font-bold">{item.vpCode || item.code}</span> · {item.brand}
                                </p>
                              </div>
                              <Badge className={cn("text-[9px] font-bold uppercase", stockStatus.low ? "bg-red-600" : "bg-emerald-600")}>
                                {stockStatus.label}
                              </Badge>
                            </div>

                            {/* Popover Breakdown List */}
                            <div className="p-3.5 space-y-2.5 bg-white text-xs">
                              <p className="text-[10px] font-extrabold uppercase text-slate-400 tracking-wider">
                                Live Stock Breakdown
                              </p>

                              {/* Showroom Row */}
                              <div className="flex items-center justify-between p-2.5 rounded-xl bg-blue-50/70 border border-blue-100">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold">
                                    <Store className="w-3.5 h-3.5" />
                                  </div>
                                  <div>
                                    <p className="font-bold text-blue-950 text-xs">Showroom Stock</p>
                                    <p className="text-[10px] text-blue-700/80 truncate max-w-[130px]">{activeLocation?.name || "Kunraghat Showroom"}</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono font-extrabold text-blue-900 text-sm">{showroomQty} {item.unit || "PCS"}</p>
                                  <p className="text-[9px] text-blue-600 font-semibold">{showroomQty > 0 ? "In Stock" : "Out of Stock"}</p>
                                </div>
                              </div>

                              {/* Godown Row */}
                              <div className="flex items-center justify-between p-2.5 rounded-xl bg-amber-50/70 border border-amber-200">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-amber-600 text-white flex items-center justify-center font-bold">
                                    <Warehouse className="w-3.5 h-3.5" />
                                  </div>
                                  <div>
                                    <p className="font-bold text-amber-950 text-xs">Central Godown</p>
                                    <p className="text-[10px] text-amber-800/80">Main Logistics Hub</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="font-mono font-extrabold text-amber-950 text-sm">{godownQty} {item.unit || "PCS"}</p>
                                  <p className="text-[9px] text-amber-700 font-semibold">{godownQty > 0 ? "In Stock" : "Out of Stock"}</p>
                                </div>
                              </div>

                              {/* Total Stock Row */}
                              <div className="flex items-center justify-between pt-2 border-t border-slate-100 font-bold text-slate-800 px-1">
                                <span className="text-[11px] text-slate-600">Total System Units:</span>
                                <span className="font-mono text-sm text-[#3F63AD] font-black">{totalQty} {item.unit || "PCS"}</span>
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <Badge variant={stockStatus.variant}>{stockStatus.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          {isSalesperson ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-[11px] font-bold text-[#30539C] border-blue-200 hover:bg-blue-50"
                              onClick={() => setViewingItem(item)}
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" /> View
                            </Button>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-[11px] font-bold text-amber-800 bg-amber-50 hover:bg-amber-100 border-amber-300 shadow-xs"
                                onClick={() => openEdit(item)}
                              >
                                <Edit className="w-3.5 h-3.5 mr-1 text-amber-600" /> Edit
                              </Button>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
                                    <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  <DropdownMenuItem onClick={() => setViewingItem(item)}>
                                    <Eye className="w-4 h-4 mr-2" /> View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openEdit(item)}>
                                    <Edit className="w-4 h-4 mr-2" /> Edit Item & Serials
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => confirmDelete(item.code)}
                                    className="text-red-600 focus:text-red-600 focus:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" /> Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-4 py-3 border-t text-sm text-muted-foreground">
          <p>Showing {Math.min((page - 1) * PER_PAGE + 1, filtered.length)}–{Math.min(page * PER_PAGE, filtered.length)} of {filtered.length} items</p>
          <div className="flex flex-wrap items-center justify-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${page === p ? "bg-[#3F63AD] text-white" : "hover:bg-slate-100"}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages || totalPages === 0}
              className="px-3 py-1.5 rounded-lg border hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 rounded-2xl border-none shadow-2xl">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 rounded-t-2xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Package className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">
                  {editingItem ? "Edit Product Catalog Item" : "Add Mobile & Electronics Item"}
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  Specify particulars, pricing, GST tax rates & showroom/godown stock levels
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6 bg-slate-50/50">
            {/* Section 1: General Particulars */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                <Package className="w-4 h-4 text-[#3F63AD]" /> 1. Product Identification & Categorization
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Product Name & Model *</Label>
                  <Input
                    list="item-names"
                    placeholder="e.g. iPhone 15 Pro Max 256GB"
                    value={formData.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      const existing = items.find((i: any) => i.name.toLowerCase() === val.toLowerCase());
                      if (existing) {
                        setFormData((f) => ({ ...f, name: val, hsn: existing.hsnCode || existing.hsn || "" }));
                      } else {
                        setFormData((f) => ({ ...f, name: val }));
                      }
                    }}
                    className="bg-slate-50 border-slate-300"
                  />
                  <datalist id="item-names">
                    {items.map((it: any) => (
                      <option key={it._id || it.id} value={it.name} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">VP Code (SKU)</Label>
                  <Input
                    placeholder="Auto-generated (e.g. VP-10029)"
                    value={formData.code}
                    onChange={(e) => setFormData((f) => ({ ...f, code: e.target.value }))}
                    className="bg-slate-50 border-slate-300 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Category *</Label>
                  <Select value={formData.category} onValueChange={(v) => setFormData((f) => ({ ...f, category: v }))}>
                    <SelectTrigger className="bg-slate-50 border-slate-300 font-semibold text-slate-800">
                      <SelectValue placeholder="Select category">
                        {formData.category || "Select category"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {formData.category && !categories.some((c: any) => c.name?.toLowerCase().trim() === formData.category.toLowerCase().trim()) && (
                        <SelectItem value={formData.category}>{formData.category}</SelectItem>
                      )}
                      {categories.map((c: any) => <SelectItem key={c._id || c.id || c.name} value={c.name}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Brand *</Label>
                  <BrandSelect
                    value={formData.brand}
                    onValueChange={(v) => setFormData((f) => ({ ...f, brand: v }))}
                    className="bg-slate-50 border-slate-300 font-semibold text-slate-800"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">HSN Code</Label>
                  <Input
                    placeholder="85171300"
                    value={formData.hsn}
                    onChange={(e) => setFormData((f) => ({ ...f, hsn: e.target.value }))}
                    className="bg-slate-50 border-slate-300 font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Billing Company *</Label>
                  <select
                    value={entityOf(formData.billingEntity)}
                    onChange={(e) => setFormData((f) => ({ ...f, billingEntity: e.target.value }))}
                    className="w-full h-9 rounded-md border border-slate-300 bg-slate-50 px-2 text-sm font-semibold text-slate-800"
                  >
                    {BILLING_ENTITY_LIST.map((e) => (
                      <option key={e.key} value={e.key}>{e.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-slate-400">This product can only be sold on this company's bills.</p>
                </div>
              </div>
            </div>

            {/* Section 2: Pricing & Floor Price */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#3F63AD]" /> 2. Pricing & Selling Rates
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Purchase Cost (₹) *</Label>
                  <Input
                    type="number"
                    placeholder="125000"
                    value={formData.purchasePrice}
                    onChange={(e) => setFormData((f) => ({ ...f, purchasePrice: e.target.value }))}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Showroom Selling Price (₹) *</Label>
                  <Input
                    type="number"
                    placeholder="144900"
                    value={formData.sellingPrice}
                    onChange={(e) => setFormData((f) => ({ ...f, sellingPrice: e.target.value }))}
                    className="bg-slate-50 border-slate-300 font-semibold text-[#3F63AD]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-emerald-700 flex items-center gap-1">
                    VSP (₹) <span className="text-[10px] text-emerald-600 font-normal">(Value Plus Price)</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder={`Default: ₹${formData.sellingPrice || 0}`}
                    value={formData.vsp}
                    onChange={(e) => setFormData((f) => ({ ...f, vsp: e.target.value }))}
                    className="bg-emerald-50/50 border-emerald-300 font-mono font-semibold"
                  />
                  <p className="text-[10px] text-slate-400">Suggested price only — billing can still charge any amount.</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                    Min Floor Price (₹) <span className="text-[10px] text-amber-600 font-normal">(PIN Lock)</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="e.g. 135000"
                    value={formData.minSellingPrice}
                    onChange={(e) => setFormData((f) => ({ ...f, minSellingPrice: e.target.value }))}
                    className="bg-amber-50/50 border-amber-300 font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                    Max Discount (%) <span className="text-[10px] text-amber-600 font-normal">(Hard Cap)</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="e.g. 10"
                    value={formData.maxDiscountPercent}
                    onChange={(e) => setFormData((f) => ({ ...f, maxDiscountPercent: e.target.value }))}
                    className="bg-amber-50/50 border-amber-300 font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-amber-700 flex items-center gap-1">
                    Max Discount (₹) <span className="text-[10px] text-amber-600 font-normal">(Hard Cap)</span>
                  </Label>
                  <Input
                    type="number"
                    placeholder="e.g. 500"
                    value={formData.maxDiscountAmount}
                    onChange={(e) => setFormData((f) => ({ ...f, maxDiscountAmount: e.target.value }))}
                    className="bg-amber-50/50 border-amber-300 font-mono font-semibold"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">MRP (₹)</Label>
                  <Input
                    type="number"
                    placeholder="149900"
                    value={formData.mrp}
                    onChange={(e) => setFormData((f) => ({ ...f, mrp: e.target.value }))}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">GST Rate (%)</Label>
                  <Select value={formData.gstRate} onValueChange={(v) => setFormData((f) => ({ ...f, gstRate: v }))}>
                    <SelectTrigger className="bg-slate-50 border-slate-300"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[0, 5, 12, 18, 28].map((r) => <SelectItem key={r} value={String(r)}>{r}% GST</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Section 3: Salesperson Incentive — collapsed by default; most
                products have no incentive scheme, so the form stays short
                unless the admin explicitly opens this. */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              {/*
                A plain <button> wrapping the Switch put a <button role="switch">
                inside another <button> — invalid HTML that React flags as a
                hydration error. This is a <div> that behaves like a toggle
                (role="button", keyboard-operable) instead, with the Switch as an
                ordinary child rather than a nested interactive control.
              */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIncentiveOpen((o) => !o)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIncentiveOpen((o) => !o);
                  }
                }}
                className="w-full flex items-center justify-between p-5 text-left cursor-pointer select-none"
              >
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                  <Gift className="w-4 h-4 text-[#3F63AD]" /> 3. Salesperson Incentive
                  {incentiveOpen && Number(formData.incentiveValue) > 0 && (
                    <span className="normal-case font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-[10px] tracking-normal">
                      {formData.incentiveType === "percentage"
                        ? `${formData.incentiveValue}% set`
                        : `₹${formData.incentiveValue} set`}
                    </span>
                  )}
                </h4>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={incentiveOpen}
                    onCheckedChange={(v: boolean) => {
                      setIncentiveOpen(v);
                      // Turning it on for the first time needs a starting type;
                      // turning it off is handled at save time regardless of
                      // whatever is left in the fields.
                      if (v && formData.incentiveType === "none") {
                        setFormData((f) => ({ ...f, incentiveType: "fixed" }));
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {incentiveOpen ? (
                    <ChevronUp className="w-4 h-4 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  )}
                </div>
              </div>

              {incentiveOpen && (
                <div className="px-5 pb-5 space-y-4 border-t border-slate-100 pt-4">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, incentiveType: "fixed" }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold border transition-colors",
                        formData.incentiveType === "fixed"
                          ? "bg-[#3F63AD] text-white border-[#3F63AD]"
                          : "bg-slate-50 text-slate-600 border-slate-300"
                      )}
                    >
                      Fixed ₹ per unit
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, incentiveType: "percentage" }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-xs font-bold border transition-colors",
                        formData.incentiveType === "percentage"
                          ? "bg-[#3F63AD] text-white border-[#3F63AD]"
                          : "bg-slate-50 text-slate-600 border-slate-300"
                      )}
                    >
                      Percentage %
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">
                        Reward Value {formData.incentiveType === "percentage" ? "(%)" : "(₹)"} *
                      </Label>
                      <Input
                        type="number"
                        placeholder={formData.incentiveType === "percentage" ? "e.g. 1.5" : "e.g. 500"}
                        value={formData.incentiveValue}
                        onChange={(e) => setFormData((f) => ({ ...f, incentiveValue: e.target.value }))}
                        className="bg-slate-50 border-slate-300 font-semibold"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-700">
                        Target Selling Price (₹)
                      </Label>
                      <Input
                        type="number"
                        placeholder={`Optional · this item's price is ₹${formData.sellingPrice || 0}`}
                        value={formData.incentiveTargetAmount}
                        onChange={(e) => setFormData((f) => ({ ...f, incentiveTargetAmount: e.target.value }))}
                        className="bg-slate-50 border-slate-300"
                      />
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-500 leading-relaxed bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    {formData.incentiveType === "percentage"
                      ? `The salesperson earns ${formData.incentiveValue || 0}% of the taxable amount`
                      : `The salesperson earns ₹${formData.incentiveValue || 0} per unit`}
                    {Number(formData.incentiveTargetAmount) > 0
                      ? ` when this product is billed at ₹${formData.incentiveTargetAmount} or above.`
                      : " on every sale of this product, at any rate."}
                  </p>
                </div>
              )}
            </div>

            {/* Section 4: Showroom & Godown Stock Allocation */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-[#3F63AD]" /> 4. Showroom & Godown Stock Allocation
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                    <Store className="w-3.5 h-3.5 text-blue-600" />
                    Showroom Stock (Logged-in Store)
                  </Label>
                  <Input
                    type="number"
                    placeholder="10"
                    value={formData.showroomStock}
                    onChange={(e) => setFormData((f) => ({ ...f, showroomStock: e.target.value }))}
                    disabled={!!editingItem}
                    className="bg-blue-50/50 border-blue-300 font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500">
                    {editingItem
                      ? "Stock is not edited here — use Inventory Adjustment."
                      : `Available units in ${activeLocation?.name || "Showroom"}`}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                    <Warehouse className="w-3.5 h-3.5 text-amber-700" />
                    Godown Stock (Central Hub)
                  </Label>
                  <Input
                    type="number"
                    placeholder="25"
                    value={formData.godownStock}
                    onChange={(e) => setFormData((f) => ({ ...f, godownStock: e.target.value }))}
                    disabled={!!editingItem}
                    className="bg-amber-50/50 border-amber-300 font-bold disabled:opacity-60 disabled:cursor-not-allowed"
                  />
                  <p className="text-[10px] text-slate-500">
                    {editingItem ? "Stock is not edited here — use Inventory Adjustment." : "Available units in Central Godown"}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Low Stock Alert Level</Label>
                  <Input
                    type="number"
                    placeholder="5"
                    value={formData.reorderLevel}
                    onChange={(e) => setFormData((f) => ({ ...f, reorderLevel: e.target.value }))}
                    className="bg-slate-50 border-slate-300"
                  />
                  <p className="text-[10px] text-slate-500">Minimum threshold for reorder alert</p>
                </div>
              </div>
            </div>

            {/* Section 5: Serial Numbers & IMEI Units Management */}
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3">
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD] flex items-center gap-2">
                    <Barcode className="w-4 h-4 text-[#3F63AD]" /> 5. Serial Numbers & IMEI Inventory Tracking
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Manage unique device serial/IMEI barcodes for this product. Serial numbers will be selectable during Invoicing & POS billing.
                  </p>
                </div>
                <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200 font-mono font-bold text-xs self-start sm:self-auto">
                  {formSerials.length} Registered Units ({formSerials.filter(s => s.status === "AVAILABLE").length} Available)
                </Badge>
              </div>

              {/* Add New Serials Bar */}
              <div className="p-4 bg-slate-50/80 rounded-xl border border-slate-200 space-y-3">
                <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <PlusCircle className="w-4 h-4 text-[#3F63AD]" /> Add / Register Device Serial or IMEI Numbers
                </p>
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                  <div className="md:col-span-5 space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-600">Serial Number / IMEI (Barcode)</Label>
                    <Input
                      placeholder="e.g. 354892019482019 or comma separated"
                      value={newSerialInput}
                      onChange={(e) => setNewSerialInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddSerials();
                        }
                      }}
                      className="bg-white border-slate-300 font-mono text-xs font-bold uppercase"
                    />
                  </div>
                  <div className="md:col-span-2 space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-600">Batch No</Label>
                    <Input
                      placeholder="e.g. B-01"
                      value={batchNoInput}
                      onChange={(e) => setBatchNoInput(e.target.value)}
                      className="bg-white border-slate-300 font-mono text-xs uppercase"
                    />
                  </div>
                  <div className="md:col-span-3 space-y-1">
                    <Label className="text-[11px] font-semibold text-slate-600">Stock Location</Label>
                    <Select value={serialWarehouseInput} onValueChange={setSerialWarehouseInput}>
                      <SelectTrigger className="bg-white border-slate-300 text-xs font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Showroom">Showroom (Kunraghat)</SelectItem>
                        <SelectItem value="Central Godown">Central Godown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2">
                    <Button 
                      type="button" 
                      onClick={handleAddSerials} 
                      className="w-full bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold h-9"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                  </div>
                </div>
              </div>

              {/* Serial Numbers Table / List */}
              {formSerials.length > 0 ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-100 text-slate-600 uppercase font-bold text-[10px] sticky top-0">
                      <tr>
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Serial / IMEI Number</th>
                        <th className="px-3 py-2">Batch</th>
                        <th className="px-3 py-2">Location</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {formSerials.map((s, idx) => (
                        <tr key={s.id || idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-slate-400 font-bold">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <Input
                              value={s.serialNumber}
                              onChange={(e) => handleUpdateSerialField(idx, "serialNumber", e.target.value.toUpperCase())}
                              className="h-7 text-xs font-mono font-bold uppercase bg-slate-50 border-slate-200 max-w-[200px]"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              value={s.batchNo}
                              placeholder="-"
                              onChange={(e) => handleUpdateSerialField(idx, "batchNo", e.target.value.toUpperCase())}
                              className="h-7 text-xs font-mono bg-slate-50 border-slate-200 max-w-[100px]"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Select 
                              value={s.warehouse || "Showroom"} 
                              onValueChange={(v) => handleUpdateSerialField(idx, "warehouse", v)}
                            >
                              <SelectTrigger className="h-7 text-xs font-medium bg-slate-50 border-slate-200 w-28">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Showroom">Showroom</SelectItem>
                                <SelectItem value="Central Godown">Central Godown</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2">
                            <Select 
                              value={s.status} 
                              onValueChange={(v: any) => handleUpdateSerialField(idx, "status", v)}
                            >
                              <SelectTrigger className={cn(
                                "h-7 text-xs font-bold border w-28",
                                s.status === "AVAILABLE" ? "bg-emerald-50 text-emerald-800 border-emerald-300" :
                                s.status === "SOLD" ? "bg-blue-50 text-blue-800 border-blue-300" :
                                s.status === "DEFECTIVE" ? "bg-rose-50 text-rose-800 border-rose-300" :
                                "bg-amber-50 text-amber-800 border-amber-300"
                              )}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="AVAILABLE">AVAILABLE</SelectItem>
                                <SelectItem value="SOLD">SOLD</SelectItem>
                                <SelectItem value="RETURNED">RETURNED</SelectItem>
                                <SelectItem value="DEFECTIVE">DEFECTIVE</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleRemoveSerial(idx)}
                              className="p-1 rounded text-red-600 hover:bg-red-50 transition-colors"
                              title="Delete Serial"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/50 text-center">
                  <p className="text-xs text-slate-500 font-medium">No serial / IMEI numbers added for this item yet.</p>
                  <p className="text-[11px] text-slate-400">Type in the box above to register serial numbers directly.</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20">
              {saveMutation.isPending ? "Saving..." : (editingItem ? "Update Product" : "Save & Add to Catalog")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this item? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={deleteMutation.isPending}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Item Modal */}
      <Dialog open={!!viewingItem} onOpenChange={(open) => !open && setViewingItem(null)}>
        <DialogContent className="max-w-6xl p-0 rounded-2xl overflow-y-auto border-none shadow-2xl">
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-5 pr-14 flex flex-wrap justify-between items-center gap-3">
            <div className="min-w-0">
              <h3 className="text-lg font-bold tracking-tight">Product Details & Live Stock</h3>
              <p className="text-xs text-slate-300 mt-0.5 truncate">
                VP Code: <span className="font-mono text-amber-300 font-bold">{viewingItem?.vpCode || viewingItem?.code}</span> · {viewingItem?.brand}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Badge variant="outline" className="bg-blue-500/20 text-blue-200 border-blue-400/30 font-bold text-xs whitespace-nowrap">
                🏪 Showroom: {viewingItem?.showroomStock ?? viewingItem?.currentStock ?? 0} {viewingItem?.unit || "PCS"}
              </Badge>
              <Badge variant="outline" className="bg-amber-500/20 text-amber-200 border-amber-400/30 font-bold text-xs whitespace-nowrap">
                🏭 Godown: {viewingItem?.godownStock ?? viewingItem?.currentStock ?? 0} {viewingItem?.unit || "PCS"}
              </Badge>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 bg-slate-50 min-h-[400px]">
            {/* Left Side: Details */}
            <div className="p-5 border-r border-slate-200 bg-white space-y-5">
              <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2 border-b pb-2">
                <Package className="w-4 h-4 text-[#3F63AD]" /> Item Particulars
              </h4>
              <div className="grid grid-cols-1 gap-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground font-semibold uppercase">Product Name</p>
                  <p className="font-medium text-foreground">{viewingItem?.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Category</p>
                    <p className="font-medium text-foreground">{viewingItem?.category}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">HSN Code</p>
                    <p className="font-medium text-foreground">{viewingItem?.hsnCode || viewingItem?.hsn || "N/A"}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">GST Rate</p>
                    <p className="font-medium text-foreground">{viewingItem?.gstRate}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Min Alert</p>
                    <p className="font-medium text-foreground">{viewingItem?.reorderLevel || 5} {viewingItem?.unit || "PCS"}</p>
                  </div>
                </div>

                {/* Stock Breakdown Card in Modal */}
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
                  <p className="text-xs font-bold text-slate-800 uppercase tracking-wide">Stock Breakdown</p>
                  <div className="flex items-center justify-between text-xs py-1 border-b border-slate-200">
                    <span className="flex items-center text-blue-700 font-semibold">
                      <Store className="w-3.5 h-3.5 mr-1" /> {activeLocation?.name || "Showroom"}:
                    </span>
                    <span className="font-bold font-mono text-blue-900">{viewingItem?.showroomStock ?? viewingItem?.currentStock ?? 0} {viewingItem?.unit || "PCS"}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs py-1 border-b border-slate-200">
                    <span className="flex items-center text-amber-800 font-semibold">
                      <Warehouse className="w-3.5 h-3.5 mr-1" /> Central Godown:
                    </span>
                    <span className="font-bold font-mono text-amber-900">{viewingItem?.godownStock ?? viewingItem?.currentStock ?? 0} {viewingItem?.unit || "PCS"}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-1 font-bold">
                    <span className="text-slate-800">Total System Stock:</span>
                    <span className="font-mono text-[#3F63AD]">
                      {Number(viewingItem?.showroomStock ?? viewingItem?.currentStock ?? 0) + Number(viewingItem?.godownStock ?? viewingItem?.currentStock ?? 0)} {viewingItem?.unit || "PCS"}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                  {!isSalesperson ? (
                    <div>
                      <p className="text-xs text-muted-foreground font-semibold uppercase">Purchase Cost</p>
                      <p className="font-bold text-slate-700">{formatCurrency(viewingItem?.purchasePrice || 0)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs text-muted-foreground font-semibold uppercase">MRP Price</p>
                      <p className="font-bold text-slate-700">{formatCurrency(viewingItem?.mrp || viewingItem?.sellingPrice || 0)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">Selling Price</p>
                    <p className="font-bold text-[#3F63AD]">{formatCurrency(viewingItem?.sellingPrice || 0)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold uppercase">VSP</p>
                    <p className="font-bold text-emerald-700">{formatCurrency(viewingItem?.vsp || viewingItem?.sellingPrice || 0)}</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right Side: Purchase & Sales Ledger */}
            {/* Height grows with the viewport instead of a fixed 400px: the
                reconciliation banner and the tab strip took ~90px out of that
                budget, which left the list so short the first row was clipped
                with its header cut off. */}
            <div className="col-span-2 p-5 flex flex-col h-[min(70vh,640px)] min-h-[420px]">
              <div className="flex items-center justify-between border-b pb-2 mb-3">
                <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-[#3F63AD]" /> Purchase & Sales Ledger
                </h4>
                <ExportMenu
                  className="h-7 text-xs gap-1"
                  title={`${viewingItem?.name || viewingItem?.code || "Item"} — Purchase & Sales Ledger`}
                  subtitle={`${ledgerTransactions.length} transactions`}
                  data={ledgerTransactions.map((t: any) => ({
                    Date: t.date,
                    Type: t.type,
                    "Ref #": t.refNo,
                    Party: t.party,
                    "Qty In": t.qtyIn,
                    "Qty Out": t.qtyOut,
                    Balance: t.balance,
                    Rate: t.rate,
                    Amount: t.amount,
                    Profit: t.profit,
                  }))}
                  filename={`${viewingItem?.code || "item"}-ledger`}
                />
              </div>

              {/* Stock reconciliation: opening + in − out must equal on-hand stock.
                  Stating it explicitly means a partial history can't pass itself off
                  as complete. */}
              {ledgerSummary && (
                <div className={cn(
                  "mb-3 rounded-lg border px-3 py-2 text-[11px] font-semibold flex flex-wrap items-center gap-x-2 gap-y-1",
                  ledgerSummary.reconciles
                    ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                    : "bg-amber-50 border-amber-300 text-amber-900"
                )}>
                  <span>Opening <b>{ledgerSummary.openingQty}</b></span>
                  <span className="text-slate-400">+</span>
                  <span>In <b>{ledgerSummary.movementIn}</b></span>
                  <span className="text-slate-400">−</span>
                  <span>Out <b>{ledgerSummary.movementOut}</b></span>
                  <span className="text-slate-400">=</span>
                  <span>Balance <b>{ledgerSummary.ledgerClosingBalance}</b></span>
                  <span className="ml-auto">
                    {ledgerSummary.reconciles
                      ? `✓ matches stock on hand (${ledgerSummary.currentStock} = showroom + godown)`
                      : `⚠ stock on hand is ${ledgerSummary.currentStock} (off by ${ledgerSummary.reconcileDiff})`}
                  </span>
                </div>
              )}

              {/* An opening balance with no inward records isn't history — it's the
                  absence of it. Say so, rather than letting a large "Opening" number
                  imply the purchase trail exists. */}
              {ledgerSummary && ledgerSummary.movementIn === 0 && ledgerSummary.openingQty > 0 && (
                <div className="mb-3 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] text-slate-700">
                  <b>No purchase bill recorded for this product.</b> All {ledgerSummary.openingQty} units come
                  from the opening balance, so there is no supplier or purchase date to show. Record a purchase
                  entry to start building its inward history.
                </div>
              )}

              {/* Movement type filter */}
              <div className="flex items-center gap-1 mb-3 bg-slate-100 p-0.5 rounded-lg border border-slate-200 w-fit">
                {[
                  { key: "all", label: "All" },
                  { key: "purchase", label: "Purchases" },
                  { key: "sales", label: "Sales" },
                  { key: "other", label: "Adjustments" },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setLedgerTab(tab.key)}
                    className={cn(
                      "px-2.5 h-7 rounded-md text-[11px] font-bold transition-all",
                      ledgerTab === tab.key ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {ledgerSummary && (
                <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-2">
                    <p className="text-[10px] text-emerald-700 font-bold uppercase">Purchased</p>
                    <p className="text-sm font-black text-emerald-900">{ledgerSummary.totalInwardQty}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-2">
                    <p className="text-[10px] text-blue-700 font-bold uppercase">Sold</p>
                    <p className="text-sm font-black text-blue-900">{ledgerSummary.totalSoldQty}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-[10px] text-slate-600 font-bold uppercase">Revenue</p>
                    <p className="text-sm font-black text-slate-900">{formatCurrency(ledgerSummary.totalSoldRevenue)}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-2">
                    <p className="text-[10px] text-amber-700 font-bold uppercase">Margin</p>
                    <p className="text-sm font-black text-amber-900">{ledgerSummary.grossMarginPct}%</p>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto pr-2">
                {historyLoading ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-3">
                    <div className="w-8 h-8 border-4 border-[#3F63AD] border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm text-muted-foreground">Loading ledger...</p>
                  </div>
                ) : ledgerTransactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                      <TrendingUp className="w-5 h-5 text-slate-400" />
                    </div>
                    <p className="text-slate-600 font-medium">
                      {ledgerTab === "purchase" ? "No purchase entries for this product"
                        : ledgerTab === "sales" ? "Not sold yet"
                        : ledgerTab === "other" ? "No stock adjustments or transfers"
                        : "No stock movement recorded yet"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {ledgerTab === "all"
                        ? "Purchase bills, invoices and stock adjustments for this item will appear here."
                        : "Switch to All to see the complete ledger."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {ledgerTransactions.map((t: any) => {
                      const isPurchase = t.source === "purchase";
                      const isSale = t.source === "sales";
                      const isOpening = t.source === "opening";
                      const label = isOpening
                        ? "Opening"
                        : isPurchase
                        ? (t.type === "PURCHASE_RETURN" ? "Purchase Return" : "Purchase In")
                        : isSale
                        ? "Sale"
                        : String(t.type || "Movement").replace(/^STOCK_/, "").replace(/_/g, " ").toLowerCase();
                      const tone = isOpening
                        ? "bg-slate-200 text-slate-800"
                        : isPurchase
                        ? "bg-emerald-100 text-emerald-800"
                        : isSale
                        ? "bg-blue-100 text-blue-800"
                        : "bg-amber-100 text-amber-900";
                      return (
                        <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-3 hover:shadow-md transition-shadow">
                          <div className="flex justify-between items-start mb-2">
                            <div className="min-w-0">
                              <div className="font-bold text-foreground text-sm flex items-center gap-2 flex-wrap">
                                <span className="truncate">{t.party}</span>
                                <Badge variant="secondary" className={cn("text-[10px] px-1.5 py-0 uppercase h-4 tracking-wider", tone)}>
                                  {label}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {isOpening ? "Before recorded movements" : formatDate(t.date)}
                              </p>
                            </div>
                            <Badge variant="outline" className="font-mono text-xs text-[#3F63AD] border-[#3F63AD]/20 bg-[#3F63AD]/5 shrink-0">{t.refNo}</Badge>
                          </div>
                          <div className="flex justify-between items-center bg-slate-50 p-2 rounded text-sm gap-2 flex-wrap">
                            <span className="text-slate-600">
                              {t.qtyIn > 0 ? (
                                <>In: <span className="font-bold text-emerald-700">+{t.qtyIn}</span></>
                              ) : (
                                <>Out: <span className="font-bold text-[#3F63AD]">−{t.qtyOut}</span></>
                              )}
                            </span>
                            <span className="text-slate-600">Rate: <span className="font-bold text-foreground">{formatCurrency(t.rate)}</span></span>
                            {/* Stock after this movement — lets you trace how the
                                current on-hand figure was arrived at, line by line. */}
                            <span className="text-slate-600">
                              Balance: <span className="font-black text-slate-900 font-mono">{t.balance}</span>
                            </span>
                            <span className={cn("font-bold", isPurchase || isOpening ? "text-emerald-700" : isSale ? "text-[#3F63AD]" : "text-amber-700")}>
                              {formatCurrency(t.amount)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white px-5 py-3 flex justify-end border-t">
            <Button onClick={() => setViewingItem(null)} className="px-6 bg-slate-800 hover:bg-slate-700 text-white font-semibold shadow-sm">
              Close Window
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <BulkIncentiveModal
        open={bulkIncentiveOpen}
        onOpenChange={setBulkIncentiveOpen}
        categories={categories}
        brands={brands}
      />

      <ProductReferenceImportModal
        open={productReferenceOpen}
        onOpenChange={setProductReferenceOpen}
      />

      <VspSheetImportModal
        open={vspImportOpen}
        onOpenChange={setVspImportOpen}
        onApplied={() => queryClient.invalidateQueries({ queryKey: ["items"] })}
      />
    </PageShell>
  );
}

export default function ItemsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs font-bold text-slate-500">Loading Value Plus Master Stock...</div>}>
      <ItemsPageContent />
    </Suspense>
  );
}
