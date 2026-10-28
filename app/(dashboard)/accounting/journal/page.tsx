"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Search, FileText } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function JournalPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newEntry, setNewEntry] = useState({
    date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    lines: [{ accountId: "", accountName: "", debit: 0, credit: 0 }, { accountId: "", accountName: "", debit: 0, credit: 0 }]
  });

  const { data: accountsData } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/accounts");
      return res.json();
    }
  });
  const accounts = accountsData?.data || [];

  const { data: journalData, isLoading } = useQuery({
    queryKey: ["journal-entries"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/journal");
      return res.json();
    }
  });
  const entries = journalData?.data || [];

  const addEntryMutation = useMutation({
    mutationFn: async (entry: any) => {
      const res = await fetch("/api/accounting/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to create entry");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal-entries"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      setIsAddOpen(false);
      setNewEntry({
        date: format(new Date(), "yyyy-MM-dd"),
        description: "",
        lines: [{ accountId: "", accountName: "", debit: 0, credit: 0 }, { accountId: "", accountName: "", debit: 0, credit: 0 }]
      });
    }
  });

  const handleAddLine = () => {
    setNewEntry({ ...newEntry, lines: [...newEntry.lines, { accountId: "", accountName: "", debit: 0, credit: 0 }] });
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    const updatedLines = [...newEntry.lines];
    if (field === "accountId") {
      const acc = accounts.find((a: any) => a._id === value);
      updatedLines[index].accountId = value;
      updatedLines[index].accountName = acc ? `${acc.code} - ${acc.name}` : "";
    } else {
      updatedLines[index] = { ...updatedLines[index], [field]: value };
    }
    setNewEntry({ ...newEntry, lines: updatedLines });
  };

  const totalDebit = newEntry.lines.reduce((acc, line) => acc + (Number(line.debit) || 0), 0);
  const totalCredit = newEntry.lines.reduce((acc, line) => acc + (Number(line.credit) || 0), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isBalanced) return alert("Debits and Credits must balance!");
    addEntryMutation.mutate(newEntry);
  };

  const filteredEntries = entries.filter((entry: any) => {
    const matchSearch =
      entry.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
      entry.entryNumber.toLowerCase().includes(searchTerm.toLowerCase());
    const matchDate = isDateInRange(entry.date || entry.createdAt, dateRange.start, dateRange.end);
    return matchSearch && matchDate;
  });

  return (
    <PageShell 
      title="Journal Entries" 
      subtitle="Double-entry bookkeeping"
      breadcrumbs={[{ label: "Accounting" }, { label: "Journal Entries" }]}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search entries..." 
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <DateRangeFilter 
            value={dateFilter} 
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-40"
            showIcon={true}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Journal Entries"
            subtitle={`${filteredEntries.length} entries`}
            data={filteredEntries.map((row: any) => ({
              Date: format(new Date(row.date), "dd MMM, yyyy"),
              "Entry No.": row.entryNumber,
              Description: row.description,
              "Amount (₹)": row.totalDebit,
            }))}
            filename="journal-entries"
          />
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#3F63AD] hover:bg-[#3F63AD]/90">
              <Plus className="w-4 h-4 mr-2" />
              New Journal Entry
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Create Journal Entry</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-6 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input type="date" value={newEntry.date} onChange={e => setNewEntry({...newEntry, date: e.target.value})} required />
                </div>
                <div>
                  <label className="text-sm font-medium">Description / Memo</label>
                  <Input value={newEntry.description} onChange={e => setNewEntry({...newEntry, description: e.target.value})} required />
                </div>
              </div>

              <div>
                <table className="w-full text-sm border">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-right">Debit (₹)</th>
                      <th className="px-3 py-2 text-right">Credit (₹)</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {newEntry.lines.map((line, idx) => (
                      <tr key={idx} className="border-b">
                        <td className="p-2">
                          <select 
                            className="w-full border rounded p-2 text-sm"
                            value={line.accountId}
                            onChange={(e) => handleLineChange(idx, "accountId", e.target.value)}
                            required
                          >
                            <option value="">Select Account...</option>
                            {accounts.map((acc: any) => (
                              <option key={acc._id} value={acc._id}>
                                {acc.code} - {acc.name} ({acc.type})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 w-32">
                          <Input type="number" min="0" step="0.01" value={line.debit || ""} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleLineChange(idx, "debit", e.target.value)} />
                        </td>
                        <td className="p-2 w-32">
                          <Input type="number" min="0" step="0.01" value={line.credit || ""} onKeyDown={(e) => ["-", "+", "e", "E"].includes(e.key) && e.preventDefault()} onChange={e => handleLineChange(idx, "credit", e.target.value)} />
                        </td>
                        <td className="p-2 w-12 text-center">
                          {newEntry.lines.length > 2 && (
                             <button type="button" onClick={() => setNewEntry({...newEntry, lines: newEntry.lines.filter((_, i) => i !== idx)})} className="text-red-500 hover:text-red-700">✕</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-right">Total:</td>
                      <td className={`px-3 py-2 text-right ${!isBalanced ? 'text-red-600' : 'text-emerald-600'}`}>₹{totalDebit.toLocaleString()}</td>
                      <td className={`px-3 py-2 text-right ${!isBalanced ? 'text-red-600' : 'text-emerald-600'}`}>₹{totalCredit.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
                <div className="mt-2 text-right">
                  <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>+ Add Line</Button>
                </div>
              </div>
              
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="bg-[#3F63AD] hover:bg-[#3F63AD]/90" disabled={!isBalanced || addEntryMutation.isPending}>
                  {addEntryMutation.isPending ? "Saving..." : "Post Entry"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <Card className="overflow-hidden border border-slate-200">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Date</th>
                <th className="px-4 py-3 text-left font-semibold">Entry No.</th>
                <th className="px-4 py-3 text-left font-semibold">Description</th>
                <th className="px-4 py-3 text-right font-semibold">Amount (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Loading entries...</td></tr>
              ) : filteredEntries.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No journal entries found</td></tr>
              ) : (
                filteredEntries.map((row: any) => (
                  <tr key={row._id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 whitespace-nowrap">{format(new Date(row.date), "dd MMM, yyyy")}</td>
                    <td className="px-4 py-3 font-medium text-[#3F63AD] whitespace-nowrap">{row.entryNumber}</td>
                    <td className="px-4 py-3">
                      <div>{row.description}</div>
                      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                        {row.lines.map((line: any, i: number) => (
                          <div key={i} className="flex justify-between max-w-sm">
                            <span className={line.credit > 0 ? "ml-4" : ""}>{line.accountName}</span>
                            <span>{line.debit > 0 ? `Dr ${line.debit.toLocaleString()}` : `Cr ${line.credit.toLocaleString()}`}</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">₹{row.totalDebit?.toLocaleString('en-IN')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </PageShell>
  );
}
