/**
 * The real VP code is the supplier's item code printed on the Value Plus Retail invoice: "VP" + 7 digits, e.g.
 * VP0014215. Codes like "VP-WW7O780074" or "ITM-61914114-2" were made up by older imports and are not VP codes.
 */
export const REAL_VP_CODE = /^VP\d{6,8}$/;

export const isRealVpCode = (code: any) => REAL_VP_CODE.test(String(code || "").trim().toUpperCase());

/** The newest real VP code a product has learned from purchase invoices (supplierCodes are added oldest first). */
export function realCodeFromSupplierCodes(codes: any): string {
  const list = (Array.isArray(codes) ? codes : []).map((c) => String(c || "").trim().toUpperCase()).filter(isRealVpCode);
  return list.length ? list[list.length - 1] : "";
}
