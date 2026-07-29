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

// Temporarily override CONFIG.CUSTOM_SET.weapon.dmg to higher value and check damage increases
const oldDmg = globalThis.CONFIG.CUSTOM_SET.weapon.dmg;
globalThis.CONFIG.CUSTOM_SET.weapon.dmg = 150;
globalThis.setActiveBaselineSet(globalThis.loadBaselineSet());
const increasedDmgResult = globalThis.computeDamagePotential(testMember);
assert.ok(increasedDmgResult.dailyDmg > dmgResult.dailyDmg, 'Custom baseline weapon dmg increase should increase damage potential');
globalThis.CONFIG.CUSTOM_SET.weapon.dmg = oldDmg;
globalThis.setActiveBaselineSet(globalThis.loadBaselineSet());

// Test slot value with "abc" non-numeric string
const oldGlovesPrec = globalThis.CONFIG.CUSTOM_SET.gloves.precision;
globalThis.CONFIG.CUSTOM_SET.gloves.precision = 'abc';
globalThis.setActiveBaselineSet(globalThis.loadBaselineSet());
const normalized = globalThis.baselineContribs();
assert.strictEqual(normalized.precision, 0, 'Non-numeric gloves precision should normalize to 0');
const fallbackDmgResult = globalThis.computeDamagePotential(testMember);
assert.ok(!isNaN(fallbackDmgResult.dailyDmg), 'Damage calculation must remain finite and not NaN even with garbage set values');
globalThis.CONFIG.CUSTOM_SET.gloves.precision = oldGlovesPrec;
globalThis.setActiveBaselineSet(globalThis.loadBaselineSet());

// Test 7c: Live Floor Regression Guard (Custom Baseline Set must not affect Live floor)
console.log('Test 7c: Testing Live Floor Regression Guard (Custom baseline must not affect Live floor)...');
const defaultLiveDmgResult = globalThis.computeDamagePotential(testMember, { equip: 'realFloored' });
const defaultTagDmgResult = globalThis.computeDamagePotential(testMember);

// Set a HIGH custom baseline set
const highCustomSet = {
  weapon: { dmg: 300, crit: 20 },
  gloves: { precision: 25 },
  helmet: { critDmg: 90 },
  chest:  { armor: 30 },
  pants:  { armor: 30 },
  boots:  { dodge: 25 },
};
globalThis.setActiveBaselineSet(highCustomSet);

const highTagDmgResult = globalThis.computeDamagePotential(testMember);
assert.ok(highTagDmgResult.dailyDmg > defaultTagDmgResult.dailyDmg, 'Tag damage potential should rise with high custom baseline set');

const highLiveDmgResult = globalThis.computeDamagePotential(testMember, { equip: 'realFloored' });
assert.strictEqual(highLiveDmgResult.dailyDmg, defaultLiveDmgResult.dailyDmg, 'Live damage potential (realFloored) must remain unchanged when custom baseline is modified');

// Restore default baseline set
globalThis.setActiveBaselineSet(globalThis.CONFIG.CUSTOM_SET);

// Test 7b: Custom Baseline Set persistence & validation (Issue #71 Part B)
console.log('Test 7b: Testing Custom Baseline Set persistence and validation...');
// 1. isValidBaselineShape checks
const validSet = {
  weapon: { dmg: 80.5, crit: 13 },
  gloves: { precision: 13 },
  helmet: { critDmg: 40.5 },
  chest:  { armor: 13 },
  pants:  { armor: 13 },
  boots:  { dodge: 13 },
};
assert.strictEqual(globalThis.isValidBaselineShape(validSet), true, 'Valid set shape should return true');

const missingSlot = {
  weapon: { dmg: 80.5, crit: 13 },
  gloves: { precision: 13 },
  helmet: { critDmg: 40.5 },
  chest:  { armor: 13 },
  pants:  { armor: 13 },
  // boots slot missing
};
assert.strictEqual(globalThis.isValidBaselineShape(missingSlot), false, 'Missing slot boots should return false');

const missingKey = {
  weapon: { dmg: 80.5 }, // crit missing
  gloves: { precision: 13 },
  helmet: { critDmg: 40.5 },
  chest:  { armor: 13 },
  pants:  { armor: 13 },
  boots:  { dodge: 13 },
};
assert.strictEqual(globalThis.isValidBaselineShape(missingKey), false, 'Missing key weapon.crit should return false');

const nonNumeric = {
  weapon: { dmg: 'abc', crit: 13 },
  gloves: { precision: 13 },
  helmet: { critDmg: 40.5 },
  chest:  { armor: 13 },
  pants:  { armor: 13 },
  boots:  { dodge: 13 },
};
assert.strictEqual(globalThis.isValidBaselineShape(nonNumeric), false, 'Non-numeric leaf weapon.dmg should return false');

// 2. loadBaselineSet fallback checks
const originalGMGet = global.GM_getValue;

