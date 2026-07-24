const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing Troop-Radar core logic & algorithms (Issue #61 Phase 1) ---');

// Mock browser / Tampermonkey environment
global.location = { pathname: '/' };
global.window = { addEventListener: () => {}, location: global.location };
global.MutationObserver = class { observe() {} disconnect() {} };
global.GM_addStyle = () => {};
global.GM_setValue = () => {};
global.GM_getValue = (key, def) => def;
global.GM_registerMenuCommand = () => {};

class MockElement {
  constructor(tag, classes = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this.style = {};
    this.classList = { contains: () => false, add: () => {}, remove: () => {} };
    this.children = [];
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild() {}
}

global.document = {
  body: new MockElement('body'),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: (t) => new MockElement(t),
  addEventListener: () => {}
};

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Load script in current context
eval(code);

// Test 1: classifyWarskiller calculations & thresholds
console.log('Test 1: Testing classifyWarskiller thresholds (75% War / 75% Eco)...');
const war75 = globalThis.classifyWarskiller({
  attack: { level: 75 },
  companies: { level: 25 }
});
assert.strictEqual(war75.isWarskiller, true, '75% war share should be classified as Warskiller');
assert.strictEqual(war75.build, 'war');
assert.strictEqual(war75.emoji, '💥');

const hybrid74 = globalThis.classifyWarskiller({
  attack: { level: 74 },
  companies: { level: 26 }
});
assert.strictEqual(hybrid74.isWarskiller, false, '74% war share should yield hybrid build');
assert.strictEqual(hybrid74.build, 'hybrid');
assert.strictEqual(hybrid74.emoji, '⚖');

const hybrid50 = globalThis.classifyWarskiller({
  attack: { level: 50 },
  companies: { level: 50 }
});
assert.strictEqual(hybrid50.build, 'hybrid');
assert.strictEqual(hybrid50.emoji, '⚖');
assert.strictEqual(hybrid50.label, 'Hybrid');

const eco85 = globalThis.classifyWarskiller({
  attack: { level: 15 },
  companies: { level: 85 }
});
assert.strictEqual(eco85.build, 'eco');
assert.strictEqual(eco85.emoji, '💰');
assert.strictEqual(eco85.label, 'Eco');

const emptySkills = globalThis.classifyWarskiller(null);
assert.strictEqual(emptySkills.isWarskiller, false);
assert.strictEqual(emptySkills.warShare, 0);

// Test 2: evaluatePillStatus readiness state machine
console.log('Test 2: Testing evaluatePillStatus state machine...');
const pilled = globalThis.evaluatePillStatus(
  { attack: { buffsPercent: 20 } },
  { currentBarValue: 100, total: 100 },
  { currentBarValue: 100, total: 100 }
);
assert.strictEqual(pilled.state, 'pill-on', 'Active buff should yield pill-on (gepillt)');
assert.strictEqual(pilled.label, 'gepillt');

const readyToPill = globalThis.evaluatePillStatus(
  { attack: { buffsPercent: 0, debuffsPercent: 0 } },
  { currentBarValue: 100, total: 100 },
  { currentBarValue: 100, total: 100 }
);
assert.strictEqual(readyToPill.state, 'pill-off', 'Unbuffed with full H&H should yield pill-off (bereit)');
assert.strictEqual(readyToPill.isReadyToPill, true);
assert.strictEqual(readyToPill.label, 'bereit');

const debuffed = globalThis.evaluatePillStatus(
  { attack: { buffsPercent: 0, debuffsPercent: 15 } },
  { currentBarValue: 100, total: 100 },
  { currentBarValue: 100, total: 100 }
);
assert.strictEqual(debuffed.state, 'pill-cd', 'Debuffed user should yield pill-cd (nicht bereit)');

const injured = globalThis.evaluatePillStatus(
  { attack: { buffsPercent: 0, debuffsPercent: 0 } },
  { currentBarValue: 60, total: 100 },
  { currentBarValue: 100, total: 100 }
);
assert.strictEqual(injured.state, 'pill-cd', 'Injured user without buff should yield pill-cd (nicht bereit)');

// Test 3: createOptimisticMemberData defaults
console.log('Test 3: Testing createOptimisticMemberData optimistic defaults...');
const opt = globalThis.createOptimisticMemberData('user-123');
assert.strictEqual(opt.userId, 'user-123');
assert.strictEqual(opt.hpCurrent, 100);
assert.strictEqual(opt.isOptimistic, true);
assert.strictEqual(opt.build, 'eco');

// Test 4: summarizeTroops aggregation & actionable alerts
console.log('Test 4: Testing summarizeTroops aggregation & actionable alerts...');
const sampleMembers = [
  // Warskiller #1: pilled, 100% HP -> ready
  { userId: 'u1', isWarskiller: true, pillState: 'pill-on', hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // Warskiller #2: unpilled & full H&H -> ready (has no debuff)
  { userId: 'u2', isWarskiller: true, pillState: 'pill-off', hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // Warskiller #3: injured -> not ready
  { userId: 'u3', isWarskiller: true, pillState: 'pill-cd', hpCurrent: 50, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // Eco #1: pilled, 100% HP
  { userId: 'u4', isWarskiller: false, pillState: 'pill-on', hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // Inactive Warskiller: pilled, 100% HP -> should be excluded from stats
  { userId: 'u5', isWarskiller: true, pillState: 'pill-on', hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100, isActive: false },
  // Inactive Eco: unpilled -> should be excluded from stats
  { userId: 'u6', isWarskiller: false, pillState: 'pill-off', hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100, isActive: false }
];

const summary = globalThis.summarizeTroops(sampleMembers);
assert.strictEqual(summary.totalMembers, 4, 'Inactive members must not be counted in totalMembers');
assert.strictEqual(summary.warskillerCount, 3, 'Inactive warskillers must not be counted in warskillerCount');
assert.strictEqual(summary.pillCount, 2, 'Inactive pilled members must not be counted in pillCount');
assert.strictEqual(summary.readyCount, 2, 'u1 (pilled) and u2 (pillable) are ready Warskillers (excluding u5)');
assert.strictEqual(summary.avgHpPct, 88, 'Average HP must only include active members');
assert.strictEqual(summary.actionableWarskillers.length, 1);
assert.strictEqual(summary.actionableWarskillers[0].userId, 'u2');

// Test 5: Real live curl payloads verification
console.log('Test 5: Testing real live API payload responses...');
const liveUser1Skills = {
  energy: { level: 0, currentBarValue: 6, total: 30 },
  health: { level: 6, currentBarValue: 113.7, total: 160 },
  hunger: { level: 4, currentBarValue: 5.8, total: 8 },
  attack: { level: 8, buffsPercent: 60, debuffsPercent: 0 },
  companies: { level: 2 },
  criticalChance: { level: 7 },
  criticalDamages: { level: 7 },
  armor: { level: 4 },
  precision: { level: 7 },
  dodge: { level: 6 },
  lootChance: { level: 5 },
  management: { level: 0 }
};

const liveUser1Class = globalThis.classifyWarskiller(liveUser1Skills);
assert.strictEqual(liveUser1Class.isWarskiller, true);
assert.strictEqual(liveUser1Class.build, 'war');
assert.strictEqual(liveUser1Class.warSum, 39);
assert.strictEqual(liveUser1Class.ecoSum, 7);

const liveUser1Pill = globalThis.evaluatePillStatus(liveUser1Skills, liveUser1Skills.health, liveUser1Skills.hunger);
assert.strictEqual(liveUser1Pill.state, 'pill-on');
assert.strictEqual(liveUser1Pill.label, 'gepillt');

const liveUser2Skills = {
  health: { level: 2, currentBarValue: 80, total: 120 },
  hunger: { level: 0, currentBarValue: 4, total: 4 },
  attack: { level: 0, buffsPercent: 0, debuffsPercent: 0 },
  companies: { level: 6 },
  criticalChance: { level: 0 },
  criticalDamages: { level: 0 },
  armor: { level: 0 },
  precision: { level: 2 },
  dodge: { level: 0 },
  lootChance: { level: 0 },
  management: { level: 0 }
};

const liveUser2Class = globalThis.classifyWarskiller(liveUser2Skills);
assert.strictEqual(liveUser2Class.isWarskiller, false);
assert.strictEqual(liveUser2Class.build, 'eco');
assert.strictEqual(liveUser2Class.emoji, '💰');
assert.strictEqual(liveUser2Class.warSum, 2);
assert.strictEqual(liveUser2Class.ecoSum, 6);

const liveUser2Pill = globalThis.evaluatePillStatus(liveUser2Skills, liveUser2Skills.health, liveUser2Skills.hunger);
assert.strictEqual(liveUser2Pill.state, 'pill-cd');
assert.strictEqual(liveUser2Pill.label, 'nicht bereit');

// Test 6: formatTroopRadarTime calculations
console.log('Test 6: Testing formatTroopRadarTime...');
const futureTime = new Date('2026-07-21T19:12:35.604Z');
const timeStr = globalThis.formatTroopRadarTime(futureTime.toISOString());
assert.match(timeStr, /^\d{2}:\d{2}$/, 'Should format to HH:MM format');
assert.strictEqual(globalThis.formatTroopRadarTime(null), '');
assert.strictEqual(globalThis.formatTroopRadarTime('invalid-date'), '');

// Test 7: computeDamagePotential happy path & expected value check
console.log('Test 7: Testing computeDamagePotential happy path...');
const testMember = {
  isWarskiller: true,
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8
  }
};
const dmgResult = globalThis.computeDamagePotential(testMember);
assert.strictEqual(dmgResult.degraded, false, 'Should not be degraded');
const ratio = dmgResult.dailyDmg / 864213.842897337;
assert.ok(ratio >= 0.995 && ratio <= 1.005, `Daily damage should be within 0.5% of expected 864213.84 (got: ${dmgResult.dailyDmg})`);

// Test 8: NaN-guard degraded checks
console.log('Test 8: Testing computeDamagePotential NaN-guards...');
const degradedMember = {
  isWarskiller: true,
  combat: {
    attackValue: null,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8
  }
};
const degradedResult = globalThis.computeDamagePotential(degradedMember);
assert.strictEqual(degradedResult.dailyDmg, 0, 'Degraded daily damage must be 0');
assert.strictEqual(degradedResult.degraded, true, 'Should be flagged as degraded');

// Test 9: summarizeTroops damage potential aggregation
console.log('Test 9: Testing summarizeTroops damage potential aggregates...');
const roster = [
  { isWarskiller: true, isActive: true, combat: { attackValue: 300, rank: 10, precisionValue: 80, critChanceValue: 40, critDmgValue: 220, armorValue: 18, dodgeValue: 16, healthMax: 160, hungerMax: 8 } },
  { isWarskiller: true, isActive: true, combat: { attackValue: null, rank: 10, precisionValue: 80, critChanceValue: 40, critDmgValue: 220, armorValue: 18, dodgeValue: 16, healthMax: 160, hungerMax: 8 } },
  { isWarskiller: false, isActive: true, combat: { attackValue: 300, rank: 10, precisionValue: 80, critChanceValue: 40, critDmgValue: 220, armorValue: 18, dodgeValue: 16, healthMax: 160, hungerMax: 8 } },
  { isWarskiller: true, isActive: false, combat: { attackValue: 300, rank: 10, precisionValue: 80, critChanceValue: 40, critDmgValue: 220, armorValue: 18, dodgeValue: 16, healthMax: 160, hungerMax: 8 } }
];
const troopSummary = globalThis.summarizeTroops(roster);
assert.strictEqual(troopSummary.damageTotalCount, 2, 'Should count 2 active warskillers');
assert.strictEqual(troopSummary.damageComputedCount, 1, 'Only 1 warskiller has non-degraded stats');
assert.ok(troopSummary.damagePotential > 0 && Math.abs(troopSummary.damagePotential - 864213.84) < 1000, `Aggregated potential should sum only the valid warskiller`);

// Test 10: fmtDamage formatting and localization
console.log('Test 10: Testing fmtDamage formatting...');
globalThis.CONFIG.locale = null;
global.window.__WIA_LOCALE__ = 'en';
assert.strictEqual(globalThis.fmtDamage(950), '950');
assert.strictEqual(globalThis.fmtDamage(12700), '12.7k');
assert.strictEqual(globalThis.fmtDamage(48200000), '48.2M');
assert.strictEqual(globalThis.fmtDamage(1200000000), '1.2Mrd');

global.window.__WIA_LOCALE__ = 'de';
assert.strictEqual(globalThis.fmtDamage(950), '950');
assert.strictEqual(globalThis.fmtDamage(12700), '12,7k');
assert.strictEqual(globalThis.fmtDamage(48200000), '48,2M');
assert.strictEqual(globalThis.fmtDamage(1200000000), '1,2Mrd');

// Test 11: computeDamagePotential realFloored
console.log('Test 11: Testing computeDamagePotential with realFloored option...');
const equippedMember = {
  isWarskiller: true,
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8,
    weaponDmgReal: 120,
    precisionEquip: 20,
    critChanceWeapon: 20,
    critDmgEquip: 50,
    armorEquip: 40,
    dodgeEquip: 20,
    healthRegen: 10,
    hungerRegen: 1
  }
};
const strippedMember = {
  isWarskiller: true,
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8,
    weaponDmgReal: null,
    precisionEquip: null,
    critChanceWeapon: null,
    critDmgEquip: null,
    armorEquip: null,
    dodgeEquip: null,
    healthRegen: 10,
    hungerRegen: 1
  }
};

const equipRes = globalThis.computeDamagePotential(equippedMember, { equip: 'realFloored' });
const stripRes = globalThis.computeDamagePotential(strippedMember, { equip: 'realFloored' });
const baseRes = globalThis.computeDamagePotential(strippedMember, { equip: 'blue' });

assert.ok(equipRes.dailyDmg > baseRes.dailyDmg, 'Real equipment should produce higher damage than baseline');
assert.strictEqual(stripRes.dailyDmg, baseRes.dailyDmg, 'Stripped member should floor to the exact same baseline');
assert.ok(Math.abs(baseRes.dailyDmg - 864213.84) < 1, 'Test 7 expected value must remain correct');

// Test 12: hoursUntilDailyReset
console.log('Test 12: Testing hoursUntilDailyReset...');
const beforeMidnight = new Date('2026-07-24T22:30:00');
const afterMidnight = new Date('2026-07-25T00:45:00');
const afterReset = new Date('2026-07-25T03:15:00');

assert.strictEqual(globalThis.hoursUntilDailyReset(beforeMidnight), 3.5);
assert.strictEqual(globalThis.hoursUntilDailyReset(afterMidnight), 1.25);
assert.strictEqual(globalThis.hoursUntilDailyReset(afterReset), 22.75);

// Test 13: computeLiveDamagePotential
console.log('Test 13: Testing computeLiveDamagePotential scenarios...');
const nowTime = new Date('2026-07-24T22:30:00');

const liveMemberA = {
  isWarskiller: true,
  hpCurrent: 160,
  hpMax: 160,
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8,
    healthRegen: 50,
    weaponDmgReal: null,
    precisionEquip: null,
    critChanceWeapon: null,
    critDmgEquip: null,
    armorEquip: null,
    dodgeEquip: null
  }
};
const liveResA = globalThis.computeLiveDamagePotential(liveMemberA, nowTime);
assert.strictEqual(liveResA.fracH, 1, 'Should clamp fracH to 1');
assert.strictEqual(liveResA.liveDmg, stripRes.dailyDmg, 'Should equal realFloored daily damage when fracH is 1');

const liveMemberB = {
  isWarskiller: true,
  hpCurrent: 40,
  hpMax: 160,
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8,
    healthRegen: 0,
    weaponDmgReal: null,
    precisionEquip: null,
    critChanceWeapon: null,
    critDmgEquip: null,
    armorEquip: null,
    dodgeEquip: null
  }
};
const liveResB = globalThis.computeLiveDamagePotential(liveMemberB, nowTime);
const expectedFrac = 40 / (1.8 * 160);
assert.ok(Math.abs(liveResB.fracH - expectedFrac) < 1e-6);

const liveMemberC = {
  isWarskiller: true,
  hpCurrent: 160,
  hpMax: 160,
  debuffEndAt: '2026-07-25T05:00:00',
  combat: {
    attackValue: 300,
    rank: 10,
    precisionValue: 80,
    critChanceValue: 40,
    critDmgValue: 220,
    armorValue: 18,
    dodgeValue: 16,
    healthMax: 160,
    hungerMax: 8,
    healthRegen: 10,
    weaponDmgReal: null,
    precisionEquip: null,
    critChanceWeapon: null,
    critDmgEquip: null,
    armorEquip: null,
    dodgeEquip: null
  }
};
const liveResC = globalThis.computeLiveDamagePotential(liveMemberC, nowTime);
assert.strictEqual(liveResC.usableHours, 0, 'Usable hours must be 0 when debuff ends after reset');
assert.ok(Math.abs(liveResC.fracH - 160 / 288) < 1e-6);

// Test 14: sumLiveDamage aggregation
console.log('Test 14: Testing sumLiveDamage aggregates...');
const mixedRoster = [
  {
    isWarskiller: true,
    isActive: true,
    hpCurrent: 160,
    hpMax: 160,
    combat: {
      attackValue: 300,
      rank: 10,
      precisionValue: 80,
      critChanceValue: 40,
      critDmgValue: 220,
      armorValue: 18,
      dodgeValue: 16,
      healthMax: 160,
      hungerMax: 8,
      healthRegen: 100,
      weaponDmgReal: null,
      precisionEquip: null,
      critChanceWeapon: null,
      critDmgEquip: null,
      armorEquip: null,
      dodgeEquip: null,
      weeklyDamage: 70000
    }
  },
  {
    isWarskiller: true,
    isActive: true,
    hpCurrent: 160,
    hpMax: 160,
    combat: {
      attackValue: null,
      rank: 10,
      precisionValue: 80,
      critChanceValue: 40,
      critDmgValue: 220,
      armorValue: 18,
      dodgeValue: 16,
      healthMax: 160,
      hungerMax: 8,
      healthRegen: 10,
      weeklyDamage: null
    }
  },
  {
    isWarskiller: false,
    isActive: true,
    hpCurrent: 160,
    hpMax: 160,
    combat: {
      attackValue: 300,
      rank: 10,
      precisionValue: 80,
      critChanceValue: 40,
      critDmgValue: 220,
      armorValue: 18,
      dodgeValue: 16,
      healthMax: 160,
      hungerMax: 8,
      healthRegen: 10,
      weeklyDamage: 280000
    }
  }
];

const sumRes = globalThis.sumLiveDamage(mixedRoster, nowTime);
assert.strictEqual(sumRes.total, 2, 'Should have 2 warskillers in total count');
assert.strictEqual(sumRes.computed, 1, 'Should have 1 computed warskiller');
assert.ok(Math.abs(sumRes.live - 864213.84) < 1, 'Sum live damage should equal the non-degraded warskiller potential');
assert.strictEqual(sumRes.observed, 10000, 'Observed average should sum only the warskiller weekly damage / 7');

console.log('All Troop-Radar Phase 1, 2, and 3 tests passed successfully!');
process.exit(0);
