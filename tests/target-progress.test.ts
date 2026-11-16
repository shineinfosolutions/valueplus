// How bills count towards a Sales Target (lib/target-progress.ts): name matching, line totals, which salesman.
import assert from "node:assert/strict";
import { billCountsForTarget, billIsForAssignee, lineMatchesTarget, nameMatches } from "@/lib/target-progress";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok - ${name}`);
};

test("spaces and dashes are ignored", () => {
  assert.equal(nameMatches("VT 250- V-GUARD", "V guard "), true);
  assert.equal(nameMatches("VT 250- VGUARD", "V-Guard"), true);
  assert.equal(nameMatches("VT 250 V GUARD", "vguard"), true);
  assert.equal(nameMatches("AQUAGUARD SURE CHAMP RO+UV 1X- EUREKA FORBES", "V guard"), false);
});

test("a short name must be a whole word", () => {
  assert.equal(nameMatches("32LB651BPLA.ATR- LG", "LG"), true);
  assert.equal(nameMatches("P7510RRAZ.ABGQEIL- LG", "lg"), true);
  assert.equal(nameMatches("ELGI BULB 9W", "LG"), false);
  assert.equal(nameMatches("BULGARI MIXER", "LG"), false);
});

test("a longer name may sit inside a word", () => {
  assert.equal(nameMatches("HSU-19C-TFW5BN-INV- HAIER", "Haier"), true);
  assert.equal(nameMatches("HAIERAC 1.5T", "Haier"), true);
  assert.equal(nameMatches("260 IMPRO ROY 3S SAPPHIRE BREEZE-Z- WHIRLPOOL", "Whirlpool "), true);
});

test("empty names match nothing", () => {
  assert.equal(nameMatches("ANY PRODUCT", ""), false);
  assert.equal(nameMatches("ANY PRODUCT", "  - "), false);
  assert.equal(lineMatchesTarget({ itemName: "ANY" }, "", ""), false);
});

test("product target counts only matching lines", () => {
  const bill = {
    total: 50000,
    items: [
      { itemName: "32LB651BPLA.ATR- LG", quantity: 2, amount: 30000 },
      { itemName: "VT 250- V-GUARD", quantity: 1, amount: 19500 },
      { itemName: "ELGI BULB", quantity: 3, rate: 100 },
    ],
  };
  assert.deepEqual(billCountsForTarget({ targetBrand: "LG" }, bill), { matched: true, qty: 2, amount: 30000 });
  assert.deepEqual(billCountsForTarget({ targetProduct: "V guard ", targetBrand: "V guard " }, bill), { matched: true, qty: 1, amount: 19500 });
  assert.deepEqual(billCountsForTarget({ targetBrand: "Haier" }, bill), { matched: false, qty: 0, amount: 0 });
});

test("target with no product counts the whole bill", () => {
  const bill = { total: 50000, items: [{ itemName: "A", quantity: 2 }, { itemName: "B" }] };
  assert.deepEqual(billCountsForTarget({}, bill), { matched: true, qty: 3, amount: 50000 });
});

test("which salesman's bills count", () => {
  assert.equal(billIsForAssignee("Amit Singh", "Amit Singh"), true);
  assert.equal(billIsForAssignee("DHANANJAY PANDEY", "DHANANJAY PANDEY"), true);
  assert.equal(billIsForAssignee("Saurabh Rai", "Amit Singh"), false);
  assert.equal(billIsForAssignee("Anyone", "All Staff"), true);
  assert.equal(billIsForAssignee("", "Usaid"), false);
});

console.log(`\n${passed} tests passed`);
