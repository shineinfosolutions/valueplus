"use client";

import { useRef, useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileText, UploadCloud, ExternalLink, Trash2, Search, ShieldAlert, Folder, FolderPlus, Pencil } from "lucide-react";
import { toast } from "sonner";

const ALLOWED_ROLES = ["admin", "superadmin", "manager", "accounts"];
/** Every other staff role sees only the On Site Go folder (Onsitego plans and material), and cannot upload. */
const ONSITEGO_ONLY_ROLES = ["salesman", "sales", "cashier", "warehouse", "hr", "driver"];

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
  const onsitegoOnly = ONSITEGO_ONLY_ROLES.includes(role);
  const allowed = ALLOWED_ROLES.includes(role) || onsitegoOnly;
  const isAdmin = role === "admin" || role === "superadmin";
  // Admin and manager make and rename folders and move documents between them.
  const canManage = isAdmin || role === "manager";

  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  // The date starts as today and is filled in automatically; it can be changed
  // for a paper that belongs to an earlier day.
  const [date, setDate] = useState(todayInIndia());
  const [narration, setNarration] = useState("");
  const [search, setSearch] = useState("");
  // "all" | "unfiled" | a folder id: what the list shows, and where an upload goes.
  const [activeFolder, setActiveFolder] = useState<string>("all");
  const [uploadFolder, setUploadFolder] = useState<string>("");

  const { data: folderData } = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => {
      const res = await fetch("/api/documents/folders");
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not load folders");
      return json as { data: any[]; unfiled: number };
    },
    enabled: allowed,
  });
  const folders: any[] = folderData?.data || [];
  const folderName = (id: string) => folders.find((f) => String(f._id) === id)?.name || "";
  // Salesmen and cashiers have only the On Site Go folder: open it straight away.
  const onlyFolderId = onsitegoOnly && folders[0] ? String(folders[0]._id) : "";
  useEffect(() => {
    if (onlyFolderId) setActiveFolder(onlyFolderId);
  }, [onlyFolderId]);

  const folderMutation = useMutation({
    mutationFn: async (b: { id?: string; name: string }) => {
      const res = await fetch("/api/documents/folders", {
        method: b.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not save the folder");
      return json.data;
    },
    onSuccess: (f: any, vars) => {
      toast.success(vars.id ? "Folder renamed." : "Folder created.");
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
      if (!vars.id) { setActiveFolder(String(f._id)); setUploadFolder(String(f._id)); }
    },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/documents/folders?id=${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not delete the folder");
    },
    onSuccess: () => {
      toast.success("Folder deleted.");
      setActiveFolder("all");
      setUploadFolder("");
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });
  const moveMutation = useMutation({
    mutationFn: async (b: { id: string; folderId: string }) => {
      const res = await fetch("/api/documents", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Could not move the document");
    },
    onSuccess: () => {
      toast.success("Document moved.");
      queryClient.invalidateQueries({ queryKey: ["stored-documents"] });
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const newFolder = () => {
    const name = window.prompt("New folder name (e.g. Bank Statements, GST, Agreements):");
    if (name && name.trim()) folderMutation.mutate({ name });
  };
  const renameFolder = (f: any) => {
    const name = window.prompt("Rename folder:", f.name);
    if (name && name.trim() && name.trim() !== f.name) folderMutation.mutate({ id: String(f._id), name });
  };

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
      form.append("folderId", uploadFolder);
      const res = await fetch("/api/documents", { method: "POST", body: form });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Upload failed");
      return json;
    },
    onSuccess: (json: any) => {
      // An Onsitego price list says how many plans were read (or why none could be).
      const msg = String(json?.message || "Document saved.");
      if (/No Onsitego plan lines|could not be read/i.test(msg)) toast.warning(msg, { duration: 10000 });
      else toast.success(msg, { duration: 6000 });
      setFile(null);
      setNarration("");
      setDate(todayInIndia());
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["stored-documents"] });
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
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
      queryClient.invalidateQueries({ queryKey: ["document-folders"] });
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
          <p className="text-xs text-slate-500 mt-1">Only the admin, manager and accounts can open the documents section.</p>
        </div>
      </PageShell>
    );
  }

  const q = search.trim().toLowerCase();
  const filtered = documents.filter(
    (d: any) =>
      (activeFolder === "all" || (activeFolder === "unfiled" ? !d.folderId : d.folderId === activeFolder)) &&
      (!q ||
      (d.narration || "").toLowerCase().includes(q) ||
      (d.fileName || "").toLowerCase().includes(q) ||
      (d.date || "").includes(q) ||
      (d.uploadedBy || "").toLowerCase().includes(q) ||
      folderName(d.folderId || "").toLowerCase().includes(q))
  );
  const active = folders.find((f) => String(f._id) === activeFolder);

  return (
    <PageShell
      title="Documents"
      subtitle="Upload a PDF with its date and narration, and find it again later"
      breadcrumbs={[{ label: "Accounts" }, { label: "Documents" }]}
    >
      <div className="space-y-4">
        {/* Folders */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-3 flex flex-wrap items-center gap-2">
          {[
            ...(onsitegoOnly
              ? []
              : [
                  { id: "all", label: "All documents", count: documents.length },
                  { id: "unfiled", label: "Not in a folder", count: folderData?.unfiled ?? 0 },
                ]),
            ...folders.map((f) => ({ id: String(f._id), label: f.name, count: f.count })),
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setActiveFolder(f.id); if (f.id !== "all" && f.id !== "unfiled") setUploadFolder(f.id); }}
              className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border text-xs font-bold ${
                activeFolder === f.id ? "bg-[#3F63AD] text-white border-[#3F63AD]" : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Folder className="w-3.5 h-3.5" /> {f.label} <span className={activeFolder === f.id ? "text-blue-100" : "text-slate-400"}>({f.count})</span>
            </button>
          ))}
          {canManage && (
            <Button type="button" size="sm" variant="outline" onClick={newFolder} disabled={folderMutation.isPending} className="h-8 text-xs font-bold border-dashed">
              <FolderPlus className="w-3.5 h-3.5 mr-1" /> New folder
            </Button>
          )}
          {active && canManage && !active.fixed && (
            <div className="ml-auto flex items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => renameFolder(active)} className="h-8 text-xs"><Pencil className="w-3 h-3 mr-1" /> Rename</Button>
              {isAdmin && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => window.confirm(`Delete the folder "${active.name}"?`) && deleteFolderMutation.mutate(String(active._id))}
                  className="h-8 text-xs text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3 h-3 mr-1" /> Delete folder
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Upload */}
        {onsitegoOnly && (
          <p className="text-xs text-slate-500 px-1">
            Onsitego plans, price lists and material from the Admin. You earn 10% of every Onsitego plan you sell.
          </p>
        )}
        {!onsitegoOnly && (
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
            <select
              value={uploadFolder}
              onChange={(e) => setUploadFolder(e.target.value)}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700"
              title="Save into this folder"
            >
              <option value="">No folder</option>
              {folders.map((f) => <option key={f._id} value={String(f._id)}>{f.name}</option>)}
            </select>
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
          {folders.find((f) => String(f._id) === uploadFolder)?.fixed && (
            <p className="text-[11px] text-slate-500">
              On Site Go: the Onsitego price list PDF put here becomes the plans the bill shows (a newer PDF replaces them).
              Every staff member can open everything in this folder.
            </p>
          )}
        </form>
        )}

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
                  <th className="p-3">Folder</th>
                  <th className="p-3">File</th>
                  <th className="p-3">Uploaded By</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-slate-400">Loading documents...</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">
                      {documents.length === 0 ? "No documents have been uploaded yet." : "No documents match this search."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((d: any) => (
                    <tr key={d._id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 font-mono font-bold text-[#3F63AD] whitespace-nowrap">{d.date}</td>
                      <td className="p-3 text-slate-800 font-medium">{d.narration}</td>
                      <td className="p-3">
                        {canManage ? (
                          <select
                            value={d.folderId || ""}
                            disabled={moveMutation.isPending}
                            onChange={(e) => moveMutation.mutate({ id: d._id, folderId: e.target.value })}
                            className="h-7 max-w-[150px] rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-semibold text-slate-700"
                            title="Move to another folder"
                          >
                            <option value="">No folder</option>
                            {folders.map((f) => <option key={f._id} value={String(f._id)}>{f.name}</option>)}
                          </select>
                        ) : (
                          <span className="text-[11px] text-slate-600">{folderName(d.folderId || "") || "-"}</span>
                        )}
                      </td>
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
