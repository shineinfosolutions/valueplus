"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { ExportMenu } from "@/components/shared/ExportMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableShimmer } from "@/components/shared/shimmer-skeleton";
import {
  MessageCircle,
  Send,
  Check,
  RefreshCw,
  Search,
  Trash2,
  Settings as SettingsIcon,
  Info,
  Plus,
  X,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { formatDate, cn } from "@/lib/utils";

/**
 * WhatsApp outbox and settings.
 *
 * Under the manual provider every notification lands here as `pending` with a
 * ready-made wa.me link: click "Send", WhatsApp opens with the text already
 * written, press send, then mark it done. Switching the provider to the Cloud API
 * makes the same messages go out on their own — the outbox then becomes a log
 * rather than a work queue.
 */

const STATUS_TONE: Record<string, string> = {
  pending: "warning",
  sent: "success",
  failed: "destructive",
  skipped: "secondary",
};

export default function WhatsAppPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("outbox");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [search, setSearch] = useState("");

  const { data: outbox, isLoading } = useQuery({
    queryKey: ["whatsapp-outbox", statusFilter, search],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (statusFilter !== "all") qs.set("status", statusFilter);
      if (search.trim()) qs.set("q", search.trim());
      const res = await fetch(`/api/whatsapp?${qs.toString()}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json.data;
    },
    refetchInterval: 30_000,
  });

  const rows = outbox?.rows || [];
  const counts = outbox?.counts || { pending: 0, sent: 0, failed: 0, total: 0 };

  const act = useMutation({
    mutationFn: async ({ ids, action }: { ids: string[]; action: string }) => {
      const res = await fetch("/api/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-outbox"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSend = (row: any) => {
    // Opening the link and marking the row done are separate steps on purpose:
    // the browser cannot know whether the person actually pressed send inside
    // WhatsApp, so the row is only closed when they say so.
    window.open(row.waLink, "_blank", "noopener");
  };

  return (
    <PageShell
      title="WhatsApp Notifications"
      subtitle="Customer queries and status updates going out on WhatsApp"
      breadcrumbs={[{ label: "Marketing" }, { label: "WhatsApp" }]}
      actions={
        <div className="flex items-center gap-2">
          {tab === "outbox" && (
            <ExportMenu
              title="WhatsApp Outbox"
              subtitle={`${rows.length} messages · ${statusFilter === "all" ? "all statuses" : statusFilter}`}
              data={(rows as any[]).map((row) => ({
                Audience: row.audience === "admin" ? "Admin alert" : "Customer",
                Status: row.status || "",
                Reference: row.entityRef || "",
                Name: row.toName || "",
                Number: row.toNumber || "",
                Message: row.message || "",
                Error: row.error || "",
                "Created At": formatDate(row.createdAt),
                "Sent By": row.sentBy || "",
                "Sent At": row.sentAt ? formatDate(row.sentAt) : "",
              }))}
              filename="whatsapp-outbox"
            />
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["whatsapp-outbox"] })}
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="Waiting to Send" value={counts.pending} tone="amber" />
        <Metric label="Sent" value={counts.sent} tone="emerald" />
        <Metric label="Failed" value={counts.failed} tone="red" />
        <Metric label="Total Messages" value={counts.total} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="outbox">
            Outbox {counts.pending > 0 ? `(${counts.pending})` : ""}
          </TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "outbox" ? (
        <>
          <div className="data-table-container">
            <div className="flex flex-wrap items-center gap-3 p-4 border-b">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by ticket, name or number…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Waiting to send</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              {statusFilter === "pending" && rows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    act.mutate({ ids: rows.map((r: any) => r._id), action: "mark-sent" })
                  }
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" /> Mark all sent
                </Button>
              )}
            </div>

            <div className="divide-y">
              {isLoading ? (
                <TableShimmer rows={5} cols={4} />
              ) : rows.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <MessageCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm font-medium">
                    {statusFilter === "pending"
                      ? "Nothing waiting to be sent."
                      : "No messages here."}
                  </p>
                  <p className="text-xs mt-1">
                    Messages appear the moment a complaint, walk-in or lead is raised or
                    changes status.
                  </p>
                </div>
              ) : (
                rows.map((row: any) => (
                  <div key={row._id} className="p-4 hover:bg-slate-50/70 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex-1 min-w-[260px]">
                        <div className="flex flex-wrap items-center gap-2 mb-1.5">
                          <Badge variant={row.audience === "admin" ? "secondary" : "default"} className="text-[10px]">
                            {row.audience === "admin" ? "Admin alert" : "Customer"}
                          </Badge>
                          <Badge variant={STATUS_TONE[row.status] as any} className="text-[10px]">
                            {row.status}
                          </Badge>
                          {row.entityRef && (
                            <span className="text-xs font-mono font-bold text-[#3F63AD]">
                              {row.entityRef}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {row.toName} • +{row.toNumber}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {formatDate(row.createdAt)}
                          </span>
                        </div>
                        <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-200 rounded-lg p-3 max-w-2xl">
                          {row.message}
                        </pre>
                        {row.error && (
                          <p className="text-[11px] text-red-600 font-semibold mt-1.5">
                            {row.error}
                          </p>
                        )}
                        {row.status === "sent" && row.sentBy && (
                          <p className="text-[10px] text-slate-400 mt-1.5">
                            Marked sent by {row.sentBy}
                            {row.sentAt ? ` on ${formatDate(row.sentAt)}` : ""}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {row.status !== "sent" && (
                          <>
                            <Button size="sm" onClick={() => handleSend(row)}>
                              <Send className="w-3.5 h-3.5 mr-1.5" /> Open WhatsApp
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => act.mutate({ ids: [row._id], action: "mark-sent" })}
                            >
                              <Check className="w-3.5 h-3.5 mr-1.5" /> Mark sent
                            </Button>
                          </>
                        )}
                        {row.status === "failed" && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => act.mutate({ ids: [row._id], action: "retry" })}
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:bg-red-50"
                          onClick={async () => {
                            await fetch(`/api/whatsapp?id=${row._id}`, { method: "DELETE" });
                            queryClient.invalidateQueries({ queryKey: ["whatsapp-outbox"] });
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      ) : (
        <WhatsAppSettings />
      )}
    </PageShell>
  );
}

function WhatsAppSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<any>(null);
  const [newNumber, setNewNumber] = useState("");
  const [token, setToken] = useState("");

  const { data: settings, isLoading } = useQuery({
    queryKey: ["whatsapp-settings"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp/settings");
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setDraft(json.data);
      return json.data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...draft };
      if (token.trim()) payload.cloudApi = { ...payload.cloudApi, accessToken: token.trim() };
      const res = await fetch("/api/whatsapp/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      return json;
    },
    onSuccess: () => {
      toast.success("WhatsApp settings saved");
      setToken("");
      queryClient.invalidateQueries({ queryKey: ["whatsapp-settings"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading || !draft) {
    return (
      <div className="py-16 text-center">
        <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  const addNumber = () => {
    const n = newNumber.trim();
    if (!n) return;
    setDraft({ ...draft, adminNumbers: [...(draft.adminNumbers || []), n] });
    setNewNumber("");
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 flex gap-3">
        <Info className="w-5 h-5 text-[#3F63AD] shrink-0 mt-0.5" />
        <div className="text-xs text-slate-700 space-y-1">
          <p className="font-semibold text-slate-900">
            Right now messages are sent by clicking, not automatically.
          </p>
          <p className="leading-relaxed">
            Every notification is written with the text ready and a WhatsApp link. Someone
            opens it and presses send. To make it fully automatic you need a Meta WhatsApp
            Business account with a verified number, then switch the mode below to Cloud API
            and paste the credentials — the same messages then go out on their own.
          </p>
        </div>
      </div>

      <Panel title="Notifications">
        <Row
          label="WhatsApp notifications"
          hint="Turn everything off without losing the settings"
        >
          <Switch
            checked={draft.enabled}
            onCheckedChange={(v: boolean) => setDraft({ ...draft, enabled: v })}
          />
        </Row>
        <Row
          label="Also message the customer"
          hint="Off means only the admin numbers below are notified"
        >
          <Switch
            checked={draft.notifyCustomer}
            onCheckedChange={(v: boolean) => setDraft({ ...draft, notifyCustomer: v })}
          />
        </Row>
        <Row label="Business name" hint="Used as the sign-off in customer messages">
          <Input
            value={draft.businessName || ""}
            onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
            className="max-w-[240px]"
          />
        </Row>
      </Panel>

      <Panel title="Admin numbers">
        <p className="text-xs text-muted-foreground mb-3">
          Every new query and every status change is sent to these numbers.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(draft.adminNumbers || []).map((n: string) => (
            <span
              key={n}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 text-xs font-semibold"
            >
              +{n}
              <button
                onClick={() =>
                  setDraft({
                    ...draft,
                    adminNumbers: draft.adminNumbers.filter((x: string) => x !== n),
                  })
                }
                className="text-slate-400 hover:text-red-500"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {(draft.adminNumbers || []).length === 0 && (
            <span className="text-xs text-amber-600 font-semibold">
              No number set — nobody will be alerted.
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="e.g. 7510002806"
            value={newNumber}
            onChange={(e) => setNewNumber(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNumber()}
            className="max-w-[220px]"
          />
          <Button variant="outline" size="sm" onClick={addNumber}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add
          </Button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">
          10-digit Indian numbers are fine; 91 is added for you.
        </p>
      </Panel>

      <Panel title="Which events send a message">
        <div className="space-y-2.5">
          {(draft.eventList || []).map((ev: string) => (
            <div key={ev} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {draft.eventLabels?.[ev] || ev}
                </p>
                <p className="text-[10px] font-mono text-slate-400">{ev}</p>
              </div>
              <Switch
                checked={Boolean(draft.events?.[ev])}
                onCheckedChange={(v: boolean) =>
                  setDraft({ ...draft, events: { ...draft.events, [ev]: v } })
                }
              />
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Sending mode">
        <Row label="Mode" hint="How the message actually reaches WhatsApp">
          <Select
            value={draft.provider}
            onValueChange={(v) => setDraft({ ...draft, provider: v })}
          >
            <SelectTrigger className="max-w-[260px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">Click to send (no setup)</SelectItem>
              <SelectItem value="cloud-api">Automatic — Meta Cloud API</SelectItem>
            </SelectContent>
          </Select>
        </Row>

        {draft.provider === "cloud-api" && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Phone Number ID">
                <Input
                  value={draft.cloudApi?.phoneNumberId || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloudApi: { ...draft.cloudApi, phoneNumberId: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="API Version">
                <Input
                  value={draft.cloudApi?.apiVersion || "v21.0"}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cloudApi: { ...draft.cloudApi, apiVersion: e.target.value },
                    })
                  }
                />
              </Field>
              <Field
                label={
                  draft.cloudApi?.hasAccessToken
                    ? "Access Token (saved — retype only to change)"
                    : "Access Token"
                }
                className="sm:col-span-2"
              >
                <Input
                  type="password"
                  placeholder={draft.cloudApi?.hasAccessToken ? "••••••••••••" : "Paste the permanent token"}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Field>
            </div>
            <a
              href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#3F63AD] hover:underline"
            >
              How to get these from Meta <ExternalLink className="w-3 h-3" />
            </a>
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Meta only allows free-form text within 24 hours of the customer messaging you.
              Outside that window a pre-approved template is required, so some customer
              updates may be rejected until you set one up.
            </p>
          </div>
        )}
      </Panel>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <SettingsIcon className="w-4 h-4 mr-1.5" />
          {save.isPending ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-5 py-3 border-b border-slate-100">
        <h3 className="font-bold text-slate-900 text-sm">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-2 gap-4">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-semibold text-slate-700">{label}</Label>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "amber" | "emerald" | "red";
}) {
  const toneClass = {
    slate: "",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    red: "text-red-600",
  }[tone];
  return (
    <div className="metric-card">
      <p className={`text-2xl font-bold ${toneClass}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}
