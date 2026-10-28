import React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-gradient-to-r from-slate-200/80 via-slate-100 to-slate-200/80 bg-[length:200%_100%] animate-pulse shimmer-pulse",
        className
      )}
      {...props}
    />
  );
}

export function MetricCardsShimmer({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28 rounded" />
            <Skeleton className="h-9 w-9 rounded-xl" />
          </div>
          <Skeleton className="h-8 w-36 rounded-lg" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableShimmer({ rows = 6, cols = 7 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full space-y-3 p-4 bg-white rounded-2xl">
      {/* Header skeleton */}
      <div className="flex items-center justify-between gap-4 pb-3 border-b border-slate-100">
        {Array.from({ length: cols }).map((_, c) => (
          <Skeleton key={c} className="h-4 flex-1 rounded" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton
              key={c}
              className={cn("h-4 rounded", c === 0 ? "w-24 flex-initial" : "flex-1")}
              style={{ opacity: 1 - (r * 0.08) }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function ChartShimmer({ height = 280 }: { height?: number }) {
  return (
    <div className="w-full p-6 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-40 rounded" />
        <Skeleton className="h-8 w-28 rounded-lg" />
      </div>
      <div className="w-full flex items-end gap-3 pt-6 pb-2" style={{ height }}>
        {Array.from({ length: 10 }).map((_, idx) => {
          const heights = ["40%", "65%", "85%", "55%", "90%", "70%", "45%", "80%", "60%", "75%"];
          return (
            <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
              <Skeleton 
                className="w-full rounded-t-lg" 
                style={{ height: heights[idx % heights.length] }} 
              />
              <Skeleton className="h-3 w-8 rounded" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DistributionShimmer() {
  return (
    <div className="w-full p-5 bg-white rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32 rounded" />
        <Skeleton className="h-6 w-20 rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div key={idx} className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-3.5 w-24 rounded" />
              <Skeleton className="h-3.5 w-16 rounded" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function GridCardsShimmer({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="p-5 rounded-2xl bg-white border border-slate-200/80 shadow-sm space-y-3">
          <div className="flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <div className="space-y-1.5 flex-1">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
            </div>
          </div>
          <Skeleton className="h-3 w-full rounded" />
          <div className="flex justify-between pt-2 border-t border-slate-100">
            <Skeleton className="h-3.5 w-20 rounded" />
            <Skeleton className="h-3.5 w-16 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function GodownHubShimmer() {
  return (
    <div className="space-y-5">
      {/* Banner Shimmer */}
      <div className="p-6 rounded-2xl bg-[#1B2537] border border-slate-700 shadow-xl space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-2xl bg-white/10" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48 bg-white/20 rounded" />
              <Skeleton className="h-3.5 w-64 bg-white/10 rounded" />
            </div>
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32 bg-white/10 rounded-xl" />
            <Skeleton className="h-9 w-36 bg-white/20 rounded-xl" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-white/10">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="bg-white/5 rounded-xl p-3 space-y-2">
              <Skeleton className="h-3 w-24 bg-white/10 rounded" />
              <Skeleton className="h-6 w-32 bg-white/20 rounded" />
              <Skeleton className="h-2.5 w-20 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
      {/* Table Shimmer */}
      <TableShimmer rows={6} cols={7} />
    </div>
  );
}

