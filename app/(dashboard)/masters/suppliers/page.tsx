"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Supplier master, ledger and payments were consolidated into one page at
// /suppliers (promoted to its own top-level nav section) instead of living
// here and on the old /vendors "Suppliers (Payable)" tab at the same time.
export default function MastersSuppliersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/suppliers");
  }, [router]);
  return null;
}
