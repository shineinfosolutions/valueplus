"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type CategoryBrandChoice = { type: "category" | "brand"; name: string } | null;

/**
 * One search box for "category or brand": type a few letters and the matching categories and brands are listed
 * (grouped); pick one to filter the products by it. A picked choice shows as a chip with a cross to clear it.
 * Enter picks the first match, Escape closes the list.
 */
export function CategoryBrandSearch({
  categories,
  brands,
  value,
  onChange,
  className,
}: {
  categories: string[];
  brands: string[];
  value: CategoryBrandChoice;
  onChange: (choice: CategoryBrandChoice) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close when tapping outside.
  useEffect(() => {
    const away = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("touchstart", away);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("touchstart", away);
    };
  }, []);

  const q = text.trim().toLowerCase();
  const matches = useMemo(() => {
    const pick = (list: string[]) =>
      list
        .filter((n) => !q || n.toLowerCase().includes(q))
        // Names that start with what was typed come first.
        .sort((a, b) => Number(b.toLowerCase().startsWith(q)) - Number(a.toLowerCase().startsWith(q)) || a.localeCompare(b))
        .slice(0, 12);
    return { categories: pick(categories), brands: pick(brands) };
  }, [categories, brands, q]);
  const first: CategoryBrandChoice = matches.categories[0]
    ? { type: "category", name: matches.categories[0] }
    : matches.brands[0]
    ? { type: "brand", name: matches.brands[0] }
    : null;

  const choose = (choice: CategoryBrandChoice) => {
    onChange(choice);
    setText("");
    setOpen(false);
  };

  const Row = ({ type, name }: { type: "category" | "brand"; name: string }) => (
    <button
      type="button"
      onClick={() => choose({ type, name })}
      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-100"
    >
      <span className="truncate">{name}</span>
      <span className={cn("shrink-0 rounded px-1.5 text-[10px] font-bold", type === "category" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800")}>
        {type === "category" ? "Category" : "Brand"}
      </span>
    </button>
  );

  return (
    <div ref={box} className={cn("relative", className)}>
      {value ? (
        <div className="flex h-10 items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm">
          <span className="truncate">
            <span className={cn("mr-1.5 rounded px-1.5 text-[10px] font-bold", value.type === "category" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-800")}>
              {value.type === "category" ? "Category" : "Brand"}
            </span>
            {value.name}
          </span>
          <button type="button" aria-label="Clear" onClick={() => choose(null)} className="shrink-0 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={text}
            placeholder="Category or brand"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && first) {
                e.preventDefault();
                choose(first);
              } else if (e.key === "Escape") setOpen(false);
            }}
            className="h-10 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm outline-none focus:border-[#30539C] focus:ring-1 focus:ring-[#30539C]"
          />
        </div>
      )}
      {open && !value && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-md border bg-white py-1 shadow-lg">
          {matches.categories.length === 0 && matches.brands.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">No category or brand matches "{text}".</p>
          ) : (
            <>
              {matches.categories.length > 0 && <p className="px-3 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Categories</p>}
              {matches.categories.map((n) => <Row key={`c-${n}`} type="category" name={n} />)}
              {matches.brands.length > 0 && <p className="px-3 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Brands</p>}
              {matches.brands.map((n) => <Row key={`b-${n}`} type="brand" name={n} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
