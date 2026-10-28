"use client";

import { Building2, Check, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { BILLING_ENTITY_LIST, type BillingEntity } from "@/lib/billing-entity";

/**
 * The "Value Plus or Ashoka Enterprises?" question, asked at the top of a
 * purchase entry and of a bill. Nothing is selected to begin with — it has to be
 * answered, because the answer decides which products the form will offer.
 */
export function BillingEntityPicker({
  value,
  onChange,
  question,
  hint,
  className,
}: {
  value: BillingEntity | "";
  onChange: (entity: BillingEntity) => void;
  question: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white p-4 rounded-xl border shadow-sm",
        value ? "border-slate-200" : "border-amber-300 ring-2 ring-amber-100",
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wider text-[#3F63AD]">{question}</p>
          {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:w-[380px] flex-shrink-0">
          {BILLING_ENTITY_LIST.map((entity) => {
            const selected = value === entity.key;
            const Icon = entity.key === "valueplus" ? Store : Building2;
            return (
              <button
                key={entity.key}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(entity.key)}
                className={cn(
                  "h-11 px-3 rounded-lg border text-xs font-bold flex items-center justify-center gap-2 transition-all",
                  selected
                    ? "bg-[#3F63AD] border-[#3F63AD] text-white shadow-sm"
                    : "bg-slate-50 border-slate-300 text-slate-700 hover:border-[#3F63AD] hover:bg-blue-50"
                )}
              >
                {selected ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                <span className="truncate">{entity.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Small "Value Plus" / "Ashoka Enterprises" tag for lists. */
export function BillingEntityBadge({ entity, className }: { entity: BillingEntity; className?: string }) {
  const info = BILLING_ENTITY_LIST.find((e) => e.key === entity) || BILLING_ENTITY_LIST[0];
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide border whitespace-nowrap",
        entity === "ashoka"
          ? "bg-amber-50 text-amber-800 border-amber-200"
          : "bg-blue-50 text-[#30539C] border-blue-200",
        className
      )}
    >
      {info.label}
    </span>
  );
}
