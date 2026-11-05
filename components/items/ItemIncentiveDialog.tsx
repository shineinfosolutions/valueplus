"use client";

import { useEffect, useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { IncentiveRulesEditor, type EditableRule } from "@/components/items/IncentiveRulesEditor";
import { rulesOf } from "@/lib/incentive-rules";

/** Quick editor for one product's incentive rules, opened from the Items list (Admin, Store Manager, Cashier). */
export function ItemIncentiveDialog({
  item,
  onOpenChange,
  onSaved,
}: {
  item: any | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}) {
  const [rules, setRules] = useState<EditableRule[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (item) setRules(rulesOf(item));
  }, [item]);

  const save = async () => {
    if (rules.some((r) => !(Number(r.value) > 0))) {
      toast.error("Every rule needs a value above 0 — fill it in or remove the rule.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/items/incentive-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item._id, rules }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save");
      toast.success(rules.length > 0 ? `Incentive saved for ${item.name}` : `Incentive removed from ${item.name}`);
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-emerald-600" /> Salesman incentive
          </DialogTitle>
          <DialogDescription>
            {item?.name} · selling price ₹{Number(item?.sellingPrice || 0).toLocaleString("en-IN")}. Add as many ₹ and % rules as
            you like; every running rule adds up.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <IncentiveRulesEditor
            rules={rules}
            onChange={setRules}
            sellingPrice={Number(item.sellingPrice) || 0}
            gstRate={Number(item.gstRate) || 18}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving} className="bg-[#3F63AD] hover:bg-[#30539C]">
            {saving && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />} Save incentive
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
