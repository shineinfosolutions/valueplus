"use client";

import Link from "next/link";
import { MessageCircle, ArrowRight } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Clock } from "lucide-react";
import { FollowUpDialog, LastFollowUpLine } from "@/components/shared/FollowUpDialog";
import { LeadShareChips, ShareLeadDialog } from "@/components/shared/ShareLeadDialog";

/** The lead pipeline buckets shown on the dashboards. */
export type LeadBucket = "all" | "new" | "followup" | "converted" | "lost";

export const LEAD_BUCKETS: { key: LeadBucket; label: string; emoji: string; status?: string }[] = [
  { key: "all", label: "All", emoji: "" },
  { key: "new", label: "New", emoji: "🎯", status: "New" },
  { key: "followup", label: "Follow-up", emoji: "⏳", status: "Follow-up" },
  { key: "converted", label: "Converted", emoji: "🏆", status: "Converted" },
  { key: "lost", label: "Lost", emoji: "❌", status: "Lost" },
];

/** Does a lead fall in this bucket? Follow-up also covers Contacted and Interested. */
export function inLeadBucket(lead: any, bucket: LeadBucket): boolean {
  const s = String(lead?.status || "");
  if (bucket === "new") return s === "New";
  if (bucket === "followup") return s === "Follow-up" || s === "Interested" || s === "Contacted";
  if (bucket === "converted") return s === "Converted";
  if (bucket === "lost") return s === "Lost";
  return true;
}

export const leadBucketCount = (leads: any[], bucket: LeadBucket) => leads.filter((l) => inLeadBucket(l, bucket)).length;

const inr = (n: number) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

/**
 * Pops up the full list of leads in one pipeline bucket (All / New / Follow-up / Converted / Lost), opened from the
 * dashboards' Lead Pipeline tiles and tabs. The status can be changed right here when `onStatusChange` is given.
 */
export function LeadPipelineDialog({
  bucket,
  onClose,
  leads,
  onStatusChange,
  onWhatsApp,
  onLeadUpdated,
  crmHref = "/marketing/leads",
}: {
  bucket: LeadBucket | null;
  onClose: () => void;
  /** Leads already scoped to the viewer (date / staff filters applied). */
  leads: any[];
  onStatusChange?: (leadId: string, status: string) => void;
  onWhatsApp?: (lead: any) => void;
  /** Called with the saved lead after a follow-up is recorded here, so the dashboard can refresh it. */
  onLeadUpdated?: (lead: any) => void;
  crmHref?: string;
}) {
  const [followUpLead, setFollowUpLead] = useState<any | null>(null);
  const [shareLead, setShareLead] = useState<any | null>(null);
  const meta = LEAD_BUCKETS.find((b) => b.key === bucket);
  const list = bucket ? leads.filter((l) => inLeadBucket(l, bucket)) : [];
  const value = list.reduce((s, l) => s + (Number(l.estimatedValue) || 0), 0);
  const href = meta?.status ? `${crmHref}${crmHref.includes("?") ? "&" : "?"}status=${encodeURIComponent(meta.status)}` : crmHref;

  return (
    <Dialog open={!!bucket} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>
            {meta?.emoji} {meta?.label} leads ({list.length})
          </DialogTitle>
          <DialogDescription>
            {list.length > 0 ? `Pipeline value ${inr(value)}` : "No leads here for the chosen dates and staff."}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto px-4 pb-2 space-y-1.5">
          {list.map((lead: any) => (
            <div key={lead._id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-100 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-900 truncate">{lead.customerName}</p>
                  <a href={`tel:${lead.mobile}`} className="text-[11px] text-slate-500 font-mono hover:underline">{lead.mobile}</a>
                </div>
                <p className="text-xs text-slate-600 truncate">
                  {lead.interestedProduct}
                  {Number(lead.estimatedValue) > 0 && <span className="font-bold text-slate-900"> · {inr(lead.estimatedValue)}</span>}
                </p>
                <p className="text-[11px] text-slate-400">
                  Assigned: <span className="font-semibold text-slate-600">{lead.assignedStaff || "Sales Team"}</span>
                  {lead.followUpDate ? ` · Next follow-up: ${lead.followUpDate}` : ""}
                </p>
                <LastFollowUpLine lead={lead} className="mt-0.5" />
                <LeadShareChips lead={lead} className="mt-1" />
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onStatusChange ? (
                  <select
                    value={lead.status}
                    onChange={(e) => onStatusChange(lead._id, e.target.value)}
                    className={cn(
                      "text-[11px] font-bold px-2 py-1 rounded-lg border outline-none cursor-pointer",
                      lead.status === "Converted" && "bg-emerald-50 text-emerald-800 border-emerald-200",
                      lead.status === "Follow-up" && "bg-amber-50 text-amber-800 border-amber-200",
                      lead.status === "New" && "bg-blue-50 text-blue-800 border-blue-200",
                      (lead.status === "Interested" || lead.status === "Contacted") && "bg-purple-50 text-purple-800 border-purple-200",
                      lead.status === "Lost" && "bg-rose-50 text-rose-800 border-rose-200"
                    )}
                  >
                    {["New", "Contacted", "Interested", "Follow-up", "Converted", "Lost"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[11px] font-bold px-2 py-1 rounded-lg border bg-slate-50">{lead.status}</span>
                )}
                {!["Converted", "Lost"].includes(lead.status) && !String(lead._id || "").startsWith("lead-") && (
                  <button
                    type="button"
                    onClick={() => setFollowUpLead(lead)}
                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-bold text-amber-700 border border-amber-200 bg-amber-50 hover:bg-amber-100"
                    title="Record follow-up"
                  >
                    <Clock className="w-3.5 h-3.5" /> Follow-up
                  </button>
                )}
                {!["Converted", "Lost"].includes(lead.status) && !String(lead._id || "").startsWith("lead-") && (
                  <button
                    type="button"
                    onClick={() => setShareLead(lead)}
                    className="h-7 px-2 inline-flex items-center gap-1 rounded-md text-[11px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                    title="Share with another brand's salesman"
                  >
                    🤝 Share
                  </button>
                )}
                {onWhatsApp && (
                  <button
                    type="button"
                    onClick={() => onWhatsApp(lead)}
                    className="h-7 w-7 inline-flex items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50"
                    title="WhatsApp Message"
                  >
                    <MessageCircle className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-3 border-t flex justify-end">
          <Link href={href} onClick={onClose} className="text-xs font-bold text-[#30539C] hover:underline inline-flex items-center gap-1">
            Open in CRM Leads <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </DialogContent>
      <FollowUpDialog lead={followUpLead} onClose={() => setFollowUpLead(null)} onSaved={(saved) => onLeadUpdated?.(saved)} />
      <ShareLeadDialog lead={shareLead} onClose={() => setShareLead(null)} onSaved={(saved) => onLeadUpdated?.(saved)} />
    </Dialog>
  );
}
