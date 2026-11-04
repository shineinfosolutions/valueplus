# Builds docs/ValuePlus_Feature_Checklist.html from checklist_data.py; print it to PDF with Edge (see memory.md).
import html
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from checklist_data import SECTIONS  # noqa: E402

esc = html.escape
BOX = '<span class="box"></span>'

css = """
@page { size: A4 landscape; margin: 14mm 14mm 14mm 14mm; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; }
body { font-family: "Segoe UI", Inter, Arial, sans-serif; color: #1b2537; font-size: 9.6pt; line-height: 1.45; }
@media screen { body { max-width: 1123px; margin: 0 auto; padding: 24px 30px; } }
.cover { background: #1B2537; color: #fff; padding: 20px 26px; border-radius: 10px; border-left: 8px solid #76C043; }
.cover h1 { margin: 0; font-size: 20pt; }
.cover p { margin: 6px 0 0; color: #cfd8e6; font-size: 10pt; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 10px; }
.meta div { border: 1px solid #d5dce8; border-radius: 6px; padding: 8px 10px; min-height: 46px; }
.meta b { display: block; font-size: 8.5pt; color: #5b6b85; text-transform: uppercase; letter-spacing: .3px; }
.how { border: 1px solid #d5dce8; background: #f6f8fc; border-radius: 6px; padding: 10px 14px; margin: 0 0 6px; }
.how ol { margin: 4px 0 0 18px; padding: 0; }
.how li { margin: 2px 0; }
h2 { font-size: 12.5pt; color: #1B2537; margin: 20px 0 6px; padding: 6px 10px; background: #eef2f8; border-left: 5px solid #76C043; border-radius: 4px;
     display: flex; justify-content: space-between; align-items: baseline; page-break-after: avoid; break-after: avoid; }
h2 small { font-size: 9pt; font-weight: 600; color: #30539C; }
table { border-collapse: collapse; width: 100%; margin: 0 0 6px; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; break-inside: avoid; }
th, td { border: 1px solid #cfd7e4; padding: 6px 8px; vertical-align: top; text-align: left; }
th { background: #1B2537; color: #fff; font-size: 8.8pt; font-weight: 600; }
td.no { width: 46px; font-weight: 700; color: #30539C; white-space: nowrap; }
td.chk { width: 30%; }
td.exp { width: 31%; }
td.ok, td.iss, th.ok, th.iss { width: 52px; text-align: center; }
td.rem { width: auto; }
.box { display: inline-block; width: 15px; height: 15px; border: 1.6px solid #1b2537; border-radius: 3px; margin-top: 1px; }
.warn { display: block; margin-top: 4px; padding: 3px 6px; background: #fff7e6; border: 1px solid #f3c56b; border-radius: 4px; color: #8a5300; font-size: 8.4pt; }
.summary td, .summary th { padding: 3px 10px; font-size: 9pt; }
.summary tr { height: 21px; }
.summary th { background: #1B2537; }
.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 30px; page-break-inside: avoid; }
.sign div { border-top: 1.5px solid #1b2537; padding-top: 6px; font-size: 9.5pt; }
.legend { font-size: 9pt; color: #44536b; margin: 6px 0 0; }
.pb { page-break-before: always; break-before: page; }
"""

total = sum(len(items) for _, _, items in SECTIONS)
known = sum(1 for _, _, items in SECTIONS for *_, w in items if w)

parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ValuePlus ERP — Feature Checklist</title><style>{css}</style></head><body>
<div class="cover"><h1>ValuePlus ERP — Feature Acceptance Checklist</h1>
<p>Check every point with the client and tick OK or Issue · {total} points in {len(SECTIONS)} sections · Live site: valuplus.shineinfosolutions.in · Prepared 3 November 2026</p></div>
<div class="meta">
<div><b>Tested by (developer)</b></div><div><b>Client / Store representative</b></div><div><b>Date of testing</b></div><div><b>App version / Phone used</b></div>
</div>
<div class="how"><b>How to use this checklist</b>
<ol>
<li>Log in with the role shown on the right of each section heading (on the live site or the Android app).</li>
<li>Do what the <b>What to check</b> column says and compare with <b>Expected result</b>.</li>
<li>Tick <b>OK</b> when it works exactly as written, or <b>Issue</b> when anything differs, and write what happened in <b>Remarks</b>.</li>
<li>Points marked <span class="warn" style="display:inline;padding:1px 5px">⚠</span> are already known issues (listed in BUGS.md, {known} points). Show them to the client as known and note the agreed fix date.</li>
</ol></div>
<p class="legend">☐ OK = works as expected &nbsp; · &nbsp; ☐ Issue = does not work / differs (write details in Remarks)</p>
"""]

n_sec = 0
for title, role, items in SECTIONS:
    n_sec += 1
    parts.append(f'<h2><span>{n_sec}. {esc(title)}</span><small>Test as: {esc(role)}</small></h2>')
    parts.append('<table><thead><tr><th>No.</th><th>What to check</th><th>Expected result</th><th class="ok">OK</th><th class="iss">Issue</th><th>Remarks</th></tr></thead><tbody>')
    for i, (check, expected, warn) in enumerate(items, 1):
        w = f'<span class="warn">{esc(warn)}</span>' if warn else ""
        parts.append(
            f'<tr><td class="no">{n_sec}.{i}</td><td class="chk">{esc(check)}</td><td class="exp">{esc(expected)}{w}</td>'
            f'<td class="ok">{BOX}</td><td class="iss">{BOX}</td><td class="rem"></td></tr>'
        )
    parts.append("</tbody></table>")

# Summary and sign-off
parts.append('<h2 class="pb"><span>Summary</span><small>Fill in after testing</small></h2>')
parts.append('<table class="summary"><thead><tr><th>No.</th><th>Section</th><th>Points</th><th>OK</th><th>Issue</th><th>Notes / agreed fix date</th></tr></thead><tbody>')
for i, (title, _, items) in enumerate(SECTIONS, 1):
    parts.append(f'<tr><td class="no">{i}</td><td>{esc(title)}</td><td>{len(items)}</td><td></td><td></td><td></td></tr>')
parts.append(f'<tr><td></td><td><b>Total</b></td><td><b>{total}</b></td><td></td><td></td><td></td></tr></tbody></table>')
parts.append('<div class="sign"><div>Developer signature</div><div>Client / Owner signature</div><div>Date</div></div>')
parts.append("</body></html>")

out = os.path.join(os.path.dirname(__file__), "ValuePlus_Feature_Checklist.html")
open(out, "w", encoding="utf-8").write("\n".join(parts))
print(f"{total} points, {known} known issues -> {out}")
