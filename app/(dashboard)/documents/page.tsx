"use client";

import { useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, UploadCloud, ExternalLink, Trash2, Search, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const ALLOWED_ROLES = ["admin", "superadmin", "accounts"];

function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function DocumentsPage() {
  const { data: session, status } = useSession();
  const role = String((session?.user as any)?.role || "").toLowerCase();
  const allowed = ALLOWED_ROLES.includes(role);
  const isAdmin = role === "admin" || role === "superadmin";

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // The date starts as today and is filled in automatically; it can be changed
  // for a paper that belongs to an earlier day.
  const [date, setDate] = useState(todayInIndia());
  const [narration, setNarration] = useState("");
  const [search, setSearch] = useState("");

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["stored-documents"],
    queryFn: async () => {
      const res = await fetch("/api/documents");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load documents");
      return json.data as any[];
    },
    enabled: allowed,
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("file", file as File);
      form.append("date", date);
      form.append("narration", narration.trim());
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Document saved.");
      setFile(null);
      setNarration("");
      setDate(todayInIndia());
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["stored-documents"] });
    },
    onError: (err: any) => toast.error(err.message || "Upload failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
    },
    onSuccess: () => {
      toast.success("Document deleted.");
      queryClient.invalidateQueries({ queryKey: ["stored-documents"] });
    },
    onError: (err: any) => toast.error(err.message || "Delete failed"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return toast.error("Choose a file to upload.");
    if (narration.trim().length < 3) return toast.error("Write a narration that says what this document is.");
    uploadMutation.mutate();
  };

  if (status === "loading") {
    return (
      <PageShell title="Documents" subtitle="Loading...">
        <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" />
      </PageShell>
    );
  }

  if (!allowed) {
    return (
      <PageShell title="Documents" subtitle="Office document records">
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
          <ShieldAlert className="w-9 h-9 text-rose-500 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-800">Access denied</p>
          <p className="text-xs text-slate-500 mt-1">Only the admin and accounts can open the documents section.</p>
        </div>
      </PageShell>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = documents.filter(
    (d: any) =>
      !q ||
      (d.narration || "").toLowerCase().includes(q) ||
      (d.fileName || "").toLowerCase().includes(q) ||
      (d.date || "").includes(q) ||
      (d.uploadedBy || "").toLowerCase().includes(q)
  );

  return (
    <PageShell
      title="Documents"
      subtitle="Upload a PDF with its date and narration, and find it again later"
      breadcrumbs={[{ label: "Accounts" }, { label: "Documents" }]}
    >
      <div className="space-y-4">
        {/* Upload */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#30539C] flex items-center justify-center">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Upload a document</h3>
              <p className="text-xs text-slate-500">PDF, JPG, PNG or WEBP, up to 10 MB.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-3">
              <Label className="text-xs font-bold text-slate-700">Date</Label>
              <Input
                type="date"
                value={date}
                max={todayInIndia()}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9 text-xs font-medium bg-white"
                required
              />
              <p className="text-[10px] text-slate-400 mt-0.5">Filled in automatically with today's date.</p>
            </div>
            <div className="md:col-span-9">
              <Label className="text-xs font-bold text-slate-700">Narration *</Label>
              <Input
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="e.g. HDFC bank statement for September 2026"
                className="mt-1 h-9 text-xs bg-white"
                required
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs border-[#3F63AD]/40 text-[#3F63AD] hover:bg-[#3F63AD]/5"
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" /> {file ? "Change file" : "Choose file"}
            </Button>
            <span className="flex-1 min-w-0 truncate text-xs text-slate-600">
              {file ? `${file.name} · ${formatSize(file.size)}` : "No file chosen"}
            </span>
            <Button
              type="submit"
              size="sm"
              disabled={uploadMutation.isPending}
              className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white text-xs font-bold"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload & Save"}
            </Button>
          </div>
        </form>

        {/* List */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">
              Saved documents <span className="text-slate-400 font-semibold">({filtered.length})</span>
            </h3>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search narration, file name, date..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9 text-xs bg-white"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs text-left">
              <thead className="bg-slate-50 border-b text-slate-600 uppercase font-bold text-[10px] tracking-wider">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">Narration</th>
                  <th className="p-3">File</th>
                  <th className="p-3">Uploaded By</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-400">Loading documents...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400 font-medium">
                      {documents.length === 0 ? "No documents have been uploaded yet." : "No documents match this search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((d: any) => (
                    <tr key={d._id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-mono font-bold text-[#3F63AD] whitespace-nowrap">{d.date}</td>
                      <td className="p-3 text-slate-800 font-medium">{d.narration}</td>
                      <td className="p-3 text-slate-500">
                        <span className="block max-w-[220px] truncate">{d.fileName || "File"}</span>
                        <span className="text-[10px] text-slate-400">{formatSize(d.fileSize)}</span>
                      </td>
                      <td className="p-3 text-slate-600">
                        {d.uploadedBy}
                        {d.uploadedByRole && <span className="block text-[10px] text-slate-400 capitalize">{d.uploadedByRole}</span>}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <a
                            // Opened through the app, which checks access and fetches the
                            // file itself — the stored file has no public link.
                            href={`/api/documents/file?id=${d._id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center h-7 px-2 rounded-md border border-[#3F63AD]/30 text-[11px] font-bold text-[#3F63AD] hover:bg-blue-50"
                          >
                            <ExternalLink className="w-3 h-3 mr-1" /> View / Download
                          </a>
                          {isAdmin && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={deleteMutation.isPending}
                              onClick={() => {
                                if (window.confirm(`Delete "${d.narration}"? This cannot be undone.`)) deleteMutation.mutate(d._id);
                              }}
                              className="h-7 px-2 text-[11px] text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                              title="Delete document"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
