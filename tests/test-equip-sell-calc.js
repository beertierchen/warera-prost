const assert = require('assert');

// 1. Math test (Target Price Calculator)
function calcEquipSellPrice(targetBuyerPays, taxPct) {
  const mult = 1 + taxPct / 100;
  const exactEntered = targetBuyerPays / mult;
  
  const baseTick = Math.floor(exactEntered * 1000) / 1000;
  const rawTicks = [
    Math.max(0, baseTick - 0.001),
    baseTick,
    baseTick + 0.001,
    baseTick + 0.002
  ];

  const ticks = rawTicks.map(figure => {
    // how game rounds buyer pays:
    const roundedBp = Math.round(figure * mult * 100) / 100;
    return {
      figure: Number(figure.toFixed(3)),
      buyerPays: roundedBp,
      delta: Number((roundedBp - targetBuyerPays).toFixed(4)),
      tax: Number((roundedBp - figure).toFixed(4))
    };
  });

  // dedup by figure
  const deduped = [];
  const seen = new Set();
  for (const t of ticks) {
    if (!seen.has(t.figure)) {
      seen.add(t.figure);
      deduped.push(t);
    }
  }

  // closest tick
  let closest = deduped[0];
  let minAbs = Math.abs(closest.delta);
  for (const t of deduped) {
    const a = Math.abs(t.delta);
    if (a < minAbs) {
      minAbs = a;
      closest = t;
    } else if (a === minAbs && t.delta <= 0) { // prefer undercutting
      closest = t;
    }
  }

  return {
    figure: closest.figure,
    buyerPays: closest.buyerPays,
    delta: closest.delta,
    tax: closest.tax,
    ticks: deduped
  };
}

// 2. Item advisor math fix
function itemAdvisorCalc(value, taxPct) {
  return value / (1 + taxPct / 100);
}

// 3. Route match test
const routes = [
  { path: '/market/equipments', match: true },
  { path: '/market/equipments/123', match: true },
  { path: '/market/items', match: false },
  { path: '/market', match: false }
];
function isMarketPage(path) {
  return new RegExp('^/market/equipments').test(path);
}

function runTests() {
  console.log('Running Equipment Sell Calc tests...');

  // Math tests (156.55 target, 1% tax)
  const res1 = calcEquipSellPrice(156.55, 1);
  assert.strictEqual(res1.figure, 155.002);
  assert.strictEqual(res1.buyerPays, 156.55);
  assert.strictEqual(res1.delta, 0);

  // Test ticks array
  assert.ok(Array.isArray(res1.ticks));
  assert.strictEqual(res1.ticks.length, 4);
  const t0 = res1.ticks.find(t => t.figure === 154.999);
  assert.strictEqual(t0.buyerPays, 156.55);

  // Math tests (110.00 target, 10% tax)
  const res2 = calcEquipSellPrice(110, 10);
  assert.strictEqual(res2.figure, 100.001);

  // Route matching tests
  for (const route of routes) {
    assert.strictEqual(isMarketPage(route.path), route.match, `Route ${route.path} failed`);
  }

  console.log('All tests passed!');
}

runTests();
