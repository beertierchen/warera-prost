// Run: node tests/bounty-notify.test.js  (exit 0 = pass)
const assert = require('assert');

// Mirror of getEffectiveTopic logic (userscript is an IIFE, can't require).
function getEffectiveTopic(topic, secret) {
  const t = (topic || '').trim();
  const s = (secret || '').trim();
  if (!t) return '';
  return s ? `${t}-${s}` : t;
}

assert.strictEqual(getEffectiveTopic('wia-bounty-beer', ''), 'wia-bounty-beer');
assert.strictEqual(getEffectiveTopic('wia-bounty-beer', 'x7q2'), 'wia-bounty-beer-x7q2');
assert.strictEqual(getEffectiveTopic('  beer  ', ' s1 '), 'beer-s1');
assert.strictEqual(getEffectiveTopic('', 'x'), '');
console.log('bounty-notify: getEffectiveTopic OK');

function bountyKey(battleId, side, effectiveAt) {
  return `bkey_${battleId}_${side}_${Date.parse(effectiveAt)}`;
}
assert.strictEqual(
  bountyKey('6a46', 'attacker', '2026-07-02T14:27:08.022Z'),
  'bkey_6a46_attacker_' + Date.parse('2026-07-02T14:27:08.022Z'));
console.log('bounty-notify: bountyKey OK');

function parseSearchCountryAndAlliance(p) {
  const d = (p && p.result && p.result.data) ? p.result.data : p;
  return { countryIds: d.countryIds || [], allianceIds: d.allianceIds || [] };
}
function parseAllianceCountryIds(alliancePayload) {
  const p = alliancePayload || {};
  const arr = p.memberCountries || p.countries || p.countryIds || [];
  return arr.map((x) => (typeof x === 'string' ? x : (x && (x.country || x._id)))).filter(Boolean);
}

const beer = { result: { data: { userIds:[], muIds:['x'], countryIds:[], regionIds:[], partyIds:['p'], allianceIds:['6a2b13879c8c99640b9c4963'], hasData:true } } };
const germany = { result: { data: { userIds:['u'], countryIds:['6813b6d446e731854c7ac79c'], allianceIds:[], hasData:true } } };
assert.deepStrictEqual(parseSearchCountryAndAlliance(beer).allianceIds, ['6a2b13879c8c99640b9c4963']);
assert.deepStrictEqual(parseSearchCountryAndAlliance(germany).countryIds, ['6813b6d446e731854c7ac79c']);

// Real alliance.getById shape: memberCountries: [{ country: <id>, ... }]
const allianceReal = { memberCountries: [
  { country: '6813b6d446e731854c7ac79c', coreDevelopment: 1149, suspended: false },
  { country: '6813b6d446e731854c7ac802', coreDevelopment: 96, suspended: false },
] };
assert.deepStrictEqual(parseAllianceCountryIds(allianceReal), ['6813b6d446e731854c7ac79c', '6813b6d446e731854c7ac802']);

// Tolerate legacy shapes.
assert.deepStrictEqual(parseAllianceCountryIds({ countries: ['c1', 'c2'] }), ['c1', 'c2']);
assert.deepStrictEqual(parseAllianceCountryIds({ countries: [{ _id: 'c1' }, { _id: 'c2' }] }), ['c1', 'c2']);

console.log('bounty-notify: parsers OK');

function extractAllyBounties(items, allySet) {
  const out = [];
  for (const b of (items || [])) {
    for (const side of ['attacker', 'defender']) {
      const s = b[side];
      if (!s || !s.bountyEffectiveAt) continue;
      if (allySet && !allySet.has(s.country)) continue;
      out.push({
        battleId: b._id,
        side,
        country: s.country,
        attackerCountry: b.attacker && b.attacker.country,
        defenderCountry: b.defender && b.defender.country,
        effectiveAt: s.bountyEffectiveAt,
        effectiveAtEpoch: Date.parse(s.bountyEffectiveAt),
        moneyPool: s.moneyPool,
        ratePer1k: s.moneyPer1kDamages,
        regionId: (b.defender && b.defender.region) || null,
        warId: b.war
      });
    }
  }
  return out;
}

const items = [
  { _id:'B1', war:'W1', defender:{ region:'R1', country:'ALLY' },
    attacker:{ country:'ALLY', bountyEffectiveAt:'2026-07-02T14:27:08.022Z', moneyPool:62.15, moneyPer1kDamages:0.05 } },
  { _id:'B2', war:'W2', defender:{ region:'R2', country:'ENEMY', bountyEffectiveAt:'2026-07-02T13:00:00.000Z', moneyPool:5, moneyPer1kDamages:0.1 },
    attacker:{ country:'ENEMY' } },
  { _id:'B3', war:'W3', defender:{ region:'R3', country:'ALLY' }, attacker:{ country:'ALLY' } }, // no bounty
];
const res = extractAllyBounties(items, new Set(['ALLY']));
assert.strictEqual(res.length, 1);
assert.strictEqual(res[0].battleId, 'B1');
assert.strictEqual(res[0].side, 'attacker');
assert.strictEqual(res[0].moneyPool, 62.15);
assert.strictEqual(res[0].attackerCountry, 'ALLY');
assert.strictEqual(res[0].defenderCountry, 'ALLY');

const resAll = extractAllyBounties(items, null);
assert.strictEqual(resAll.length, 2);
assert.strictEqual(resAll[0].battleId, 'B1');
assert.strictEqual(resAll[1].battleId, 'B2');
console.log('bounty-notify: extract OK');

