/**
 * Reads a finance company's Delivery Order (DO) PDF text into the fields the bill form needs.
 *
 * Every finance company lays its DO out differently, so each one has its own reader below
 * (Bajaj Finance, HDB Financial Services, IDFC First Bank). A DO from any other company still
 * gives whatever the generic reader can find (DO number, customer name, mobile), and the cashier
 * types the rest. Nothing here touches the database; it is pure text in, fields out.
 */

export interface ParsedDo {
  /** The name used in the bill form's Finance Provider list, or "" when the company is not recognised. */
  provider: string;
  doId: string;
  /** Deal / application id when it is a different number from the DO id (Bajaj's ATOS Deal ID). */
  appId: string;
  /** YYYY-MM-DD */
  date: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  customerPin: string;
  brand: string;
  category: string;
  model: string;
  serialNumber: string;
  scheme: string;
  tenureMonths: number;
  advanceEmiCount: number;
  emi: number;
  interestRate: number;
  productPrice: number;
  grossLoan: number;
  netLoan: number;
  marginMoney: number;
  advanceEmi: number;
  upfrontInterest: number;
  serviceCharge: number;
  subvention: number;
  subventionPercent: number;
  convenienceFee: number;
  totalGst: number;
  downPayment: number;
  totalDeductions: number;
  netDisbursement: number;
}

