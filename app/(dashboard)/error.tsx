"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard Module Error:", error);
  }, [error]);

  return (
    <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mb-4 border border-rose-100">
        <AlertCircle className="w-7 h-7" />
      </div>
      <h2 className="text-lg font-bold text-slate-900 mb-1">Failed to load this section</h2>
      <p className="text-xs text-slate-500 max-w-sm mb-6">
        There was a temporary problem retrieving data for this view.
      </p>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => reset()}
          className="bg-[#3F63AD] hover:bg-[#3F63AD]/90 text-white text-xs h-8 px-4"
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
        </Button>
      </div>
    </div>
  );
}
