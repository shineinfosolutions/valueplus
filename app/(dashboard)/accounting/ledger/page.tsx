"use client";

import { useState } from "react";
import { PageShell } from "@/components/shared/page-shell";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { FileText } from "lucide-react";
import { DateRangeFilter, resolveDateRange, isDateInRange } from "@/components/shared/date-range-filter";
import { ExportMenu } from "@/components/shared/ExportMenu";

export default function LedgerPage() {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [dateFilter, setDateFilter] = useState("This Month");
  const [dateRange, setDateRange] = useState(() => resolveDateRange("This Month"));

  const { data: accountsData } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const res = await fetch("/api/accounting/accounts");
      return res.json();
    }
  });
  const accounts = accountsData?.data || [];

  const { data: journalData, isLoading } = useQuery({
    queryKey: ["journal-entries", selectedAccountId],
    queryFn: async () => {
      const url = selectedAccountId ? `/api/accounting/journal?accountId=${selectedAccountId}` : "/api/accounting/journal";
      const res = await fetch(url);
      return res.json();
    },
    enabled: !!selectedAccountId
  });
  const entries = (journalData?.data || []).filter((e: any) => isDateInRange(e.date || e.createdAt, dateRange.start, dateRange.end));

  const selectedAccount = accounts.find((a: any) => a._id === selectedAccountId);

  return (
    <PageShell 
      title="General Ledger" 
      subtitle="Complete account ledger"
      breadcrumbs={[{ label: "Accounting" }, { label: "General Ledger" }]}
    >
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 max-w-md">
          <label className="text-sm font-medium mb-1.5 block">Select Account</label>
          <select 
            className="w-full border rounded-md p-2 text-sm bg-white"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            <option value="">-- Choose an Account --</option>
            {accounts.map((acc: any) => (
              <option key={acc._id} value={acc._id}>
                {acc.code} - {acc.name} ({acc.type})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">Time Period</label>
          <DateRangeFilter 
            value={dateFilter} 
            onChange={(val, s, e) => {
              setDateFilter(val);
              if (s && e) setDateRange({ start: s, end: e });
            }}
            className="w-44"
            showIcon={true}
          />
        </div>
      </div>

      {selectedAccountId ? (
        <Card className="overflow-hidden border border-slate-200">
          <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-lg">{selectedAccount?.name}</h3>
              <p className="text-sm text-muted-foreground">Account Code: {selectedAccount?.code} • Type: <span className="capitalize">{selectedAccount?.type}</span></p>
            </div>
            <div className="flex items-center gap-3">
              <ExportMenu
                title="General Ledger"
                subtitle={`${selectedAccount?.name || ""} — ${entries.length} transactions`}
                data={entries
                  .filter((entry: any) => entry.lines.find((l: any) => l.accountId === selectedAccountId))
                  .map((entry: any) => {
                    const line = entry.lines.find((l: any) => l.accountId === selectedAccountId);
                    return {
                      Date: format(new Date(entry.date), "dd MMM, yyyy"),
                      Description: entry.description,
                      Ref: entry.entryNumber,
                      "Debit (₹)": line.debit > 0 ? line.debit : 0,
                      "Credit (₹)": line.credit > 0 ? line.credit : 0,
                    };
                  })}
                filename="general-ledger"
              />
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Current Balance</p>
                <h3 className="text-2xl font-bold">₹{selectedAccount?.balance?.toLocaleString('en-IN') || 0}</h3>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Date</th>
                  <th className="px-4 py-3 text-left font-semibold">Description</th>
                  <th className="px-4 py-3 text-left font-semibold">Ref</th>
                  <th className="px-4 py-3 text-right font-semibold">Debit (₹)</th>
                  <th className="px-4 py-3 text-right font-semibold">Credit (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading ledger...</td></tr>
                ) : entries.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No transactions found for this account</td></tr>
                ) : (
                  entries.map((entry: any) => {
                    const line = entry.lines.find((l: any) => l.accountId === selectedAccountId);
                    if (!line) return null;
                    return (
                      <tr key={entry._id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 whitespace-nowrap">{format(new Date(entry.date), "dd MMM, yyyy")}</td>
                        <td className="px-4 py-3">{entry.description}</td>
                        <td className="px-4 py-3 text-muted-foreground">{entry.entryNumber}</td>
                        <td className="px-4 py-3 text-right">{line.debit > 0 ? line.debit.toLocaleString('en-IN') : "-"}</td>
                        <td className="px-4 py-3 text-right">{line.credit > 0 ? line.credit.toLocaleString('en-IN') : "-"}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="text-center py-12 border rounded-xl border-dashed bg-slate-50/50">
          <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-700">Select an Account</h3>
          <p className="text-sm text-slate-500">Choose an account from the dropdown above to view its ledger.</p>
        </div>
      )}
    </PageShell>
  );
}
