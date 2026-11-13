/** Tiny test helpers: no test framework is installed, so a test is a plain script that exits non-zero on failure. */
let failures = 0;
let passes = 0;

export function check(condition: unknown, message: string) {
  if (condition) {
    passes++;
    console.log(`  ok   ${message}`);
  } else {
    failures++;
    console.log(`  FAIL ${message}`);
  }
}

export function summary(name: string): number {
  console.log(`\n${name}: ${passes} passed, ${failures} failed`);
  return failures;
}
