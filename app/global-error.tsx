"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global Layout Error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
          <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Application Encountered an Error</h2>
          <p className="text-sm text-slate-500 mb-6">
            A critical error occurred in the application root. Please reload to restore the session.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              onClick={() => reset()}
              className="bg-[#3F63AD] hover:bg-[#3F63AD]/90 text-white text-xs h-9 px-4"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" /> Reload App
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
