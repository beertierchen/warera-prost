const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing PROST script load ---');

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Mock Tampermonkey / Browser environment
global.GM_addStyle = () => {};
const mockStorage = { 'wia.locale': 'en' };
global.GM_setValue = (key, val) => {
  if (val != null && (typeof val === 'object' || Array.isArray(val))) {
    mockStorage[key] = JSON.stringify(val);
  } else {
    mockStorage[key] = val;
  }
};
global.GM_getValue = (key, def) => {
  const val = key in mockStorage ? mockStorage[key] : def;
  if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
    try { return JSON.parse(val); } catch (e) {}
  }
  return val;
};
global.GM_registerMenuCommand = () => {};
global.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

// Mock Element class
class MockElement {
  constructor(tag, classes = '') {
    this.tagName = (tag || 'div').toUpperCase();
    this._className = classes;
    this.style = {};
    this.classList = {
      classes: new Set(classes.split(' ').filter(Boolean)),
      add: (c) => {
        this.classList.classes.add(c);
        this._className = Array.from(this.classList.classes).join(' ');
      },
      remove: (c) => {
        this.classList.classes.delete(c);
        this._className = Array.from(this.classList.classes).join(' ');
      },
      contains: (c) => this.classList.classes.has(c)
    };
    this.children = [];
    this.dataset = {};
    this.parentElement = null;
    this.attributes = new Map();
    this.textContent = '';
    this.offsetWidth = 600;
    this.offsetHeight = 50;
  }

  focus() {}
  blur() {}

  get childNodes() {
    return this.children;
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val;
    this.classList.classes = new Set(val.split(' ').filter(Boolean));
  }

  get innerHTML() {
    const serializeAttr = (k, v) => `${k}="${v}"`;
    return this.children.map(c => {
      const tag = c.tagName.toLowerCase();
      const attrs = [];
      if (c.className) attrs.push(serializeAttr('class', c.className));
      for (const [k, v] of c.attributes.entries()) {
        if (k !== 'class') attrs.push(serializeAttr(k, v));
      }
      const attrsStr = attrs.length ? ' ' + attrs.join(' ') : '';
      if (['input', 'img', 'br', 'hr'].includes(tag)) {
        return `<${tag}${attrsStr} />`;
      }
      const childContent = c.innerHTML || c.textContent;
      return `<${tag}${attrsStr}>${childContent}</${tag}>`;
    }).join('');
  }

