"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function FinanceDoRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/finance/ledger");
  }, [router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-2">
        <div className="w-8 h-8 border-3 border-[#30539C] border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-500 font-medium">Redirecting to Finance Ledger...</p>
      </div>
    </div>
  );
}
