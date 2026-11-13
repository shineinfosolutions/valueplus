// Who gets which part of GET /api/me/summary, its live paths, and how the answer is shaped.
// Run: node_modules/.bin/esbuild tests/me-summary.test.ts --bundle --platform=node --outfile=tests/.out/me-summary.cjs --alias:@=. && node tests/.out/me-summary.cjs
import assert from "node:assert/strict";
import { shapeMeSummary, summaryLivePaths, summarySectionsForRole } from "@/lib/me-summary";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

const sorted = (a: string[]) => [...a].sort();

test("parts per role match the roles each component fetched for before", () => {
  assert.deepEqual(sorted(summarySectionsForRole("admin")), sorted(["notifications", "approvals", "estimates", "leaves", "discounts", "financeReminders"]));
  assert.deepEqual(sorted(summarySectionsForRole("superadmin")), sorted(["notifications", "approvals", "estimates", "leaves", "discounts"]));
  assert.deepEqual(sorted(summarySectionsForRole("manager")), sorted(["notifications", "estimates", "leaves", "discounts", "financeReminders"]));
  assert.deepEqual(sorted(summarySectionsForRole("cashier")), sorted(["notifications", "estimates", "discounts", "dayClose"]));
  assert.deepEqual(sorted(summarySectionsForRole("accounts")), sorted(["notifications", "dayClose", "financeReminders"]));
  assert.deepEqual(sorted(summarySectionsForRole("salesman")), sorted(["notifications", "leadShareInbox"]));
  assert.deepEqual(sorted(summarySectionsForRole("Sales")), sorted(["notifications", "leadShareInbox"]));
  assert.deepEqual(summarySectionsForRole("driver"), ["notifications"]);
  assert.deepEqual(summarySectionsForRole(""), []);
});

test("live paths: union of what the components watched, always with notifications", () => {
  assert.deepEqual(sorted(summaryLivePaths("cashier")), sorted(["/api/notifications", "/api/estimates", "/api/discount-approvals", "/api/day-close"]));
  assert.deepEqual(
    sorted(summaryLivePaths("admin")),
    sorted(["/api/notifications", "/api/approvals", "/api/estimates", "/api/staff/leave-requests", "/api/discount-approvals", "/api/finance", "/api/invoices"])
  );
  assert.deepEqual(sorted(summaryLivePaths("salesman")), sorted(["/api/notifications", "/api/crm/leads"]));
  assert.deepEqual(summaryLivePaths("driver"), ["/api/notifications"]);
  assert.deepEqual(summaryLivePaths(""), ["/api/notifications"]);
});

const notifJson = { success: true, data: [{ _id: "n1", title: "T", createdAt: "2026-11-13T10:00:00Z", readAt: null }], unreadCount: 1 };

test("shaping keeps only the fields the pop-ups show", () => {
  const out = shapeMeSummary("cashier", "u1", {
    notifications: notifJson,
    estimates: {
      success: true,
      data: [{ _id: "e1", estimateNumber: "EST-1", total: 500, customerName: "Ravi", salesperson: "Amit", items: [{ big: 1 }], notes: "x" }],
    },
    discounts: {
      success: true,
      data: [{ _id: "d1", itemName: "TV", brand: "LG", percent: 9, quantity: 1, context: "bill", customerName: "Ravi", sellingPrice: 100, price: 91, requestedBy: "Amit", requestedByRole: "salesman", tier: "cashier", requestedById: "u9", itemId: "i1" }],
    },
    dayClose: { pendingDate: "2026-11-12" },
  });
  assert.equal(out.role, "cashier");
  assert.deepEqual(out.notifications, { data: notifJson.data, unreadCount: 1 });
  assert.deepEqual(out.estimates, [{ _id: "e1", estimateNumber: "EST-1", total: 500, customerName: "Ravi", salesperson: "Amit" }]);
  assert.deepEqual(out.discounts, [
    { _id: "d1", itemName: "TV", brand: "LG", percent: 9, quantity: 1, context: "bill", customerName: "Ravi", sellingPrice: 100, price: 91, requestedBy: "Amit", requestedByRole: "salesman", tier: "cashier" },
  ]);
  assert.deepEqual(out.dayClose, { pendingDate: "2026-11-12" });
  assert.equal("approvals" in out, false);
  assert.equal("leaves" in out, false);
});

test("a part the role may not see is dropped even if it was passed in", () => {
  const out = shapeMeSummary("salesman", "u1", {
    notifications: notifJson,
    approvals: 4,
    estimates: { success: true, data: [{ _id: "e1" }] },
    discounts: { success: true, data: [{ _id: "d1" }] },
    financeReminders: { success: true, data: [{ doId: "x" }] },
    dayClose: { pendingDate: "2026-11-12" },
    leadShareInbox: { success: true, data: [] },
  });
  assert.deepEqual(Object.keys(out).sort(), ["leadShareInbox", "notifications", "role"]);
});

test("a failed part is null, so the screen keeps what it had", () => {
  const out = shapeMeSummary("admin", "u1", {
    notifications: { success: false, error: "boom" },
    approvals: null,
    estimates: undefined,
    leaves: { success: true, data: "not a list" },
    discounts: { success: true, data: [] },
    financeReminders: null,
  });
  assert.equal(out.notifications, null);
  assert.equal(out.approvals, null);
  assert.equal(out.estimates, null);
  assert.equal(out.leaves, null);
  assert.deepEqual(out.discounts, []);
  assert.equal(out.financeReminders, null);
});

test("approvals count and day-close shapes", () => {
  const admin = shapeMeSummary("admin", "u1", { approvals: 3 });
  assert.deepEqual(admin.approvals, { pendingCount: 3 });
  const noneDue = shapeMeSummary("accounts", "u1", { dayClose: { pendingDate: null }, financeReminders: { success: true, data: [{ doId: "D1", amount: 10 }] } });
  assert.deepEqual(noneDue.dayClose, { pendingDate: null });
  assert.deepEqual(noneDue.financeReminders, [{ doId: "D1", amount: 10 }]);
});

test("a shared lead carries only this salesman's own share entry", () => {
  const out = shapeMeSummary("salesman", "me", {
    leadShareInbox: {
      success: true,
      data: [
        {
          _id: "l1",
          customerName: "Ravi",
          mobile: "9999999999",
          interestedProduct: "AC",
          assignedStaff: "Amit",
          notes: "private",
          sharedWith: [
            { staffId: "me", status: "pending", products: "AC", requestedBy: "Amit" },
            { staffId: "other", status: "pending", products: "TV" },
          ],
        },
      ],
    },
  });
  assert.deepEqual(out.leadShareInbox, [
    {
      _id: "l1",
      customerName: "Ravi",
      mobile: "9999999999",
      interestedProduct: "AC",
      assignedStaff: "Amit",
      sharedWith: [{ staffId: "me", status: "pending", products: "AC", requestedBy: "Amit" }],
    },
  ]);
});

console.log(`\n${passed} tests passed`);
