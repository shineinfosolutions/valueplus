"use client";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Plus, Tag, Search, Trash2, Edit } from "lucide-react";
import { useState, useMemo } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AutocompleteSearch } from "@/components/shared/autocomplete-search";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<any | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "", status: "active" });

  const { data: categories = [], isLoading: loading, isError } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to fetch categories");
      return json.data;
    },
    retry: 2,
  });

  const filtered = useMemo(() => {
    if (!Array.isArray(categories)) return [];
    return categories.filter((c: any) =>
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(search.toLowerCase()))
    );
  }, [categories, search]);

  const openAdd = () => {
    setEditingCategory(null);
    setFormData({ name: "", description: "", status: "active" });
    setIsFormOpen(true);
  };

  const openEdit = (cat: any) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, description: cat.description || "", status: cat.status });
    setIsFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (payload: any) => {
      const isEditing = !!editingCategory;
      const method = isEditing ? "PUT" : "POST";
      const url = isEditing
        ? `/api/categories?id=${editingCategory._id || editingCategory.id}`
        : "/api/categories";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to save category");
      return json.data;
    },
    onSuccess: () => {
      toast.success(editingCategory
        ? "Category updated successfully"
        : `Category "${formData.name}" added successfully`
      );
      setIsFormOpen(false);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/categories?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Failed to delete category");
      return json;
    },
    onSuccess: () => {
      toast.success("Category deleted");
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setIsDeleteOpen(false);
      setDeletingId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "An error occurred");
      setIsDeleteOpen(false);
      setDeletingId(null);
    },
  });

  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const confirmDelete = (id: string) => {
    setDeletingId(id);
    setIsDeleteOpen(true);
  };

  const safeCategories = Array.isArray(categories) ? categories : [];

  return (
    <PageShell
      title="Categories"
      subtitle="Organize your mobile & electronics items"
      breadcrumbs={[{ label: "Masters", href: "/masters/items" }, { label: "Categories" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Categories"
            subtitle={`${filtered.length} categories`}
            data={(filtered as any[]).map((cat) => ({
              Name: cat.name || "",
              Description: cat.description || "",
              Items: cat.items || 0,
              Status: cat.status === "active" ? "Active" : "Inactive",
            }))}
            filename="categories"
          />
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Category
          </Button>
        </div>
      }
    >
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Categories", value: safeCategories.length },
          { label: "Active", value: safeCategories.filter((c: any) => c.status === "active").length },
          { label: "Total Items", value: safeCategories.reduce((a: number, c: any) => a + (c.items || 0), 0) },
          { label: "Inactive", value: safeCategories.filter((c: any) => c.status === "inactive").length },
        ].map((s) => (
          <div key={s.label} className="metric-card">
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="data-table-container">
        <div className="flex items-center justify-between p-4 border-b">
          <AutocompleteSearch
            data={categories}
            searchKeys={["name", "description"]}
            displayKey="name"
            placeholder="Search categories..."
            value={search}
            onSearchChange={(val) => setSearch(val)}
            className="flex-1 max-w-sm"
          />
          <span className="text-sm font-semibold text-muted-foreground">{filtered.length} Categories</span>
        </div>

        <div className="divide-y">
          {loading ? (
            <TableShimmer rows={5} cols={4} />
          ) : isError ? (
            <div className="p-8 text-center text-red-500">
              Failed to load categories. Please refresh.
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              {search ? "No categories match your search." : "No categories found. Click \"Add Category\" to create one."}
            </div>
          ) : (
            filtered.map((cat: any) => (
              <div
                key={cat._id || cat.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-slate-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-xl bg-[#3F63AD]/10 flex items-center justify-center flex-shrink-0">
                  <Tag className="w-5 h-5 text-[#3F63AD]" />
                </div>
                <div className="flex-1 min-w-[140px]">
                  <p className="font-semibold text-foreground">{cat.name}</p>
                  <p className="text-xs text-muted-foreground">{cat.description}</p>
                </div>
                <div className="text-sm text-muted-foreground font-medium">{cat.items || 0} items</div>
                <Badge variant={cat.status === "active" ? "success" : "secondary"}>
                  {cat.status === "active" ? "Active" : "Inactive"}
                </Badge>
                <div className="flex gap-1 ml-auto">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(cat)}>
                    <Edit className="w-4 h-4 mr-1" /> Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-600 hover:bg-red-50"
                    onClick={() => confirmDelete(cat._id || cat.id)}
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          <DialogHeader className="sr-only">
            <DialogTitle>
              {editingCategory ? "Edit Product Category" : "Add Product Category"}
            </DialogTitle>
          </DialogHeader>
          {/* Visual Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
              <Tag className="w-6 h-6 text-[#76C043]" />
            </div>
            <div>
              <h3 className="text-xl font-bold tracking-tight">
                {editingCategory ? "Edit Product Category" : "Add Product Category"}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Organize your mobile &amp; electronics stock items into categories
              </p>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Category Name *</Label>
                  <Input
                    placeholder="e.g. Smartwatches & Wearables"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Description</Label>
                  <Input
                    placeholder="Brief description of products in this category"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(v) => setFormData({ ...formData, status: v })}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => setIsFormOpen(false)} className="px-5">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending}
              className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20"
            >
              {saveMutation.isPending
                ? "Saving..."
                : editingCategory ? "Save Changes" : "Create Category"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this category? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deletingId && deleteMutation.mutate(deletingId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
