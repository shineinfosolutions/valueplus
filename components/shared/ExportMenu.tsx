"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel } from "@/lib/export/excel";
import { exportToPdf, type ExportPdfOptions } from "@/lib/export/pdf";
import { toast } from "sonner";

/**
 * Drop-in replacement for the old single CSV export button: same `data` +
 * `filename` shape as `downloadCSV`, but lets the user pick Excel or PDF at
 * click time instead of always producing CSV.
 */
export function ExportMenu({
  data,
  filename,
  title,
  subtitle,
  columns,
  size = "sm",
  className,
}: {
  data: Record<string, unknown>[];
  /** Base filename, without extension — each format appends its own. */
  filename: string;
  /** PDF header title; defaults to the filename. */
  title?: string;
  subtitle?: string;
  columns?: ExportPdfOptions["columns"];
  size?: "sm" | "default" | "lg" | "icon";
  className?: string;
}) {
  const handleExport = (format: "excel" | "pdf") => {
    if (!data.length) {
      toast.error("Nothing to export");
      return;
    }
    if (format === "excel") {
      exportToExcel(data, filename);
    } else {
      exportToPdf(data, filename, { title: title || filename, subtitle, columns });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className={className}>
          <Download className="w-3.5 h-3.5 mr-1.5" /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("excel")} className="gap-2">
          <FileSpreadsheet className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("pdf")} className="gap-2">
          <FileText className="w-4 h-4 text-red-600" /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
