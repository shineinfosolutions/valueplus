/**
 * The store bills under two names: Value Plus, and Ashoka Enterprises for
 * products that fall outside Value Plus. Every product belongs to exactly one of
 * them — decided when it is purchased — and an invoice is raised under one of
 * them and can only carry that company's products.
 *
 * Called "billing entity" in code because "billing company" already means the
 * customer's GST company (see models/BillingCompany.ts).
 *
 * Kept free of imports so both the server routes and the client forms can use it.
 */

export type BillingEntity = "valueplus" | "ashoka";

export interface BillingEntityInfo {
  key: BillingEntity;
  /** Short name shown on buttons, badges and filters. */
  label: string;
  /** Name printed on the bill. */
  printName: string;
  /** Tax-invoice number series. */
  invoicePrefix: string;
  invoicePad: number;
}

export const BILLING_ENTITIES: Record<BillingEntity, BillingEntityInfo> = {
  valueplus: {
    key: "valueplus",
    label: "Value Plus",
    printName: "M/S ASHOKA ENTERPRISES",
    invoicePrefix: "SVAK2026RI",
    invoicePad: 5,
  },
  ashoka: {
    key: "ashoka",
    label: "Ashoka Enterprises",
    printName: "M/S ASHOKA ENTERPRISES",
    invoicePrefix: "INV2026-",
    invoicePad: 4,
  },
};

export const BILLING_ENTITY_LIST: BillingEntityInfo[] = [BILLING_ENTITIES.valueplus, BILLING_ENTITIES.ashoka];

/**
 * Anything recorded before the two were told apart — every existing product,
 * purchase and bill — belongs to Value Plus.
 */
export function entityOf(value: any): BillingEntity {
  const raw = typeof value === "string" ? value : value?.billingEntity;
  return String(raw || "").toLowerCase().trim() === "ashoka" ? "ashoka" : "valueplus";
}

export function entityLabel(value: any): string {
  return BILLING_ENTITIES[entityOf(value)].label;
}

/** True only for an explicit, valid choice — used where the form must be answered. */
export function isBillingEntity(value: any): value is BillingEntity {
  return value === "valueplus" || value === "ashoka";
}

/**
 * The series a tax-invoice number belongs to, so the next number in that series
 * can be worked out. Longest prefix first, so one series can never be mistaken
 * for another that merely starts the same way.
 */
export function invoiceSeriesOf(invoiceNumber: string): BillingEntityInfo | null {
  const number = String(invoiceNumber || "");
  return (
    BILLING_ENTITY_LIST.slice()
      .sort((a, b) => b.invoicePrefix.length - a.invoicePrefix.length)
      .find((e) => number.startsWith(e.invoicePrefix)) || null
  );
}
