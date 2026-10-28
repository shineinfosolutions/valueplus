/**
 * A supplier invoice line such as
 *
 *   "VP0012023 - GLS19I3AGAHF- LLOYD"
 *   "VP0010655 - LLOYD 55PS850G (QLED)- LLOYD"
 *   "VP0005313 - Voltas AquaM 155VMBWT Water Heater-4610002- VOLTAS"
 *
 * carries three things in one cell: the supplier's item code (VP0012023), the
 * model, and the brand after the last "- ". Saving the whole cell as a product
 * name is how products like "VP0012023 - GLS19I3AGAHF- LLOYD" with brand
 * "Unbranded" got into the catalog, next to the real "GLS19I3AGAHF- LLOYD".
 */

export interface SupplierLineParts {
  /** The supplier's own item code, e.g. "VP0012023"; "" when the line has none. */
  supplierCode: string;
  /** The model / description without the code and the brand, e.g. "GLS19I3AGAHF". */
  model: string;
  /** Brand written at the end of the line, e.g. "LLOYD"; "" when there is none. */
  brand: string;
}

const LEADING_CODE = /^\s*(VP-?\d{4,})\s*-\s*/i;
// The brand is the last "- WORD" on the line: letters only (with spaces), so a
// trailing "-4610002" article number or "-1" variant is never read as a brand.
const TRAILING_BRAND = /\s*-\s*([A-Za-z][A-Za-z &]{1,24})\s*$/;

export function splitSupplierLine(text: string): SupplierLineParts {
  let rest = String(text || "").replace(/\s+/g, " ").trim();
  let supplierCode = "";
  const code = rest.match(LEADING_CODE);
  if (code) {
    supplierCode = code[1].toUpperCase().replace("-", "");
    rest = rest.slice(code[0].length).trim();
  }
  let brand = "";
  const tail = rest.match(TRAILING_BRAND);
  if (tail) {
    brand = tail[1].trim().toUpperCase();
    rest = rest.slice(0, tail.index).trim();
  }
  // A dangling "-" left behind when the brand sat on a line of its own.
  rest = rest.replace(/\s*-\s*$/, "").trim();
  return { supplierCode, model: rest, brand };
}

/** The name a new product gets: "MODEL- BRAND", the catalog's own convention. */
export function productNameFromLine(parts: SupplierLineParts): string {
  if (!parts.model) return "";
  return parts.brand ? `${parts.model}- ${parts.brand}` : parts.model;
}

/**
 * A model reduced to letters and digits, without the supplier code, the
 * trailing brand or a leading brand word, so "LLOYD 55PS850G (QLED)- LLOYD"
 * and "VP0010655 - LLOYD 55PS850G (QLED)-" both become "55PS850GQLED".
 * "GLS19I3AGAHF OU" stays different from "GLS19I3AGAHF".
 */
export function modelKey(text: string, brandHint = ""): string {
  const parts = splitSupplierLine(text);
  let model = parts.model.toUpperCase();
  const brands = [parts.brand, String(brandHint || "").toUpperCase()].filter(Boolean);
  for (const b of brands) {
    if (model.startsWith(b + " ")) model = model.slice(b.length + 1);
  }
  return model.replace(/[^A-Z0-9]/g, "");
}
