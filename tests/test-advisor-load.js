const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing PROST script load ---');

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Mock Tampermonkey / Browser environment
global.GM_addStyle = () => {};
global.GM_getValue = (key, def) => def;
global.GM_setValue = () => {};
global.GM_registerMenuCommand = () => {};

// Mock Element class
class MockElement {
  constructor(tag, classes = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this.className = classes;
    this.style = {};
    this.classList = {
      classes: new Set(classes.split(' ').filter(Boolean)),
      add: (c) => this.classList.classes.add(c),
      remove: (c) => this.classList.classes.delete(c),
      contains: (c) => this.classList.classes.has(c)
    };
    this.children = [];
    this.dataset = {};
    this.parentElement = null;
    this.attributes = new Map();
    this.textContent = '';
    this.offsetWidth = 50;
    this.offsetHeight = 50;
  }

  appendChild(child) {
    if (child) {
      child.parentElement = this;
      this.children.push(child);
    }
    return child;
  }

  insertBefore(newChild, refChild) {
    if (newChild) {
      newChild.parentElement = this;
      this.children.unshift(newChild);
    }
    return newChild;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children.splice(idx, 1);
      }
      this.parentElement = null;
    }
  }

  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes.get(name) || '';
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
    if (name === 'class') {
      this.className = value;
      this.classList.classes = new Set(value.split(' ').filter(Boolean));
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  cloneNode(deep = true) {
    const clone = new MockElement(this.tagName.toLowerCase(), this.className);
    clone.textContent = this.textContent;
    clone.offsetWidth = this.offsetWidth;
    clone.offsetHeight = this.offsetHeight;
    for (const [k, v] of this.attributes.entries()) {
      clone.setAttribute(k, v);
    }
    for (const [k, v] of Object.entries(this.dataset)) {
      clone.dataset[k] = v;
    }
    if (deep) {
      this.children.forEach(child => {
        clone.appendChild(child.cloneNode(true));
      });
    }
    return clone;
  }

  closest(selector) {
    let el = this;
    while (el) {
      if (el.matchesSelector(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  matchesSelector(selector) {
    let tag = null;
    let rest = selector;
    const tagMatch = selector.match(/^([a-z0-9]+)(.*)/i);
    if (tagMatch) {
      tag = tagMatch[1].toUpperCase();
      rest = tagMatch[2];
    }
    if (tag && this.tagName !== tag) return false;
    if (!rest) return true;

    if (rest.startsWith('.')) {
      return this.classList.contains(rest.slice(1));
    }
    if (rest.startsWith('[')) {
      const matchStart = rest.match(/\[([^=^]+)\^="([^"]+)"\]/);
      if (matchStart) {
        return this.getAttribute(matchStart[1]).startsWith(matchStart[2]);
      }
      const matchContain = rest.match(/\[([^=*]+)\*="([^"]+)"\]/);
      if (matchContain) {
        return this.getAttribute(matchContain[1]).includes(matchContain[2]);
      }
      const matchEnd = rest.match(/\[([^=$]+)\$="([^"]+)"\]/);
      if (matchEnd) {
        return this.getAttribute(matchEnd[1]).endsWith(matchEnd[2]);
      }
      const matchEq = rest.match(/\[([^=]+)="([^"]+)"\]/);
      if (matchEq) {
        return this.getAttribute(matchEq[1]) === matchEq[2];
      }
      const attrMatch = rest.match(/\[([^\]]+)\]/);
      if (attrMatch) {
        return this.attributes.has(attrMatch[1]);
      }
    }
    return false;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const walk = (el) => {
      if (el !== this && el.matchesSelector(selector)) {
        results.push(el);
      }
      el.children.forEach(walk);
    };
    walk(this);
    return results;
  }

  insertAdjacentText(position, text) {
    if (position === 'afterend') {
      if (this.parentElement) {
        this.parentElement.textContent += ' ' + text;
      }
    }
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent || '';
    return this.children.map(c => c.textContent).join(' ');
  }

  set textContent(val) {
    this._textContent = val;
  }
}

// Mock Browser globals
global.window = {
  addEventListener: () => {}
};
global.document = {
  createElement: (tag) => new MockElement(tag),
  body: new MockElement('body'),
  querySelectorAll: () => [],
  querySelector: () => null
};
global.history = {
  pushState: () => {},
  replaceState: () => {}
};
global.location = {
  pathname: '/user/some-id/inventory'
};
global.navigator = {
  userAgent: 'node'
};
global.MutationObserver = class {
  observe() {}
  disconnect() {}
};

try {
  // Run the script by eval'ing it
  eval(code);
  assert.strictEqual(typeof globalThis.computeScrapFlip, 'function', 'computeScrapFlip should be defined');

  // Float-safe comparison (avoids IEEE-754 rounding noise like 1.7819999999999998)
  const EPS = 1e-9;
  const approx = (actual, expected, label) =>
    assert.ok(Math.abs(actual - expected) < EPS, `${label}: expected ~${expected}, got ${actual}`);

  // Profitable flip: buy 1.4, tier 1 (yield 6), scrap unit 0.3, tax 1%
  const win = globalThis.computeScrapFlip(1.4, 1, 0.3, 0.01, { 1: 6 });
  approx(win.scrapValue, 1.8, 'win.scrapValue');
  approx(win.net, 1.782, 'win.net');
  approx(win.profit, 0.382, 'win.profit');
  assert.strictEqual(win.yield, 6, 'win.yield');
  assert.strictEqual(win.flip, true, 'win.flip');

  // Non-profitable: buy price above net scrap value -> no flip
  const loss = globalThis.computeScrapFlip(2, 1, 0.3, 0.01, { 1: 6 });
  assert.strictEqual(loss.flip, false, 'loss.flip');
  assert.ok(loss.profit < 0, 'loss.profit should be negative');

  // Unknown tier (no yield) -> null, never a false signal
  assert.strictEqual(globalThis.computeScrapFlip(1.4, 99, 0.3, 0.01, { 1: 6 }), null, 'unknown tier -> null');

  // Missing inputs -> null
  assert.strictEqual(globalThis.computeScrapFlip(null, 1, 0.3, 0.01, { 1: 6 }), null, 'null buyPrice -> null');
  assert.strictEqual(globalThis.computeScrapFlip(1.4, 1, null, 0.01, { 1: 6 }), null, 'null scrap price -> null');

  // Grid safety-margin behavior: a marginally-profitable floor must STOP being a
  // flip once the 5% grid margin is applied (guards against false positives from
  // a scraped floor sitting below the real cheapest offer).
  const GRID_MARGIN = 0.05;
  const realFloor = 1.75; // net scrap value = 6 * 0.3 * 0.99 = 1.782
  const onRawFloor = globalThis.computeScrapFlip(realFloor, 1, 0.3, 0.01, { 1: 6 });
  assert.strictEqual(onRawFloor.flip, true, 'marginal floor flips on raw price');
  const onBufferedFloor = globalThis.computeScrapFlip(realFloor * (1 + GRID_MARGIN), 1, 0.3, 0.01, { 1: 6 });
  assert.strictEqual(onBufferedFloor.flip, false, 'marginal floor no longer flips after grid margin');
  assert.ok(onBufferedFloor.profit < 0, 'buffered marginal profit goes negative');

  console.log('--- Testing low durability and profile fixes ---');

  // Test 1: Durability parsing under cleanIcons.forEach container removal
  const cell = new MockElement('div');
  cell.setAttribute('aria-haspopup', 'dialog');

  const card = new MockElement('div');
  cell.appendChild(card);

  // Armor icon container
  const iconContainer = new MockElement('div', '_1dnmndy29y');
  const svgIcon = new MockElement('div', 'a6izou0');
  const svgPath = new MockElement('path');
  svgPath.setAttribute('d', 'M12,1L3,5V11C3,16.55'); // armor fingerprint
  svgIcon.appendChild(svgPath);
  iconContainer.appendChild(svgIcon);
  
  const armorText = new MockElement('span');
  armorText.textContent = '5';
  iconContainer.appendChild(armorText);
  card.appendChild(iconContainer);

  // Durability progress bar
  const durContainer = new MockElement('div');
  const durText = new MockElement('span');
  durText.textContent = '29%';
  durContainer.appendChild(durText);
  card.appendChild(durContainer);

  const parsed = globalThis.parseStats(card, 'chest');
  assert.strictEqual(parsed.primaryPercent, 5, 'Armor should be parsed as 5');
  assert.strictEqual(parsed.durability, 29, 'Durability should be parsed as 29 (and not 529!)');
  console.log('Test 1 passed: Durability parsed correctly as 29 without leaking armor value.');

  // Test 2: Character profile equipment slots exclusion
  const profileContainer = new MockElement('div');
  const progressbar = new MockElement('div', 'CircularProgressbar');
  profileContainer.appendChild(progressbar);

  const profileCard = new MockElement('div');
  profileContainer.appendChild(profileCard);

  const normalCard = new MockElement('div');

  assert.strictEqual(globalThis.isInsideProfileEquipment(profileCard), true, 'profileCard should be detected as inside profile equipment');
  assert.strictEqual(globalThis.isInsideProfileEquipment(normalCard), false, 'normalCard should NOT be detected as inside profile equipment');
  console.log('Test 2 passed: Profile equipment slots detected correctly.');

  // Test 3: Equipped and damaged suppression
  const equippedCell = new MockElement('div');
  equippedCell.setAttribute('aria-haspopup', 'dialog');
  const equippedCard = new MockElement('div');
  equippedCell.appendChild(equippedCard);
  const equipLabel = new MockElement('span');
  equipLabel.textContent = 'Equipped';
  equippedCard.appendChild(equipLabel);

  const normalCell2 = new MockElement('div');
  normalCell2.setAttribute('aria-haspopup', 'dialog');
  const normalCard2 = new MockElement('div');
  normalCell2.appendChild(normalCard2);

  // 1. Equipped, undamaged: should be suppressed
  assert.strictEqual(globalThis.shouldSuppressItem(equippedCard, { durability: 100 }), true, 'Equipped undamaged item should be suppressed');
  
  // 2. Equipped, damaged (<100%): should be suppressed
  assert.strictEqual(globalThis.shouldSuppressItem(equippedCard, { durability: 99 }), true, 'Equipped damaged item should be suppressed');

  // 3. Normal, undamaged: should NOT be suppressed
  assert.strictEqual(globalThis.shouldSuppressItem(normalCard2, { durability: 100 }), false, 'Normal undamaged item should not be suppressed');

  // 4. Normal, damaged (<100%): should be suppressed
  assert.strictEqual(globalThis.shouldSuppressItem(normalCard2, { durability: 99 }), true, 'Normal damaged item should be suppressed');

  console.log('Test 3 passed: Equipped and damaged items suppressed correctly.');

  console.log('Success! The script loaded and initialized without throwing any runtime errors.');
  process.exit(0);
} catch (err) {
  console.error('Error during script load/execution:');
  console.error(err.stack || err);
  process.exit(1);
}
