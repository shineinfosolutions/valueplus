"use client";
import { PageShell } from "@/components/shared/page-shell";
import { Button } from "@/components/ui/button";
import { Plus, Construction } from "lucide-react";
import { toast } from "sonner";

interface ModuleStubProps {
  title: string;
  subtitle: string;
  breadcrumbs: Array<{ label: string; href?: string }>;
  description: string;
  ctaLabel?: string;
}

export function ModuleStub({ title, subtitle, breadcrumbs, description, ctaLabel }: ModuleStubProps) {
  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      breadcrumbs={breadcrumbs}
      actions={
        ctaLabel ? (
          <Button size="sm" onClick={() => toast.success(`${ctaLabel} form opening...`)}>
            <Plus className="w-4 h-4 mr-1.5" /> {ctaLabel}
          </Button>
        ) : undefined
      }
    >
      <div className="data-table-container flex flex-col items-center justify-center py-24 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#3F63AD]/10 flex items-center justify-center mb-4">
          <Construction className="w-8 h-8 text-[#3F63AD]" />
        </div>
        <h3 className="text-xl font-semibold text-foreground mb-2">{title} Module</h3>
        <p className="text-muted-foreground max-w-md text-sm">{description}</p>
        <p className="text-xs text-muted-foreground mt-3 font-medium">This module is part of the full ValuePlus ERP build.</p>
        {ctaLabel && (
          <Button className="mt-6" onClick={() => toast.success(`${ctaLabel} form opening...`)}>
            <Plus className="w-4 h-4 mr-1.5" /> {ctaLabel}
          </Button>
        )}
      </div>
    </PageShell>
  );
}
