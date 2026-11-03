# ValuePlus ERP — Suggestions by user

> Review date: 3 Nov 2026. These are improvements, not bugs (bugs are in `BUGS.md`). They are grouped by **who it helps**, and each is marked by how much work it is: **S** = small (hours), **M** = medium (a day or two), **L** = large.
> ⭐ = recommended first: high value for little work.

---

## 👑 Admin / Owner

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| A1 | ⭐ **Safety today:** change the MongoDB Atlas password, Cloudinary keys and `NEXTAUTH_SECRET`, then every staff password. The master passwords have been live (BUGS 1.1, 1.3). | Anyone who knew them could get in. | S |
| A2 | ⭐ **Turn on Atlas backups** (continuous backup / point-in-time restore) and try a restore once a month. | One wrong delete or bug today cannot be undone. | S |
| A3 | ⭐ **One "money truth" rule for all reports:** tax invoices minus credit notes, cancelled bills left out, India dates. Dashboard, P&L, Sales-out and GSTR then always agree. | Today each report counts differently (BUGS 5.1–5.4). | M |
| A4 | **"Money check" page:** bills where paid + advance + due ≠ total, advances marked available but already used, bills with no real customer, items where total stock ≠ showroom + godown, negative stock. | Finds the damage the bugs above have already done in live data. | M |
| A5 | **"Today" staff board:** who is in, late, on break (time left), outside the store, on leave, not come. | One screen instead of five. | M |
| A6 | **Approve / Reject right from the phone notification** (leave, break, discount, bill edit). | No need to open the app and find the request. | M |
| A7 | **9 PM daily summary on WhatsApp / bell:** sales, cash, dues collected, Onsitego plans sold, staff hours and away minutes, auto check-outs to look at. | The owner sees the day without opening reports. | M |
| A8 | **Before replacing the Onsitego plans, show a preview:** plans read per section, slabs that were auto-fixed, then "Use this list". | Catches a wrong PDF before it reaches the counter. | S |
| A9 | **Login security:** limit wrong-password tries, shorter sessions on shared counter phones (about 12 h), OTP for the Admin and Accounts logins. | Shared phones and simple passwords. | M |
| A10 | **Audit log for user, role, salary, bank and delete changes**, with who, when and from where; review it weekly. | Today many of these changes leave no trace. | M |

---

## 🧾 Cashier

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| C1 | ⭐ **Receive Payment: keep "Refund" behind its own red button**, and show "Advance with us ₹X" in green next to the customer's name. | Today it switches to refund by itself (BUGS 2.1); the cashier can't easily see what the customer already has with the shop. | S |
| C2 | ⭐ **On the bill, list each advance receipt with a tick** ("ADV-0012 · ₹10,000 · ₹4,000 left"), instead of one total. | The cashier knows exactly which receipt is used; nothing is hidden (BUGS 2.2). | M |
| C3 | ⭐ **"Collect due" button on every bill row**, filled with the real balance (total − advance − paid). | Faster than Receive Payment plus typing the amount, and no wrong balances. | S |
| C4 | **Warn when another bill for the same mobile was saved in the last few minutes.** | Stops double bills and double use of an advance. | S |
| C5 | **Onsitego plan: warn on the line when the price no longer fits the chosen slab** (rate or discount changed). | The right SKU is sold; the claim is not rejected. | S |
| C6 | **Day-close with a carried-forward opening float.** | The drawer's leftover cash stops showing as "excess" every day. | M |
| C7 | **Don't allow "Cash" mode on a bill that still has a balance:** make it Due or Split. | Keeps the cash register clean. | S |
| C8 | **Show the cash handover status at check-out time.** | Nobody leaves with a pending handover. | S |

---

