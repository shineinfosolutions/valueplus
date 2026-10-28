"use client";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Plus, Warehouse, MapPin, Phone, X, Package, ShoppingBag, Store, Building2, ArrowRight, Edit } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDIA_STATES, INDIA_STATES_AND_DISTRICTS } from "@/lib/data/locations";
import { MetricCardsShimmer, Skeleton } from "@/components/shared/shimmer-skeleton";
import { useRouter } from "next/navigation";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function WarehousesPage() {
  const router = useRouter();
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    type: "showroom" as "showroom" | "godown",
    address: "",
    city: "Gorakhpur",
    state: "Uttar Pradesh",
    pincode: "273008",
    contact: "",
    phone: "",
  });

  const EMPTY_FORM = {
    name: "",
    code: "",
    type: "showroom" as "showroom" | "godown",
    address: "",
    city: "Gorakhpur",
    state: "Uttar Pradesh",
    pincode: "273008",
    contact: "",
    phone: "",
  };

  const openAddForm = () => {
    setEditingWarehouse(null);
    setFormData(EMPTY_FORM);
    setIsFormOpen(true);
  };

  const openEditForm = (wh: any) => {
    setEditingWarehouse(wh);
    setFormData({
      name: wh.name || "",
      code: wh.code || "",
      type: wh.type === "godown" ? "godown" : "showroom",
      address: wh.address || "",
      city: wh.city || "Gorakhpur",
      state: wh.state || "Uttar Pradesh",
      pincode: wh.pincode || "273008",
      contact: wh.contactPerson || wh.contact || "",
      phone: (wh.phone || "").replace(/^\+91\s?/, ""),
    });
    setIsFormOpen(true);
  };

  const fetchWarehouses = async () => {
    try {
      const res = await fetch("/api/warehouses");
      const json = await res.json();
      if (json.success) setWarehouses(json.data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWarehouses();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete location "${name}"?`)) return;
    try {
      const res = await fetch(`/api/warehouses?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || "Location deleted successfully");
        fetchWarehouses();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("erp-warehouses-updated"));
        }
      } else {
        toast.error(json.error || "Failed to delete location");
      }
    } catch (error) {
      toast.error("An error occurred while deleting");
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.phone) {
      toast.error("Please fill Warehouse Name and Phone");
      return;
    }

    const payload = {
      code: formData.code || `WH-${formData.city.substring(0, 3).toUpperCase()}`,
      name: formData.name,
      type: formData.type,
      address: formData.address || "Gorakhpur, Uttar Pradesh",
      city: formData.city,
      state: formData.state,
      pincode: formData.pincode || "273001",
      contactPerson: formData.contact || "Store Manager",
      phone: formData.phone.startsWith("+91") ? formData.phone : `+91 ${formData.phone}`,
      email: formData.name.replace(/\s+/g, '').toLowerCase() + "@valueplus.com",
      status: "active",
      isDefault: editingWarehouse?.isDefault || false,
    };

    try {
      const res = editingWarehouse
        ? await fetch(`/api/warehouses?id=${editingWarehouse._id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/warehouses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (json.success) {
        toast.success(editingWarehouse ? `"${json.data.name}" updated successfully!` : `Warehouse "${json.data.name}" added successfully!`);
        setIsFormOpen(false);
        setEditingWarehouse(null);
        fetchWarehouses();
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("erp-warehouses-updated"));
        }
      } else {
        toast.error(json.error || "Failed to save warehouse");
      }
    } catch (error) {
      toast.error("An error occurred");
    }
  };

  return (
    <PageShell 
      title="Warehouses & Showroom Outlets" 
      subtitle={`${warehouses.length} registered locations (Showrooms & Central Godowns)`} 
      breadcrumbs={[{ label: "Masters" }, { label: "Warehouses" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Warehouses & Showroom Outlets"
            subtitle={`${warehouses.length} registered locations (Showrooms & Central Godowns)`}
            data={warehouses.map((wh: any) => {
              const isGodown = wh.type ? wh.type === "godown" : wh.name?.toLowerCase().includes("godown") || wh.name?.toLowerCase().includes("warehouse") || wh.name?.toLowerCase().includes("gida") || wh.name?.toLowerCase().includes("logistics");
              return {
                Code: wh.code,
                Name: wh.name,
                Type: isGodown ? "Central Godown & Hub" : "Showroom Outlet",
                Address: wh.address,
                City: wh.city,
                State: wh.state,
                Pincode: wh.pincode,
                "Contact Person": wh.contactPerson || wh.contact || "",
                Phone: wh.phone,
                Primary: wh.isDefault ? "Yes" : "No",
              };
            })}
            filename="warehouses"
          />
          <Button variant="outline" size="sm" onClick={() => router.push("/purchase/entries?action=create")}>
            <ShoppingBag className="w-4 h-4 mr-1.5 text-[#3F63AD]" /> Inward Purchase Entry
          </Button>
          <Button size="sm" onClick={openAddForm}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Location / Godown
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="w-11 h-11 rounded-2xl" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))
        ) : warehouses.map(wh => {
          const isGodown = wh.type ? wh.type === "godown" : wh.name?.toLowerCase().includes("godown") || wh.name?.toLowerCase().includes("warehouse") || wh.name?.toLowerCase().includes("gida") || wh.name?.toLowerCase().includes("logistics");
          return (
            <div key={wh._id || wh.id} className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${isGodown ? 'bg-purple-100/70 text-purple-700' : 'bg-blue-100/70 text-[#3F63AD]'}`}>
                    {isGodown ? <Building2 className="w-6 h-6" /> : <Store className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-base leading-snug">{wh.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{wh.code}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isGodown ? 'bg-purple-50 text-purple-800 border border-purple-200' : 'bg-blue-50 text-blue-800 border border-blue-200'}`}>
                        {isGodown ? "Central Godown & Hub" : "Showroom Outlet"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {wh.isDefault && <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] font-bold">Primary</Badge>}
                  <Badge variant="success" className="text-[10px]">Active</Badge>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-600 bg-slate-50/70 p-3 rounded-xl border border-slate-100">
                <div className="flex items-start gap-2">
                  <MapPin className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                  <span>{wh.address}, {wh.city}, {wh.state} - {wh.pincode}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                  <span>{wh.contactPerson || wh.contact || "Store Head"} · <a href={`tel:${wh.phone}`} className="text-blue-600 hover:underline font-bold">{wh.phone}</a></span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50"
                    onClick={() => router.push("/masters/items")}
                  >
                    <Package className="w-3.5 h-3.5 mr-1 text-[#3F63AD]" /> View Stock Items
                  </Button>
                  <Button 
                    size="sm" 
                    className="h-8 text-xs font-bold bg-[#3F63AD] hover:bg-[#325191] text-white"
                    onClick={() => router.push("/purchase/entries?action=create")}
                  >
                    <ShoppingBag className="w-3.5 h-3.5 mr-1 text-white" /> Inward Stock
                  </Button>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-slate-600 hover:bg-slate-100"
                    onClick={() => openEditForm(wh)}
                  >
                    <Edit className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  {!wh.isDefault && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                      onClick={() => handleDelete(wh._id || wh.id, wh.name)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={isFormOpen} onOpenChange={(o) => { setIsFormOpen(o); if (!o) setEditingWarehouse(null); }}>
        <DialogContent className="max-w-2xl p-0 rounded-2xl border-none shadow-2xl overflow-y-auto">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#1B2537] via-[#2C3E5A] to-[#1B2537] text-white p-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20">
                <Warehouse className="w-6 h-6 text-[#76C043]" />
              </div>
              <div>
                <h3 className="text-xl font-bold tracking-tight">{editingWarehouse ? "Edit Warehouse / Store Outlet" : "Add Warehouse / Store Outlet"}</h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  {editingWarehouse ? "Update this location's details, including whether it's a showroom or a godown." : "Register new store showroom location or regional distribution hub"}
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4 bg-slate-50/50">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label className="text-xs font-semibold text-slate-700">Store / Warehouse Name *</Label>
                  <Input
                    placeholder="e.g. Prayagraj Showroom & Hub"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Store Code</Label>
                  <Input
                    placeholder="WH-PRY"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="bg-slate-50 border-slate-300 font-mono"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-3">
                  <Label className="text-xs font-semibold text-slate-700">Location Type *</Label>
                  <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v as "showroom" | "godown" })}>
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="showroom">Showroom — sells to walk-in customers</SelectItem>
                      <SelectItem value="godown">Godown — storage / distribution, no retail counter</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-500">
                    This decides which stock bucket this location's inventory rolls up into everywhere in the app.
                  </p>
                </div>

                <div className="space-y-1.5 md:col-span-3">
                  <Label className="text-xs font-semibold text-slate-700">Full Address Location</Label>
                  <Input
                    placeholder="18, Civil Lines, Near Subhash Chauraha"
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">State</Label>
                  <Select 
                    value={formData.state} 
                    onValueChange={(v) => setFormData({ ...formData, state: v, city: "" })}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue placeholder="Select State" />
                    </SelectTrigger>
                    <SelectContent>
                      {(INDIA_STATES.includes(formData.state) ? INDIA_STATES : [...INDIA_STATES, formData.state].filter(Boolean)).map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">District / City</Label>
                  <Select 
                    value={formData.city} 
                    onValueChange={(v) => setFormData({ ...formData, city: v })}
                    disabled={!formData.state}
                  >
                    <SelectTrigger className="bg-slate-50 border-slate-300">
                      <SelectValue placeholder="Select District" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const available = INDIA_STATES_AND_DISTRICTS[formData.state] || [];
                        const options = available.includes(formData.city) ? available : [...available, formData.city].filter(Boolean);
                        return options.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>);
                      })()}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Pincode</Label>
                  <Input
                    value={formData.pincode}
                    onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">Store Manager Name</Label>
                  <Input
                    placeholder="Ravi Kumar"
                    value={formData.contact}
                    onChange={(e) => setFormData({ ...formData, contact: e.target.value })}
                    className="bg-slate-50 border-slate-300"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-3">
                  <Label className="text-xs font-semibold text-slate-700">Store Contact Phone *</Label>
                  <div className="flex items-center">
                    <span className="flex items-center justify-center bg-slate-100 border border-r-0 border-slate-300 rounded-l-md h-9 px-3 text-sm font-medium text-slate-600">+91</span>
                    <Input
                      placeholder="9876543210"
                      value={formData.phone}
                      maxLength={10}
                      onKeyDown={(e) => ["-", "+", "e", "E", "."].includes(e.key) && e.preventDefault()}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                      className="bg-slate-50 border-slate-300 font-mono rounded-l-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-100 px-6 py-4 rounded-b-2xl border-t border-slate-200 flex items-center justify-end gap-3">
            <Button variant="outline" onClick={() => { setIsFormOpen(false); setEditingWarehouse(null); }} className="px-5">
              Cancel
            </Button>
            <Button onClick={handleSave} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white px-6 font-bold shadow-lg shadow-[#3F63AD]/20">
              {editingWarehouse ? "Save Changes" : "Save & Create Warehouse"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}


