"use client";

import React, { useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { todayInIndia } from "@/lib/today";

export const DATE_FILTER_OPTIONS = [
  { label: "Today", value: "Today" },
  { label: "Yesterday", value: "Yesterday" },
  { label: "Last 7 Days", value: "Last 7 Days" },
  { label: "This Month", value: "This Month" },
  { label: "Last Month", value: "Last Month" },
  { label: "Last 3 Months", value: "Last 3 Months" },
  { label: "Last Year", value: "Last Year" },
  { label: "Custom Date Range", value: "Custom Date" },
] as const;

export type DateFilterType = (typeof DATE_FILTER_OPTIONS)[number]["value"];

export function resolveDateRange(filter: string, customStart?: string, customEnd?: string) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  let start = todayInIndia();
  let end = todayInIndia();

  if (filter === "Yesterday") {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    start = y.toISOString().split("T")[0];
    end = start;
  } else if (filter === "Last 7 Days") {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    start = d.toISOString().split("T")[0];
    end = todayInIndia();
  } else if (filter === "This Month") {
    const d = new Date();
    d.setDate(1);
    start = d.toISOString().split("T")[0];
    end = todayInIndia();
  } else if (filter === "Last Month") {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    d.setDate(1);
    const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    start = d.toISOString().split("T")[0];
    end = endD.toISOString().split("T")[0];
  } else if (filter === "Last 3 Months") {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    start = d.toISOString().split("T")[0];
    end = todayInIndia();
  } else if (filter === "Last Year") {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    start = d.toISOString().split("T")[0];
    end = todayInIndia();
  } else if (filter === "Custom Date" && customStart && customEnd) {
    start = customStart;
    end = customEnd;
  }

  return { start, end };
}

export function isDateInRange(itemDate: string | Date | undefined, start: string, end: string): boolean {
  if (!itemDate) return true;
  const d = new Date(itemDate);
  if (isNaN(d.getTime())) return true;
  const s = new Date(start);
  s.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(23, 59, 59, 999);
  return d >= s && d <= e;
}

interface DateRangeFilterProps {
  value: string;
  onChange: (value: string, start?: string, end?: string) => void;
  className?: string;
  size?: "sm" | "default";
  showIcon?: boolean;
  placeholder?: string;
}

export function DateRangeFilter({
  value,
  onChange,
  className = "w-[140px]",
  size = "sm",
  showIcon = false,
  placeholder = "Select Date",
}: DateRangeFilterProps) {
  const [customModalOpen, setCustomModalOpen] = useState(false);
  const [tempStart, setTempStart] = useState(() => todayInIndia());
  const [tempEnd, setTempEnd] = useState(() => todayInIndia());

  const handleSelectChange = (val: string) => {
    if (val === "Custom Date") {
      setCustomModalOpen(true);
    } else {
      const { start, end } = resolveDateRange(val);
      onChange(val, start, end);
    }
  };

  const handleApplyCustom = () => {
    setCustomModalOpen(false);
    onChange("Custom Date", tempStart, tempEnd);
  };

  return (
    <>
      <Select value={value} onValueChange={handleSelectChange}>
        <SelectTrigger className={`h-8 text-xs font-semibold bg-slate-50 border-slate-300 text-slate-700 shadow-sm hover:bg-slate-100/80 transition-colors ${className}`}>
          <div className="flex items-center gap-1.5 truncate">
            {showIcon && <CalendarIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />}
            <SelectValue placeholder={placeholder} />
          </div>
        </SelectTrigger>
        <SelectContent className="text-xs">
          {DATE_FILTER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="text-xs py-1.5 cursor-pointer">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Custom Date Range Picker Modal */}
      <Dialog open={customModalOpen} onOpenChange={setCustomModalOpen}>
        <DialogContent className="max-w-sm p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-slate-800">
              <CalendarIcon className="w-4 h-4 text-[#3F63AD]" /> Custom Date Range
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 pt-2">
            <div>
              <Label className="text-xs font-semibold text-slate-600">From Date (Start)</Label>
              <Input
                type="date"
                value={tempStart}
                onChange={(e) => setTempStart(e.target.value)}
                className="h-9 text-xs mt-1"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold text-slate-600">To Date (End)</Label>
              <Input
                type="date"
                value={tempEnd}
                onChange={(e) => setTempEnd(e.target.value)}
                className="h-9 text-xs mt-1"
              />
            </div>
          </div>
          <DialogFooter className="pt-3 gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setCustomModalOpen(false)}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleApplyCustom} className="bg-[#3F63AD] hover:bg-[#2E4F95] text-white font-bold">
              Apply Range
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