## 👔 Salesman

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| S1 | ⭐ **"You earned ₹X on this bill"** right after a bill is made (product incentive + Onsitego 10%). | Motivating, and the salesman can check it straight away. | S |
| S2 | ⭐ **Real target progress bar on the dashboard** (₹ and units left, days left), from his assigned targets, instead of the fixed 25k / 125k / 500k figures. | He sees what is actually expected of him. | S |
| S3 | **"My bills" list:** each estimate or bill he sent, with its status (waiting, invoiced with number and final amount, rejected with reason). | He knows if the cashier changed the price. | M |
| S4 | **Onsitego per bill on the Incentive card**, with VP Code and slab. | Easy to check his 10%. | S |
| S5 | **Onsitego plans to show the customer:** a "Plans for this product" button on the product view (not only inside the bill). | He can pitch the plan before the bill is made. | S |
| S6 | **Lead follow-up reminders as phone notifications at the follow-up time.** | Follow-ups are not missed. | M |

---

## 🏬 Store Manager

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| M1 | ⭐ **Stock transfer: cancel (puts stock back) instead of delete**, with a received-by name and photo on receipt. | Stock is never lost (BUGS 4.1). | M |
| M2 | **Live Audit per location, and "blind" counting** (the expected figure is hidden while counting). | Honest counts and correct differences (BUGS 4.5). | M |
| M3 | **Team target bar when one target is given to several people:** combined progress plus each person's. | Uses today's "one task for many people". | S |

---

## 👥 HR

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| H1 | ⭐ **Monthly attendance sheet per person** (Present / Late / Half-Day / Absent / Leave, away minutes) feeding straight into salary. | Payroll without counting by hand. | M |
| H2 | **"Edit with reason" on every manual attendance change**, with history. | Disputes can be settled. | S |
| H3 | **Leave balance on the leave page** (weekly offs used this month, leaves taken this year). | Staff and HR see what is left. | S |
| H4 | **Salary advance as a request** that the Admin approves, then it is deducted from salary automatically. | Today the request adds the money at once (BUGS 3.1). | M |

---

## 🏭 Godown incharge

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| G1 | ⭐ **Check-in at the godown's own location** (a second geofence). | Today they can't check in and get late alerts (BUGS 3.4). | S |
| G2 | **"Coming to my godown" inbox:** in-transit transfers, received by scanning the IMEI. | No missed or wrong receipts. | M |
| G3 | **Alert when a purchase bill has fewer IMEIs than its quantity**, before the stock can be sold. | Every unit has its serial. | S |

---

## 🚚 Delivery boy

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| D1 | ⭐ **A small "My deliveries" list** with only his own, not-cancelled deliveries, without OTP or prices. | Faster on mobile data, and safe (BUGS 1.6, 6.1). | S |
| D2 | **Check-in by the first delivery of the day or at the godown**, and show "on delivery" instead of "absent". | Fair attendance for staff who are always out. | S |
| D3 | **Record GPS and time with the delivery photos.** | Proof of delivery at the right place. | S |

---

## 🙋 Customer

| # | Suggestion | Why | Size |
|---|-----------|-----|------|
| U1 | ⭐ **One WhatsApp message after billing:** bill total, advance used (with receipt numbers), paid now, balance and due date. | Clear and trustworthy; fewer calls to the shop. | S |
| U2 | ⭐ **The delivery OTP is sent only to the customer** (SMS / WhatsApp). The tracking link uses a random code and shows only status, ETA and the driver's first name. | Their order can't be marked delivered without them (BUGS 1.5). | M |
| U3 | **The advance receipt shows "used on bill #… ₹…" and what is left after each bill.** | The customer always knows their advance. | S |
| U4 | **The printed bill lists each Onsitego plan** with VP Code, years, certificate / policy number and how to claim. | The customer can claim without calling the shop. | S |
| U5 | **Due reminder on WhatsApp** a day before the due date, with a UPI link. | Dues come in faster. | M |

---

## Suggested order of work

1. **Now:** A1, A2 (safety), and the BUGS section 1 security fixes.
2. **This week:** the money bugs (BUGS 2.1–2.12), plus C1, C2, C3 and U1.
3. **Next:** A3 and A4 (correct reports and a check of live data), then G1, D1, S1, S2 and H1.
4. **Later:** everything else, by what the shop asks for most.
