// Pure-predicate test for the narrow-panel float threshold.
// Run: node tests/pill-float.test.js  (exit 0 = pass)
const assert = require('assert');

// Mirror of the constant in warera-prost.user.js (kept in sync intentionally).
const PILL_FLOAT_BREAKPOINT = 570;
function shouldPillFloat(width) {
  return Number.isFinite(width) && width > 0 && width < PILL_FLOAT_BREAKPOINT;
}

assert.strictEqual(shouldPillFloat(599.978), false, 'wide panel -> in-flow');
assert.strictEqual(shouldPillFloat(570), false, 'exactly breakpoint -> in-flow');
assert.strictEqual(shouldPillFloat(569.9), true, 'just under -> float');
assert.strictEqual(shouldPillFloat(320), true, 'narrow -> float');
assert.strictEqual(shouldPillFloat(0), false, 'unmeasured (0) -> in-flow (fail-open)');
assert.strictEqual(shouldPillFloat(NaN), false, 'NaN -> in-flow (fail-open)');
assert.strictEqual(shouldPillFloat(Infinity), false, 'Infinity -> in-flow');

console.log('pill-float: all assertions passed');