// Mock GM_getValue for broken JSON
global.GM_getValue = (key, def) => {
  if (key === 'wia.customBaselineSet') return '{invalid json';
  return def;
};
const fallbackSet = globalThis.loadBaselineSet();
assert.deepStrictEqual(fallbackSet, globalThis.CONFIG.CUSTOM_SET, 'Broken JSON should fallback to default CONFIG.CUSTOM_SET');

// Mock GM_getValue for valid override
const overrideSet = {
  weapon: { dmg: 110, crit: 20 },
  gloves: { precision: 25 },
  helmet: { critDmg: 90 },
  chest:  { armor: 30 },
  pants:  { armor: 30 },
  boots:  { dodge: 25 },
};
global.GM_getValue = (key, def) => {
  if (key === 'wia.customBaselineSet') return JSON.stringify(overrideSet);
  return def;
};
const parsedOverride = globalThis.loadBaselineSet();
assert.deepStrictEqual(parsedOverride, overrideSet, 'Valid persisted override should be loaded');

// 3. activeBaselineSet and baselineContribs updates
// Mock activeBaselineSet with override
globalThis.setActiveBaselineSet(parsedOverride);
const contribs = globalThis.baselineContribs();
assert.strictEqual(contribs.weaponDmg, 110);
assert.strictEqual(contribs.precision, 25);
assert.strictEqual(contribs.armor, 60, 'Should sum chest + pants armor');

// Restore to default
globalThis.setActiveBaselineSet(globalThis.CONFIG.CUSTOM_SET);
const defaultContribs = globalThis.baselineContribs();
assert.strictEqual(defaultContribs.weaponDmg, 80.5);

// Restore original GM_getValue mock
global.GM_getValue = originalGMGet;

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
  },
  // Warskiller 3: reset skills 2.5 days ago, weekly damage 25,000 -> observed average 10,000
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
      healthRegen: 100, // fracH will be 1
      weaponDmgReal: null,
      precisionEquip: null,
      critChanceWeapon: null,
      critDmgEquip: null,
      armorEquip: null,
      dodgeEquip: null,
      weeklyDamage: 25000,
      lastSkillsResetAt: '2026-07-22T10:30:00'
    }
  }
];

const sumRes = globalThis.sumLiveDamage(mixedRoster, nowTime);
assert.strictEqual(sumRes.total, 3, 'Should have 3 warskillers in total count');
assert.strictEqual(sumRes.computed, 2, 'Should have 2 computed warskillers');
assert.ok(Math.abs(sumRes.live - 2 * 864213.85) < 1, 'Sum live damage should sum the non-degraded warskillers potential');
assert.strictEqual(sumRes.observed, 20000, 'Observed average should adjust denominators using lastSkillsResetAt');

