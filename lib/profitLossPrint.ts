/**
 * The Profit & Loss statement as a finished A4 document (like an invoice): company header,
 * period, summary, GST, expenses, category / brand margins and every product sold.
 *
 * It is a complete HTML page with its own CSS, shown in an iframe for the preview and
 * printed from that same iframe, so what is on screen is what comes out of the printer,
 * and nothing of the dashboard (menus, buttons, scroll boxes) gets into the print.
 */

const esc = (v: any) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const inr = (n: any) => {
  const v = Number(n) || 0;
  return `${v < 0 ? "-" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
};
const pct = (n: any) => `${Number(n) || 0}%`;

export interface ProfitLossPrintData {
  summary: any;
  products: any[];
  categories: any[];
  brands: any[];
  expenses: any[];
  periodLabel: string;
  generatedBy?: string;
}

export function buildProfitLossHtml(d: ProfitLossPrintData): string {
  const s = d.summary || {};
  const net = Number(s.netProfit) || 0;
  const generated = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const rowsFor = (list: any[], cols: (r: any, i: number) => string, empty: string, span: number) =>
    list.length === 0 ? `<tr><td colspan="${span}" class="empty">${empty}</td></tr>` : list.map((r, i) => `<tr>${cols(r, i)}</tr>`).join("");

  const productRows = rowsFor(
    d.products,
    (p, i) => `
      <td class="c">${i + 1}</td>
      <td><b>${esc(p.name)}</b><div class="sub">${esc(p.vpCode || p.code || "")}${p.brand ? ` · ${esc(p.brand)}` : ""}</div></td>
      <td class="c">${esc(p.qtySold)}</td>
      <td class="r">${inr(p.purchasePrice)}</td>
      <td class="r">${inr(p.avgSellingPrice)}</td>
      <td class="r">${inr(p.totalCost ?? (Number(p.purchasePrice) || 0) * (Number(p.qtySold) || 0))}</td>
      <td class="r">${inr(p.totalRevenue)}</td>
      <td class="r ${Number(p.totalProfit) < 0 ? "neg" : "pos"}"><b>${inr(p.totalProfit)}</b></td>
      <td class="c">${pct(p.marginPct)}</td>`,
    "No products were sold in this period.",
    9
  );

  const marginRows = (list: any[]) =>
    rowsFor(
      list,
      (r) => `
      <td><b>${esc(r.name)}</b></td>
      <td class="c">${esc(r.qty)}</td>
      <td class="r">${inr(r.revenue)}</td>
      <td class="r">${inr(r.cost)}</td>
      <td class="r ${Number(r.profit) < 0 ? "neg" : "pos"}"><b>${inr(r.profit)}</b></td>
      <td class="c">${pct(r.marginPct)}</td>`,
      "Nothing sold in this period.",
      6
    );

  const expenseRows = rowsFor(
    d.expenses,
    (e) => `<td>${esc(e.category)}</td><td class="r">${inr(e.amount)}</td><td class="c">${pct(e.percentage)}</td>`,
    "No expenses recorded in this period.",
    3
  );

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>Profit and Loss ${esc(d.periodLabel)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; color: #0f172a; font-family: 'Inter', 'Segoe UI', Arial, sans-serif; font-size: 11px; line-height: 1.4; }
  .page { width: 100%; max-width: 190mm; margin: 0 auto; padding: 4mm 0; }
  .head { text-align: center; border-bottom: 2px solid #1b2537; padding-bottom: 8px; }
  .head h1 { margin: 0; font-size: 18px; letter-spacing: .3px; text-transform: uppercase; }
  .head .tag { color: #3f63ad; font-weight: 700; font-size: 11px; margin-top: 2px; }
  .head .addr { color: #64748b; font-size: 10px; margin-top: 2px; }
  .title { margin: 10px 0 2px; display: flex; justify-content: space-between; align-items: flex-end; gap: 8px; }
  .title h2 { margin: 0; font-size: 14px; text-transform: uppercase; letter-spacing: .5px; }
  .title .meta { text-align: right; color: #475569; font-size: 10px; }
  .badge { display: inline-block; background: #eef2ff; color: #1b2537; border: 1px solid #c7d2fe; border-radius: 4px; padding: 2px 8px; font-weight: 700; }
  h3 { margin: 14px 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; color: #334155; border-left: 3px solid #3f63ad; padding-left: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
  th { background: #f1f5f9; font-size: 9.5px; text-transform: uppercase; letter-spacing: .3px; text-align: left; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .c { text-align: center; }
  .sub { color: #64748b; font-size: 9px; }
  .pos { color: #047857; } .neg { color: #be123c; }
  .empty { text-align: center; color: #94a3b8; padding: 10px; }
  .summary td { padding: 6px 8px; font-size: 11.5px; }
  .summary .sum-row td { background: #f8fafc; font-weight: 800; }
  .summary .net td { background: ${net >= 0 ? "#d1fae5" : "#ffe4e6"}; color: ${net >= 0 ? "#065f46" : "#9f1239"}; font-size: 13px; font-weight: 900; }
  .cards { display: flex; gap: 6px; }
  .card { flex: 1; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 8px; }
  .card .k { font-size: 9px; text-transform: uppercase; color: #64748b; font-weight: 700; }
  .card .v { font-size: 13px; font-weight: 900; margin-top: 2px; }
  .note { color: #64748b; font-size: 9.5px; margin-top: 4px; }
  .two { display: flex; gap: 8px; align-items: flex-start; } .two > div { flex: 1; }
  .sign { margin-top: 28px; display: flex; justify-content: space-between; font-size: 10px; color: #475569; }
  .sign div { width: 42%; border-top: 1px solid #94a3b8; padding-top: 4px; text-align: center; }
  .foot { margin-top: 10px; text-align: center; color: #94a3b8; font-size: 9px; }
</style></head>
<body><div class="page">
  <div class="head">
    <h1>M/S Ashoka Enterprises</h1>
    <div class="tag">VALUE PLUS RETAIL ELECTRONICS &amp; APPLIANCES</div>
    <div class="addr">Kunraghat, Gorakhpur · GSTIN: 09ANHPJ7242D1Z2</div>
  </div>
  <div class="title">
    <div><h2>Profit &amp; Loss Statement</h2><span class="badge">${esc(d.periodLabel)}</span></div>
    <div class="meta">Generated: ${esc(generated)}${d.generatedBy ? `<br/>By: ${esc(d.generatedBy)}` : ""}<br/>${esc(s.totalInvoices || 0)} bills · ${esc(s.totalUnitsSold || 0)} items sold</div>
  </div>

  <h3>Summary</h3>
  <table class="summary">
    <thead><tr><th>Particulars</th><th class="r">Amount (₹)</th></tr></thead>
    <tbody>
      <tr><td><b>Sales revenue</b> (amount billed, GST included)</td><td class="r"><b>${inr(s.totalRevenue)}</b></td></tr>
      <tr><td>Less: Cost of goods sold (purchase cost of items sold)</td><td class="r">${inr(s.totalCOGS)}</td></tr>
      <tr class="sum-row"><td>GROSS PROFIT (${pct(s.grossMarginPct)})</td><td class="r">${inr(s.grossProfit)}</td></tr>
      <tr><td>Less: Operating expenses</td><td class="r">${inr(s.totalExpenses)}</td></tr>
      <tr class="net"><td>${net >= 0 ? "NET PROFIT" : "NET LOSS"} (${pct(s.netMarginPct)})</td><td class="r">${inr(s.netProfit)}</td></tr>
    </tbody>
  </table>

  <h3>GST this period (not part of profit)</h3>
  <div class="cards">
    <div class="card"><div class="k">GST on sales (collected)</div><div class="v">${inr(s.salesGst)}</div></div>
    <div class="card"><div class="k">GST on purchases (paid)</div><div class="v">${inr(s.purchaseGst)}</div></div>
    <div class="card"><div class="k">${(Number(s.netGst) || 0) > 0 ? "Net GST to pay" : "Purchase GST more than sales GST"}</div><div class="v">${inr(Math.abs(Number(s.netGst) || 0))}</div></div>
    <div class="card"><div class="k">Purchases (GST included)</div><div class="v">${inr(s.totalPurchases)}</div><div class="note" style="margin:0">${esc(s.totalPurchaseBills || 0)} bills</div></div>
  </div>

  <h3>Operating expenses</h3>
  <table><thead><tr><th>Expense</th><th class="r">Amount</th><th class="c">Share</th></tr></thead><tbody>${expenseRows}</tbody></table>

  <div class="two">
    <div>
      <h3>Category margins</h3>
      <table><thead><tr><th>Category</th><th class="c">Qty</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="c">%</th></tr></thead><tbody>${marginRows(d.categories)}</tbody></table>
    </div>
    <div>
      <h3>Brand margins</h3>
      <table><thead><tr><th>Brand</th><th class="c">Qty</th><th class="r">Sales</th><th class="r">Cost</th><th class="r">Profit</th><th class="c">%</th></tr></thead><tbody>${marginRows(d.brands)}</tbody></table>
    </div>
  </div>

  <h3>Product-wise profit &amp; loss (${d.products.length} product${d.products.length === 1 ? "" : "s"})</h3>
  <table>
    <thead><tr><th class="c">#</th><th>Product</th><th class="c">Qty</th><th class="r">Cost rate</th><th class="r">Selling rate</th><th class="r">Total cost</th><th class="r">Total sales</th><th class="r">Profit / loss</th><th class="c">%</th></tr></thead>
    <tbody>${productRows}</tbody>
  </table>
  <div class="note">Sales are the amount billed with GST included. Cost is the purchase cost the bill line was sold at.</div>

  <div class="sign"><div>Prepared by</div><div>Authorized signatory</div></div>
  <div class="foot">Generated by Value Plus ERP Accounting System</div>
</div></body></html>`;
}
