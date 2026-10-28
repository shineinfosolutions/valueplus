"use client";
import { ModuleStub } from "@/components/shared/module-stub";
export default function BankingReceiptsPage() {
  return <ModuleStub title="Receipts" subtitle="Bank receipts and deposits" breadcrumbs={[{ label: "Banking" }, { label: "Receipts" }]} description="Record all money received in bank accounts. Link receipts to invoices and customer payments for automatic reconciliation." ctaLabel="Record Receipt" />;
}