// Test 15: summarizeTroops responsive / H&H metrics (avgHungerPct, avgEffPoolPct)
console.log('Test 15: Testing summarizeTroops H&H metrics (avgHungerPct, avgEffPoolPct)...');
const hhRoster = [
  // Member 1: HP 100/100, Hunger 50/100 -> effPct = (100 + 25) / (100 + 50) = 125 / 150 = 83.33%
  { isWarskiller: true, isActive: true, hpCurrent: 100, hpMax: 100, hungerCurrent: 50, hungerMax: 100 },
  // Member 2: HP 0/100, Hunger 100/100 -> effPct = (0 + 50) / (100 + 50) = 50 / 150 = 33.33%
  { isWarskiller: true, isActive: true, hpCurrent: 0, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // Member 3: HP 100/100, Hunger 0/100 -> effPct = (100 + 0) / (100 + 50) = 100 / 150 = 66.67%
  { isWarskiller: true, isActive: true, hpCurrent: 100, hpMax: 100, hungerCurrent: 0, hungerMax: 100 },
  // Member 4: missing fields
  { isWarskiller: true, isActive: true }
];

const hhSummary = globalThis.summarizeTroops(hhRoster);
// Member 1 hunger = 50%, Member 2 hunger = 100%, Member 3 hunger = 0%, Member 4 hunger = 100% (default)
// avgHungerPct = Math.round((50 + 100 + 0 + 100) / 4) = Math.round(250 / 4) = 62.5 -> 63
assert.strictEqual(hhSummary.avgHungerPct, 63);

// Member 1 effPct = 83.33333333333333
// Member 2 effPct = 33.33333333333333
// Member 3 effPct = 66.66666666666666
// Member 4 effPct = 100 (defaults: hpCurrent=100, hpMax=100, hungerCurrent=100, hungerMax=100 -> (100+50)/(100+50)=100%)
// effSumPct = 83.3333 + 33.3333 + 66.6667 + 100 = 283.3333
// avgEffPoolPct = Math.round(283.3333 / 4) = 71
assert.strictEqual(hhSummary.avgEffPoolPct, 71);

// Test 16: effMember% edge-cases
console.log('Test 16: Testing effMember% edge cases (0/100, 100/0, 100/100, den <= 0)...');
const edgeRoster = [
  // 0/100 HP, 0/100 hunger -> effPct = 0%
  { isActive: true, hpCurrent: 0, hpMax: 100, hungerCurrent: 0, hungerMax: 100 },
  // 100/100 HP, 100/100 hunger -> effPct = 100%
  { isActive: true, hpCurrent: 100, hpMax: 100, hungerCurrent: 100, hungerMax: 100 },
  // hpMax & hungerMax are 0 -> den <= 0 -> should fall back to 100%
  { isActive: true, hpCurrent: 0, hpMax: 0, hungerCurrent: 0, hungerMax: 0 }
];
const edgeSummary = globalThis.summarizeTroops(edgeRoster);
// effPct 1 = 0
// effPct 2 = 100
// effPct 3 = 100
// avg = Math.round((0 + 100 + 100) / 3) = 67
assert.strictEqual(edgeSummary.avgEffPoolPct, 67);

// Test 17: computeLiveDamagePotential custom horizon hour
console.log('Test 17: Testing computeLiveDamagePotential with custom horizon hours...');
const baseTime = new Date('2026-07-24T18:00:00'); // 18:00
const testLiveMember = {
  isWarskiller: true,
  hpCurrent: 100,
  hpMax: 100,
  combat: {
    attackValue: 300, rank: 10, precisionValue: 80, critChanceValue: 40, critDmgValue: 220,
    armorValue: 18, dodgeValue: 16, healthMax: 100, hungerMax: 8, healthRegen: 0
  }
};

// Horizon 23: reset today at 23:00. usableHours = 5.
const resH23 = globalThis.computeLiveDamagePotential(testLiveMember, baseTime, 23);
assert.strictEqual(resH23.usableHours, 5);

// Horizon 2: reset today at 02:00? Since 18:00 > 02:00, reset is tomorrow at 02:00.
// usableHours = from 18:00 to tomorrow 02:00 = 8 hours.
const resH2 = globalThis.computeLiveDamagePotential(testLiveMember, baseTime, 2);
assert.strictEqual(resH2.usableHours, 8);

// Horizon 0: reset tomorrow at 00:00.
// usableHours = from 18:00 to tomorrow 00:00 = 6 hours.
const resH0 = globalThis.computeLiveDamagePotential(testLiveMember, baseTime, 0);
assert.strictEqual(resH0.usableHours, 6);

// Horizon in past relative to current hour (e.g. horizon = 12). Reset tomorrow at 12:00.
// usableHours = from 18:00 to tomorrow 12:00 = 18 hours.
const resH12 = globalThis.computeLiveDamagePotential(testLiveMember, baseTime, 12);
assert.strictEqual(resH12.usableHours, 18);

// debuffEndAt > horizon -> usableHours = 0
const debuffedMember = {
  ...testLiveMember,
  debuffEndAt: '2026-07-25T01:00:00' // tomorrow at 01:00
};
// Horizon 23 (today 23:00) -> debuff ends after reset -> usableHours = 0
const resDebuff = globalThis.computeLiveDamagePotential(debuffedMember, baseTime, 23);
assert.strictEqual(resDebuff.usableHours, 0);

// Test 18: sumLiveDamage passes horizonHour
console.log('Test 18: Testing sumLiveDamage passing horizonHour...');
const testSumRoster = [testLiveMember];
const sumH23 = globalThis.sumLiveDamage(testSumRoster, baseTime, 23);
const sumH2 = globalThis.sumLiveDamage(testSumRoster, baseTime, 2);
// Horizon 23 has 5 usable hours, Horizon 2 has 8 usable hours. Since regen is 0, fracH is same, but let's check it passes it correctly.
// Let's modify healthRegen to 10. Then throughput = 100 + 10 * usableHours.
// For H23: throughput = 100 + 50 = 150 -> fracH = 150 / 180 = 0.8333
// For H2: throughput = 100 + 80 = 180 -> fracH = 180 / 180 = 1
const testRegenMember = {
  ...testLiveMember,
  combat: { ...testLiveMember.combat, healthRegen: 10 }
};
const sumRegenH23 = globalThis.sumLiveDamage([testRegenMember], baseTime, 23);
const sumRegenH2 = globalThis.sumLiveDamage([testRegenMember], baseTime, 2);
assert.ok(sumRegenH2.live > sumRegenH23.live, 'Horizon 2 should produce higher damage due to more regen hours');

// Test 19: Per-member damage degraded cases
console.log('Test 19: Testing per-member damage potential degradation...');
const ecoMember = {
  isWarskiller: false,
  isActive: true,
  combat: null // degraded
};
const ecoRes = globalThis.computeDamagePotential(ecoMember);
assert.strictEqual(ecoRes.degraded, true);
assert.strictEqual(ecoRes.dailyDmg, 0);

console.log('All Troop-Radar Phase 1, 2, and 3 tests passed successfully!');
process.exit(0);
