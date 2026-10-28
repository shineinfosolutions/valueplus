import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "INR"): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-IN").format(num);
}

export function formatDate(date: any, fmt = "dd MMM yyyy"): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (!(d instanceof Date) || isNaN(d.getTime())) return "-";
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const day = d.getDate().toString().padStart(2, "0");
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatDateShort(date: any): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  if (!(d instanceof Date) || isNaN(d.getTime())) return "-";
  const day = d.getDate().toString().padStart(2, "0");
  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    active: "badge-success",
    inactive: "badge-neutral",
    paid: "badge-success",
    unpaid: "badge-danger",
    partial: "badge-warning",
    pending: "badge-warning",
    confirmed: "badge-info",
    cancelled: "badge-danger",
    delivered: "badge-success",
    draft: "badge-neutral",
    approved: "badge-success",
    rejected: "badge-danger",
    open: "badge-info",
    closed: "badge-neutral",
    "in-transit": "badge-warning",
    received: "badge-success",
  };
  return map[status.toLowerCase()] ?? "badge-neutral";
}

export function truncate(str: string, n: number): string {
  return str.length > n ? str.substring(0, n) + "..." : str;
}

export function calcGST(amount: number, rate: number) {
  const taxAmount = (amount * rate) / 100;
  return { taxAmount, total: amount + taxAmount };
}

export function downloadJSON(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCSV(data: Record<string, unknown>[], filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(","),
    ...data.map((row) =>
      headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function indianNumberFormat(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n}`;
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
