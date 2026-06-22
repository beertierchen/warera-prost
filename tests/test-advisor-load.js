const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing PROST script load ---');

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

// Mock Tampermonkey / Browser environment
global.GM_addStyle = () => {};
const mockStorage = { 'wia.locale': 'en' };
global.GM_getValue = (key, def) => (key in mockStorage ? mockStorage[key] : def);
global.GM_setValue = (key, val) => { mockStorage[key] = val; };
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
global.getComputedStyle = global.window.getComputedStyle;
const documentBody = new MockElement('body');
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
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
  assert.strictEqual(hintBtns.length, 5, 'Should have exactly 5 hint toggle buttons (Notes, Battle, Live Offers, Scrap Flip, Pill Reminder)');

  const liveOffersCheckbox = bg.querySelector('.wia-live-offers');
  const scrapFlipCheckbox = bg.querySelector('.wia-scrap-flip');
  const featPillCheckbox = bg.querySelector('.wia-feat-pill');
  assert.ok(liveOffersCheckbox, 'Live offers checkbox should be present');
  assert.ok(scrapFlipCheckbox, 'Scrap flip checkbox should be present');
  assert.ok(featPillCheckbox, 'Pill reminder checkbox should be present');

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
  assert.strictEqual(alliedCodesRow.attributes.has('open'), false, 'Allied codes row should be closed when battle advisor is unchecked');

  // Toggle it back to checked
  featBattleCheckbox.checked = true;
  if (featBattleCheckbox.onchange) featBattleCheckbox.onchange();
  assert.strictEqual(alliedCodesRow.attributes.has('open'), true, 'Allied codes row should be open when battle advisor is checked');

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
  assert.ok(pillBadge.classList.contains('wia-badge-gated'), 'Pill badge should be in wia-badge-gated class when health is below 100%');
  
  const labelEl = pillBadge.querySelector('.wia-pill-phase-lbl');
  assert.strictEqual(labelEl.textContent, 'H&H full', 'Gated label should display H&H full');

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
  assert.strictEqual(cocainCard.classList.contains('wia-cocain-highlight'), true, 'Cocaine card should have READY highlight outline');
  assert.strictEqual(cocainCard.getAttribute('data-label'), 'now', 'Highlight badge label should be now');

  hpText.textContent = '100/130';
  globalThis.highlightCocaineItems();
  assert.strictEqual(cocainCard.classList.contains('wia-cocain-gated-highlight'), true, 'Cocaine card should have warning H&H highlight');
  assert.strictEqual(cocainCard.getAttribute('data-label'), 'H&H 77%', 'Highlight badge label should be H&H 77%');

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
  assert.strictEqual(buffTimer.textContent, 'Window from 15:05 (in 3h 5m)', 'Should show preferred window countdown');

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

  modalDiv.remove();
  console.log('Crafting Advisor tests passed successfully.');

  console.log('Success! The script loaded and initialized without throwing any runtime errors.');
  process.exit(0);
} catch (err) {
  console.error('Error during script load/execution:');
  console.error(err.stack || err);
  process.exit(1);
}
