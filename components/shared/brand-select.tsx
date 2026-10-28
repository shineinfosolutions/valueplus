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
import { Plus, Award } from "lucide-react";
import { toast } from "sonner";

/**
 * A brand picker that can create the brand it doesn't find.
 *
 * Every product form used to offer only a closed dropdown of existing brands —
 * adding one for a genuinely new manufacturer meant abandoning the product you
 * were filling in, going to Masters > Brands, adding it there, and coming back
 * to start over. This keeps the admin on the same form: picking "Add New Brand"
 * opens a two-field dialog, saves straight to the same Brand collection
 * Masters > Brands uses, and selects the new brand in place without losing
 * anything else already typed into the surrounding form.
 */

const ADD_NEW_VALUE = "__add_new_brand__";

export function BrandSelect({
  value,
  onValueChange,
  className,
  placeholder = "Select brand...",
}: {
  value: string;
  onValueChange: (name: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const { data: brands = [] } = useQuery({
    queryKey: ["brands"],
    queryFn: async () => {
      const res = await fetch("/api/brands");
      const json = await res.json();
      return json.success ? json.data : [];
    },
  });

  const createBrand = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, status: "active" }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not add the brand");
      return json.data;
    },
    onSuccess: (brand) => {
      toast.success(`Brand "${brand.name}" added`);
      // Masters > Brands reads the same ["brands"] key, so this also refreshes
      // that page (and any other open tab, via the app-wide mutation listener).
      queryClient.invalidateQueries({ queryKey: ["brands"] });
      onValueChange(brand.name);
      setDialogOpen(false);
      setNewName("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  // The sentinel value never reaches the caller's state — it only opens the
  // dialog — so the trigger never visibly flashes "__add_new_brand__" before
  // the dialog appears.
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
      toast.error("Enter a brand name");
      return;
    }
    if (brands.some((b: any) => b.name?.toLowerCase().trim() === trimmed.toLowerCase())) {
      toast.error("That brand already exists — pick it from the list instead");
      return;
    }
    createBrand.mutate(trimmed);
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
              <Plus className="w-3.5 h-3.5" /> Add New Brand
            </span>
          </SelectItem>
          {/* An older item's brand that was typed free-text, or has since been
              removed from the master list, still needs to stay selectable so
              editing that item doesn't silently blank the field. */}
          {value && !brands.some((b: any) => b.name?.toLowerCase().trim() === value.toLowerCase().trim()) && (
            <SelectItem value={value}>{value}</SelectItem>
          )}
          {brands.map((b: any) => (
            <SelectItem key={b._id || b.id || b.name} value={b.name}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Award className="w-4 h-4 text-[#3F63AD]" /> Add New Brand
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label className="text-xs font-semibold text-slate-700">Brand Name *</Label>
            <Input
              autoFocus
              placeholder="e.g. Godrej"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createBrand.isPending}>
              {createBrand.isPending ? "Adding…" : "Add & Select"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