function parseNtfyNdjson(text) {
  const out = [];
  for (const line of (text || '').split('\n')) {
    const s = line.trim(); if (!s) continue;
    try { out.push(JSON.parse(s)); } catch (_) { /* skip partial/blank */ }
  }
  return out;
}
const nd = '{"id":"1","event":"message","tags":["bkey_B1_attacker_123"]}\n{"id":"2","tags":[]}\n';
const msgs = parseNtfyNdjson(nd);
assert.strictEqual(msgs.length, 2);
assert.ok(msgs.some((m) => (m.tags || []).includes('bkey_B1_attacker_123')));
assert.deepStrictEqual(parseNtfyNdjson(''), []);
console.log('bounty-notify: ndjson OK');

const BOUNTY_SEEN_TTL_MS = 86400000;
function pruneSeen(store, nowMs) {
  const out = {};
  for (const k of Object.keys(store)) if (nowMs - store[k] <= BOUNTY_SEEN_TTL_MS) out[k] = store[k];
  return out;
}
const nowMs = 1000000000000;
const kept = pruneSeen({ old: nowMs - BOUNTY_SEEN_TTL_MS - 1, fresh: nowMs - 1000 }, nowMs);
assert.deepStrictEqual(Object.keys(kept), ['fresh']);
console.log('bounty-notify: prune OK');

function buildTopicLink(baseTopic, hasSecret) {
  const t = (baseTopic || '').trim();
  if (!t || hasSecret) return null;
  return `https://ntfy.sh/${t}`;
}
assert.strictEqual(buildTopicLink('wia-bounty-beer-casc', false), 'https://ntfy.sh/wia-bounty-beer-casc');
assert.strictEqual(buildTopicLink('wia-bounty-beer-casc', true), null);
assert.strictEqual(buildTopicLink('', false), null);
console.log('bounty-notify: buildTopicLink OK');

function cleanHeaderValue(str) {
  if (!str) return '';
  return str
    .replace(/Ä/g, 'Ae').replace(/ä/g, 'ae')
    .replace(/Ö/g, 'Oe').replace(/ö/g, 'oe')
    .replace(/Ü/g, 'Ue').replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^\x20-\x7E]/g, '') // Nur druckbare US-ASCII-Zeichen erlauben
    .trim();
}
assert.strictEqual(cleanHeaderValue('Topic öffnen'), 'Topic oeffnen');
assert.strictEqual(cleanHeaderValue('⚔️ Ally-Casc-Bounty: Dänemark vs Österreich'), 'Ally-Casc-Bounty: Daenemark vs Oesterreich');
assert.strictEqual(cleanHeaderValue('   Spaces und ß   '), 'Spaces und ss');
assert.strictEqual(cleanHeaderValue(''), '');
console.log('bounty-notify: cleanHeaderValue OK');

// Multi-Feed Nesting Test
const testItems = [
  { _id:'B1', war:'W1', defender:{ region:'R1', country:'ALLY1' },
    attacker:{ country:'ALLY1', bountyEffectiveAt:'2026-07-02T14:27:08.022Z', moneyPool:60, moneyPer1kDamages:0.05 } },
  { _id:'B2', war:'W2', defender:{ region:'R2', country:'ALLY2', bountyEffectiveAt:'2026-07-02T13:00:00.000Z', moneyPool:5, moneyPer1kDamages:0.1 },
    attacker:{ country:'ALLY2' } },
  { _id:'B3', war:'W3', defender:{ region:'R3', country:'ENEMY', bountyEffectiveAt:'2026-07-02T12:00:00.000Z', moneyPool:10, moneyPer1kDamages:0.2 },
    attacker:{ country:'ENEMY' } },
];
const alliesSet = new Set(['ALLY1']);
const cascadeSet = new Set(['ALLY1', 'ALLY2']);

const bAll = extractAllyBounties(testItems, null);
const bCasc = extractAllyBounties(testItems, cascadeSet);
const bAlly = extractAllyBounties(testItems, alliesSet);

assert.ok(bAll.length >= bCasc.length);
assert.ok(bCasc.length >= bAlly.length);
assert.strictEqual(bAll.length, 3);
assert.strictEqual(bCasc.length, 2);
assert.strictEqual(bAlly.length, 1);
console.log('bounty-notify: Nesting (all >= cascade >= allies) OK');

// Composite Dedup key unique test
const mirrorSeen = {};
const key = bountyKey('B1', 'attacker', '2026-07-02T14:27:08.022Z');
mirrorSeen[`wia-bounty-all|${key}`] = 1000;
mirrorSeen[`wia-bounty-base|${key}`] = 2000;
assert.notStrictEqual(mirrorSeen[`wia-bounty-all|${key}`], mirrorSeen[`wia-bounty-base|${key}`]);
console.log('bounty-notify: Composite mirrorSeen keys OK');

// sendNtfy label param logic helper test
function resolveScopeLabel(customTopic, labelScope, userConfigScope) {
  return labelScope || (customTopic ? 'all' : (userConfigScope || 'cascade'));
}
assert.strictEqual(resolveScopeLabel('wia-bounty-all', 'allies', 'cascade'), 'allies');
assert.strictEqual(resolveScopeLabel('wia-bounty-all', 'cascade', 'all'), 'cascade');
assert.strictEqual(resolveScopeLabel('wia-bounty-all', null, 'cascade'), 'all');
assert.strictEqual(resolveScopeLabel(null, null, 'allies'), 'allies');
console.log('bounty-notify: sendNtfy labelScope resolution OK');
