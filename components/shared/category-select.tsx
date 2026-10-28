"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Tag } from "lucide-react";
import { toast } from "sonner";

/**
 * A category picker that can create the category it doesn't find — same
 * shape as `BrandSelect` (components/shared/brand-select.tsx), kept as its
 * own file rather than a shared generic component since the two save to
 * different collections with slightly different payloads.
 */

const ADD_NEW_VALUE = "__add_new_category__";

export function CategorySelect({
  value,
  onValueChange,
  className,
  placeholder = "Select category...",
}: {
  value: string;
  onValueChange: (name: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const res = await fetch("/api/categories");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status: "active" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not add the category");
      return json.data;
    },
    onSuccess: (category) => {
      toast.success(`Category "${category.name}" added`);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onValueChange(category.name);
      setDialogOpen(false);
      setNewName("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSelectChange = (v: string) => {
    if (v === ADD_NEW_VALUE) {
      setNewName("");
      setDialogOpen(true);
      return;
    }
    onValueChange(v);
  };

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Enter a category name");
      return;
    }
    if (categories.some((c: any) => c.name?.toLowerCase().trim() === trimmed.toLowerCase())) {
      toast.error("That category already exists — pick it from the list instead");
      return;
    }
    createCategory.mutate(trimmed);
  };

  return (
    <>
      <Select value={value} onValueChange={handleSelectChange}>
        <SelectTrigger className={className}>
          <SelectValue placeholder={placeholder}>{value || placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ADD_NEW_VALUE} className="text-[#3F63AD] font-bold focus:text-[#3F63AD]">
            <span className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Add New Category
            </span>
          </SelectItem>
          {value && !categories.some((c: any) => c.name?.toLowerCase().trim() === value.toLowerCase().trim()) && (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {categories.map((c: any) => (
            <SelectItem key={c._id || c.id || c.name} value={c.name}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Tag className="w-4 h-4 text-[#3F63AD]" /> Add New Category
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-xs font-semibold text-slate-700">Category Name *</Label>
            <Input
              autoFocus
              placeholder="e.g. Gift & Accessories"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createCategory.isPending}>
              {createCategory.isPending ? "Adding…" : "Add & Select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
