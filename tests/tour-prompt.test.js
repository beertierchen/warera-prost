// Pure test for the onboarding auto-prompt gating.
// Run: node tests/tour-prompt.test.js  (exit 0 = pass)
const assert = require('assert');

// Mirror of the predicate in warera-prost.user.js (kept in sync intentionally).
function shouldShowTourPrompt({ featTour, hasToken, dismissed, completed }) {
  return !!featTour && !hasToken && !dismissed && !completed;
}

assert.strictEqual(shouldShowTourPrompt({ featTour: true,  hasToken: false, dismissed: false, completed: false }), true,  'fresh user -> show');
assert.strictEqual(shouldShowTourPrompt({ featTour: false, hasToken: false, dismissed: false, completed: false }), false, 'feature off -> hide');
assert.strictEqual(shouldShowTourPrompt({ featTour: true,  hasToken: true,  dismissed: false, completed: false }), false, 'has token -> hide');
assert.strictEqual(shouldShowTourPrompt({ featTour: true,  hasToken: false, dismissed: true,  completed: false }), false, 'dismissed -> hide');
assert.strictEqual(shouldShowTourPrompt({ featTour: true,  hasToken: false, dismissed: false, completed: true  }), false, 'completed -> hide');

console.log('tour-prompt: all assertions passed');
