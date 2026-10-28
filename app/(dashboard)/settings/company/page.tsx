"use client";
import { ModuleStub } from "@/components/shared/module-stub";
export default function CompanySettingsPage() {
  return <ModuleStub title="Company Settings" subtitle="Detailed company configuration" breadcrumbs={[{ label: "Settings" }, { label: "Company" }]} description="Configure detailed company information including logo, invoice footer, bank details, digital signature, terms and conditions for documents." />;
}