const EMPTY: ParsedDo = {
  provider: "", doId: "", appId: "", date: "",
  customerName: "", customerPhone: "", customerAddress: "", customerPin: "",
  brand: "", category: "", model: "", serialNumber: "", scheme: "",
  tenureMonths: 0, advanceEmiCount: 0, emi: 0, interestRate: 0,
  productPrice: 0, grossLoan: 0, netLoan: 0, marginMoney: 0, advanceEmi: 0, upfrontInterest: 0, serviceCharge: 0,
  subvention: 0, subventionPercent: 0, convenienceFee: 0, totalGst: 0, downPayment: 0, totalDeductions: 0, netDisbursement: 0,
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const num = (s?: string | null) => {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const AMOUNT = "([\\d,]+(?:\\.\\d+)?)";

/** The first amount that follows `label` on the same line. `label` is a regex source. */
function amountAfter(text: string, label: string): number {
  const m = text.match(new RegExp(`${label}[ \\t]*:?[ \\t]*${AMOUNT}`, "i"));
  return m ? num(m[1]) : 0;
}
function textAfter(text: string, label: string): string {
  const m = text.match(new RegExp(`${label}[ \\t]*:?[ \\t]*(.+)`, "i"));
  return m ? squash(m[1]) : "";
}
const isoDate = (y: string | number, m: string | number, d: string | number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "Mr. Sanjeev MOHAN dubey" -> "Sanjeev Mohan Dubey" (letters and spaces only, as the bill's name box allows). */
export function cleanPersonName(raw: string): string {
  return squash(
    String(raw || "")
      .replace(/^(?:mr|mrs|miss|ms|shri|smt)\b\.?\s*(?:\/\s*(?:miss|mrs|ms)\b\.?\s*)*/i, "")
      .replace(/[^a-zA-Z\s]/g, " ")
  )
    .toLowerCase()
    .replace(/(^|\s)([a-z])/g, (_, sp, ch) => sp + ch.toUpperCase());
}

const pinOf = (address: string) => address.match(/\b(\d{6})\b/)?.[1] || "";
const titleCase = (s: string) => squash(s).toLowerCase().replace(/(^|\s)([a-z])/g, (_, sp, ch) => sp + ch.toUpperCase());

function parseBajaj(t: string): ParsedDo {
  const r = { ...EMPTY, provider: "Bajaj Finance Limited" };
  r.doId = t.match(/DO ID\s*:\s*([A-Z0-9]+)/i)?.[1] || "";
  r.appId = t.match(/ATOS Deal ID\s*:\s*([A-Z0-9]+)/i)?.[1] || "";
  const d = t.match(/Date\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
  if (d) r.date = isoDate(d[3], d[2], d[1]);
  r.customerName = cleanPersonName(t.match(/application of\s+(.+?)\s+has been approved/i)?.[1] || "");
  r.category = squash(t.match(/(?:^|\n)Asset Category[ \t]+(.+)/i)?.[1] || "");
  const oem = textAfter(t, "OEM Asset Category");
  r.brand = titleCase((oem.split(/\s+-\s+/)[0] || textAfter(t, "Manufacturer").split(/\s/)[0] || "").trim());
  // "HAIER - LED - H43S80GFX": the model is the last part.
  r.model = squash((t.match(/\nModel[ \t]+(.+)/i)?.[1] || "").split(/\s+-\s+/).pop() || "");
  const sc = t.match(/Scheme Code \(GT\/AE\)\s*:?\s*(\S+)\s*\((\d+)\s*\/\s*(\d+)\)/i);
  if (sc) {
    r.scheme = sc[1];
    r.tenureMonths = num(sc[2]);
    r.advanceEmiCount = num(sc[3]);
  }
  r.productPrice = amountAfter(t, "Product Price");
  r.grossLoan = amountAfter(t, "Gross Loan Amount");
  r.netLoan = amountAfter(t, "Net Loan Amount");
  r.marginMoney = amountAfter(t, "Margin Money(?=[ \\t]+\\d)");
  r.advanceEmi = amountAfter(t, "Advance EMI(?=[ \\t]+\\d)");
  r.serviceCharge = amountAfter(t, "Service Charge");
  r.upfrontInterest = amountAfter(t, "Upfront Interest");
  const sub = t.match(/Dealer Interest Subsidy value \(%\)[ \t]*:?[ \t]*([\d,]+(?:\.\d+)?)(?:[ \t]*\(([\d.]+)%\))?/i);
  if (sub) {
    r.subvention = num(sub[1]);
    r.subventionPercent = num(sub[2]);
  }
  r.emi = amountAfter(t, "Total EMI");
  r.totalGst = amountAfter(t, "Total GST");
  r.convenienceFee = amountAfter(t, "Convenience Fee Charges");
  r.downPayment = amountAfter(t, "DP from Customer(?=[ \\t]+\\d)");
  r.totalDeductions = amountAfter(t, "Total Deductions(?=[ \\t]+\\d)");
  r.netDisbursement = amountAfter(t, "Net Disbursement(?=[ \\t]+\\d)");
  const addr = t.match(/Address of the customer for delivery\s*:\s*([\s\S]+?)\s*Mobile Number\s*:\s*(\d{10})/i);
  if (addr) {
    r.customerAddress = squash(addr[1]);
    r.customerPhone = addr[2];
    r.customerPin = pinOf(r.customerAddress);
  }
  return r;
}

function parseHdb(t: string): ParsedDo {
  const r = { ...EMPTY, provider: "HDB Financial Services" };
  r.doId = t.match(/HDB\/CDL\/DO\/(\d+)/i)?.[1] || t.match(/Parent Ref ID\s*:\s*(\d+)/i)?.[1] || "";
  const d = t.match(/Date\s*:\s*(\d{2})-(\d{2})-(\d{4})/);
  if (d) r.date = isoDate(d[3], d[2], d[1]);
  r.customerName = cleanPersonName(textAfter(t, "Customer Name"));
  r.customerPhone = t.match(/Mobile Number\s*:\s*(\d{10})/i)?.[1] || "";
  const addr = t.match(/Customer Address\s*:\s*([\s\S]+?)\s*Product Brand\s*:/i);
  if (addr) {
    r.customerAddress = squash(addr[1]).replace(/\.$/, "");
    r.customerPin = pinOf(r.customerAddress);
  }
  r.brand = titleCase(textAfter(t, "Product Brand"));
  r.category = titleCase(textAfter(t, "Product Catg & Make").replace(/\s*-\s*\S+$/, ""));
  r.model = textAfter(t, "Product Model");
  r.serialNumber = t.match(/IMEI\s*:[ \t]*(\S*)/i)?.[1] || "";
  const sc = t.match(/Scheme Code & EMI\s*:\s*(\d+)\s*-\s*(\S+)\s*-\s*\((\d+)\s*\/\s*(\d+)\)[^\n]*?EMI Rs\.?\s*([\d,]+)/i);
  if (sc) {
    r.scheme = `${sc[1]} ${sc[2]}`;
    r.tenureMonths = num(sc[3]);
    r.advanceEmiCount = num(sc[4]);
    r.emi = num(sc[5]);
  }
  r.productPrice = amountAfter(t, "A\\.Product Cost");
  r.marginMoney = amountAfter(t, "B\\.Margin Money");
  r.grossLoan = amountAfter(t, "C\\.Finance Amount\\(A-B\\)");
  r.totalDeductions = amountAfter(t, "D\\.Deductions by HDBFS");
  r.downPayment = amountAfter(t, "customer \\(1\\+2\\+4\\+5\\+6\\+B\\)");
  r.netLoan = amountAfter(t, "F\\.Net Loan Amount\\(C-2\\)");
  r.netDisbursement = amountAfter(t, "G\\.Final Disbursement Amount\\(C-D\\)");
  r.serviceCharge = amountAfter(t, "1\\.Processing Fees");
  r.advanceEmi = amountAfter(t, "2\\.Advance EMI");
  r.subvention = amountAfter(t, "3\\.Dealer Subvention");
  r.upfrontInterest = amountAfter(t, "4\\.Upfront Interest");
  r.convenienceFee = amountAfter(t, "5\\.Convenience Fee");
  return r;
}

function parseIdfc(t: string): ParsedDo {
  const r = { ...EMPTY, provider: "IDFC First Bank" };
  r.doId = t.match(/approval no\.?\s*(\d+)/i)?.[1] || t.match(/Application ID\s+(\d+)/i)?.[1] || "";
  const d = t.match(/Date\s*:\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/);
  if (d) {
    const mi = MONTHS.indexOf(d[1].toLowerCase());
    if (mi >= 0) r.date = isoDate(d[3], mi + 1, d[2]);
  }
  r.customerName = cleanPersonName(t.match(/loan application of\s+(.+?)\s+has been approved/i)?.[1] || textAfter(t, "Customer Name"));
  const brandCat = textAfter(t, "Brand \\| Asset Category");
  r.brand = titleCase(brandCat.split(" ")[0] || "");
  r.category = titleCase(brandCat.split(" ").slice(1).join(" "));
  r.model = textAfter(t, "Model Number");
  r.scheme = t.match(/Scheme Name[ \t]+(\S+)/i)?.[1] || "";
  r.interestRate = num(t.match(/ROI %[ \t]+([\d.]+)\s*%?/i)?.[1]);
  const ten = t.match(/Gross \| Net Tenor \(months\)[ \t]+(\d+)\s*\|\s*(\d+)/i);
  if (ten) r.tenureMonths = num(ten[1]);
  r.advanceEmiCount = num(t.match(/Advance EMIs \(no\.\)[ \t]+(\d+)/i)?.[1]);
  r.serialNumber = t.match(/Serial Number[ \t]+(\S+)/i)?.[1] || "";
  r.productPrice = amountAfter(t, "Cost Of Product");
  r.subventionPercent = amountAfter(t, "DBD % \\(excl\\. GST\\)");
  r.subvention = amountAfter(t, "DBD Amount \\(incl\\. GST\\)");
  r.downPayment = amountAfter(t, "Down Payment Collected \\(from customer\\)");
  r.netDisbursement = amountAfter(t, "Net Disbursement Amount");
  r.marginMoney = amountAfter(t, "Margin Money paid by customer");
  // This DA states no loan amount: the loan is the price less what the customer pays now.
  r.grossLoan = Math.max(0, r.productPrice - r.downPayment);
  r.netLoan = r.grossLoan;
  r.totalDeductions = r.subvention;
  const addr = t.match(/Customer Address\s*:\s*([\s\S]+?)\s*Thanking you/i);
  if (addr) {
    r.customerAddress = squash(addr[1]);
    r.customerPin = pinOf(r.customerAddress);
  }
  return r;
}

function parseGeneric(t: string): ParsedDo {
  const r = { ...EMPTY };
  r.doId = t.match(/(?:DO|Sanction|Approval)\s*(?:ID|No\.?|Number)\s*[:\-]?\s*([A-Z0-9]{6,})/i)?.[1] || "";
  r.customerName = cleanPersonName(textAfter(t, "Customer Name"));
  r.customerPhone = t.match(/Mobile(?: Number| No\.?)?\s*:?\s*(\d{10})/i)?.[1] || "";
  return r;
}

/** Fields of a DO, or null when the text is not recognisably a delivery order. */
export function parseDeliveryOrder(rawText: string): ParsedDo | null {
  const t = String(rawText || "").replace(/\r/g, "").replace(/[ \u00a0]+\n/g, "\n");
  let out: ParsedDo;
  if (/Bajaj Finance/i.test(t) && /DELIVERY ORDER/i.test(t)) out = parseBajaj(t);
  else if (/HDB Financial/i.test(t)) out = parseHdb(t);
  else if (/IDFC FIRST/i.test(t)) out = parseIdfc(t);
  else out = parseGeneric(t);
  const found = out.doId || out.customerName || out.provider;
  return found ? out : null;
}

/**
 * The finance record's figures taken from the DO the cashier uploaded, to replace the estimates the app would
 * otherwise make. Used only when the bill's DO number is that DO's number. The loan, deduction and payout
 * figures are used only while the down payment is still what the DO says (else the cashier changed the deal and
 * the bill's own figures are right) and the bill has no extra DOs splitting the loan.
 */
export function doRecordOverrides(body: any): Record<string, any> {
  const d: Partial<ParsedDo> | undefined = body?.financeDoData;
  if (!d || typeof d !== "object") return {};
  if (String(d.doId || "").trim() !== String(body.financeDoId || "").trim() || !String(d.doId || "").trim()) return {};
  const set = (o: Record<string, any>, k: string, v: any) => {
    if (v !== undefined && v !== null && v !== "" && !(typeof v === "number" && !Number.isFinite(v))) o[k] = v;
  };
  const o: Record<string, any> = {};
  set(o, "assetCategory", d.category);
  set(o, "brand", d.brand);
  set(o, "manufacturer", d.brand);
  set(o, "productModel", d.model);
  set(o, "schemeCode", d.scheme && d.tenureMonths ? `${d.scheme} (${d.tenureMonths}/${d.advanceEmiCount || 0})` : d.scheme);
  set(o, "tenureMonths", d.tenureMonths || undefined);
  set(o, "monthlyEmiAmount", d.emi || undefined);
  set(o, "totalEmi", d.emi || undefined);
  set(o, "serviceCharge", d.serviceCharge);
  set(o, "upfrontInterest", d.upfrontInterest);
  set(o, "convenienceFee", d.convenienceFee);
  set(o, "totalGst", d.totalGst);
  set(o, "advanceEmi", d.advanceEmi);
  set(o, "marginMoney", d.marginMoney);
  set(o, "dealerInterestSubsidy", d.subvention);
  set(o, "dealerSubsidyPercent", d.subventionPercent);

  const sameDown = Math.abs((Number(d.downPayment) || 0) - (Number(body.financeDownPayment ?? body.downPayment) || 0)) < 1;
  const hasExtraDos = Array.isArray(body.financeDos) && body.financeDos.some((r: any) => r && String(r.doId || "").trim());
  if (sameDown && !hasExtraDos) {
    set(o, "grossLoanAmount", d.grossLoan || undefined);
    set(o, "netLoanAmount", d.netLoan || d.grossLoan || undefined);
    set(o, "customerDownPayment", d.downPayment);
    set(o, "totalDeductions", d.totalDeductions);
    set(o, "netDisbursement", d.netDisbursement || undefined);
  }
  return o;
}
