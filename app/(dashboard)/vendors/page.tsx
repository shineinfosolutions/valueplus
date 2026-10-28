"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Vendor (receivable/dealer tracking) was removed from this app's UI — this
// business only needed Supplier (payable). Historical Vendor data stays in
// MongoDB untouched; this route just forwards anyone with an old link/bookmark.
export default function VendorsRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/suppliers");
  }, [router]);
  return null;
}
