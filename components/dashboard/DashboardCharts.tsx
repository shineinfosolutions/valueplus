"use client";

import type { ReactElement } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/**
 * The dashboard's two charts, kept in their own file so the page can load recharts (~110 kB compressed) with
 * next/dynamic instead of with the page itself. The JSX is moved here unchanged; the page passes in its data and
 * callbacks.
 */

/** Daily revenue vs online/card trend (the "Sales Trend" card). */
export function DashboardTrendChart({ data, tooltip }: { data: any[]; tooltip: ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 5, left: -25, bottom: 0 }}>
        <defs>
          <linearGradient id="colorTrends" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#76C043" stopOpacity={0.4}/>
            <stop offset="95%" stopColor="#76C043" stopOpacity={0}/>
          </linearGradient>
          <linearGradient id="colorOnline" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3F63AD" stopOpacity={0.3}/>
            <stop offset="95%" stopColor="#3F63AD" stopOpacity={0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11, fontWeight: "bold" }} />
        <YAxis tickLine={false} axisLine={false} tick={{ fill: "#64748B", fontSize: 11 }} tickFormatter={(val) => `₹${val > 99999 ? (val/100000).toFixed(1)+'L' : val > 999 ? (val/1000).toFixed(0)+'k' : val}`} />
        <Tooltip content={tooltip} />
        <Area type="monotone" dataKey="revenue" name="Total Revenue" stroke="#76C043" strokeWidth={3} fillOpacity={1} fill="url(#colorTrends)" />
        <Area type="monotone" dataKey="online" name="Online & Card" stroke="#3F63AD" strokeWidth={2.5} fillOpacity={1} fill="url(#colorOnline)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * The small expenses donut. With nothing spent (`hasData` false) it shows one grey ring, as before; clicking a
 * slice calls `onSliceClick` with that slice's entry.
 */
export function DashboardExpenseDonut({
  data,
  hasData,
  colors,
  onSliceClick,
  formatAmount,
}: {
  data: any[];
  hasData: boolean;
  colors: string[];
  onSliceClick: (entry: any) => void;
  formatAmount: (v: any) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={hasData ? data : [{ name: "Zero", amount: 1 }]}
          cx="50%"
          cy="50%"
          innerRadius={28}
          outerRadius={44}
          paddingAngle={3}
          dataKey="amount"
        >
          {hasData ? (
            data.map((entry: any, i: number) => (
              <Cell
                key={i}
                fill={colors[i % colors.length]}
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onSliceClick(entry)}
              />
            ))
          ) : (
            <Cell fill="#E2E8F0" />
          )}
        </Pie>
        <Tooltip
          formatter={(v: any) => [formatAmount(v), "Amount"]}
          position={{ x: 0, y: -10 }}
          wrapperStyle={{ zIndex: 20 }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
