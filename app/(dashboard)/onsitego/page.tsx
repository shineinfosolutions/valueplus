"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { FileUp, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { OnsitegoPlansTable } from "@/components/onsitego/OnsitegoPlansTable";
import { ONSITEGO_INCENTIVE_RATE, type OnsitegoPlanRow } from "@/lib/onsitego";

/**
 * Admin > Onsite Go: every plan of the Onsite Go price list (the plans the bill offers as extended warranty and the
 * salesman sees in his Incentive Plan), and the way to replace the list: upload the new price list PDF here.
 */
export default function OnsiteGoPage() {
  const { data: session } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const canUpload = ["admin", "superadmin", "manager"].includes(role);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [lastMessage, setLastMessage] = useState("");

  const { data, isLoading } = useQuery({
    // (a different key from the bill form's plan list, which holds just the rows)
    queryKey: ["onsitego-plans-info"],
    meta: { live: ["/api/documents"] },
    queryFn: async () => {
      const json = await (await fetch("/api/onsitego/plans")).json();
      return json.success
        ? { plans: json.data as OnsitegoPlanRow[], sourceFileName: String(json.sourceFileName || ""), updatedAt: json.updatedAt as string | null }
        : { plans: [] as OnsitegoPlanRow[], sourceFileName: "", updatedAt: null };
    },
  });
  const plans = data?.plans || [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      // The server reads the PDF and replaces the plans (and keeps the PDF in the On Site Go documents folder when it can).
      const form = new FormData();
      form.append("file", file);
      const json = await (await fetch("/api/onsitego/plans", { method: "POST", body: form })).json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      return String(json.message || "Price list saved.");
    },
    onSuccess: (message) => {
      setLastMessage(message);
      if (/No Onsitego plan lines|could not be read/i.test(message)) toast.warning(message, { duration: 10000 });
      else toast.success(message);
      queryClient.invalidateQueries({ queryKey: ["onsitego-plans-info"] });
      queryClient.invalidateQueries({ queryKey: ["onsitego-plans"] });
    },
    onError: (e: any) => toast.error(e.message || "Upload failed"),
  });

  const sections = new Set(plans.map((p) => p.category)).size;
  const updated = data?.updatedAt ? new Date(data.updatedAt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <PageShell
      title="Onsite Go"
      description="Onsite Go extended warranty plans. The bill offers only these plans, and the salesman earns 10% of every plan he sells."
      icon={ShieldCheck}
      actions={
        canUpload ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) upload.mutate(f);
              }}
            />
            <Button size="sm" disabled={upload.isPending} onClick={() => fileRef.current?.click()} className="bg-[#30539C] hover:bg-[#203E78] text-white">
              <FileUp className="w-4 h-4 mr-1.5" /> {upload.isPending ? "Reading the PDF..." : plans.length ? "Upload new price list (PDF)" : "Upload price list (PDF)"}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4 pb-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: "Plans", value: String(plans.length) },
            { label: "Sections", value: String(sections) },
            { label: "Salesman earns", value: `${Math.round(ONSITEGO_INCENTIVE_RATE * 100)}% of the plan price` },
            { label: "Price list", value: data?.sourceFileName || "None uploaded", small: true },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-xs min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{c.label}</p>
              <p className={`font-black text-slate-900 mt-1 ${c.small ? "text-xs break-all" : "text-lg"}`}>{c.value}</p>
              {c.label === "Price list" && updated && <p className="text-[10px] text-slate-400">Updated {updated}</p>}
            </div>
          ))}
        </div>

        {lastMessage && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900">{lastMessage}</p>
        )}
        {canUpload && plans.length > 0 && (
          <p className="text-[11px] text-slate-500">Uploading another price list PDF replaces all the plans below, here, on the bill and in every salesman&apos;s Incentive Plan.</p>
        )}

        {isLoading ? (
          <div className="h-40 rounded-xl bg-slate-100 animate-pulse" />
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600 space-y-2">
            <p className="font-bold text-slate-800">No Onsite Go price list is loaded yet.</p>
            <p>{canUpload ? "Upload Onsite Go's price list PDF with the button above; its plans are read and listed here." : "The Admin uploads the price list PDF."}</p>
          </div>
        ) : (
          <OnsitegoPlansTable plans={plans} />
        )}
      </div>
    </PageShell>
  );
}
