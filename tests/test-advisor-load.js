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
    this.offsetWidth = 50;
    this.offsetHeight = 50;
  }

  get className() {
    return this._className;
  }

  set className(val) {
    this._className = val;
    this.classList.classes = new Set(val.split(' ').filter(Boolean));
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
  addEventListener: () => {},
  getComputedStyle: (el) => {
    return {
      color: el.style.color || 'rgb(59, 219, 139)'
    };
  },
  setTimeout: (fn, delay) => setTimeout(fn, delay)
};
const documentBody = new MockElement('body');
global.document = {
  createElement: (tag) => new MockElement(tag),
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
  assert.strictEqual(hintBtns.length, 4, 'Should have exactly 4 hint toggle buttons (Notes, Battle, Live Offers, Scrap Flip)');

  const liveOffersCheckbox = bg.querySelector('.wia-live-offers');
  const scrapFlipCheckbox = bg.querySelector('.wia-scrap-flip');
  assert.ok(liveOffersCheckbox, 'Live offers checkbox should be present');
  assert.ok(scrapFlipCheckbox, 'Scrap flip checkbox should be present');

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

  // Verify progressive disclosure of allied codes row
  const featBattleCheckbox = bg.querySelector('.wia-feat-battle');
  const alliedCodesRow = bg.querySelector('.wia-allied-codes-row');
  assert.ok(featBattleCheckbox, 'Battle advisor checkbox should be present');
  assert.ok(alliedCodesRow, 'Allied codes container row should be present');
  
  // Toggle the battle checkbox to unchecked and trigger change
  featBattleCheckbox.checked = false;
  if (featBattleCheckbox.onchange) featBattleCheckbox.onchange();
  assert.strictEqual(alliedCodesRow.style.display, 'none', 'Allied codes row should be hidden when battle advisor is unchecked');

  // Toggle it back to checked
  featBattleCheckbox.checked = true;
  if (featBattleCheckbox.onchange) featBattleCheckbox.onchange();
  assert.strictEqual(alliedCodesRow.style.display, 'block', 'Allied codes row should be visible when battle advisor is checked');

  console.log('Settings cheatsheet and hints UI tests passed successfully.');

  console.log('Success! The script loaded and initialized without throwing any runtime errors.');
  process.exit(0);
} catch (err) {
  console.error('Error during script load/execution:');
  console.error(err.stack || err);
  process.exit(1);
}
