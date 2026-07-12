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

function extractAllyBounties(items, allySet, ownCountry = null) {
  const out = [];
  for (const b of (items || [])) {
    const attackerCountry = b.attacker && b.attacker.country;
    const defenderCountry = b.defender && b.defender.country;
    const isUserSideInvolved = ownCountry && (attackerCountry === ownCountry || defenderCountry === ownCountry);

    for (const side of ['attacker', 'defender']) {
      const s = b[side];
      if (!s || !s.bountyEffectiveAt) continue;

      // If the user's country is involved in the battle, they can only claim bounties on their own side.
      if (isUserSideInvolved && s.country !== ownCountry) {
        continue;
      }

      if (allySet && !allySet.has(s.country)) continue;
      out.push({
        battleId: b._id,
        side,
        country: s.country,
        attackerCountry,
        defenderCountry,
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
  // User country is ALLY, fighting ENEMY, bounty is on ENEMY side (should be skipped when ownCountry is ALLY)
  { _id:'B4', war:'W4', defender:{ region:'R4', country:'ALLY' },
    attacker:{ country:'ENEMY', bountyEffectiveAt:'2026-07-02T15:00:00.000Z', moneyPool:10, moneyPer1kDamages:0.1 } },
];
const res = extractAllyBounties(items, new Set(['ALLY', 'ENEMY']), 'ALLY');
assert.strictEqual(res.length, 2);
assert.strictEqual(res[0].battleId, 'B1');
assert.strictEqual(res[1].battleId, 'B2');
assert.strictEqual(res[0].side, 'attacker');
assert.strictEqual(res[0].moneyPool, 62.15);
assert.strictEqual(res[0].attackerCountry, 'ALLY');
assert.strictEqual(res[0].defenderCountry, 'ALLY');

const resAll = extractAllyBounties(items, null);
assert.strictEqual(resAll.length, 3);
assert.strictEqual(resAll[0].battleId, 'B1');
assert.strictEqual(resAll[1].battleId, 'B2');
assert.strictEqual(resAll[2].battleId, 'B4');
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

// Cache split and cascade set size verification test (Bug 2)
{
  const mockStorage = {};
  const GM_getValue = (key, def) => mockStorage[key] !== undefined ? mockStorage[key] : def;
  const GM_setValue = (key, val) => { mockStorage[key] = val; };
  const now = () => Date.now();
  const KEYS = { bountyAllyCache: 'bountyAllyCache' };
  const CONFIG = { bountyOwnCountryOverride: '' };
  const getCurrentUserId = () => 'user123';
  const resolveApiPost = async (method, args) => {
    if (method === 'user.getUserById' && args.userId === 'user123') {
      return { payload: { country: 'C1', alliance: 'A1' } };
    }
    throw new Error('unknown api method: ' + method);
  };
  const loadCountryMap = async () => ({
    C1: { allianceId: 'A1', allies: ['C2'] },
    C2: { allianceId: 'A1', defensivePacts: ['C3'] },
    C3: { allianceId: 'A2' }
  });
  const dbg = () => {};
  const BOUNTY_ALLY_TTL_MS = 60000;

  async function resolveAllyCountryIds(cascade = true) {
    const ckey = KEYS.bountyAllyCache + (cascade ? '_casc' : '_allies');
    const cached = GM_getValue(ckey, null);
    if (cached && (now() - cached.at) < BOUNTY_ALLY_TTL_MS && Array.isArray(cached.ids) && cached.ids.length) {
      return new Set(cached.ids);
    }
    const ids = new Set();
    try {
      const ov = (CONFIG.bountyOwnCountryOverride || '').trim();
      if (ov) {
        // override logic omitted for mock test simplicity
      }
      if (!ids.size) {
        const uid = getCurrentUserId();
        if (uid) {
          const u = await resolveApiPost('user.getUserById', { userId: uid });
          const ownCountry = u.payload?.country;
          if (ownCountry) {
            const map = await loadCountryMap();
            const addCountry = (cid, addRelations = true) => {
              if (!cid) return;
              ids.add(cid);
              const c = map[cid];
              if (c && addRelations) {
                (c.defensivePacts || []).forEach((x) => ids.add(x));
              }
            };
            addCountry(ownCountry, true);
            const aid = u.payload?.alliance || u.payload?.allianceId;
            if (aid) {
              for (const cid of Object.keys(map)) {
                if (map[cid].allianceId === aid) addCountry(cid, cascade);
              }
            }
          }
        }
      }
    } catch (e) {
      dbg('error', e.message);
    }
    if (ids.size) GM_setValue(ckey, { at: now(), ids: [...ids] });
    return ids;
  }

  (async () => {
    const alliesSet = await resolveAllyCountryIds(false);
    const cascadeSet = await resolveAllyCountryIds(true);

    // Verify cache split works and they don't overwrite each other
    assert.ok(mockStorage['bountyAllyCache_allies']);
    assert.ok(mockStorage['bountyAllyCache_casc']);
    assert.deepStrictEqual(mockStorage['bountyAllyCache_allies'].ids.sort(), ['C1', 'C2'].sort());
    assert.deepStrictEqual(mockStorage['bountyAllyCache_casc'].ids.sort(), ['C1', 'C2', 'C3'].sort());

    // Verify cascade size >= allies size
    assert.ok(cascadeSet.size >= alliesSet.size);
    assert.strictEqual(alliesSet.size, 2);
    assert.strictEqual(cascadeSet.size, 3);
    console.log('bounty-notify: resolveAllyCountryIds cache-split & nesting verification OK');
  })().catch(e => {
    console.error(e);
    process.exit(1);
  });
}

// New Tests for v0.8.10: Jitter, Client ID, and topicPresentKeys
const BOUNTY_JITTER_MS = 10000;
function bhash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h; }
function bountyJitter(seed) { return bhash(String(seed)) % BOUNTY_JITTER_MS; }

// Test bhash and bountyJitter determinism
const seedA = 'client1|wia-bounty-all|bkey_B1_attacker_123';
const seedB = 'client2|wia-bounty-all|bkey_B1_attacker_123';
const jitA1 = bountyJitter(seedA);
const jitA2 = bountyJitter(seedA);
const jitB = bountyJitter(seedB);

assert.strictEqual(jitA1, jitA2, 'bountyJitter must be deterministic');
assert.notStrictEqual(jitA1, jitB, 'bountyJitter must yield different offsets for different clients');
assert.ok(jitA1 >= 0 && jitA1 < BOUNTY_JITTER_MS, 'Jitter must be in bounds');
console.log('bounty-notify: jitter & bhash OK');

// Test bountyClientId logic
function bountyClientId(mockStorage) {
  let id = mockStorage['bountyClientId'] || '';
  if (!id) {
    id = ('12345678' + bhash('userAgent').toString(36)).replace(/[^a-z0-9]/gi, '').slice(0, 8);
    mockStorage['bountyClientId'] = id;
  }
  return id;
}
const mockStore = {};
const cid1 = bountyClientId(mockStore);
const cid2 = bountyClientId(mockStore);
assert.strictEqual(cid1, cid2, 'Client ID must be persisted and stable');
assert.strictEqual(cid1.length, 8, 'Client ID must be 8 chars');
console.log('bounty-notify: clientId OK');

// Test topicPresentKeys keys and legacy count
function topicPresentKeys(resText) {
  const msgs = parseNtfyNdjson(resText);
  const keys = new Set();
  let legacy = 0;
  for (const m of msgs) {
    const tags = m.tags || [];
    const bkey = tags.find(t => t.startsWith('bkey_'));
    if (bkey) {
      keys.add(bkey);
      const hasVersion = tags.some(t => t.startsWith('v'));
      if (!hasVersion) legacy++;
    }
  }
  return { keys, legacy };
}

const mockNdjson = `
{"id":"1","tags":["crossed_swords","bkey_B1_attacker_123","v0.8.10","cid_c1"]}
{"id":"2","tags":["crossed_swords","bkey_B2_attacker_456"]}
{"id":"3","tags":["random"]}
`;
const presentKeys = topicPresentKeys(mockNdjson);
assert.ok(presentKeys.keys.has('bkey_B1_attacker_123'));
assert.ok(presentKeys.keys.has('bkey_B2_attacker_456'));
assert.strictEqual(presentKeys.legacy, 1, 'Should have exactly 1 legacy notification');
console.log('bounty-notify: topicPresentKeys return format OK');

// ── v0.8.13: intra-client concurrency (lock race) & tabNonce jitter ──
// Mirror of the userscript's acquirePollSlot + renewPollLock (IIFE can't be required).
(async () => {
  const BOUNTY_POLL_MS = 30000, BOUNTY_LOCK_TTL_MS = 30000;

  // Each "tab" is a closure over the SHARED GM store but with its own activeLockVal,
  // exactly like separate browser tabs sharing one GM_storage backend.
  function makeTab(store, clockRef) {
    const G = (k, d) => (store[k] !== undefined ? store[k] : d);
    const S = (k, v) => { store[k] = v; };
    let activeLockVal = null;
    async function acquirePollSlot(backoffMs) {
      const nowMs = clockRef.t;
      if (nowMs - G('last', 0) < BOUNTY_POLL_MS) return false;
      const lock = G('lock', 0);
      if (lock && (nowMs - lock < BOUNTY_LOCK_TTL_MS)) return false;
      const myLockVal = nowMs + Math.random();
      S('lock', myLockVal);
      await new Promise((r) => setTimeout(r, backoffMs));   // deterministic backoff for the test
      if (G('lock', 0) !== myLockVal) return false;
      activeLockVal = myLockVal;
      S('last', nowMs);
      return true;
    }
    function release() {
      if (activeLockVal != null && G('lock', 0) === activeLockVal) S('lock', 0);
      activeLockVal = null;
    }
    return { acquirePollSlot, release };
  }

  // WORST CASE: 3 tabs fire at the same instant → all read lock=0 before any write lands.
  // Staggered backoffs model real timer jitter; last-writer-wins must resolve to ONE winner.
  const store = {}; const clockRef = { t: 100000 };
  const tabs = [makeTab(store, clockRef), makeTab(store, clockRef), makeTab(store, clockRef)];
  const results = await Promise.all([
    tabs[0].acquirePollSlot(60),
    tabs[1].acquirePollSlot(90),
    tabs[2].acquirePollSlot(120),
  ]);
  const winners = results.filter(Boolean).length;
  assert.strictEqual(winners, 1, `exactly 1 tab may win the poll slot, got ${winners}`);
  console.log('bounty-notify: concurrent lock — single winner OK');

  // A losing tab must NOT be blocked forever: after the winner releases, a later poll wins.
  tabs.forEach((t, i) => { if (results[i]) t.release(); });
  clockRef.t += BOUNTY_POLL_MS;   // next interval, past the 30s window
  const second = await tabs[1].acquirePollSlot(60);
  assert.strictEqual(second, true, 'a fresh poll after release + window must acquire');
  console.log('bounty-notify: lock released & re-acquirable OK');

  // tabNonce must diversify the jitter so tabs of the SAME client don't collide.
  const cid = 'client1', key = 'bkey_B1_attacker_123';
  const noNonce = bountyJitter(cid + '|' + key);
  const nonces = ['a1b2', 'c3d4', 'e5f6', 'g7h8'];
  const jitters = nonces.map((n) => bountyJitter(cid + '|' + n + '|' + key));
  assert.ok(new Set(jitters).size > 1, 'different tabNonces must yield different jitters');
  assert.ok(jitters.some((j) => j !== noNonce), 'tabNonce must change the stagger vs the old seed');
  console.log('bounty-notify: tabNonce jitter divergence OK');

  // ── v0.8.13: identity cache survives transient failure (settings must not fall to wia-bounty-all) ──
  // Mirror of resolveOwnIdentity's cache-on-success / fallback-on-failure contract.
  function makeResolver(store, api) {
    const G = (k, d) => (store[k] !== undefined ? store[k] : d);
    const S = (k, v) => { store[k] = v; };
    return async function resolveOwnIdentity() {
      const cachedIdentity = () => G('idCache', null);
      const uid = api.getCurrentUserId();
      if (!uid) return cachedIdentity();
      try {
        const u = await api.getUserById(uid);
        const ownCountry = u && u.country;
        if (!ownCountry) return cachedIdentity();
        const countryName = api.countryName(ownCountry) || ownCountry;
        const allianceName = api.allianceName || '';
        const base = (allianceName || countryName).toLowerCase().replace(/[^a-z0-9]/g, '');
        const identity = { countryName, allianceName, base };
        S('idCache', identity);
        return identity;
      } catch (e) { return cachedIdentity(); }
    };
  }
  // Mirror of updateTopicHints tName selection (the settings-UI symptom under test).
  const tNameFor = (scope, id) => (scope === 'all' ? 'all'
    : id && id.allianceName ? id.allianceName.toLowerCase().replace(/[^a-z0-9]/g, '')
    : id && id.countryName ? id.countryName.toLowerCase().replace(/[^a-z0-9]/g, '') : '');

  const idStore = {};
  const api = { ok: true, getCurrentUserId: () => 'u1',
    getUserById: async function () { if (!this.ok) throw new Error('429'); return { country: 'C1' }; },
    countryName: () => 'Redland', allianceName: 'Red Alliance' };
  const resolve = makeResolver(idStore, api);

  const first = await resolve();
  assert.strictEqual(first.base, 'redalliance', 'first resolve builds base from alliance');
  assert.strictEqual(tNameFor('cascade', first), 'redalliance', 'cascade topic uses alliance, not "all"');

  api.ok = false;   // now every API call 429s (the spam-induced rate-limit window)
  const during429 = await resolve();
  assert.ok(during429 && during429.base === 'redalliance', 'transient failure returns cached identity, not null');
  assert.strictEqual(tNameFor('cascade', during429), 'redalliance', 'UI keeps real topic during 429 (bug was "all")');

  api.getCurrentUserId = () => null;   // user-menu not in DOM this render
  const noDom = await resolve();
  assert.ok(noDom && noDom.base === 'redalliance', 'missing uid also falls back to cache');
  console.log('bounty-notify: identity cache fallback OK');
})().catch((e) => { console.error(e); process.exit(1); });


// ═══════════════════════════════════════════════════════════════════════════
// Blocks below were lost to an accidental `git checkout` of this file and
// restored/reconstructed afterwards.
// ═══════════════════════════════════════════════════════════════════════════

// ── popup refocus freshness gate (reconstructed) ──
// Mirror of checkAndShowPendingPopups' gate: on (re)focus the whole queued list
// replays; only triggers younger than POPUP_FRESH_MS may pop. Stale ones are
// consumed (marked shown) WITHOUT popping; already-shown keys never repeat.
{
  const POPUP_FRESH_MS = 90000;
  function replayGate(triggers, shownSet, nowMs) {
    const popped = [];
    for (const item of triggers) {
      if (shownSet.has(item.key)) continue;
      if (nowMs - item.time >= POPUP_FRESH_MS) { shownSet.add(item.key); continue; }
      shownSet.add(item.key);
      popped.push(item.key);
    }
    return popped;
  }
  const t0 = 1_000_000_000_000;
  const shown = new Set(['old-shown']);
  const popped = replayGate([
    { key: 'fresh', time: t0 - 5000 },
    { key: 'edge-fresh', time: t0 - POPUP_FRESH_MS + 1 },
    { key: 'stale', time: t0 - POPUP_FRESH_MS },
    { key: 'ancient', time: t0 - 600000 },
    { key: 'old-shown', time: t0 - 1000 },
  ], shown, t0);
  assert.deepStrictEqual(popped, ['fresh', 'edge-fresh'], 'only fresh triggers pop');
  assert.ok(shown.has('stale') && shown.has('ancient'), 'stale triggers consumed without popping');
  assert.deepStrictEqual(replayGate([{ key: 'fresh', time: t0 - 5000 }], shown, t0), [],
    'replay after consumption pops nothing');
  console.log('bounty-notify: popup refocus freshness gate OK');
}

// ── mirror dedup by bkey (time-based) ──
const MIRROR_TTL = 86400000;
function mirrorPrune(store, nowMs) {
  const out = {};
  for (const k of Object.keys(store)) if (nowMs - store[k] <= MIRROR_TTL) out[k] = store[k];
  return out;
}
function mirrorShouldForward(store, bkey, nowMs) {
  if (store[bkey]) return false;
  store[bkey] = nowMs;
  return true;
}

{
  let store = {};
  const t0 = 1_000_000_000_000;
  const bkeyA = 'bkey_6a4f1e75a9e526de9f9eaa7f_attacker_1783608484948';

  // 10 polls of the SAME bounty within its 30s window → forwarded exactly once.
  let fwd = 0;
  for (let i = 0; i < 10; i++) {
    store = mirrorPrune(store, t0 + i * 3000);
    if (mirrorShouldForward(store, bkeyA, t0 + i * 3000)) fwd++;
  }
  assert.strictEqual(fwd, 1, 'same bkey across ~10 polls forwards once (cap-10 thrash fixed)');

  // 20 other distinct bounties flow through (would have evicted bkeyA from a cap-10 array)…
  for (let i = 0; i < 20; i++) mirrorShouldForward(store, `bkey_other_${i}`, t0 + 30000);
  // …bkeyA reappears (e.g. re-published a minute later) → still deduped, no eviction.
  assert.strictEqual(mirrorShouldForward(store, bkeyA, t0 + 60000), false,
    'bkeyA not re-forwarded despite 20 newer entries');

  // A genuinely different bounty round (new effectiveAt → new bkey) DOES forward.
  const bkeyA2 = 'bkey_6a4f1e75a9e526de9f9eaa7f_attacker_1783608000882';
  assert.strictEqual(mirrorShouldForward(store, bkeyA2, t0 + 61000), true,
    'different bkey (new bounty round) forwards');

  // After TTL the entry is pruned → treated as new again (acceptable, 24h later).
  store = mirrorPrune(store, t0 + MIRROR_TTL + 1);
  assert.strictEqual(mirrorShouldForward(store, bkeyA, t0 + MIRROR_TTL + 1), true,
    'after TTL, treated as new');
  console.log('bounty-notify: mirror dedup by bkey (time-based) OK');
}

// ── v0.8.17: ntfy 429 layer (backoff, Retry-After, no blind sends) ──
// Mirror of the userscript's ntfy rate-limit helpers (IIFE can't be required).
const NTFY_BACKOFF_BASE_MS = 5 * 60 * 1000;
const NTFY_BACKOFF_CAP_MS = 60 * 60 * 1000;
function ntfyBackoffMsFor(retryAfterSec, streak) {
  const escalated = Math.min(NTFY_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, (streak || 1) - 1)), NTFY_BACKOFF_CAP_MS);
  return Math.max(escalated, (retryAfterSec || 0) * 1000);
}
function parseRetryAfterSec(rawHeaders) {
  const m = /^retry-after:\s*(\d+)\s*$/im.exec(rawHeaders || '');
  return m ? parseInt(m[1], 10) : 0;
}

assert.strictEqual(ntfyBackoffMsFor(0, 1), 5 * 60 * 1000, 'first 429 → 5 min');
assert.strictEqual(ntfyBackoffMsFor(0, 2), 10 * 60 * 1000, 'second consecutive 429 → 10 min');
assert.strictEqual(ntfyBackoffMsFor(0, 4), 40 * 60 * 1000, 'fourth → 40 min');
assert.strictEqual(ntfyBackoffMsFor(0, 5), 60 * 60 * 1000, 'escalation capped at 60 min');
assert.strictEqual(ntfyBackoffMsFor(0, 50), 60 * 60 * 1000, 'huge streak still capped');
assert.strictEqual(ntfyBackoffMsFor(900, 1), 900 * 1000, 'Retry-After wins when longer than backoff');
assert.strictEqual(ntfyBackoffMsFor(10, 1), 5 * 60 * 1000, 'short Retry-After never shrinks backoff');
console.log('bounty-notify: ntfy backoff escalation OK');

assert.strictEqual(parseRetryAfterSec('Content-Type: text/plain\r\nRetry-After: 77\r\n'), 77);
assert.strictEqual(parseRetryAfterSec('retry-after: 5'), 5, 'case-insensitive');
assert.strictEqual(parseRetryAfterSec('Content-Type: text/plain'), 0, 'absent → 0');
assert.strictEqual(parseRetryAfterSec(''), 0);
assert.strictEqual(parseRetryAfterSec(null), 0);
console.log('bounty-notify: Retry-After parsing OK');

// Gate semantics: 429 trips a persisted window; requests inside the window are
// suppressed WITHOUT hitting the network; success resets the escalation streak.
function makeNtfyGate(store, clockRef) {
  return {
    isLimited: () => clockRef.t < (store.until || 0),
    onResponse: (status, rawHeaders) => {
      if (status === 429) {
        store.streak = (store.streak || 0) + 1;
        store.until = clockRef.t + ntfyBackoffMsFor(parseRetryAfterSec(rawHeaders), store.streak);
        return null;
      }
      store.streak = 0;
      return { status };
    },
  };
}
{
  const store = {}, clock = { t: 1_000_000_000_000 };
  const gate = makeNtfyGate(store, clock);
  assert.strictEqual(gate.isLimited(), false, 'starts unlimited');
  assert.strictEqual(gate.onResponse(429, ''), null, '429 → null (caller must not mark sent)');
  assert.strictEqual(gate.isLimited(), true, '429 trips the gate');
  clock.t += 5 * 60 * 1000 - 1;
  assert.strictEqual(gate.isLimited(), true, 'still limited 1ms before expiry');
  clock.t += 2;
  assert.strictEqual(gate.isLimited(), false, 'expires after backoff');
  gate.onResponse(429, '');
  clock.t += 10 * 60 * 1000 + 1;   // second consecutive 429 → 10 min window
  assert.strictEqual(gate.isLimited(), false, 'second window is 10 min (escalated)');
  assert.ok(gate.onResponse(200, ''), '2xx passes through');
  assert.strictEqual(store.streak, 0, 'success resets the streak');
  gate.onResponse(429, '');
  clock.t += 5 * 60 * 1000 + 1;
  assert.strictEqual(gate.isLimited(), false, 'post-reset 429 back to 5 min window');
  console.log('bounty-notify: ntfy gate trip/expiry/reset OK');
}

// Regression: ntfy answers 429 with a JSON error body. The old reader parsed it
// as an "empty topic" (no tags → no keys) → dedup defeated → EVERY pending
// bounty re-published while rate-limited. Non-200 must read as UNKNOWN (null).
function topicPresentKeysV2(status, resText) {
  if (status !== 200) return null;
  const msgs = parseNtfyNdjson(resText);
  const keys = new Set();
  let legacy = 0;
  for (const m of msgs) {
    const tags = m.tags || [];
    const bkey = tags.find(t => t.startsWith('bkey_'));
    if (bkey) {
      keys.add(bkey);
      if (!tags.some(t => t.startsWith('v'))) legacy++;
    }
  }
  return { keys, legacy };
}
{
  const ntfy429Body = '{"code":42901,"http":429,"error":"limit reached","link":"https://ntfy.sh/docs/publish/#limitations"}';
  assert.strictEqual(topicPresentKeysV2(429, ntfy429Body), null, '429 → UNKNOWN, never "empty topic"');
  assert.strictEqual(topicPresentKeysV2(502, ''), null, 'other non-200 → UNKNOWN too');
  const okRes = topicPresentKeysV2(200, '{"id":"1","tags":["crossed_swords","bkey_B9_attacker_1","v0.8.17"]}');
  assert.ok(okRes.keys.has('bkey_B9_attacker_1'), '200 still parses keys');
  console.log('bounty-notify: 429 readback → null (no blind re-publish) OK');
}
