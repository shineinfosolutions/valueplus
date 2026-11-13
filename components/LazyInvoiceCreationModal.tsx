"use client";

import dynamic from "next/dynamic";

/**
 * The billing form (InvoiceCreationModal, ~4,000 lines plus its pickers) loaded as its own chunk, so the pages that
 * can open it (dashboard, invoices, estimates, orders, credit notes, brands) show up without first downloading it.
 * The chunk is fetched right after the page has loaded, while the modal is still closed, so opening it is not
 * slower than before. Same props as the real component.
 */
export const InvoiceCreationModal = dynamic(
  () => import("@/components/InvoiceCreationModal").then((m) => m.InvoiceCreationModal),
  { ssr: false }
);
