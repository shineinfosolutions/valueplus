"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * Area charts for the Reports and Expenses pages, kept in their own file so those pages load recharts (~110 kB
 * compressed) with next/dynamic instead of with the page itself. The JSX is moved here unchanged.
 */

/** Dashboard → Reports: one coloured series; orders count, everything else rupees in thousands. */
export function ReportTrendChart({ data, color, isCount }: { data: any[]; color: string; isCount: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
            <stop offset="95%" stopColor={color} stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
        <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dx={-10} tickFormatter={(val) => isCount ? `${val}` : `₹${(val/1000).toFixed(0)}k`} />
        <Tooltip
          cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 4' }}
          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' }}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={3} fillOpacity={1} fill="url(#colorValue)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Purchase → Expenses: daily expense trend; `formatAmount` gives the tooltip's rupee text. */
export function ExpenseTrendChart({ data, formatAmount }: { data: any[]; formatAmount: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#e11d48" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#e11d48" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          formatter={(val: any) => [formatAmount(Number(val)), "Expense"]}
          contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
        />
        <Area type="monotone" dataKey="amount" stroke="#e11d48" strokeWidth={3} fillOpacity={1} fill="url(#expenseGradient)" dot={{ r: 4, stroke: "#e11d48", strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 6, stroke: "#e11d48", strokeWidth: 2, fill: "#fff" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
