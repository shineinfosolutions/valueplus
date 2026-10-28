"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ChevronRight, Search, Package, Tag, Award,
  ArrowLeft, TrendingUp, Box, ShoppingCart, Eye, CheckCircle2, AlertTriangle, Layers
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { TableShimmer, GridCardsShimmer } from "@/components/shared/shimmer-skeleton";
import { BrandLogo, getBrandMeta } from "@/components/shared/brand-logo";
import { InvoiceCreationModal } from "@/components/InvoiceCreationModal";
import Link from "next/link";

export default function BrandsPage() {
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [stockFilter, setStockFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [isBillingModalOpen, setIsBillingModalOpen] = useState(false);

  // ── Fetch all brands ────────────────────────────────────────────
  const { data: brands = [], isLoading: loadingBrands } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
  });

  // ── Fetch items for selected brand ──────────────────────────────
  const { data: brandItems = [], isLoading: loadingBrandItems } = useQuery({
    queryKey: ["items", "brand", selectedBrand],
    queryFn: async () => {
      if (!selectedBrand) return [];
      const res = await fetch(`/api/items?brand=${encodeURIComponent(selectedBrand)}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    enabled: !!selectedBrand,
  });

  // ── Compute categories for selected brand ───────────────────────
  const brandCategories = useMemo(() => {
    if (!Array.isArray(brandItems) || !brandItems.length) return [];
    const catMap: Record<string, number> = {};
    brandItems.forEach((item: any) => {
      const cat = item.category || "Uncategorized";
      catMap[cat] = (catMap[cat] || 0) + 1;
    });
    return Object.entries(catMap).map(([name, count]) => ({
      name,
      count,
    })).sort((a, b) => b.count - a.count);
  }, [brandItems]);

  // ── Filtered Brands (Level 1) ───────────────────────────────────
  const filteredBrands = useMemo(() => {
    const list = Array.isArray(brands) ? [...brands] : [];
    const sorted = list.sort((a: any, b: any) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
    );
    if (!search) return sorted;
    return sorted.filter((b: any) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      (b.description && b.description.toLowerCase().includes(search.toLowerCase()))
    );
  }, [brands, search]);

  // ── Filtered Brand Items (Level 2) ──────────────────────────────
  const filteredBrandProducts = useMemo(() => {
    if (!Array.isArray(brandItems)) return [];
    return brandItems.filter((item: any) => {
      // Category filter
      if (selectedCategory !== "all" && item.category !== selectedCategory) return false;
      
      // Stock filter
      if (stockFilter === "in_stock" && (item.currentStock || 0) <= 0) return false;
      if (stockFilter === "low_stock" && ((item.currentStock || 0) > (item.reorderLevel || 3) || (item.currentStock || 0) <= 0)) return false;
      if (stockFilter === "out_of_stock" && (item.currentStock || 0) > 0) return false;

      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = (item.name || "").toLowerCase().includes(q);
        const codeMatch = (item.code || "").toLowerCase().includes(q);
        const vpCodeMatch = (item.vpCode || "").toLowerCase().includes(q);
        const catMatch = (item.category || "").toLowerCase().includes(q);
        const modelMatch = (item.modelNumber || "").toLowerCase().includes(q);
        if (!nameMatch && !codeMatch && !vpCodeMatch && !catMatch && !modelMatch) return false;
      }

      return true;
    });
  }, [brandItems, selectedCategory, stockFilter, search]);

  // ── Navigation Handlers ─────────────────────────────────────────
  const handleBrandClick = (brandName: string) => {
    setSelectedBrand(brandName);
    setSelectedCategory("all");
    setStockFilter("all");
    setSearch("");
  };

  const handleBackToBrands = () => {
    setSelectedBrand(null);
    setSelectedCategory("all");
    setStockFilter("all");
    setSearch("");
  };

  // ── Stats Calculations ──────────────────────────────────────────
  const brandStats = useMemo(() => {
    if (!Array.isArray(brandItems) || !brandItems.length) {
      return { total: 0, inStock: 0, stockUnits: 0, avgPrice: 0 };
    }
    const total = brandItems.length;
    const inStock = brandItems.filter((i: any) => (i.currentStock || 0) > 0).length;
    const stockUnits = brandItems.reduce((acc: number, i: any) => acc + (i.currentStock || 0), 0);
    const totalPrice = brandItems.reduce((acc: number, i: any) => acc + (i.sellingPrice || 0), 0);
    const avgPrice = Math.round(totalPrice / total);
    return { total, inStock, stockUnits, avgPrice };
  }, [brandItems]);

  // ── Breadcrumbs ─────────────────────────────────────────────────
  const breadcrumbs = [
    { label: "Masters", href: "/masters/items" },
    { label: "Brands", href: "/masters/brands" },
    ...(selectedBrand ? [{ label: selectedBrand }] : []),
  ];

  return (
    <PageShell
      title={selectedBrand ? `${selectedBrand} Products Catalog` : "Showroom Brands Master"}
      subtitle={
        selectedBrand
          ? `Browsing ${filteredBrandProducts.length} authorized ${selectedBrand} products in showroom inventory`
          : "Explore authorized showroom brands, view product catalogs, live stock & pricing"
      }
      breadcrumbs={breadcrumbs}
      actions={
        selectedBrand ? (
          <div className="flex items-center gap-2">
            <ExportMenu
              title={`${selectedBrand} Products`}
              subtitle={`${filteredBrandProducts.length} products in ${selectedBrand} catalog`}
              data={(filteredBrandProducts as any[]).map((item) => ({
                "Product Name": item.name || "",
                "VP Code": item.vpCode || item.code || "",
                SKU: item.code || "",
                Category: item.category || "",
                HSN: item.hsnCode || item.hsn || "",
                "GST %": item.gstRate || 18,
                "Purchase Rate": item.purchasePrice || 0,
                "Showroom Price": item.sellingPrice || 0,
                MRP: item.mrp || 0,
                "Live Stock": item.currentStock || 0,
                Unit: item.unit || "Pcs",
              }))}
              filename="brand-products"
            />
            <Button
              size="sm"
              onClick={() => setIsBillingModalOpen(true)}
              className="gap-2 bg-[#30539C] hover:bg-[#25427d] text-white font-semibold shadow-sm"
            >
              <ShoppingCart className="w-4 h-4" /> Create Bill / Invoice
            </Button>
            <Button variant="outline" size="sm" onClick={handleBackToBrands} className="gap-2 font-semibold">
              <ArrowLeft className="w-4 h-4" />
              Back to All Brands
            </Button>
          </div>
        ) : (
          <ExportMenu
            title="Showroom Brands"
            subtitle={`${filteredBrands.length} partner brands`}
            data={(filteredBrands as any[]).map((brand) => ({
              "Brand Name": brand.name || "",
              Description: brand.description || "",
              Products: brand.items || 0,
              Status: brand.status || "active",
            }))}
            filename="brands"
          />
        )
      }
    >
      {/* ════════════════════════════════════════════════════════════ */}
      {/* LEVEL 1: ALL BRANDS DIRECTORY                                */}
      {/* ════════════════════════════════════════════════════════════ */}
      {!selectedBrand && (
        <div className="space-y-5">
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: "Partner Brands", value: brands.length, icon: Award, sub: "Authorized Electronics" },
              { label: "Active Brands", value: brands.filter((b: any) => b.status === "active").length, icon: TrendingUp, sub: "Live In Catalog" },
              { label: "Total SKUs", value: brands.reduce((a: number, b: any) => a + (b.items || 0), 0), icon: Package, sub: "Gorakhpur Showroom" },
              { label: "Categories", value: 9, icon: Tag, sub: "Product Segments" },
            ].map((s) => (
              <div key={s.label} className="metric-card bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{s.label}</span>
                  <s.icon className="w-4 h-4 text-[#30539C]" />
                </div>
                <p className="text-2xl font-black text-slate-900 mt-1">{s.value}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* Search bar */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search partner brands (e.g., Samsung, Daikin, LG)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10 text-sm bg-white"
            />
          </div>

          {/* Brands Grid */}
          {loadingBrands ? (
            <GridCardsShimmer count={8} />
          ) : filteredBrands.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
              <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="font-semibold text-sm">No brands found matching "{search}"</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredBrands.map((brand: any) => {
                const { color } = getBrandMeta(brand.name);
                return (
                  <button
                    key={brand._id || brand.id || brand.name}
                    onClick={() => handleBrandClick(brand.name)}
                    className="metric-card bg-white p-4 rounded-xl border border-slate-200 text-left group hover:border-[#30539C] hover:shadow-md transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#30539C]"
                  >
                    <div className="flex items-start gap-3.5 mb-3.5">
                      <BrandLogo name={brand.name} size="md" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 text-base leading-tight truncate group-hover:text-[#30539C] transition-colors">
                          {brand.name}
                        </p>
                        <Badge variant={brand.status === "active" ? "success" : "secondary"} className="mt-1 text-[10px] px-1.5 py-0">
                          {brand.status || "active"}
                        </Badge>
                      </div>
                    </div>
                    
                    <p className="text-xs text-slate-500 line-clamp-2 mb-3.5 leading-relaxed">
                      {brand.description || `Explore authorized ${brand.name} electronics & appliances`}
                    </p>

                    <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-xs text-slate-600 font-semibold">
                        <Package className="w-3.5 h-3.5 text-[#30539C]" />
                        <span>{brand.items || 0} Products</span>
                      </div>
                      <span className={cn("text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 group-hover:gap-1.5 transition-all", color.bg, color.text)}>
                        Open Catalog <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* LEVEL 2: DIRECT BRAND PRODUCTS CATALOG                        */}
      {/* ════════════════════════════════════════════════════════════ */}
      {selectedBrand && (
        <div className="space-y-4">
          {/* Brand Header Banner */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <BrandLogo name={selectedBrand} size="xl" className="shadow-md" />
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">{selectedBrand}</h2>
                  <Badge variant="success" className="text-xs">Authorized Partner</Badge>
                </div>
                <p className="text-xs text-slate-500 font-medium mt-1">
                  M/S Ashoka Enterprises · Gorakhpur Showroom Official Catalog
                </p>
              </div>
            </div>

            {/* Quick Metrics Bar */}
            <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
              <div className="bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-100 text-center min-w-[90px]">
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Total SKUs</p>
                <p className="text-base font-black text-slate-900">{brandStats.total}</p>
              </div>
              <div className="bg-emerald-50 px-3.5 py-2 rounded-xl border border-emerald-100 text-center min-w-[90px]">
                <p className="text-[10px] font-semibold text-emerald-700 uppercase">In Stock</p>
                <p className="text-base font-black text-emerald-800">{brandStats.inStock}</p>
              </div>
              <div className="bg-blue-50 px-3.5 py-2 rounded-xl border border-blue-100 text-center min-w-[90px]">
                <p className="text-[10px] font-semibold text-[#30539C] uppercase">Units Available</p>
                <p className="text-base font-black text-[#30539C]">{brandStats.stockUnits} Pcs</p>
              </div>
              <div className="bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-100 text-center min-w-[100px]">
                <p className="text-[10px] font-semibold text-slate-400 uppercase">Avg Selling Price</p>
                <p className="text-base font-black text-slate-900">{formatCurrency(brandStats.avgPrice)}</p>
              </div>
            </div>
          </div>

          {/* Category Filter Tabs */}
          {brandCategories.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                onClick={() => setSelectedCategory("all")}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5",
                  selectedCategory === "all"
                    ? "bg-[#30539C] text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                All Products ({brandStats.total})
              </button>
              {brandCategories.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setSelectedCategory(c.name)}
                  className={cn(
                    "px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5",
                    selectedCategory === c.name
                      ? "bg-[#30539C] text-white shadow-sm"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                  )}
                >
                  <Tag className="w-3.5 h-3.5" />
                  {c.name} ({c.count})
                </button>
              ))}
            </div>
          )}

          {/* Search & Stock Filter Toolbar */}
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder={`Search ${selectedBrand} models, VP Code, name...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-slate-50 border-slate-200"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <button
                onClick={() => setStockFilter("all")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                  stockFilter === "all" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                )}
              >
                All Status
              </button>
              <button
                onClick={() => setStockFilter("in_stock")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                  stockFilter === "in_stock" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                )}
              >
                <CheckCircle2 className="w-3 h-3" /> In Stock
              </button>
              <button
                onClick={() => setStockFilter("low_stock")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                  stockFilter === "low_stock" ? "bg-amber-600 text-white" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                )}
              >
                <AlertTriangle className="w-3 h-3" /> Low Stock
              </button>

              {(search || selectedCategory !== "all" || stockFilter !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setSelectedCategory("all");
                    setStockFilter("all");
                  }}
                  className="h-8 text-xs text-slate-500 hover:text-red-600 ml-auto"
                >
                  Reset
                </Button>
              )}
            </div>
          </div>

          {/* Products Table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loadingBrandItems ? (
              <div className="p-6">
                <TableShimmer rows={8} cols={7} />
              </div>
            ) : filteredBrandProducts.length === 0 ? (
              <div className="p-12 text-center text-slate-500">
                <Package className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-bold text-sm text-slate-800">No products found</p>
                <p className="text-xs text-slate-500 mt-1">
                  Try clearing your search query or selecting "All Products" above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 font-semibold text-[11px] uppercase border-b border-slate-200 tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Product Name & Code</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">HSN & Tax</th>
                      <th className="px-3 py-3 text-right">Purchase Rate</th>
                      <th className="px-3 py-3 text-right">Showroom Price</th>
                      <th className="px-3 py-3 text-right">MRP</th>
                      <th className="px-3 py-3 text-center">Live Stock</th>
                      <th className="px-3 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredBrandProducts.map((item: any) => {
                      const isLow = (item.currentStock || 0) <= (item.reorderLevel || 3) && (item.currentStock || 0) > 0;
                      const isOut = (item.currentStock || 0) === 0;

                      return (
                        <tr key={item._id || item.code} className="hover:bg-slate-50/80 transition-colors">
                          {/* 1. Product Name & Code */}
                          <td className="px-4 py-3 min-w-[280px] max-w-[380px]">
                            <div className="font-bold text-slate-900 text-xs leading-normal mb-1.5">
                              {item.name}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center font-mono font-bold text-[10px] text-[#30539C] bg-blue-50 px-2 py-0.5 rounded border border-blue-200 shadow-2xs">
                                VP: {item.vpCode || item.code}
                              </span>
                              <span className="inline-flex items-center text-[10px] text-slate-500 font-mono bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                SKU: {item.code}
                              </span>
                            </div>
                          </td>

                          {/* 2. Category */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {item.category || "General"}
                            </span>
                          </td>

                          {/* 3. HSN & GST */}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <p className="font-mono text-slate-700 font-semibold">{item.hsnCode || item.hsn || "84151010"}</p>
                            <p className="text-[10px] text-slate-400 font-medium">GST {item.gstRate || 18}%</p>
                          </td>

                          {/* 4. Purchase Rate */}
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <span className="font-semibold text-slate-600 font-mono">
                              {formatCurrency(item.purchasePrice || 0)}
                            </span>
                          </td>

                          {/* 5. Showroom Selling Price */}
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <span className="font-bold text-slate-900 text-sm font-mono text-[#30539C]">
                              {formatCurrency(item.sellingPrice || 0)}
                            </span>
                          </td>

                          {/* 6. MRP */}
                          <td className="px-3 py-3 text-right whitespace-nowrap">
                            <span className="text-slate-400 line-through text-xs font-mono">
                              {formatCurrency(item.mrp || 0)}
                            </span>
                          </td>

                          {/* 7. Current Live Stock */}
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <span
                              className={cn(
                                "px-2.5 py-1 rounded-full text-xs font-black font-mono inline-block",
                                isOut
                                  ? "bg-red-100 text-red-700 border border-red-200"
                                  : isLow
                                  ? "bg-amber-100 text-amber-800 border border-amber-200"
                                  : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              )}
                            >
                              {item.currentStock || 0} {item.unit || "Pcs"}
                            </span>
                          </td>

                          {/* 8. Action */}
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              onClick={() => setIsBillingModalOpen(true)}
                              className="h-7 text-[11px] gap-1.5 px-3 border-[#30539C]/40 text-[#30539C] hover:bg-[#30539C] hover:text-white font-semibold transition-all shadow-2xs"
                            >
                              <ShoppingCart className="w-3.5 h-3.5" /> Bill Now
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Billing / Tax Invoice Creation Modal ───────────────── */}
      <InvoiceCreationModal
        isOpen={isBillingModalOpen}
        onClose={() => setIsBillingModalOpen(false)}
        mode="invoice"
      />
    </PageShell>
  );
}
