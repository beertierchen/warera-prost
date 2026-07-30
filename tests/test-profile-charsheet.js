const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing User-Profile Charakterbogen-Strip (Issue #63) ---');

// Mock browser / Tampermonkey environment
global.location = { pathname: '/' };
global.window = { addEventListener: () => {}, location: global.location };
global.MutationObserver = class { observe() {} disconnect() {} };
global.GM_addStyle = () => {};
global.GM_setValue = () => {};
global.GM_getValue = (key, def) => def;
global.GM_registerMenuCommand = () => {};

class MockElement {
  constructor(tag) { this.tagName = (tag || 'div').toUpperCase(); this.style = {}; this.children = []; }
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
eval(fs.readFileSync(scriptPath, 'utf8'));

function setPath(p) { global.location.pathname = p; }

// Test 1: getEntityFromRoute — /user route + existing routes intact
console.log('Test 1: getEntityFromRoute recognizes /user/<id>...');
setPath('/user/69fa68b7b1c4942142eb2942');
assert.deepStrictEqual(globalThis.getEntityFromRoute(), { type: 'user', rawId: '69fa68b7b1c4942142eb2942' });
setPath('/user/abc-123_X');
assert.deepStrictEqual(globalThis.getEntityFromRoute(), { type: 'user', rawId: 'abc-123_X' });
setPath('/mu/xyz');
assert.deepStrictEqual(globalThis.getEntityFromRoute(), { type: 'mu', rawId: 'xyz' });
setPath('/country/de');
assert.deepStrictEqual(globalThis.getEntityFromRoute(), { type: 'country', rawId: 'de' });

// Test 1b: getEntityFromRoute resolves /mu using DOM fallback
console.log('Test 1b: getEntityFromRoute resolves /mu using DOM fallback...');
setPath('/mu');
const originalQSA = global.document.querySelectorAll;
global.document.querySelectorAll = (selector) => {
  if (selector === 'a[href*="/mu/"]') {
    return [
      {
        getAttribute: (attr) => {
          if (attr === 'href') return '/mu/69fa68b7b1c4942142eb2942/members';
          return null;
        }
      }
    ];
  }
  return [];
};
assert.deepStrictEqual(globalThis.getEntityFromRoute(), { type: 'mu', rawId: '69fa68b7b1c4942142eb2942' });
global.document.querySelectorAll = originalQSA;

// Test 2: isUserProfilePage
console.log('Test 2: isUserProfilePage...');
setPath('/user/abc123');           assert.strictEqual(globalThis.isUserProfilePage(), true);
setPath('/user/abc123/');          assert.strictEqual(globalThis.isUserProfilePage(), true);
setPath('/user/abc123/inventory'); assert.strictEqual(globalThis.isUserProfilePage(), false, 'subviews excluded');
setPath('/user/abc123/skills');    assert.strictEqual(globalThis.isUserProfilePage(), false);
setPath('/mu/abc123');             assert.strictEqual(globalThis.isUserProfilePage(), false);
setPath('/user/');                 assert.strictEqual(globalThis.isUserProfilePage(), false);
setPath('/');                      assert.strictEqual(globalThis.isUserProfilePage(), false);

// Test 3: profileClassMeta — build → title key + accent color
console.log('Test 3: profileClassMeta build mapping...');
assert.deepStrictEqual(globalThis.profileClassMeta('war'),    { titleKey: 'profileClassWar',    color: '#e05a45' });
assert.deepStrictEqual(globalThis.profileClassMeta('hybrid'), { titleKey: 'profileClassHybrid', color: '#8a6fc0' });
assert.deepStrictEqual(globalThis.profileClassMeta('eco'),    { titleKey: 'profileClassEco',    color: '#b8912b' });
// unknown build defaults to eco (never throws / NaN)
assert.deepStrictEqual(globalThis.profileClassMeta(undefined), { titleKey: 'profileClassEco', color: '#b8912b' });

// Test 4: renderProfileCharsheet is NaN-safe (no anchor → no-op, no throw)
console.log('Test 4: renderProfileCharsheet safe with zero/degraded input...');
assert.doesNotThrow(() => globalThis.renderProfileCharsheet({ build: 'war', hpMax: 0, hungerMax: 0, hpCurrent: 0, hungerCurrent: 0, warShare: 0 }));
assert.doesNotThrow(() => globalThis.renderProfileCharsheet(null));

console.log('All Profile-Charsheet tests passed successfully!');
process.exit(0);
