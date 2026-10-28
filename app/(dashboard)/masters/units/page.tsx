"use client";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function UnitsPage() {
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", abbr: "", type: "count" });

  const fetchUnits = async () => {
    try {
      const res = await fetch("/api/units");
      const json = await res.json();
      if (json.success) {
        setUnits(json.data);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUnits();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this unit?")) return;
    try {
      const res = await fetch(`/api/units?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        toast.success(json.message || "Unit deleted successfully");
        fetchUnits();
      } else {
        toast.error(json.error || "Failed to delete unit");
      }
    } catch (error) {
      toast.error("An error occurred while deleting");
    }
  };

  const handleSave = async () => {
    if (!formData.name || !formData.abbr) {
      toast.error("Please fill Unit Name and Abbreviation");
      return;
    }

    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          shortName: formData.abbr.toUpperCase(),
          type: formData.type,
        })
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`Unit "${json.data.name}" added successfully!`);
        setIsFormOpen(false);
        fetchUnits();
      } else {
        toast.error(json.error || "Failed to save unit");
      }
    } catch (error) {
      console.error(error);
      toast.error("An error occurred");
    }
  };

  return (
    <PageShell title="Units of Measurement" subtitle="Manage electronics product units" breadcrumbs={[{ label: "Masters" }, { label: "Units" }]}
      actions={
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Units of Measurement"
            subtitle={`${units.length} units`}
            data={units.map((u: any) => ({
              "Unit Name": u.name,
              Abbreviation: u.shortName || u.abbr,
              Type: u.type,
              Status: u.status,
            }))}
            filename="units"
          />
          <Button size="sm" onClick={() => setIsFormOpen(true)}><Plus className="w-4 h-4 mr-1.5" /> Add Unit</Button>
        </div>
      }>
      <div className="data-table-container">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b">
            <tr>{["Unit Name","Abbreviation","Type","Status","Actions"].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <tr><td colSpan={5} className="p-0"><TableShimmer rows={5} cols={5} /></td></tr>
            ) : units.length === 0 ? (
              <tr><td colSpan={5} className="text-center p-8 text-muted-foreground">No units found</td></tr>
            ) : units.map(u => (
              <tr key={u._id || u.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 font-mono font-semibold text-[#3F63AD]">{u.shortName || u.abbr}</td>
                <td className="px-4 py-3 capitalize text-muted-foreground">{u.type}</td>
                <td className="px-4 py-3"><Badge variant={u.status === "active" ? "success" : "secondary"}>{u.status}</Badge></td>
                <td className="px-4 py-3 flex gap-2">
                  <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(u._id || u.id)}>Delete</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Unit of Measurement</DialogTitle>
            <DialogDescription>Define a unit for measuring products</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Unit Name *</Label>
              <Input placeholder="e.g. Carton" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Abbreviation *</Label>
              <Input placeholder="CTN" value={formData.abbr} onChange={(e) => setFormData({ ...formData, abbr: e.target.value })} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Add Unit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

