"use client";
import { ModuleStub } from "@/components/shared/module-stub";
export default function BankingPaymentsPage() {
  return <ModuleStub title="Payments" subtitle="Bank payments and transfers" breadcrumbs={[{ label: "Banking" }, { label: "Payments" }]} description="Record outgoing payments to suppliers, expenses, and other payees. Reconcile with bank statements and purchase entries." ctaLabel="Record Payment" />;
}
