"use client";
import { ModuleStub } from "@/components/shared/module-stub";
export default function TrialBalancePage() {
  return <ModuleStub title="Trial Balance" subtitle="Debit and credit summary" breadcrumbs={[{ label: "Accounting" }, { label: "Trial Balance" }]} description="Generate trial balance reports for any period. Verify that all debits equal credits and identify any accounting discrepancies." />;
}
