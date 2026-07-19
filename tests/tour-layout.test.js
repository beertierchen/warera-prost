// Pure test for the beer/coach-card placement math.
// Run: node tests/tour-layout.test.js  (exit 0 = pass)
const assert = require('assert');

function clampTour(v, min, max) {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

// Mirror of computeTourLayout in warera-prost.user.js (kept in sync intentionally).
function computeTourLayout(target, vp, opts) {
  const { cardW, cardH, beerW, beerH, gap, margin } = opts;
  const unitW = beerW + gap + cardW;          // beer + gap + card
  const spaceRight = vp.w - (target.left + target.width);
  const spaceLeft = target.left;
  const tooBig = target.width > vp.w * 0.6 || target.height > vp.h * 0.6;

  const vCenter = target.top + target.height / 2;
  const rowTop = clampTour(vCenter - cardH / 2, margin, vp.h - cardH - margin);
  const beerTop = clampTour(vCenter - beerH / 2, margin, vp.h - beerH - margin);

  if (!tooBig && spaceRight >= unitW + gap + margin) {
    // target | beer(points left) | card
    const beerLeft = target.left + target.width + gap;
    return {
      side: 'right', beerVariant: 'left',
      beer: { left: beerLeft, top: beerTop },
      card: { left: beerLeft + beerW + gap, top: rowTop },
    };
  }
  if (!tooBig && spaceLeft >= unitW + gap + margin) {
    // card | beer(points right) | target
    const beerLeft = target.left - gap - beerW;
    return {
      side: 'left', beerVariant: 'right',
      beer: { left: beerLeft, top: beerTop },
      card: { left: beerLeft - gap - cardW, top: rowTop },
    };
  }
  // Fallback: pin below the target (or above if no room), card centered, beer to its left.
  const belowTop = target.top + target.height + gap;
  const cardTop = (belowTop + cardH + margin <= vp.h)
    ? belowTop
    : clampTour(target.top - gap - cardH, margin, vp.h - cardH - margin);
  const cardLeft = clampTour(target.left + target.width / 2 - cardW / 2, margin, vp.w - cardW - margin);
  return {
    side: 'bottom', beerVariant: 'right',
    beer: { left: clampTour(cardLeft - beerW - gap, margin, vp.w - beerW - margin), top: cardTop },
    card: { left: cardLeft, top: cardTop },
  };
}

const OPTS = { cardW: 300, cardH: 150, beerW: 88, beerH: 110, gap: 12, margin: 12 };
const VP = { w: 1440, h: 900 };

// small target on the left -> card goes to the right, beer points left
const r1 = computeTourLayout({ left: 380, top: 40, width: 40, height: 40 }, VP, OPTS);
assert.strictEqual(r1.side, 'right', 'left-side target -> card right');
assert.strictEqual(r1.beerVariant, 'left', 'card right -> beer points left');
assert.ok(r1.beer.left >= 420, 'beer sits right of target');

// small target near right edge -> card goes to the left, beer points right
const r2 = computeTourLayout({ left: 1360, top: 300, width: 40, height: 40 }, VP, OPTS);
assert.strictEqual(r2.side, 'left', 'right-edge target -> card left');
assert.strictEqual(r2.beerVariant, 'right', 'card left -> beer points right');

// very wide target (full-width section) -> bottom fallback
const r3 = computeTourLayout({ left: 20, top: 200, width: 1200, height: 120 }, VP, OPTS);
assert.strictEqual(r3.side, 'bottom', 'wide target -> bottom fallback');

// card never leaves the viewport
for (const r of [r1, r2, r3]) {
  assert.ok(r.card.left >= 0 && r.card.left + OPTS.cardW <= VP.w, 'card within viewport horizontally');
  assert.ok(r.card.top >= 0 && r.card.top + OPTS.cardH <= VP.h, 'card within viewport vertically');
}

console.log('tour-layout: all assertions passed');