  set innerHTML(html) {
    this.children = [];
    const stack = [this];
    const tokenRegex = /<([a-z0-9-]+)([^>]*?)\/?>|<\/([a-z0-9-]+)>|([^<]+)/gi;
    let match;
    while ((match = tokenRegex.exec(html)) !== null) {
      const [full, openTag, attrsStr, closeTag, text] = match;
      if (openTag) {
        const child = new MockElement(openTag);
        const attrRegex = /([a-z0-9-]+)\s*=\s*['"]([^'"]*)['"]/gi;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
          child.setAttribute(attrMatch[1], attrMatch[2]);
        }
        const styleAttr = child.getAttribute('style');
        if (styleAttr) {
          styleAttr.split(';').forEach(s => {
            const parts = s.split(':');
            if (parts.length === 2) {
              child.style[parts[0].trim()] = parts[1].trim();
            }
          });
        }
        if (attrsStr.toLowerCase().includes('checked')) {
          child.checked = true;
        }
        if (/\bhidden\b/i.test(attrsStr)) {
          child.setAttribute('hidden', 'true');
        }
        stack[stack.length - 1].appendChild(child);
        if (!full.endsWith('/>') && !['input', 'img', 'br', 'hr'].includes(openTag.toLowerCase())) {
          stack.push(child);
        }
      } else if (closeTag) {
        if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === closeTag.toLowerCase()) {
          stack.pop();
        }
      } else if (text && text.trim()) {
        stack[stack.length - 1].textContent = text.trim();
      }
    }
  }

  get id() { return this.getAttribute('id'); }
  set id(val) { this.setAttribute('id', val); }

  get src() { return this.getAttribute('src'); }
  set src(val) { this.setAttribute('src', val); }

  get href() { return this.getAttribute('href'); }
  set href(val) { this.setAttribute('href', val); }

  get alt() { return this.getAttribute('alt'); }
  set alt(val) { this.setAttribute('alt', val); }

  addEventListener(event, callback) {
    if (!this.listeners) this.listeners = {};
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  dispatchEvent(event, data = {}) {
    if (this.listeners && this.listeners[event]) {
      const e = {
        target: data.target || this,
        preventDefault: () => {},
        stopPropagation: () => {},
        ...data
      };
      this.listeners[event].forEach(cb => cb(e));
    }
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

  toggleAttribute(name, force) {
    const has = this.attributes.has(name);
    const shouldHave = force !== undefined ? !!force : !has;
    if (shouldHave) {
      this.attributes.set(name, 'true');
      return true;
    } else {
      this.attributes.delete(name);
      return false;
    }
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
    if (selector.includes(',')) {
      return selector.split(',').some(sel => this.matchesSelector(sel.trim()));
    }
    let tag = null;
    let rest = selector;
    const tagMatch = selector.match(/^([a-z0-9]+)(.*)/i);
    if (tagMatch) {
      tag = tagMatch[1].toUpperCase();
      rest = tagMatch[2];
    }
    if (tag && this.tagName !== tag) return false;
    if (!rest) return true;

    if (rest.startsWith('#')) {
      return this.getAttribute('id') === rest.slice(1);
    }
    if (rest.startsWith('.')) {
      return this.classList.contains(rest.slice(1));
    }
    if (rest.startsWith('[')) {
      const matchStart = rest.match(/\[([^=^]+)\^=['"]([^'"]+)['"]\]/);
      if (matchStart) {
        return this.getAttribute(matchStart[1]).startsWith(matchStart[2]);
      }
      const matchContain = rest.match(/\[([^=*]+)\*=['"]([^'"]+)['"]\]/);
      if (matchContain) {
        return this.getAttribute(matchContain[1]).includes(matchContain[2]);
      }
      const matchEnd = rest.match(/\[([^=$]+)\$=['"]([^'"]+)['"]\]/);
      if (matchEnd) {
        return this.getAttribute(matchEnd[1]).endsWith(matchEnd[2]);
      }
      const matchEq = rest.match(/\[([^=]+)=['"]([^'"]+)['"]\]/);
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

  insertAdjacentElement(position, element) {
    if (position === 'afterend') {
      if (this.parentElement) {
        const idx = this.parentElement.children.indexOf(this);
        if (idx !== -1) {
          this.parentElement.children.splice(idx + 1, 0, element);
          element.parentElement = this.parentElement;
        } else {
          this.parentElement.appendChild(element);
        }
      }
    }
  }

  get textContent() {
    if (this.children.length === 0) {
      return this._textContent !== undefined && this._textContent !== null ? String(this._textContent) : '';
    }
    return this.children.map(c => String(c.textContent)).join(' ');
  }

  set textContent(val) {
    this._textContent = val !== undefined && val !== null ? String(val) : '';
  }
}

// Mock Browser globals
global.window = {
  addEventListener: () => {},
  getComputedStyle: (el) => {
    return {
      color: el.style.color || 'rgb(59, 219, 139)',
      borderColor: el.style.borderColor || '',
      borderTopColor: el.style.borderTopColor || '',
      outlineColor: el.style.outlineColor || '',
      backgroundColor: el.style.backgroundColor || '',
      boxShadow: el.style.boxShadow || '',
      ...el.style
    };
  },
  setTimeout: (fn, delay) => setTimeout(fn, delay)
};
global.getComputedStyle = global.window.getComputedStyle;
const documentBody = new MockElement('body');
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => new MockElement(tag),
  createTextNode: (text) => {
    const el = new MockElement('span');
    el.nodeType = 3;
    el.textContent = text;
    return el;
  },
  body: documentBody,
  querySelectorAll: (selector) => documentBody.querySelectorAll(selector),
  querySelector: (selector) => {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const results = [];
      const walk = (el) => {
        if (el.getAttribute('id') === id) results.push(el);
        el.children.forEach(walk);
      };
      walk(documentBody);
      return results.length ? results[0] : null;
    }
    return documentBody.querySelector(selector);
  },
  getElementById: (id) => {
    const results = [];
    const walk = (el) => {
      if (el.getAttribute('id') === id) results.push(el);
      el.children.forEach(walk);
    };
    walk(documentBody);
    return results.length ? results[0] : null;
  }
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

  console.log('--- Testing battle advisor highlights (PLAN-agy-battle-orders.md) ---');

  // Helpers to build a mock battle page in documentBody
  const buildBattlePage = (opts = {}) => {
    // Clear documentBody
    documentBody.children = [];

    // Columns
    const defCol = new MockElement('div', 'column-def');
    const atkCol = new MockElement('div', 'column-atk');
    documentBody.appendChild(defCol);
    documentBody.appendChild(atkCol);

    // Button wrappers inside columns
    const defBtnWrapper = new MockElement('div');
    const defBtn = new MockElement('div');
    defBtn.setAttribute('id', 'defender-hit-button');
    const defBtnInner = new MockElement('button');
    const defFlag = new MockElement('img');
    defFlag.setAttribute('src', '/images/flags/fr.svg');
    defBtnInner.appendChild(defFlag);
    defBtn.appendChild(defBtnInner);
    defBtnWrapper.appendChild(defBtn);
    defCol.appendChild(defBtnWrapper);

    const atkBtnWrapper = new MockElement('div');
    const atkBtn = new MockElement('div');
    atkBtn.setAttribute('id', 'attacker-hit-button');
    const atkBtnInner = new MockElement('button');
    const atkFlag = new MockElement('img');
    atkFlag.setAttribute('src', '/images/flags/pl.svg');
    atkBtnInner.appendChild(atkFlag);
    atkBtn.appendChild(atkBtnInner);
    atkBtnWrapper.appendChild(atkBtn);
    atkCol.appendChild(atkBtnWrapper);

    // Add orders if requested
    if (opts.defOrders) {
      const ordersContainer = new MockElement('div');
      opts.defOrders.forEach(url => {
        const row = new MockElement('div');
        const svg = new MockElement('svg');
        svg.style.color = 'rgb(59, 219, 139)';
        row.appendChild(svg);
        const a = new MockElement('a');
        a.setAttribute('href', url);
        const img = new MockElement('img');
        img.setAttribute('src', '/images/flags/de.svg');
        a.appendChild(img);
        row.appendChild(a);
        ordersContainer.appendChild(row);
      });
      defCol.appendChild(ordersContainer);
    }
    if (opts.atkOrders) {
      const ordersContainer = new MockElement('div');
      opts.atkOrders.forEach(url => {
        const row = new MockElement('div');
        const svg = new MockElement('svg');
        svg.style.color = 'rgb(248, 81, 73)';
        row.appendChild(svg);
        const a = new MockElement('a');
        a.setAttribute('href', url);
        const img = new MockElement('img');
        img.setAttribute('src', 'https://media.warera.io/avatars/mu/1.webp');
        a.appendChild(img);
        row.appendChild(a);
        ordersContainer.appendChild(row);
      });
      atkCol.appendChild(ordersContainer);
    }
  };

  // Case A: Country orders on defender side, country NOT in allied list
  buildBattlePage({ defOrders: ['/country/germany'] });
  assert.strictEqual(globalThis.detectAllySide(), 'defender', 'Defender should be highlighted due to country orders');

  // Case B: MU orders on defender side, defender NOT in allied list
  buildBattlePage({ defOrders: ['/mu/1234'] });
  assert.strictEqual(globalThis.detectAllySide(), 'defender', 'Defender should be highlighted due to MU-only orders');

  // Case C: Attacker has MU orders, defender has no orders
  buildBattlePage({ atkOrders: ['/mu/5678'] });
  assert.strictEqual(globalThis.detectAllySide(), 'attacker', 'Attacker should be highlighted due to MU orders');

  // Case D: Both sides have orders (should return null to never guess)
  buildBattlePage({ defOrders: ['/country/germany'], atkOrders: ['/mu/5678'] });
  assert.strictEqual(globalThis.detectAllySide(), null, 'Should return null when both sides have orders');

  // Case E: Neither side has orders (should return null)
  buildBattlePage({});
  assert.strictEqual(globalThis.detectAllySide(), null, 'Should return null when neither side has orders');

  // Case F: Verify compact orders injection
  buildBattlePage({
    defOrders: ['/country/germany'],
    atkOrders: ['/mu/5678']
  });

  const defBtn = document.querySelector('#defender-hit-button');
  const atkBtn = document.querySelector('#attacker-hit-button');

  globalThis.injectCompactOrders(defBtn);
  globalThis.injectCompactOrders(atkBtn);

  // Defender button inner should have the injected container
  const defInjected = defBtn.querySelector('.wia-compact-orders');
  assert.ok(defInjected, 'Defender button should have compact orders injected');
  assert.strictEqual(defInjected.children.length, 1, 'Defender should have 1 compact order item');
  const defSymbol = defInjected.querySelector('.wia-compact-order-symbol');
  const defFlag = defInjected.querySelector('.wia-compact-order-flag');
  assert.ok(defSymbol, 'Should find order symbol in defender button');
  assert.strictEqual(defSymbol.style.color, 'rgb(59, 219, 139)', 'Defender symbol should preserve green color');
  assert.ok(defFlag, 'Should find order flag in defender button');
  assert.strictEqual(defFlag.getAttribute('src'), '/images/flags/de.svg', 'Defender flag should point to Germany flag');

  // Attacker button inner should have the injected container
  const atkInjected = atkBtn.querySelector('.wia-compact-orders');
  assert.ok(atkInjected, 'Attacker button should have compact orders injected');
  assert.strictEqual(atkInjected.children.length, 1, 'Attacker should have 1 compact order item');
  const atkSymbol = atkInjected.querySelector('.wia-compact-order-symbol');
  const atkFlag = atkInjected.querySelector('.wia-compact-order-flag');
  assert.ok(atkSymbol, 'Should find order symbol in attacker button');
  assert.strictEqual(atkSymbol.style.color, 'rgb(248, 81, 73)', 'Attacker symbol should preserve red color');
  assert.ok(atkFlag, 'Should find order flag in attacker button');
  assert.strictEqual(atkFlag.getAttribute('src'), 'https://media.warera.io/avatars/mu/1.webp', 'Attacker flag should point to MU avatar');

  console.log('Battle advisor highlights and compact order injection tests passed successfully.');

  console.log('--- Testing settings cheatsheet and hints UI (PLAN-agy-settings-cheatsheet-ui.md) ---');
  const bg = new MockElement('div');
  globalThis.renderSettingsModal(bg);

  const modalEl = bg.querySelector('.wia-modal');
  assert.ok(modalEl, 'Settings modal should be rendered');

  const hintBtns = bg.querySelectorAll('.wia-hint-toggle');
  assert.strictEqual(hintBtns.length, 7, 'Should have exactly 7 hint toggle buttons (Notes, Battle, Live Offers, Scrap Flip, Pill Reminder, Market Graph, P&L Tracker)');

  const liveOffersCheckbox = bg.querySelector('.wia-live-offers');
  const scrapFlipCheckbox = bg.querySelector('.wia-scrap-flip');
  const featPillCheckbox = bg.querySelector('.wia-feat-pill');
  const featMarketGraphCheckbox = bg.querySelector('.wia-feat-market-graph');
  const featPnlTrackerCheckbox = bg.querySelector('.wia-feat-pnl-tracker');
  assert.ok(liveOffersCheckbox, 'Live offers checkbox should be present');
  assert.ok(scrapFlipCheckbox, 'Scrap flip checkbox should be present');
  assert.ok(featPillCheckbox, 'Pill reminder checkbox should be present');
  assert.ok(featMarketGraphCheckbox, 'Market graph checkbox should be present');
  assert.ok(featPnlTrackerCheckbox, 'P&L Tracker checkbox should be present');

  const highCritCheckbox = bg.querySelector('.wia-high-crit');
  assert.strictEqual(highCritCheckbox, null, 'High crit checkbox should be removed');

  const helpBtn = bg.querySelector('.wia-help-toggle');
  assert.ok(helpBtn, 'Settings modal should have a cheatsheet help toggle button');

  const helpPanel = bg.querySelector('.wia-help-panel');
  assert.ok(helpPanel, 'Settings modal should have a cheatsheet panel');
  assert.strictEqual(helpPanel.getAttribute('hidden'), 'true', 'Cheatsheet panel should start hidden');

  // Verify cheatsheet panel toggle click
  modalEl.dispatchEvent('click', { target: helpBtn });
  assert.strictEqual(helpPanel.attributes.has('hidden'), false, 'Cheatsheet panel should be visible after toggling');

  // Battle advisor codes row is removed as allied country codes are resolved automatically.
  const featBattleCheckbox = bg.querySelector('.wia-feat-battle');
  assert.ok(featBattleCheckbox, 'Battle advisor checkbox should be present');

  console.log('Settings cheatsheet and hints UI tests passed successfully.');

  console.log('--- Testing Pill Reminder module ---');
  
  const header = new MockElement('header');
  documentBody.appendChild(header);

  const layoutUserMenu = new MockElement('div');
  layoutUserMenu.setAttribute('id', 'layoutUserMenu');
  const userProfileLink = new MockElement('a');
  userProfileLink.setAttribute('href', '/user/test-user-123');
  
  const avatarImg = new MockElement('img');
  avatarImg.setAttribute('src', '/images/avatars/avatar1.png');
  avatarImg.setAttribute('alt', 'avatar');
  userProfileLink.appendChild(avatarImg);
  layoutUserMenu.appendChild(userProfileLink);
  header.appendChild(layoutUserMenu);

  const hpWrap = new MockElement('div');
  const hpTrack = new MockElement('div');
  const hpFill = new MockElement('div');
  hpFill.setAttribute('style', 'transform-origin: left center; transform: scaleX(0.5);');
  hpTrack.appendChild(hpFill);
  hpWrap.appendChild(hpTrack);

  const hpTextContainer = new MockElement('div');
  const hpSvg = new MockElement('svg');
  const hpPath = new MockElement('path');
  hpPath.setAttribute('d', 'M12,21.35L10.55,20.03 heart fingerprint');
  hpSvg.appendChild(hpPath);
  hpTextContainer.appendChild(hpSvg);
  const hpText = new MockElement('span');
  hpText.textContent = '130/130';
  hpTextContainer.appendChild(hpText);
  
  const hpRegenSpan = new MockElement('span');
  const hpChevronSvg = new MockElement('svg');
  const hpChevronPath = new MockElement('path');
  hpChevronPath.setAttribute('d', 'M7.41,18.41 double chevron up fingerprint');
  hpChevronSvg.appendChild(hpChevronPath);
  hpRegenSpan.appendChild(hpChevronSvg);
  const hpRegenVal = new MockElement('span');
  hpRegenVal.textContent = '13';
  hpRegenSpan.appendChild(hpRegenVal);
  hpTextContainer.appendChild(hpRegenSpan);
  hpWrap.appendChild(hpTextContainer);
  
  header.appendChild(hpWrap);

  const hungerWrap = new MockElement('div');
  const hungerTrack = new MockElement('div');
  const hungerFill = new MockElement('div');
  hungerFill.setAttribute('style', 'transform-origin: left center; transform: scaleX(0.2);');
  hungerTrack.appendChild(hungerFill);
  hungerWrap.appendChild(hungerTrack);

  const hungerTextContainer = new MockElement('div');
  const hungerSvg = new MockElement('svg');
  const hungerPath = new MockElement('path');
  hungerPath.setAttribute('d', 'M11,9H9V2H7V9 hunger fingerprint');
  hungerSvg.appendChild(hungerPath);
  hungerTextContainer.appendChild(hungerSvg);
  const hungerText = new MockElement('span');
  hungerText.textContent = '5/5';
  hungerTextContainer.appendChild(hungerText);
  
  const hungerRegenSpan = new MockElement('span');
  const hungerChevronSvg = new MockElement('svg');
  const hungerChevronPath = new MockElement('path');
  hungerChevronPath.setAttribute('d', 'M7.41,18.41 double chevron up fingerprint');
  hungerChevronSvg.appendChild(hungerChevronPath);
  hungerRegenSpan.appendChild(hungerChevronSvg);
  const hungerRegenVal = new MockElement('span');
  hungerRegenVal.textContent = '0.5';
  hungerRegenSpan.appendChild(hungerRegenVal);
  hungerTextContainer.appendChild(hungerRegenSpan);
  hungerWrap.appendChild(hungerTextContainer);
  
  header.appendChild(hungerWrap);

  const tickSpan = new MockElement('span');
  const tickChevronSvg = new MockElement('svg');
  const tickChevronPath = new MockElement('path');
  tickChevronPath.setAttribute('d', 'M7.41,18.41 double chevron up fingerprint');
  tickChevronSvg.appendChild(tickChevronPath);
  tickSpan.appendChild(tickChevronSvg);
  const tickTimeText = new MockElement('span');
  tickTimeText.textContent = '53m38s';
  tickSpan.appendChild(tickTimeText);
  header.appendChild(tickSpan);

  const parsedUserId = globalThis.getCurrentUserId();
  assert.strictEqual(parsedUserId, 'test-user-123', 'Should extract own user id as test-user-123');

  globalThis.CONFIG.doubleChevronPath = 'M7.41,18.41';
  globalThis.CONFIG.featPillReminder = true;
  global.location.pathname = '/user/test-user-123';

  const hh = globalThis.parseHealthAndHunger();
  assert.strictEqual(hh.both100, true, 'Mock H&H indicators should both be parsed as 100%');

  hpText.textContent = '100/130';
  const hhLess = globalThis.parseHealthAndHunger();
  assert.strictEqual(hhLess.both100, false, 'Should be false when health is less than 100%');
  
  hpText.textContent = '130/130';

  // --- 4-Bar Regression Test ---
  const statsSection = new MockElement('div', '_1dnmndyf0');
  hpWrap.remove();
  hungerWrap.remove();
  statsSection.appendChild(hpWrap);
  statsSection.appendChild(hungerWrap);

  const energyWrap = new MockElement('div');
  const energySvg = new MockElement('svg');
  const energyPath = new MockElement('path');
  energyPath.setAttribute('d', 'M11 15H6 lightning icon');
  energySvg.appendChild(energyPath);
  energyWrap.appendChild(energySvg);
  const energyText = new MockElement('span');
  energyText.textContent = '10/40';
  energyWrap.appendChild(energyText);
  statsSection.appendChild(energyWrap);

  const moralWrap = new MockElement('div');
  const moralSvg = new MockElement('svg');
  const moralPath = new MockElement('path');
  moralPath.setAttribute('d', 'M12,2A7,7 shield/moral icon');
  moralSvg.appendChild(moralPath);
  moralWrap.appendChild(moralSvg);
  const moralText = new MockElement('span');
  moralText.textContent = '6/30';
  moralWrap.appendChild(moralText);
  statsSection.appendChild(moralWrap);

  documentBody.appendChild(statsSection);

  const parsed4Bars = globalThis.parseHealthAndHunger();
  assert.strictEqual(parsed4Bars.hpMax, 130, 'Should parse HP max as 130');
  assert.strictEqual(parsed4Bars.hungerMax, 5, 'Should parse Hunger max as 5');
  assert.strictEqual(parsed4Bars.hpCurrent, 130, 'Should parse HP current as 130');
  assert.strictEqual(parsed4Bars.hungerCurrent, 5, 'Should parse Hunger current as 5');
  assert.strictEqual(parsed4Bars.both100, true, 'Mock H&H indicators should be both 100% in 4-bar context');

  statsSection.remove();
  documentBody.appendChild(hpWrap);
  documentBody.appendChild(hungerWrap);

  globalThis.GM_setValue('wia.pillTakenAt', 0);
  globalThis.GM_setValue('wia.pillState', 'none');

  const buffSvg = new MockElement('svg');
  const buffPath = new MockElement('path');
  buffPath.setAttribute('d', 'M4.22,11.29L11.29,4.22 pill buff icon');
  buffSvg.appendChild(buffPath);
  userProfileLink.appendChild(buffSvg);

  globalThis.updatePillState();
  const buffTakenAt = globalThis.GM_getValue('wia.pillTakenAt');
  const buffState = globalThis.GM_getValue('wia.pillState');
  assert.strictEqual(buffState, 'BUFF', 'Pill state should update to BUFF');
  assert.ok(Math.abs(Date.now() - buffTakenAt) < 1000, 'Taken-at timestamp should be pinned to near now');

  buffSvg.remove();
  const debuffSvg = new MockElement('svg');
  const debuffPath = new MockElement('path');
  debuffPath.setAttribute('d', 'M22.11 21.46L2.39 1.73 pill debuff icon');
  debuffSvg.appendChild(debuffPath);
  userProfileLink.appendChild(debuffSvg);

  globalThis.updatePillState();
  const debuffTakenAt = globalThis.GM_getValue('wia.pillTakenAt');
  const debuffState = globalThis.GM_getValue('wia.pillState');
  assert.strictEqual(debuffState, 'DEBUFF', 'Pill state should transition to DEBUFF');
  const expectedPillTaken = Date.now() - (globalThis.CONFIG.pillBuffH * 3600000);
  assert.ok(Math.abs(debuffTakenAt - expectedPillTaken) < 1000, 'Taken-at timestamp should adjust back by buff duration (8 hours)');

  debuffSvg.remove();
  // Call updatePillState() twice, should remain DEBUFF
  globalThis.updatePillState();
  assert.strictEqual(globalThis.GM_getValue('wia.pillState'), 'DEBUFF', 'Pill state should remain DEBUFF after 1 none detection');
  globalThis.updatePillState();
  assert.strictEqual(globalThis.GM_getValue('wia.pillState'), 'DEBUFF', 'Pill state should remain DEBUFF after 2 none detections');

  // Third consecutive detection triggers transition
  globalThis.updatePillState();
  const noneTakenAt = globalThis.GM_getValue('wia.pillTakenAt');
  const noneState = globalThis.GM_getValue('wia.pillState');
  assert.strictEqual(noneState, 'none', 'Pill state should transition to none after 3 consecutive none detections');
  const expectedReadyTaken = Date.now() - ((globalThis.CONFIG.pillBuffH + globalThis.CONFIG.pillDebuffH) * 3600000);
  assert.ok(Math.abs(noneTakenAt - expectedReadyTaken) < 1000, 'Taken-at timestamp should adjust back by buff+debuff duration (23.5 hours)');

  globalThis.CONFIG.pillPrefWindowFrom = '';
  globalThis.injectPillBadge();
  const pillBadge = document.querySelector('#wia-pill-badge');
  assert.ok(pillBadge, 'Pill badge should be injected in the layout menu');
  assert.ok(pillBadge.classList.contains('wia-badge-ready'), 'Pill badge should indicate READY phase');

  hpText.textContent = '100/130';
  globalThis.injectPillBadge();
  assert.ok(pillBadge.classList.contains('wia-badge-recover'), 'Pill badge should be in wia-badge-recover class when health is below 100%');
  
  const labelEl = pillBadge.querySelector('.wia-pill-phase-lbl');
  assert.strictEqual(labelEl.textContent, 'Recover-Phase', 'Gated label should display Recover-Phase');

  const timerEl = pillBadge.querySelector('.wia-pill-timer');
  assert.ok(timerEl, 'Gated badge should display H&H recovery remaining timer');
  assert.strictEqual(timerEl.textContent, 'in 2h 53m', 'Estimated remaining time to 100% H&H should be in 2h 53m');

  const hoverDetails = pillBadge.querySelector('.wia-pill-hover-details').textContent;
  assert.ok(hoverDetails.includes('H&H full in ~2h 53m (77%)'), 'Hover details should contain H&H gate status');
  assert.ok(hoverDetails.includes('✓ Debuff ends'), 'Hover details should contain debuff gate status');

  // Test minutes-only format countdown parsing (e.g. "48m" instead of "53m38s")
  tickTimeText.textContent = '48m';
  globalThis.injectPillBadge();
  const updatedTimerEl = pillBadge.querySelector('.wia-pill-timer');
  assert.strictEqual(updatedTimerEl.textContent, 'in 2h 48m', 'Should parse remaining time correctly even if the countdown timer only contains minutes (e.g. 48m)');

  hpText.textContent = '130/130';
  globalThis.injectPillBadge();



  const scrapCard = new MockElement('div');
  const cocainCard = new MockElement('div');
  const cocainImg = new MockElement('img');
  cocainImg.setAttribute('alt', 'cocain');
  cocainCard.appendChild(cocainImg);
  documentBody.appendChild(scrapCard);
  documentBody.appendChild(cocainCard);

  globalThis.GM_setValue('wia.pillTakenAt', Date.now());
  globalThis.GM_setValue('wia.pillState', 'BUFF');
  globalThis.highlightCocaineItems();
  assert.strictEqual(cocainCard.classList.contains('wia-cocain-highlight'), false, 'Cocaine card should not have highlight in BUFF phase');

  globalThis.GM_setValue('wia.pillTakenAt', Date.now() - 25 * 3600000);
  globalThis.GM_setValue('wia.pillState', 'none');
  
  globalThis.highlightCocaineItems();
  assert.strictEqual(cocainCard.classList.contains('wia-cocain-highlight'), false, 'Cocaine card should not have READY highlight outline anymore');
  assert.strictEqual(cocainCard.getAttribute('data-label'), '', 'Cocaine card should not have data-label anymore');

  hpText.textContent = '100/130';
  globalThis.highlightCocaineItems();
  assert.strictEqual(cocainCard.classList.contains('wia-cocain-gated-highlight'), false, 'Cocaine card should not have warning H&H highlight anymore');
  assert.strictEqual(cocainCard.getAttribute('data-label'), '', 'Cocaine card should not have data-label for H&H anymore');

  // --- Test BUFF/DEBUFF phase timer strings ---
  console.log('--- Testing Buff/Debuff Phase Timer Strings ---');
  const oldNow = Date.now;
  const mockTime = new Date(2026, 5, 11, 12, 0, 0, 0).getTime();
  Date.now = () => mockTime;

  // 1. With preferred window set
  globalThis.CONFIG.pillPrefWindowFrom = '15:05';
  globalThis.GM_setValue('wia.pillTakenAt', mockTime - 1 * 3600000); // 1 hour ago (in BUFF)
  globalThis.GM_setValue('wia.pillState', 'BUFF');
  globalThis.injectPillBadge();
  const buffBadge = document.querySelector('#wia-pill-badge');
  const buffTimer = buffBadge.querySelector('.wia-pill-timer');
  assert.ok(buffTimer, 'Timer element should be present during BUFF');
  assert.strictEqual(buffTimer.textContent, 'until 3h 5m', 'Should show preferred window countdown');

  // 2. Without preferred window, H&H not full
  globalThis.CONFIG.pillPrefWindowFrom = '';
  hpText.textContent = '100/130'; // H&H not full
  tickTimeText.textContent = '53m';
  globalThis.injectPillBadge();
  const buffTimerHnHNotFull = buffBadge.querySelector('.wia-pill-timer');
  assert.strictEqual(buffTimerHnHNotFull.textContent, 'H&H full in 2h 53m', 'Should show H&H full ETA');

  // 3. Without preferred window, H&H is full
  hpText.textContent = '130/130'; // H&H is full
  hungerText.textContent = '5/5';
  tickTimeText.textContent = '10m';
  globalThis.injectPillBadge();
  const buffTimerHnHFull = buffBadge.querySelector('.wia-pill-timer');
  assert.strictEqual(buffTimerHnHFull.textContent, 'Tick in 10m 0s', 'Should show next H&H tick countdown');

  // Cleanup for other tests
  Date.now = oldNow;
  globalThis.CONFIG.pillPrefWindowFrom = '';
  globalThis.GM_setValue('wia.pillState', 'none');

  // --- H&H Budget Regression Test ---
  console.log('--- Testing H&H Budget Indicator ---');
  
  const originalNow = Date.now;
  const mockNowDate = new Date(2026, 5, 11, 12, 0, 0, 0); // June 11, 2026 12:00 local time
  Date.now = () => mockNowDate.getTime();

  globalThis.CONFIG.pillPrefWindowFrom = '15:05'; 
  globalThis.CONFIG.pillPrefWindowTo = '';

  const now = Date.now();
  globalThis.GM_setValue('wia.pillTakenAt', now - 20 * 3600000);
  globalThis.GM_setValue('wia.pillState', 'DEBUFF');

  hpText.textContent = '130/130';
  hungerText.textContent = '5/5';

  globalThis.renderHnHBudget();

  const hpBudgetVal = hpTextContainer.querySelector('.wia-hnh-budget-label');
  assert.ok(hpBudgetVal, 'HP budget label should be appended');
  assert.strictEqual(hpBudgetVal.textContent, '100% · ⬇ 39 free', 'HP spendable should be parsed as 100% · ⬇ 39 free');
  
  const hpFree = hpTrack.querySelector('.wia-hnh-free-overlay');
  assert.ok(hpFree, 'HP free overlay should be created');
  assert.strictEqual(hpFree.style.left, '70%', 'HP free left should start at 70%');
  assert.strictEqual(hpFree.style.width, '30%', 'HP free width should be 30%');

  const hpMarker = hpTrack.querySelector('.wia-hnh-floor-marker');
  assert.ok(hpMarker, 'HP floor marker should be created');
  assert.strictEqual(hpMarker.style.left, '70%', 'HP floor marker left should be 70%');

  const hungerBudgetVal = hungerTextContainer.querySelector('.wia-hnh-budget-label');
  assert.ok(hungerBudgetVal, 'Hunger budget label should be appended');
  assert.strictEqual(hungerBudgetVal.textContent, '100% · ⬇ 1.5 free', 'Hunger spendable should be parsed as 100% · ⬇ 1.5 free');

  const hungerFree = hungerTrack.querySelector('.wia-hnh-free-overlay');
  assert.ok(hungerFree, 'Hunger free overlay should be created');
  assert.strictEqual(hungerFree.style.left, '70%', 'Hunger free left should start at 70%');
  assert.strictEqual(hungerFree.style.width, '30%', 'Hunger free width should be 30%');

  hpText.textContent = '80/130';
  globalThis.renderHnHBudget();
  assert.strictEqual(hpBudgetVal.textContent, '62% · ✕ 0 free', 'HP zero-budget should show stop glyph with percentage, not a down arrow');
  const hpMarkerNew = hpTrack.querySelector('.wia-hnh-floor-marker');
  assert.ok(hpMarkerNew, 'HP floor marker should be found after re-render');
  assert.ok(hpMarkerNew.classList.contains('wia-hnh-alert'), 'HP marker should have alert style when current is below floor');

  // Test narrow layout (< 400px) which should hide the spendable suffix
  layoutUserMenu.offsetWidth = 350;
  globalThis.renderHnHBudget();
  assert.strictEqual(hpBudgetVal.textContent, '62%', 'HP label should hide spendable suffix when under 400px');
  assert.strictEqual(hungerBudgetVal.textContent, '100%', 'Hunger label should hide spendable suffix when under 400px');

  // Restore wide state for subsequent tests
  layoutUserMenu.offsetWidth = 600;
  globalThis.renderHnHBudget();

  // Test no window configured -> should remove overlays / bail (Issue 1)
  globalThis.CONFIG.pillPrefWindowFrom = '';
  globalThis.renderHnHBudget();
  const hpBudgetValEmpty = hpTextContainer.querySelector('.wia-hnh-budget-label');
  assert.strictEqual(hpBudgetValEmpty, null, 'HP budget label should be removed when no window is configured');

  // Test BUFF phase behavior
  globalThis.CONFIG.pillPrefWindowFrom = '15:05';
  globalThis.GM_setValue('wia.pillTakenAt', now - 0.5 * 3600000); // 30 mins ago, in BUFF phase
  hpText.textContent = '117/130'; // 90%
  globalThis.renderHnHBudget();
  const hpBudgetValBuff = hpTextContainer.querySelector('.wia-hnh-budget-label');
  assert.ok(hpBudgetValBuff, 'HP budget label should be present during BUFF');
  assert.strictEqual(hpBudgetValBuff.textContent, '90%', 'HP during BUFF should only show percent');
  assert.strictEqual(hpBudgetValBuff.style.color, '', 'HP label during BUFF should have no inline color');
  const hpFreeBuff = hpTrack.querySelector('.wia-hnh-free-overlay');
  assert.strictEqual(hpFreeBuff, null, 'HP free overlay should not be created during BUFF');
  const hpMarkerBuff = hpTrack.querySelector('.wia-hnh-floor-marker');
  assert.strictEqual(hpMarkerBuff, null, 'HP floor marker should not be created during BUFF');

  // Restore state for subsequent cleanup testing
  globalThis.GM_setValue('wia.pillTakenAt', now - 20 * 3600000); // debuff phase again
  globalThis.CONFIG.pillPrefWindowFrom = '15:05';
  globalThis.renderHnHBudget();

  // --- Test Personal Notifications ---
  console.log('--- Testing Personal Notifications (H&H, Pill Window, Debuff) ---');
  let personalRequests = [];
  global.GM_xmlhttpRequest = (opts) => {
    personalRequests.push(opts);
    if (opts.onload) {
      opts.onload({ status: 200, statusText: 'OK', responseText: '{}' });
    }
  };

  // Configure notifications enabled
  globalThis.CONFIG.featPillNotifHnH = true;
  globalThis.CONFIG.featPillNotifWindow = true;
  globalThis.CONFIG.featPillNotifDebuff = true;
  globalThis.CONFIG.pillPrefWindowFrom = '15:00';
  globalThis.CONFIG.pillPrefWindowTo = '16:00';

  // 1. Cold start seeding: H&H full on load
  globalThis.GM_setValue('wia.lastNotifiedHnH', false);
  globalThis.GM_setValue('wia.lastNotifiedPillWindowDate', '');
  globalThis.GM_setValue('wia.lastNotifiedDebuffEnd', 0);
  globalThis.GM_setValue('wia.pillTakenAt', now - 25 * 3600000); // debuff expired

  hpText.textContent = '130/130';
  hungerText.textContent = '4/4';

  // Mock Date.now() to be inside preferred window (e.g. 15:30)
  const windowTime = new Date(now);
  windowTime.setHours(15, 30, 0, 0);
  Date.now = () => windowTime.getTime();

  // Reset cold start tracking flag by calling teardown
  globalThis.teardownPillReminder();
  globalThis.CONFIG.featPillReminder = true;
  // Trigger first tick (this will trigger cold start seeding)
  globalThis.checkPersonalNotifications();

  // Assertions for cold start seeding
  assert.strictEqual(personalRequests.length, 0, 'No notifications should be sent on cold start');
  assert.strictEqual(globalThis.GM_getValue('wia.lastNotifiedHnH'), true, 'lastNotifiedHnH should be seeded to true');
  assert.strictEqual(globalThis.GM_getValue('wia.lastNotifiedPillWindowDate'), String(globalThis.getCurrentWindowStart(windowTime.getTime())), 'lastNotifiedPillWindowDate should be seeded');
  assert.strictEqual(globalThis.GM_getValue('wia.lastNotifiedDebuffEnd'), now - 25 * 3600000, 'lastNotifiedDebuffEnd should be seeded');

  // 2. Triggering notification: H&H drops then becomes full again
  hpText.textContent = '120/130'; // drops
  globalThis.checkPersonalNotifications();
  assert.strictEqual(globalThis.GM_getValue('wia.lastNotifiedHnH'), false, 'lastNotifiedHnH should reset to false when not full');

  hpText.textContent = '130/130'; // full again
  globalThis.checkPersonalNotifications();
  assert.strictEqual(globalThis.GM_getValue('wia.lastNotifiedHnH'), true, 'lastNotifiedHnH should become true');
  assert.strictEqual(personalRequests.length, 1, 'H&H full notification should be sent');
  assert.ok(personalRequests[0].headers.Title.includes('Leben & Hunger voll') || personalRequests[0].headers.Title.includes('Health & Hunger Full'), 'H&H notification title is set');

  // 3. Triggering notification: Preferred window transitions
  // Move time outside window
  const outsideTime = new Date(now);
  outsideTime.setHours(14, 0, 0, 0);
  Date.now = () => outsideTime.getTime();
  globalThis.checkPersonalNotifications();

  // Move time back into window, but for a new day
  personalRequests = [];
  const nextDayWindow = new Date(windowTime.getTime() + 24 * 3600000);
  Date.now = () => nextDayWindow.getTime();
  globalThis.checkPersonalNotifications();
  assert.strictEqual(personalRequests.length, 1, 'Preferred window notification should be sent on a new day');
  assert.ok(personalRequests[0].headers.Title.includes('Bevorzugtes Pillenfenster') || personalRequests[0].headers.Title.includes('Preferred Pill Window'), 'Pill window notification title is set');

  // 4. Triggering notification: Debuff expired
  // Take a pill (this sets debuff end tracking, resets notified debuff)
  globalThis.CONFIG.featPillNotifWindow = false;
  personalRequests = [];
  const takePillTime = Date.now();
  globalThis.GM_setValue('wia.pillTakenAt', takePillTime);
  globalThis.GM_setValue('wia.pillState', 'BUFF');
  globalThis.checkPersonalNotifications();

  // Advance time past debuff duration
  const debuffEndTime = takePillTime + 24 * 3600000; // > 8 + 15.5 = 23.5 hours
  Date.now = () => debuffEndTime;
  globalThis.checkPersonalNotifications();
  // --- Test Notification Hub (Mirroring, Hash, Format) ---
  console.log('--- Testing Notification Hub (Mirroring, Hash, Format) ---');
  
  // 1. Verify simpleHash
  const hash1 = globalThis.simpleHash('hello world');
  const hash2 = globalThis.simpleHash('hello world');
  const hash3 = globalThis.simpleHash('different text');
  assert.strictEqual(hash1, hash2, 'Hash should be deterministic');
  assert.notStrictEqual(hash1, hash3, 'Hash should be different for different text');
  
  // We wrap async operations in a IIFE to allow the use of await in this CommonJS environment
  (async () => {
    // 2. Setup mock environment for pollBountyTopic
    globalThis.CONFIG.featBountyNotify = true;
    globalThis.CONFIG.featBountyNotif = true;
    globalThis.CONFIG.personalTopic = 'my-personal-topic';
    globalThis.CONFIG.bountyScope = 'all';
    globalThis.GM_setValue('wia.bountyAutoTopic', 'wia-bounty-all');
    globalThis.GM_setValue('wia.bountyMirrorProcessedHashes', []);
    globalThis.GM_setValue('wia.bountyMirrorLastPollAt', 0);
    globalThis.GM_setValue('wia.bountyMirrorPollLock', 0);
    
    let mirrorRequests = [];
    global.GM_xmlhttpRequest = (opts) => {
      mirrorRequests.push(opts);
      if (opts.onload) {
        if (opts.method === 'GET') {
          opts.onload({
            status: 200,
            statusText: 'OK',
            responseText: JSON.stringify({
              event: 'message',
              title: 'Ally-Bounty: Germany vs USA',
              message: 'Fight for Germany (Attacker) · Pool 100.00 · 0.10/1k',
              tags: ['crossed_swords', 'bkey_test_123_456']
            }) + '\n'
          });
        } else {
          opts.onload({ status: 200, statusText: 'OK', responseText: '{}' });
        }
      }
    };
    
    await globalThis.pollBountyTopic();
    
    const postReqs = mirrorRequests.filter(r => r.method === 'POST');
    assert.strictEqual(postReqs.length, 1, 'Bounty notification should be mirrored');
    assert.ok(postReqs[0].url.includes('my-personal-topic'), 'Should mirror to personal topic');
    assert.strictEqual(postReqs[0].data, 'Fight for Germany (Attacker) · Pool 100.00 · 0.10/1k', 'Body should be preserved');
    assert.strictEqual(postReqs[0].headers.Title, 'Ally-Bounty: Germany vs USA', 'Title should be clean ASCII');
    
    // 3. Test duplicate prevention
    mirrorRequests = [];
    await globalThis.pollBountyTopic();
    const dupPostReqs = mirrorRequests.filter(r => r.method === 'POST');
    assert.strictEqual(dupPostReqs.length, 0, 'Duplicate message should not be mirrored');
    
    // 4. Test format validation rejection
    mirrorRequests = [];
    global.GM_xmlhttpRequest = (opts) => {
      mirrorRequests.push(opts);
      if (opts.onload && opts.method === 'GET') {
        opts.onload({
          status: 200,
          statusText: 'OK',
          responseText: JSON.stringify({
            event: 'message',
            title: 'Malicious title',
            message: 'Fight for Germany (Attacker) · Pool 100.00 · 0.10/1k',
            tags: ['crossed_swords', 'bkey_test_123_456']
          }) + '\n'
        });
      }
    };
    globalThis.GM_setValue('wia.bountyMirrorLastPollAt', 0);
    globalThis.GM_setValue('wia.bountyMirrorPollLock', 0);
    await globalThis.pollBountyTopic();
    assert.strictEqual(mirrorRequests.filter(r => r.method === 'POST').length, 0, 'Invalid title format should be rejected');
  })().catch(err => {
    console.error('Notification Hub tests failed:', err);
    process.exit(1);
  });

  // Cleanup mocked functions
  delete global.GM_xmlhttpRequest;

  globalThis.removeHnHBudget();
  Date.now = originalNow;
  console.log('H&H Budget Indicator tests passed successfully.');

  layoutUserMenu.remove();
  hpWrap.remove();
  hungerWrap.remove();
  scrapCard.remove();
  cocainCard.remove();
  globalThis.teardownPillReminder();

  console.log('Pill Reminder module tests passed successfully.');

  // --- Crafting Advisor Unit Tests ---
  console.log('--- Testing Crafting Advisor ---');
  
  // 1. Test getTierItemCodes
  const t1Codes = globalThis.getTierItemCodes(1);
  assert.deepStrictEqual(t1Codes, ['knife', 'helmet1', 'chest1', 'boots1', 'gloves1', 'pants1'], 'T1 item codes should map correctly');
  const t4Codes = globalThis.getTierItemCodes(4);
  assert.deepStrictEqual(t4Codes, ['sniper', 'helmet4', 'chest4', 'boots4', 'gloves4', 'pants4'], 'T4 item codes should map correctly');

  // 2. Test formatItemCode
  globalThis.CONFIG.locale = 'de';
  assert.strictEqual(globalThis.formatItemCode('knife'), 'Messer', 'German weapon formatting should work');
  assert.strictEqual(globalThis.formatItemCode('helmet1'), 'T1 Helm', 'German armor formatting should work');
  
  globalThis.CONFIG.locale = 'en';
  assert.strictEqual(globalThis.formatItemCode('knife'), 'Knife', 'English weapon formatting should work');
  assert.strictEqual(globalThis.formatItemCode('helmet1'), 'T1 Helmet', 'English armor formatting should work');

  // 3. Test parseCraftingState with mocked modal DOM
  const modalDiv = new MockElement('div');
  modalDiv.id = 'headlessui-dialog-panel-_r_45g9_';

  // Mock Common Tier card selected
  const commonCard = new MockElement('div', 'ahvacn2');
  const commonSpan = new MockElement('span');
  commonSpan.textContent = 'Common';
  commonCard.appendChild(commonSpan);
  const highlightOverlay = new MockElement('div', '_1dnmndy85w');
  commonCard.appendChild(highlightOverlay);
  modalDiv.appendChild(commonCard);

  // Mock specific item selected (Helmet)
  const itemGrid = new MockElement('div', '_1dnmndyjlu');
  const helmetCell = new MockElement('div', 'ahvacn2');
  const helmetImg = new MockElement('img');
  helmetImg.setAttribute('alt', 'helmet1');
  helmetCell.appendChild(helmetImg);
  const itemHighlightOverlay = new MockElement('div', '_1dnmndy85w');
  helmetCell.appendChild(itemHighlightOverlay);
  itemGrid.appendChild(helmetCell);
  modalDiv.appendChild(itemGrid);

  // Mock Scraps & Steel quantities
  const scrapsWrap = new MockElement('span');
  const scrapsImg = new MockElement('img');
  scrapsImg.setAttribute('alt', 'scraps');
  scrapsImg.setAttribute('src', '/images/items/scraps.png');
  scrapsWrap.appendChild(scrapsImg);
  const scrapsCurrentSpan = new MockElement('span');
  scrapsCurrentSpan.textContent = '100';
  scrapsWrap.appendChild(scrapsCurrentSpan);
  const scrapsInnerSpan = new MockElement('span');
  scrapsInnerSpan.textContent = '/6';
  scrapsWrap.appendChild(scrapsInnerSpan);
  modalDiv.appendChild(scrapsWrap);

  const steelWrap = new MockElement('span');
  const steelImg = new MockElement('img');
  steelImg.setAttribute('alt', 'steel');
  steelImg.setAttribute('src', '/images/items/steel.png');
  steelWrap.appendChild(steelImg);
  const steelCurrentSpan = new MockElement('span');
  steelCurrentSpan.textContent = '10';
  steelWrap.appendChild(steelCurrentSpan);
  const steelInnerSpan = new MockElement('span');
  steelInnerSpan.textContent = '/1';
  steelWrap.appendChild(steelInnerSpan);
  modalDiv.appendChild(steelWrap);

  // Inject into document body
  documentBody.appendChild(modalDiv);

  const parsedCraft = globalThis.parseCraftingState(modalDiv);
  assert.strictEqual(parsedCraft.tier, 1, 'Parsed tier should be 1 (Common)');
  assert.strictEqual(parsedCraft.selectedItem, 'helmet1', 'Parsed selected item should be helmet1');
  assert.strictEqual(parsedCraft.scrapsRequired, 6, 'Parsed scraps required should be 6');
  assert.strictEqual(parsedCraft.steelRequired, 1, 'Parsed steel required should be 1');

  // Test Random mode parsing
  itemHighlightOverlay.remove();
  const randomCell = new MockElement('div', 'ahvacn2');
  const qMarkSpan = new MockElement('span');
  qMarkSpan.textContent = '?';
  randomCell.appendChild(qMarkSpan);
  const randomHighlight = new MockElement('div', '_1dnmndy85w');
  randomCell.appendChild(randomHighlight);
  itemGrid.appendChild(randomCell);

  const parsedRandom = globalThis.parseCraftingState(modalDiv);
  assert.strictEqual(parsedRandom.selectedItem, 'random', 'Parsed selected item should be random when "?" is selected');

  // Test T6 formatting with 'k' suffix (e.g. '/ 1.46k' and '/ 32')
  scrapsInnerSpan.textContent = '/ 1.46k';
  steelInnerSpan.textContent = '/ 32';
  commonSpan.textContent = 'Mythic'; // Mythic = T6
  
  const parsedT6 = globalThis.parseCraftingState(modalDiv);
  assert.strictEqual(parsedT6.tier, 6, 'Parsed tier should be 6 (Mythic)');
  assert.strictEqual(parsedT6.scrapsRequired, 1460, 'Parsed scraps required should be 1460 (parsed from 1.46k)');
  assert.strictEqual(parsedT6.steelRequired, 32, 'Parsed steel required should be 32');

  modalDiv.remove();
  console.log('Crafting Advisor tests passed successfully.');

  console.log('--- Testing Resource Market Intraday Graph module ---');
  
  // 1. formatHoverTime tests
  const testTime = new Date(2026, 5, 22, 20, 30).getTime(); // June 22, 2026 20:30
  
  // 24h range test
  const hover24h = globalThis.formatHoverTime(testTime, '24h');
  assert.strictEqual(hover24h, '20:30', 'Hover time for 24h should be formatted as HH:MM');
  
  // 3d range test DE
  globalThis.CONFIG.locale = 'de';
  const hover3dDe = globalThis.formatHoverTime(testTime, '3d');
  assert.strictEqual(hover3dDe, '22.06. 20:30', 'Hover time for 3d in DE should be DD.MM. HH:MM');
  
  // 3d range test EN
  globalThis.CONFIG.locale = 'en';
  const hover3dEn = globalThis.formatHoverTime(testTime, '3d');
  assert.strictEqual(hover3dEn, '06-22 20:30', 'Hover time for 3d in EN should be MM-DD HH:MM');
  
  // 2. getModalResourceCode tests
  const mockModal = new MockElement('div');
  const mockImg = new MockElement('img');
  mockImg.setAttribute('src', '/images/items/steel.png?v=3');
  mockImg.setAttribute('alt', 'steel');
  mockModal.appendChild(mockImg);
  
  const parsedCode = globalThis.getModalResourceCode(mockModal);
  assert.strictEqual(parsedCode, 'steel', 'Should parse code from image src/alt as steel');
  
  // Try with excluded alt
  mockImg.setAttribute('src', '/images/items/gold.png');
  mockImg.setAttribute('alt', 'gold');
  const parsedExcluded = globalThis.getModalResourceCode(mockModal);
  assert.strictEqual(parsedExcluded, null, 'Should return null for excluded alt code');
  
  // Try with src-only (no alt)
  mockImg.removeAttribute('alt');
  mockImg.setAttribute('src', '/images/items/limestone.png');
  const parsedSrcOnly = globalThis.getModalResourceCode(mockModal);
  assert.strictEqual(parsedSrcOnly, 'limestone', 'Should parse code from src even if alt is missing');
  
  // 3. getNativeSvgFingerprint tests
  const mockSvg = new MockElement('svg');
  const nativeG = new MockElement('g');
  const nativePath = new MockElement('path');
  nativePath.setAttribute('stroke', '#A19638');
  nativePath.setAttribute('d', 'M0,0 L10,10');
  nativeG.appendChild(nativePath);
  mockSvg.appendChild(nativeG);
  
  const fingerprintBefore = globalThis.getNativeSvgFingerprint(mockSvg);
  assert.strictEqual(fingerprintBefore, 'M0,0 L10,10', 'Fingerprint should match d attribute of native gold path');
  
  // Injected elements
  const injectedPath = new MockElement('path');
  injectedPath.setAttribute('class', 'wia-mkt-line');
  injectedPath.setAttribute('stroke', '#4ec9d4');
  nativeG.appendChild(injectedPath);
  
  const fingerprintAfter = globalThis.getNativeSvgFingerprint(mockSvg);
  assert.strictEqual(fingerprintAfter, 'M0,0 L10,10', 'Fingerprint should be unaffected by injected wia-mkt- elements');

  console.log('Resource Market Intraday Graph tests passed successfully.');

  // --- Test: scanInventory renders advice without awaiting network ---
  console.log('--- Testing scanInventory Instant/Provisional Renders ---');
  
  // Clear body
  documentBody.children = [];
  
  // Setup mock inventory page with 1 item card
  const invCell = new MockElement('div');
  invCell.setAttribute('aria-haspopup', 'dialog');
  invCell.setAttribute('id', 'item-card-cell-1');
  
  const invCard = new MockElement('div');
  invCard.setAttribute('id', 'wia-item-card-1');
  invCell.appendChild(invCard);
  
  const invImg = new MockElement('img');
  invImg.setAttribute('src', '/images/items/gloves1.png');
  invImg.setAttribute('alt', 'gloves1');
  invCard.appendChild(invImg);
  
  // Add some stats elements so parseStats succeeds
  const statsDiv = new MockElement('div');
  const statIcon = new MockElement('div', 'a6izou0');
  const statPath = new MockElement('path');
  statPath.setAttribute('d', 'M12,1L3,5V11C3,16.55'); // armor fingerprint
  statIcon.appendChild(statPath);
  statsDiv.appendChild(statIcon);
  const statText = new MockElement('span');
  statText.textContent = '10';
  statsDiv.appendChild(statText);
  invCard.appendChild(statsDiv);
  
  documentBody.appendChild(invCell);
  
  // Mock route
  global.location.pathname = '/user/test-user-123/inventory';
  
  // Back up original fetchPrices and mock it to never resolve (simulate slow network)
  const originalFetchPrices = globalThis.fetchPrices;
  let fetchPricesCalled = false;
  globalThis.fetchPrices = function() {
    fetchPricesCalled = true;
    return new Promise(() => {}); // never resolves
  };
  
  // Ensure we start with empty price cache
  globalThis.GM_setValue('wia.priceCache', null);
  globalThis.GM_setValue('wia.offersCache', {});
  globalThis.GM_setValue('wia.transactionsCache', {});
  globalThis.GM_setValue('wia.persistedAdvice', {});
  
  // Run scanInventory (which is async, but we do NOT await it so we test synchronous rendering)
  globalThis.scanInventory(true);
  
  // Assertions
  assert.strictEqual(fetchPricesCalled, true, 'fetchPrices should have been triggered in the background');
  
  const badgeEl = invCell.querySelector('.wia-badge');
  assert.ok(badgeEl, 'Badge should be rendered immediately/synchronously');
  assert.strictEqual(badgeEl.classList.contains('wia-provisional'), true, 'Badge should be marked provisional class');
  assert.strictEqual(invCard.dataset.wiaProvisional, '1', 'Card should have data-wia-provisional="1"');
  
  // Restore fetchPrices
  globalThis.fetchPrices = originalFetchPrices;
  console.log('scanInventory provisional rendering tests passed successfully.');

  console.log('--- Testing Daily P&L Tracker: Phase 1 ---');
  
  // Clean storage mock
  globalThis.clearCache();
  globalThis.CONFIG.featPnlTracker = true;
  globalThis.GM_setValue('wia.pnl.ledger', null);
  globalThis.GM_setValue('wia.pnl.yesterday', null);
  globalThis.GM_setValue('wia.pnl.snapshots', null);
  
  // 1. Day key calculations
  const timeA = new Date(2026, 5, 24, 1, 0, 0).getTime();
  const dayKeyA = globalThis.getPnlDayKey(timeA);
  assert.strictEqual(dayKeyA, '2026-06-23', 'PnL day key at 01:00 AM should belong to previous day');
  
  const timeB = new Date(2026, 5, 24, 3, 0, 0).getTime();
  const dayKeyB = globalThis.getPnlDayKey(timeB);
  assert.strictEqual(dayKeyB, '2026-06-24', 'PnL day key at 03:00 AM should belong to current day');
  
  // 2. Gold Balance parsing test
  const testMenu = new MockElement('div');
  testMenu.setAttribute('id', 'layoutUserMenu');
  const goldContainer = new MockElement('div');
  goldContainer.setAttribute('id', 'money');
  const goldIcon = new MockElement('img');
  goldIcon.setAttribute('src', '/images/items/gold.png');
  goldIcon.setAttribute('alt', 'gold');
  goldContainer.appendChild(goldIcon);
  goldContainer.appendChild(global.document.createTextNode(' 108.517 '));
  testMenu.appendChild(goldContainer);
  
  // Temporarily replace documentBody children or querySelector to point to our test menu
  const oldBodyQuerySelector = global.document.querySelector;
  const oldBodyGetElementById = global.document.getElementById;
  global.document.getElementById = (id) => id === 'layoutUserMenu' ? testMenu : null;
  global.document.querySelector = (sel) => {
    if (sel === '#layoutUserMenu') return testMenu;
    return testMenu.querySelector(sel);
  };
  
  const goldParsed = globalThis.getGoldBalance();
  assert.strictEqual(goldParsed, 108.517, 'Parsed gold balance should be 108.517');
  
  // 3. Reset and ledger initialization
  const initialLedger = globalThis.checkPnlDayReset();
  assert.ok(initialLedger, 'Ledger should be initialized');
  assert.strictEqual(initialLedger.dayKey, globalThis.getPnlDayKey(), 'Ledger dayKey should match current day key');
  
  const snap = globalThis.GM_getValue('wia.pnl.snapshots');
  assert.ok(snap, 'Snapshots should be saved');
  assert.strictEqual(snap.gold_start, 108.517, 'Snapshot gold_start should be captured');
  
  // Test UI injection
  globalThis.updatePnlUi();
  const trackerBadge = testMenu.querySelector('#wia-pnl-tracker');
  assert.ok(trackerBadge, 'P&L tracker badge should be injected');
  
  // If we change gold balance, UI update should show delta
  goldContainer.children = [];
  goldContainer.appendChild(goldIcon);
  goldContainer.appendChild(global.document.createTextNode(' 110.117 ')); // +1.600 gold
  
  console.log('--- Testing Daily P&L Tracker: Phase 2 ---');
  
  // Clean mock storage and initialize
  globalThis.clearCache();
  globalThis.writeCache('wia.priceCache', {
    fetchedAt: Date.now(),
    data: {
      case1: 15.000
    }
  });
  globalThis.CONFIG.featPnlTracker = true;
  globalThis.GM_setValue('wia.pnl.ledger', null);
  globalThis.GM_setValue('wia.pnl.yesterday', null);
  globalThis.GM_setValue('wia.pnl.snapshots', null);
  globalThis.GM_setValue('wia.pnl.costBasis', null);
  
  // Let's mock todayResetTime to return a fixed time: 2026-06-24 02:00:00 (local reset)
  const fixedResetTime = new Date(2026, 5, 24, 2, 0, 0).getTime();
  const oldTodayResetTime = globalThis.todayResetTime;
  globalThis.todayResetTime = () => fixedResetTime;
  
  // Let's create mock transactions
  const mockUserId = 'my-user-id';
  
  const mockTxs = [
    // 1. Purchase before today's reset -> should update cost basis, but NOT ledger today
    {
      id: 'tx-old-buy',
      transactionType: 'trading',
      money: '50.000',
      quantity: 5,
      sellerId: 'other-user-id',
      buyerId: mockUserId,
      itemCode: 'food_bread',
      createdAt: new Date(2026, 5, 24, 1, 0, 0).toISOString() // 1:00 AM
    },
    // 2. Purchase today -> should update cost basis, and capitalized (NOT expensed)
    {
      id: 'tx-today-buy',
      transactionType: 'trading',
      money: '120.000',
      quantity: 10,
      sellerId: 'other-user-id',
      buyerId: mockUserId,
      itemCode: 'food_bread',
      createdAt: new Date(2026, 5, 24, 3, 0, 0).toISOString() // 3:00 AM
    },
    // 3. Sale today -> should add to Sales income today
    {
      id: 'tx-today-sell',
      transactionType: 'trading',
      money: '200.000',
      quantity: 4,
      sellerId: mockUserId,
      buyerId: 'other-user-id',
      itemCode: 'steel',
      createdAt: new Date(2026, 5, 24, 4, 0, 0).toISOString() // 4:00 AM
    },
    // 4. Earned wage today -> should add to Wages income today
    {
      id: 'tx-today-wage-earn',
      transactionType: 'wage',
      money: '15.500',
      quantity: 1,
      sellerId: mockUserId,
      buyerId: 'company-user-id',
      createdAt: new Date(2026, 5, 24, 5, 0, 0).toISOString()
    },
    // 5. Paid employee wage today -> should add to Employee Wages expense today
    {
      id: 'tx-today-wage-pay',
      transactionType: 'wage',
      money: '8.000',
      quantity: 1,
      sellerId: 'employee-user-id',
      buyerId: mockUserId,
      createdAt: new Date(2026, 5, 24, 6, 0, 0).toISOString()
    },
    // 6. Spende (donation) today -> should add to Other expense today
    {
      id: 'tx-today-donation',
      transactionType: 'donation',
      money: '5.000',
      sellerId: 'mu-id',
      buyerId: mockUserId,
      createdAt: new Date(2026, 5, 24, 7, 0, 0).toISOString()
    },
    // 7. Object-based Mongo ID wage transaction (should be correctly deduped)
    {
      _id: { $oid: '64a5cdef1234567890abcdef' },
      transactionType: 'wage',
      money: '1.900',
      quantity: 1,
      sellerId: mockUserId,
      buyerId: 'company-user-id',
      createdAt: new Date(2026, 5, 24, 9, 0, 0).toISOString()
    },
    // 8. openCase transaction (should resolve caseVal from priceCache)
    {
      id: 'tx-today-opencase',
      transactionType: 'openCase',
      itemCode: 'case1',
      quantity: 1,
      buyerId: mockUserId,
      createdAt: new Date(2026, 5, 24, 10, 0, 0).toISOString()
    },
    // 9. Wage earned yesterday -> should NOT add to Wages income today
    {
      id: 'tx-yesterday-wage',
      transactionType: 'wage',
      money: '50.000',
      quantity: 1,
      sellerId: mockUserId,
      buyerId: 'company-user-id',
      createdAt: new Date(2026, 5, 24, 1, 30, 0).toISOString() // 1:30 AM (before 2:00 AM reset)
    },
    // 10. Donation yesterday -> should NOT add to Other expense today
    {
      id: 'tx-yesterday-donation',
      transactionType: 'donation',
      money: '100.000',
      sellerId: 'mu-id',
      buyerId: mockUserId,
      createdAt: new Date(2026, 5, 24, 1, 45, 0).toISOString() // 1:45 AM (before 2:00 AM reset)
    }
  ];
  
  // Initialize ledger
  globalThis.checkPnlDayReset();
  
  // Process the transactions (First time)
  globalThis.processTransactionsList(mockTxs, mockUserId);
  
  // Process the transactions again (Second time - should be completely deduped!)
  globalThis.processTransactionsList(mockTxs, mockUserId);
  
  // Assertions
  const costBasisResult = globalThis.GM_getValue('wia.pnl.costBasis');
  assert.ok(costBasisResult, 'Cost basis should be populated');
  // For food_bread, old purchase unit paid was 10 (50 / 5), new was 12 (120 / 10).
  // With weighted average: (5 * 10 + 10 * 12) / 15 = 11.333
  assert.ok(Math.abs(costBasisResult.food_bread.unitPaid - 11.3333) < 0.001, 'Cost basis for food_bread should be weighted average ~11.333');
  
  const ledgerResult = globalThis.GM_getValue('wia.pnl.ledger');
  assert.ok(ledgerResult, 'Ledger should be updated');
  
  // Income verification
  assert.strictEqual(ledgerResult.income.Sales, 200.000, 'Sales income should be 200.000');
  assert.strictEqual(ledgerResult.income.Wages, 17.400, 'Wages income should be 17.400 (15.5 + 1.9, no duplicate added)');
  // Expense verification
  assert.strictEqual(ledgerResult.expense['Employee Wages'], 8.000, 'Employee Wages expense should be 8.000');
  assert.strictEqual(ledgerResult.expense.Other, 5.000, 'Donation should be mapped to Other expense (5.000)');
  assert.strictEqual(ledgerResult.expense.Cases, 15.000, 'Cases expense should be 15.000');
  // Purchases (trading buy) should NOT be expensed (should be capitalized)
  assert.strictEqual(ledgerResult.expense.Sales || 0, 0, 'Sales expense should be 0 (capitalized)');
  
  // Ledger total: (200 + 17.4) - (8 + 5 + 15) = 217.4 - 28 = 189.4
  assert.strictEqual(ledgerResult.total, 189.400, 'Accrual total should be 189.400');
  
  // Clean up mockTodayResetTime
  globalThis.todayResetTime = oldTodayResetTime;
  
  console.log('Daily P&L Tracker Phase 2 tests passed successfully.');

  console.log('--- Testing Daily P&L Tracker: Phase 3 ---');
  
  // Clean mock storage and initialize
  globalThis.clearCache();
  globalThis.CONFIG.featPnlTracker = true;
  global.location.pathname = '/user/my-user-id/inventory';
  
  // Set cost basis: food_bread = 12. pill_haste = 100 (estimated via priceCache)
  globalThis.writeCache('wia.pnl.costBasis', {
    food_bread: { unitPaid: 12, qtyKnown: 10 }
  });
  globalThis.writeCache('wia.priceCache', {
    data: { pill_haste: 100 },
    fetchedAt: Date.now()
  });
  
  // 1. Parse quantity test
  const cardA = new MockElement('div');
  const qtySpan = new MockElement('span');
  qtySpan.textContent = 'x5';
  cardA.appendChild(qtySpan);
  assert.strictEqual(globalThis.parseCardQuantity(cardA), 5, 'Should parse "x5" quantity as 5');
  
  const cardB = new MockElement('div');
  const qtyDiv = new MockElement('div');
  qtyDiv.textContent = ' 20 ';
  cardB.appendChild(qtyDiv);
  assert.strictEqual(globalThis.parseCardQuantity(cardB), 20, 'Should parse plain "20" text node quantity as 20');
  
  // 2. Click consumption test
  globalThis.bookClickConsumption('food_bread', 2); // 2 * 12 = 24 expense
  let clickLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(clickLedger.expense.Consumption, 24, 'Click consumption of 2 bread should cost 24');
  assert.strictEqual(clickLedger.bookedConsumptionEvents.length, 1, 'Should record click consumption event');
  assert.strictEqual(clickLedger.bookedConsumptionEvents[0].code, 'food_bread');
  assert.strictEqual(clickLedger.bookedConsumptionEvents[0].qty, 2);
  
  // 2.b Sofortkauf (on-the-fly purchase) cost correction test
  // Simulate click consumption of an item we don't know the price of (e.g. food_steak)
  globalThis.bookClickConsumption('food_steak', 1); // price is unknown, books 0 expense
  let steakLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(steakLedger.bookedConsumptionEvents.find(e => e.code === 'food_steak').costBooked, 0, 'Should book 0 cost for untracked item');
  
  // Now process a purchase transaction for 1 food_steak at 15.000 gold
  const mockSteakTx = [{
    id: 'tx-steak-buy',
    transactionType: 'trading',
    money: '15.000',
    quantity: 1,
    sellerId: 'other-user-id',
    buyerId: 'my-user-id',
    itemCode: 'food_steak',
    createdAt: new Date(2026, 5, 24, 8, 0, 0).toISOString()
  }];
  const oldTodayResetTimeP3 = globalThis.todayResetTime;
  globalThis.todayResetTime = () => new Date(2026, 5, 24, 2, 0, 0).getTime();
  globalThis.processTransactionsList(mockSteakTx, 'my-user-id');
  globalThis.todayResetTime = oldTodayResetTimeP3;

  let postSteakLedger = globalThis.readCache('wia.pnl.ledger');
  // Click consumption cost should be corrected: 24 (bread) + 15 (steak) = 39
  assert.strictEqual(postSteakLedger.expense.Consumption, 39, 'Steak consumption cost should be retrospectively corrected to 15');
  // Click event for food_steak should be cleared
  assert.strictEqual(postSteakLedger.bookedConsumptionEvents.some(e => e.code === 'food_steak'), false, 'Steak click event should be cleared after matching');

  // Clean up steak test changes so we don't pollute the rest of Phase 3 tests
  postSteakLedger.expense.Consumption = 24;
  globalThis.writeCache('wia.pnl.ledger', postSteakLedger);

  // 3. Fallback inventory-delta detection test (and matching click consumption / sales)
  // Let's prepare a snapshot with starting quantities
  const snapshotsMock = {
    gold_start: 1000,
    durability_start: {},
    invQty_start: {
      food_bread: 10,
      pill_haste: 5,
      steel: 10
    }
  };
  globalThis.writeCache('wia.pnl.snapshots', snapshotsMock);
  
  // Let's mock findItemCards
  const oldFindItemCards = globalThis.findItemCards;
  
  const breadCardPnl = new MockElement('div');
  const breadImgPnl = new MockElement('img');
  breadImgPnl.setAttribute('alt', 'food_bread');
  breadCardPnl.appendChild(breadImgPnl);
  const breadQtyPnl = new MockElement('span');
  breadQtyPnl.textContent = 'x7';
  breadCardPnl.appendChild(breadQtyPnl);
  
  const pillCardPnl = new MockElement('div');
  const pillImgPnl = new MockElement('img');
  pillImgPnl.setAttribute('alt', 'pill_haste');
  pillCardPnl.appendChild(pillImgPnl);
  const pillQtyPnl = new MockElement('span');
  pillQtyPnl.textContent = 'x4';
  pillCardPnl.appendChild(pillQtyPnl);
  
  const steelCardPnl = new MockElement('div');
  const steelImgPnl = new MockElement('img');
  steelImgPnl.setAttribute('alt', 'steel');
  steelCardPnl.appendChild(steelImgPnl);
  const steelQtyPnl = new MockElement('span');
  steelQtyPnl.textContent = 'x8';
  steelCardPnl.appendChild(steelQtyPnl);
  
  globalThis.findItemCards = () => {
    const map = new Map();
    map.set(breadCardPnl, breadImgPnl);
    map.set(pillCardPnl, pillImgPnl);
    map.set(steelCardPnl, steelImgPnl);
    return map;
  };
  
  // Also we had sales today! Process a sale transaction of 2 steel today
  const currentLedger = globalThis.readCache('wia.pnl.ledger');
  currentLedger.todaySales = { steel: 2 };
  globalThis.writeCache('wia.pnl.ledger', currentLedger);
  
  // Run inventory delta check
  globalThis.checkInventoryDeltaConsumption();
  
  // Let's check the booked expense:
  // - food_bread drop is 3. We had 2 click events for food_bread. So remaining delta is 1. Cost is 1 * 12 = 12.
  // - pill_haste drop is 1. We had 0 click events. Cost is 1 * 100 (fallback cached price) = 100.
  // - steel drop is 2. We had 2 sales for steel today. So remaining delta is 0. Cost is 0.
  // Total Consumption today should be: 24 (from click) + 12 (from delta food_bread) + 100 (from delta pill_haste) = 136.
  const finalLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(finalLedger.expense.Consumption, 136, 'Consumption should be 136 (24 click + 12 bread delta + 100 pill delta)');

  // --- Safeguard Tests ---
  console.log('Testing delta consumption safeguards...');

  // Mock document.querySelectorAll to simulate active search input filter
  const originalQuerySelectorAll = global.document.querySelectorAll;
  const mockSearchInput = new MockElement('input');
  mockSearchInput.value = 'steak';

  global.document.querySelectorAll = (sel) => {
    if (sel.includes('input')) {
      return [mockSearchInput];
    }
    return originalQuerySelectorAll.call(global.document, sel);
  };

  // With active search input, delta check should be skipped (Consumption remains 136)
  globalThis.checkInventoryDeltaConsumption();
  const postSearchLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(postSearchLedger.expense.Consumption, 136, 'Consumption should remain 136 when search filter is active');

  // Restore querySelectorAll
  global.document.querySelectorAll = originalQuerySelectorAll;

  // Mock findItemCards to return empty map (DOM empty / loading state)
  globalThis.findItemCards = () => new Map();

  // Run delta check - should skip since currentQts is empty and snapshots has items
  globalThis.checkInventoryDeltaConsumption();
  const postEmptyLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(postEmptyLedger.expense.Consumption, 136, 'Consumption should remain 136 when DOM is completely empty during load');

  // Mock a single item (lightammo) with high quantity dropping to 0
  const snapshotsWithAmmo = {
    gold_start: 1000,
    durability_start: {},
    invQty_start: {
      lightammo: 1000
    }
  };
  globalThis.writeCache('wia.pnl.snapshots', snapshotsWithAmmo);

  // Run delta check with empty DOM (lightammo drops to 0)
  // Since startQty (1000) > 50, it is flagged as suspicious and skipped
  globalThis.checkInventoryDeltaConsumption();
  const postAmmoDropLedger = globalThis.readCache('wia.pnl.ledger');
  assert.strictEqual(postAmmoDropLedger.expense.Consumption, 136, 'Consumption should remain 136 when high quantity ammo drops to 0 (suspicious drop)');
  
  // 4. Test printPnlReceipt execution
  const logLines = [];
  const originalLog = console.log;
  console.log = (...args) => { logLines.push(args.join(' ')); };
  globalThis.printPnlReceipt();
  console.log = originalLog;
  
  assert.ok(logLines.some(l => l.includes('🧾 WAREERA P&L BELEG')), 'Receipt header should be present in console output');
  assert.ok(logLines.some(l => l.includes('Verbrauch:')), 'Consumption section should be present in receipt');
  assert.ok(logLines.some(l => l.includes('bread')), 'bread should be present in receipt details (with food_ prefix stripped)');
  
  // Restores
  globalThis.findItemCards = oldFindItemCards;
  console.log('Daily P&L Tracker Phase 3 tests passed successfully.');
  // We wrap Phase 4 tests in an async IIFE to allow the use of await in this CommonJS environment
  (async () => {
    try {
      console.log('--- Testing Daily P&L Tracker: Phase 4 ---');
      
      // Clean mock storage and initialize
      globalThis.clearCache();
      globalThis.CONFIG.featPnlTracker = true;
      globalThis.CONFIG.minRequestIntervalMs = 0;
      globalThis.CONFIG.debug = true;
      // Set obfuscated token so internal getToken() decodes it correctly
      const testXor = (str, pad) => {
        let out = '';
        for (let i = 0; i < str.length; i++) {
          out += String.fromCharCode(str.charCodeAt(i) ^ pad.charCodeAt(i % pad.length));
        }
        return out;
      };
      const encodedToken = btoa(testXor('my-dummy-token', 'wareEra.advisor.v1'));
      globalThis.writeCache('wia.token', encodedToken);
      
      // Set cost basis: chest3 (armor) = 500, helmet3 = 200 (estimated via priceCache)
      globalThis.writeCache('wia.pnl.costBasis', {
        chest3: { unitPaid: 500, qtyKnown: 1 }
      });
      globalThis.writeCache('wia.priceCache', {
        data: { helmet3: 200 },
        fetchedAt: Date.now()
      });
      
      // 1. Mock findItemCards to return equipment cards
      let currentMockEquipPayload = [
        { slot: 'chest', itemCode: 'chest3', durability: 100 },
        { slot: 'helmet', itemCode: 'helmet3', durability: 98 }
      ];
      global.location.pathname = '/user/my-user-id/inventory';
      const oldFindItemCards = globalThis.findItemCards;
      globalThis.findItemCards = () => {
        const mockCardsMap = new Map();
        currentMockEquipPayload.forEach(item => {
          const card = new MockElement('div');
          card.setAttribute('aria-haspopup', 'dialog');
          
          const img = new MockElement('img');
          img.setAttribute('alt', item.itemCode);
          card.appendChild(img);
          img.parentElement = card;

          const textSpan = new MockElement('span');
          textSpan.textContent = ` ${item.durability}% `;
          card.appendChild(textSpan);
          textSpan.parentElement = card;
          
          mockCardsMap.set(card, img);
        });
        return mockCardsMap;
      };
      
      // Initialize ledger and snapshots
      globalThis.checkPnlDayReset();
      // First visit seeds baseline
      globalThis.checkInventoryDeltaWear();
      
      const snapsAfterInit = globalThis.readCache('wia.pnl.snapshots');
      assert.ok(snapsAfterInit.equipDur_start, 'Durability starting snapshots should be captured');
      assert.strictEqual(snapsAfterInit.equipDur_start.chest3[0], 100, 'Chest start durability should be 100');
      assert.strictEqual(snapsAfterInit.equipDur_start.helmet3[0], 98, 'Helmet start durability should be 98');
      
      // Now simulate durability drop:
      // - chest: 100 -> 98 (2% drop) -> Cost is 2% * 500 = 10
      // - helmet: 98 -> 93 (5% drop) -> Cost is 5% * 200 (fallback) = 10
      // Total Repairs expense should be: 10 + 10 = 20
      currentMockEquipPayload = [
        { slot: 'chest', itemCode: 'chest3', durability: 98 },
        { slot: 'helmet', itemCode: 'helmet3', durability: 93 }
      ];
      
      globalThis.checkInventoryDeltaWear();
      
      const pnlLedgerResult = globalThis.readCache('wia.pnl.ledger');
      assert.strictEqual(pnlLedgerResult.expense.Repairs, 20, 'Repairs expense should be 20 (10 chest wear + 10 helmet wear)');
      
      // Now simulate durability increase (repair) -> should update snapshots baseline but NOT add/subtract wear cost!
      // - chest: 98 -> 100
      // - helmet: 93 -> 98
      currentMockEquipPayload = [
        { slot: 'chest', itemCode: 'chest3', durability: 100 },
        { slot: 'helmet', itemCode: 'helmet3', durability: 98 }
      ];
      
      globalThis.checkInventoryDeltaWear();
      
      const postRepairLedger = globalThis.readCache('wia.pnl.ledger');
      assert.strictEqual(postRepairLedger.expense.Repairs, 20, 'Repairs expense should remain 20 after repair (repaired jump is neutral)');
      
      // Check snapshot baseline was updated to 100 and 98
      const snapsPostRepair = globalThis.readCache('wia.pnl.snapshots');
      assert.strictEqual(snapsPostRepair.equipDur_start.chest3[0], 100, 'Snapshot chest baseline should update to 100');
      assert.strictEqual(snapsPostRepair.equipDur_start.helmet3[0], 98, 'Snapshot helmet baseline should update to 98');
      
      // Restore findItemCards mock
      globalThis.findItemCards = oldFindItemCards;
      
      console.log('Daily P&L Tracker Phase 4 tests passed successfully.');

      console.log('--- Testing Daily P&L Tracker: Phase 5 ---');
      
      // Clean mock storage and initialize
      globalThis.clearCache();
      globalThis.CONFIG.featPnlTracker = true;
      globalThis.CONFIG.locale = 'en'; // Force English locale for text assertions
      
      // Setup testMenu with goldContainer
      const testMenuP5 = new MockElement('div');
      testMenuP5.setAttribute('id', 'layoutUserMenu');
      const goldContainerP5 = new MockElement('div');
      goldContainerP5.setAttribute('id', 'money');
      const goldIconP5 = new MockElement('img');
      goldIconP5.setAttribute('src', '/images/items/gold.png');
      goldIconP5.setAttribute('alt', 'gold');
      goldContainerP5.appendChild(goldIconP5);
      
      // Starting gold is 100.000
      const goldTextNode = global.document.createTextNode(' 100.000 ');
      goldContainerP5.appendChild(goldTextNode);
      testMenuP5.appendChild(goldContainerP5);
      
      // Mock getElementById and querySelector for UI update
      global.document.getElementById = (id) => id === 'layoutUserMenu' ? testMenuP5 : null;
      global.document.querySelector = (sel) => {
        if (sel === '#layoutUserMenu') return testMenuP5;
        return testMenuP5.querySelector(sel);
      };
      
      // 1. Initialize today's reset snapshot with start gold = 100
      globalThis.checkPnlDayReset();
      
      // 2. Set today's ledger values
      let ledgerP5 = globalThis.readCache('wia.pnl.ledger');
      ledgerP5.income = { Sales: 10.5, Wages: 0.12, Other: 0 };
      ledgerP5.expense = { Consumption: 12.0, Repairs: 2.1, 'Employee Wages': 1.5, Other: 0 };
      ledgerP5.hasEstimatedRepairs = true;
      globalThis.writeCache('wia.pnl.ledger', ledgerP5);
      
      // 3. Set yesterday's ledger values
      const yesterdayLedger = {
        dayKey: '2026-06-22',
        startedAt: Date.now() - 86400000,
        income: { Sales: 5.2, Wages: 0.24, Other: 0 },
        expense: { Consumption: 24.0, Repairs: 0, 'Employee Wages': 1.5, Other: 0.5 },
        total: -21.0,
        goldDelta: -21.44,
        untracked: -0.44,
        hasEstimatedConsumption: false,
        hasEstimatedRepairs: false
      };
      globalThis.writeCache('wia.pnl.yesterday', yesterdayLedger);
      
      // 4. Change current gold balance to 95.000 (creates a live gold delta of -5.000 today)
      goldTextNode.textContent = ' 95.000 ';
      
      // 5. Trigger UI update
      globalThis.updatePnlUi();
      
      // 6. Assert UI elements
      const badgeP5 = testMenuP5.querySelector('#wia-pnl-tracker');
      assert.ok(badgeP5, 'P&L tracker badge should exist');
      
      // Verify badge text
      const badgeContent = badgeP5.textContent;
      assert.ok(badgeContent.includes('today: ▼ -4.98'), 'Badge text should display today\'s accrual P&L total');
      assert.ok(badgeContent.includes('yesterday: ▼ -21.00'), 'Badge text should display yesterday\'s accrual P&L total');
      
      // Verify tooltip table breakdown content
      const hoverElP5 = badgeP5.querySelector('.wia-pnl-hover');
      assert.ok(hoverElP5, 'Tooltip hover element should exist');
      const tooltipHtml = hoverElP5.innerHTML;
      
      // Check today's column values:
      // Sales: +10.50
      assert.ok(tooltipHtml.includes('+10.50'), 'Tooltip should show +10.50 Sales');
      // Wages: +0.12
      assert.ok(tooltipHtml.includes('+0.12'), 'Tooltip should show +0.12 Wages');
      // Consumption: -12.00
      assert.ok(tooltipHtml.includes('-12.00'), 'Tooltip should show -12.00 Consumption');
      // Repairs: ≈-2.10 (estimated)
      assert.ok(tooltipHtml.includes('≈-2.10'), 'Tooltip should show ≈-2.10 Repairs');
      // Employee Wages: -1.50
      assert.ok(tooltipHtml.includes('-1.50'), 'Tooltip should show -1.50 Employee Wages');
      // Untracked (today): goldDelta(-5) - total(-4.98) - accrualNonCash(14.1) + capitalized(0) = -14.12
      assert.ok(tooltipHtml.includes('-14.12'), 'Tooltip should show -14.12 Untracked residual');
      // Total P&L (today): -4.98
      assert.ok(tooltipHtml.includes('-4.98'), 'Tooltip should show -4.98 Total P&L');

      // Check yesterday's column values:
      // Sales: +5.20
      assert.ok(tooltipHtml.includes('+5.20'), 'Tooltip should show +5.20 Sales yesterday');
      // Wages: +0.24
      assert.ok(tooltipHtml.includes('+0.24'), 'Tooltip should show +0.24 Wages yesterday');
      // Consumption: -24.00
      assert.ok(tooltipHtml.includes('-24.00'), 'Tooltip should show -24.00 Consumption yesterday');
      // Untracked (yesterday, stored): -0.44
      assert.ok(tooltipHtml.includes('-0.44'), 'Tooltip should show -0.44 Untracked yesterday');
      // Total P&L: -21.00
      assert.ok(tooltipHtml.includes('-21.00'), 'Tooltip should show -21.00 Total P&L yesterday');
      // Gold Delta: -21.44
      assert.ok(tooltipHtml.includes('-21.44'), 'Tooltip should show -21.44 Gold Delta yesterday');
      
      // --- Testing Inventory Tab Visibility and Skip Delta Checks ---
      console.log('--- Testing Inventory Tab Visibility and Skip Delta Checks ---');
      
      const oldQuerySelectorAll = global.document.querySelectorAll;
      
      // Test cases for active tabs
      const tabTests = [
        { tabText: 'Waffen', expectedTab: 'weapons', consVisible: false, equipVisible: true },
        { tabText: 'Weapons', expectedTab: 'weapons', consVisible: false, equipVisible: true },
        { tabText: 'Ausrüstung', expectedTab: 'equipment', consVisible: false, equipVisible: true },
        { tabText: 'Verbrauchbares', expectedTab: 'consumables', consVisible: true, equipVisible: false },
        { tabText: 'Consumables', expectedTab: 'consumables', consVisible: true, equipVisible: false },
        { tabText: 'Alle', expectedTab: 'all', consVisible: true, equipVisible: true },
        { tabText: 'All', expectedTab: 'all', consVisible: true, equipVisible: true },
        { tabText: 'Sonstiges', expectedTab: 'other', consVisible: false, equipVisible: false },
        { tabText: 'Other', expectedTab: 'other', consVisible: false, equipVisible: false }
      ];

      for (const tCase of tabTests) {
        const mockTabButton = new MockElement('button');
        mockTabButton.textContent = tCase.tabText;
        mockTabButton.setAttribute('data-state', 'active'); // Mark as active

        const mockOtherButton = new MockElement('button');
        mockOtherButton.textContent = tCase.tabText === 'Waffen' ? 'Verbrauchbares' : 'Waffen';
        mockOtherButton.setAttribute('data-state', 'inactive'); // Inactive

        global.document.querySelectorAll = (sel) => {
          if (sel === 'button, a, [role="tab"]') {
            return [mockTabButton, mockOtherButton];
          }
          return [];
        };

        const activeTabInfo = globalThis.getActiveInventoryTab();
        assert.strictEqual(activeTabInfo.tab, tCase.expectedTab, `Should detect tab ${tCase.expectedTab} for text ${tCase.tabText}`);
        assert.strictEqual(globalThis.isConsumablesVisible(), tCase.consVisible, `isConsumablesVisible should be ${tCase.consVisible} on ${tCase.expectedTab} tab`);
        assert.strictEqual(globalThis.isEquipmentVisible(), tCase.equipVisible, `isEquipmentVisible should be ${tCase.equipVisible} on ${tCase.expectedTab} tab`);
      }

      // Test fallback when no tabs are found
      global.document.querySelectorAll = () => [];
      assert.strictEqual(globalThis.isConsumablesVisible(), true, 'Fallback should allow consumables tracking');
      assert.strictEqual(globalThis.isEquipmentVisible(), true, 'Fallback should allow equipment tracking');

      global.document.querySelectorAll = oldQuerySelectorAll;
      console.log('Inventory Tab Visibility and Skip Delta Checks tests passed successfully.');

      console.log('Daily P&L Tracker Phase 5 tests passed successfully.');
 
      // Restore document mock functions
      global.document.querySelector = oldBodyQuerySelector;
      global.document.getElementById = oldBodyGetElementById;
      
      console.log('Daily P&L Tracker Phase 1 tests passed successfully.');

      // --- Testing Skin & Equipment Recognition ---
      console.log('--- Testing Skin & Equipment Recognition ---');

      // Test 1: skinNameFromSrc
      assert.strictEqual(globalThis.skinNameFromSrc('/images/skins/ctKnife.png?v=10'), 'ctKnife');
      assert.strictEqual(globalThis.skinNameFromSrc('/images/skins/gsg9Sniper.png'), 'gsg9Sniper');
      assert.strictEqual(globalThis.skinNameFromSrc('/images/items/knife.png'), null);

      // Test 2: slotForSkin
      assert.strictEqual(globalThis.slotForSkin('ctKnife'), 'knife'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('gsg9Sniper'), 'sniper'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('customNameKnife'), 'knife'); // from suffix auto-fallback
      assert.strictEqual(globalThis.slotForSkin('wc2026'), 'lightAmmo'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('ctHeavyAmmo'), 'heavyAmmo'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('ctAmmo'), 'ammo'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('ctLightAmmo'), 'lightAmmo'); // from skinToSlot
      assert.strictEqual(globalThis.slotForSkin('unknownSkinName'), null); // unknown

      // Test 3: detectItem for weapon skin
      const mockWeaponImg = new MockElement('img');
      mockWeaponImg.setAttribute('src', '/images/skins/ctKnife.png');
      mockWeaponImg.setAttribute('alt', 'ctKnife');
      const mockWeaponCard = new MockElement('div');
      const weaponInfo = globalThis.detectItem(mockWeaponImg, mockWeaponCard);
      assert.strictEqual(weaponInfo.type, 'weapon', 'Weapon skin should be weapon type');
      assert.strictEqual(weaponInfo.code, 'knife', 'Weapon skin code should be knife');
      assert.strictEqual(weaponInfo.tier, 1, 'Weapon skin tier should be 1');
      assert.strictEqual(weaponInfo.isSkin, true, 'Weapon skin isSkin should be true');

      // Test 4: detectItem for armor skin (with resolved tier from color)
      const mockArmorImg = new MockElement('img');
      mockArmorImg.setAttribute('src', '/images/skins/gsg9Chest.png');
      mockArmorImg.setAttribute('alt', 'gsg9Chest');
      const mockArmorCard = new MockElement('div');
      // mock the border color to represent Tier 3 (blue)
      mockArmorCard.style.borderColor = 'rgb(60, 130, 240)';
      
      const armorInfo = globalThis.detectItem(mockArmorImg, mockArmorCard);
      assert.strictEqual(armorInfo.type, 'chest', 'Armor skin type should be chest');
      assert.strictEqual(armorInfo.tier, 3, 'Armor skin tier should resolve to 3');
      assert.strictEqual(armorInfo.code, 'chest3', 'Armor skin code should be reconstructed to chest3');
      assert.strictEqual(armorInfo.isSkin, true, 'Armor skin isSkin should be true');

      // Test 5: isShopPage page scoping
      global.location.pathname = '/shop/skins';
      assert.strictEqual(globalThis.isShopPage(), true, 'Shop page pathname should be detected');
      
      global.location.pathname = '/user/my-user-id/inventory';
      assert.strictEqual(globalThis.isShopPage(), false, 'Inventory page should not be detected as shop page');

      // Test 6: detectItem for consumable skin (wc2026 mapped to lightAmmo)
      const mockConsumableImg = new MockElement('img');
      mockConsumableImg.setAttribute('src', '/images/skins/wc2026.png');
      mockConsumableImg.setAttribute('alt', 'wc2026');
      const mockConsumableCard = new MockElement('div');
      const consumableInfo = globalThis.detectItem(mockConsumableImg, mockConsumableCard);
      assert.strictEqual(consumableInfo.type, 'lightAmmo', 'Consumable skin type should be lightAmmo');
      assert.strictEqual(consumableInfo.code, 'lightAmmo', 'Consumable skin code should be lightAmmo');
      assert.strictEqual(consumableInfo.tier, null, 'Consumable skin tier should be null');
      assert.strictEqual(consumableInfo.isSkin, true, 'Consumable skin isSkin should be true');

      // Test 6b: detectItem for consumable skin card with stat icon but no durability (should be unknown)
      const mockSkinCardImg = new MockElement('img');
      mockSkinCardImg.setAttribute('src', '/images/skins/wc2026.png');
      mockSkinCardImg.setAttribute('alt', 'wc2026');
      const mockSkinCard = new MockElement('div');
      const statIcon = new MockElement('div', 'a6izou0');
      mockSkinCard.appendChild(statIcon);
      const skinCardInfo = globalThis.detectItem(mockSkinCardImg, mockSkinCard);
      assert.strictEqual(skinCardInfo.type, 'unknown', 'Skin card type should be unknown');
      assert.strictEqual(skinCardInfo.code, null, 'Skin card code should be null');

      const makeArmorStatCard = (statVal) => {
        const c = new MockElement('div');
        c.setAttribute('aria-haspopup', 'dialog');
        const inner = new MockElement('div');
        c.appendChild(inner);
        const iconC = new MockElement('div', '_1dnmndy29y');
        const icon = new MockElement('div', 'a6izou0');
        const p = new MockElement('path');
        p.setAttribute('d', 'M12,1L3,5V11C3,16.55'); // armor stat fingerprint
        icon.appendChild(p);
        iconC.appendChild(icon);
        const valSpan = new MockElement('span');
        valSpan.textContent = String(statVal);
        iconC.appendChild(valSpan);
        inner.appendChild(iconC);

        // Add a durability bar so it's not recognized as a skin card
        const scaleXEl = new MockElement('div');
        scaleXEl.setAttribute('style', 'scaleX(1.0)');
        const barParent = new MockElement('div');
        barParent.appendChild(scaleXEl);
        inner.appendChild(barParent);

        return c;
      };

      // Test 7: skinned armor with NO tier digit and NO tier-tinted border resolves
      // tier from its stat range (the reported bug: skinned pants showed "pants · —"
      // and all-"?" prices because tier/code stayed null). Rüstung 21 -> pants T4.
      const skinnedPantsImg = new MockElement('img');
      skinnedPantsImg.setAttribute('src', '/images/skins/ctPants.png');
      skinnedPantsImg.setAttribute('alt', 'ctPants');
      const skinnedPantsCard = makeArmorStatCard(21);
      const skinnedPants = globalThis.detectItem(skinnedPantsImg, skinnedPantsCard);
      assert.strictEqual(skinnedPants.type, 'pants', 'Skinned pants type should be pants');
      assert.strictEqual(skinnedPants.tier, 4, 'Skinned pants (stat 21) should resolve to T4 via stat range');
      assert.strictEqual(skinnedPants.code, 'pants4', 'Skinned pants code should be reconstructed to pants4');
      assert.strictEqual(skinnedPants.isSkin, true, 'Skinned pants isSkin should be true');

      // Test 8: stat range is the PRIMARY indicator even for a non-skin item whose
      // alt digit and stat agree (gloves stat 23 -> T4 band 21-25).
      const glovesImg = new MockElement('img');
      glovesImg.setAttribute('src', '/images/items/gloves4.png');
      glovesImg.setAttribute('alt', 'gloves4');
      const glovesCard = makeArmorStatCard(23);
      const gloves = globalThis.detectItem(glovesImg, glovesCard);
      assert.strictEqual(gloves.type, 'gloves', 'Gloves type should be gloves');
      assert.strictEqual(gloves.tier, 4, 'Gloves (stat 23) should resolve to T4 via stat range');
      assert.strictEqual(gloves.code, 'gloves4', 'Gloves code should be gloves4');

      // Test 9: when the stat lands in a between-tier gap (pants 16-20 is impossible),
      // tier falls back to the alt digit rather than going null.
      const gapPantsImg = new MockElement('img');
      gapPantsImg.setAttribute('src', '/images/items/pants4.png');
      gapPantsImg.setAttribute('alt', 'pants4');
      const gapPantsCard = makeArmorStatCard(18); // 18 is in the 16-20 hole
      const gapPants = globalThis.detectItem(gapPantsImg, gapPantsCard);
      assert.strictEqual(gapPants.tier, 4, 'Pants with gap stat should fall back to alt digit T4');
      assert.strictEqual(gapPants.code, 'pants4', 'Gap pants code should stay pants4');

      console.log('Skin & Equipment Recognition tests passed successfully.');

      // --- Testing Diamond Spam and Crit Thresholds (PLAN-fix-item-advisor-diamond-spam.md) ---
      console.log('--- Testing Diamond Spam and Crit Thresholds ---');

      // Setup a dummy context for evaluate
      const mockCtx = {
        prices: { scraps: 0.26, steel: 0.32 },
        scrapPrice: 0.26,
        offers: {},
        txs: {},
        stale: false
      };

      // Helper to generate a dummy card and item object
      const makeMockItem = (type, tier, statVal, extraStats = {}) => {
        const stats = type === 'weapon' 
          ? { attack: statVal, crit: extraStats.crit ?? 0, durability: 100 }
          : { primaryPercent: statVal, durability: 100 };
        return {
          card: new MockElement('div'),
          img: new MockElement('img'),
          type,
          alt: type + tier,
          code: type === 'weapon' ? `${type}-${tier}` : `${type}${tier}`,
          tier,
          stats,
          myStat: statVal
        };
      };

      // Test 1: T3 armor with stat 11 (worst T3) should NOT get KEEP (since legacy rule is removed)
      const t3WorstPants = makeMockItem('pants', 3, 11);
      // Let's rank it in a group with better items so it is not stockKeep
      const groupItems = [
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 14),
        makeMockItem('pants', 3, 13),
        t3WorstPants
      ];
      globalThis.calculateInventoryRankings(groupItems);
      // t3WorstPants should be at index 3 (rank 4, isStockKeep = false)
      assert.strictEqual(t3WorstPants.isStockKeep, false, 'Worst pants should not be stockKeep');

      const evaluationWorst = globalThis.evaluate(t3WorstPants, mockCtx);
      assert.notStrictEqual(evaluationWorst.action, 'KEEP', 'T3 worst pants (stat 11) should not get KEEP');

      // Test 2: Top 3 stock cap: out of 5 max-stat pants, only 3 get KEEP
      const maxStatPants = [
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15)
      ];
      globalThis.calculateInventoryRankings(maxStatPants);
      
      const actions = maxStatPants.map(item => globalThis.evaluate(item, mockCtx).action);
      const keepCount = actions.filter(a => a === 'KEEP').length;
      const holdCount = actions.filter(a => a === 'HOLD').length;
      
      assert.strictEqual(keepCount, 3, 'Exactly 3 max-stat pants should get KEEP');
      assert.strictEqual(holdCount, 2, 'The other 2 max-stat pants should get HOLD');

      // Test 3: T1/T2 weapon crit avoidScrap thresholds (T1 >= 5, T2 >= 10)
      // T1 weapon with crit 4 (previously avoided scrap, now should not)
      const t1WeaponCrit4 = makeMockItem('weapon', 1, 30, { crit: 4 });
      t1WeaponCrit4.isStockKeep = false;
      const t1Crit4Eval = globalThis.evaluate(t1WeaponCrit4, mockCtx);
      assert.ok(!t1Crit4Eval.reason.includes('Zustand') && !t1Crit4Eval.reason.includes('Condition'), 'T1 weapon with 4% crit should not trigger Critical Condition');

      // T1 weapon with crit 5 (should avoid scrap)
      const t1WeaponCrit5 = makeMockItem('weapon', 1, 30, { crit: 5 });
      t1WeaponCrit5.isStockKeep = false;
      const t1Crit5Eval = globalThis.evaluate(t1WeaponCrit5, mockCtx);
      assert.ok(t1Crit5Eval.reason.includes('Zustand') || t1Crit5Eval.reason.includes('Condition'), 'T1 weapon with 5% crit should trigger Critical Condition');

      // T2 weapon with crit 9 (should not trigger avoidScrap)
      const t2WeaponCrit9 = makeMockItem('weapon', 2, 55, { crit: 9 });
      t2WeaponCrit9.isStockKeep = false;
      const t2Crit9Eval = globalThis.evaluate(t2WeaponCrit9, mockCtx);
      assert.ok(!t2Crit9Eval.reason.includes('Zustand') && !t2Crit9Eval.reason.includes('Condition'), 'T2 weapon with 9% crit should not trigger Critical Condition');

      // T2 weapon with crit 10 (should trigger avoidScrap)
      const t2WeaponCrit10 = makeMockItem('weapon', 2, 55, { crit: 10 });
      t2WeaponCrit10.isStockKeep = false;
      const t2Crit10Eval = globalThis.evaluate(t2WeaponCrit10, mockCtx);
      assert.ok(t2Crit10Eval.reason.includes('Zustand') || t2Crit10Eval.reason.includes('Condition'), 'T2 weapon with 10% crit should trigger Critical Condition');

      // Test 4: Configurable stockKeepCount (e.g. set to 2)
      const origStockKeepCount = globalThis.CONFIG.stockKeepCount;
      globalThis.CONFIG.stockKeepCount = 2;
      const stockCountPants = [
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15),
        makeMockItem('pants', 3, 15)
      ];
      globalThis.calculateInventoryRankings(stockCountPants);
      const stockCountActions = stockCountPants.map(item => globalThis.evaluate(item, mockCtx).action);
      const keepCount2 = stockCountActions.filter(a => a === 'KEEP').length;
      assert.strictEqual(keepCount2, 2, 'With stockKeepCount=2, exactly 2 items should get KEEP');
      globalThis.CONFIG.stockKeepCount = origStockKeepCount; // restore

      // Test 5: T1-T3 bad rolls filter (< 50% excludes them from isStockKeep)
      // T3 pants range: 11 - 15.
      // Stat 11 (0% roll) should NOT be kept even if it's the only one
      const singleBadPant = [makeMockItem('pants', 3, 11)];
      globalThis.calculateInventoryRankings(singleBadPant);
      assert.strictEqual(singleBadPant[0].isStockKeep, false, 'T3 pant with stat 11 (0% roll) should not be stockKeep even if alone');

      // Stat 12 (25% roll) should NOT be kept even if it's the only one
      const singleBadPant2 = [makeMockItem('pants', 3, 12)];
      globalThis.calculateInventoryRankings(singleBadPant2);
      assert.strictEqual(singleBadPant2[0].isStockKeep, false, 'T3 pant with stat 12 (25% roll) should not be stockKeep even if alone');

      // Stat 13 (50% roll) should be kept
      const singleGoodPant = [makeMockItem('pants', 3, 13)];
      globalThis.calculateInventoryRankings(singleGoodPant);
      assert.strictEqual(singleGoodPant[0].isStockKeep, true, 'T3 pant with stat 13 (50% roll) should be stockKeep if alone');

      console.log('Diamond Spam and Crit Threshold tests passed successfully.');

      console.log('Success! The script loaded and initialized without throwing any runtime errors.');
      process.exit(0);
    } catch (err) {
      console.error('Error during script load/execution:');
      console.error(err.stack || err);
      process.exit(1);
    }
  })();
} catch (err) {
  console.error('Error during script load/execution:');
  console.error(err.stack || err);
  process.exit(1);
}
