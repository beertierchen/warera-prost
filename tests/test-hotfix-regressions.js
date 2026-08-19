const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('--- Testing hotfix regressions (game update breakage) ---');

const scriptPath = path.join(__dirname, '../warera-prost.user.js');
let code = fs.readFileSync(scriptPath, 'utf8');

global.GM_addStyle = () => {};
const mockStorage = {
  'wia.locale': 'en',
  'wia.gatedProcedures': JSON.stringify([])
};
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
    this.value = '';
    this.checked = false;
  }

  focus() {}
  blur() {}

  get childNodes() { return this.children; }

  get className() { return this._className; }
  set className(val) {
    this._className = val;
    this.classList.classes = new Set(val.split(' ').filter(Boolean));
  }

  get innerHTML() {
    return this.children.map(c => {
      const tag = c.tagName.toLowerCase();
      const attrs = [];
      if (c.className) attrs.push(`class="${c.className}"`);
      for (const [k, v] of c.attributes.entries()) {
        if (k !== 'class') attrs.push(`${k}="${v}"`);
      }
      const attrsStr = attrs.length ? ' ' + attrs.join(' ') : '';
      if (['input', 'img', 'br', 'hr'].includes(tag)) return `<${tag}${attrsStr} />`;
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
        if (attrsStr.toLowerCase().includes('checked')) child.checked = true;
        const valAttr = child.getAttribute('value');
        if (valAttr) child.value = valAttr;
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

  addEventListener() {}

  dispatchEvent(event, data = {}) {
    const e = { target: data.target || this, preventDefault: () => {}, stopPropagation: () => {}, ...data };
    if (event === 'click' && typeof this.onclick === 'function') this.onclick(e);
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
      if (refChild) {
        const idx = this.children.indexOf(refChild);
        if (idx !== -1) {
          this.children.splice(idx, 0, newChild);
          return newChild;
        }
      }
      this.children.unshift(newChild);
    }
    return newChild;
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) this.parentElement.children.splice(idx, 1);
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
    if (name.startsWith('data-')) {
      const propName = name.slice(5).replace(/-([a-z])/g, (g) => g[1].toUpperCase());
      this.dataset[propName] = value;
    }
  }

  removeAttribute(name) { this.attributes.delete(name); }

  toggleAttribute(name, force) {
    const has = this.attributes.has(name);
    const shouldHave = force !== undefined ? !!force : !has;
    if (shouldHave) { this.setAttribute(name, 'true'); return true; }
    else { this.removeAttribute(name); return false; }
  }

  cloneNode(deep = true) {
    const clone = new MockElement(this.tagName.toLowerCase(), this.className);
    clone.textContent = this.textContent;
    for (const [k, v] of this.attributes.entries()) clone.setAttribute(k, v);
    if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
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
    if (selector.includes(',')) return selector.split(',').some(sel => this.matchesSelector(sel.trim()));
    let tag = null;
    let rest = selector;
    const tagMatch = selector.match(/^([a-z0-9]+)(.*)/i);
    if (tagMatch) { tag = tagMatch[1].toUpperCase(); rest = tagMatch[2]; }
    if (tag && this.tagName !== tag) return false;
    if (!rest) return true;
    if (rest.startsWith('#')) return this.getAttribute('id') === rest.slice(1);
    if (rest.startsWith('.')) return this.classList.contains(rest.slice(1));
    if (rest.startsWith('[')) {
      const matchContain = rest.match(/\[([^=*]+)\*=['"]([^'"]+)['"]\]/);
      if (matchContain) return this.getAttribute(matchContain[1]).includes(matchContain[2]);
      const matchEq = rest.match(/\[([^=]+)=['"]([^'"]+)['"]\]/);
      if (matchEq) return this.getAttribute(matchEq[1]) === matchEq[2];
      const attrMatch = rest.match(/\[([^\]]+)\]/);
      if (attrMatch) return this.attributes.has(attrMatch[1]);
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
      if (el !== this && el.matchesSelector(selector)) results.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return results;
  }

  get textContent() {
    if (this.children.length === 0) return this._textContent !== undefined && this._textContent !== null ? String(this._textContent) : '';
    return this.children.map(c => String(c.textContent)).join(' ');
  }
  set textContent(val) { this._textContent = val !== undefined && val !== null ? String(val) : ''; }

  get nextSibling() {
    if (!this.parentElement) return null;
    const idx = this.parentElement.children.indexOf(this);
    return idx !== -1 && idx < this.parentElement.children.length - 1 ? this.parentElement.children[idx + 1] : null;
  }
}

const documentBody = new MockElement('body');
global.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  getComputedStyle: (el) => ({ color: el.style.color || 'rgb(59, 219, 139)', ...el.style }),
  setTimeout: (fn, delay) => setTimeout(fn, delay)
};
global.getComputedStyle = global.window.getComputedStyle;
global.document = {
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => new MockElement(tag),
  createTextNode: (text) => { const el = new MockElement('span'); el.nodeType = 3; el.textContent = text; return el; },
  body: documentBody,
  querySelectorAll: (selector) => documentBody.querySelectorAll(selector),
  querySelector: (selector) => {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const results = [];
      const walk = (el) => { if (el.getAttribute('id') === id) results.push(el); el.children.forEach(walk); };
      walk(documentBody);
      return results.length ? results[0] : null;
    }
    return documentBody.querySelector(selector);
  },
  getElementById: (id) => {
    const results = [];
    const walk = (el) => { if (el.getAttribute('id') === id) results.push(el); el.children.forEach(walk); };
    walk(documentBody);
    return results.length ? results[0] : null;
  }
};
global.history = { pushState: () => {}, replaceState: () => {} };
global.location = { pathname: '/user/some-id/inventory' };
global.navigator = { userAgent: 'node' };
global.MutationObserver = class { observe() {} disconnect() {} };

try {
  eval(code);

  (async () => {
  try {
  // ============================================================
  // Test 1: featBetterRegion checkbox exists in settings modal
  // ============================================================
  console.log('Test 1: featBetterRegion settings checkbox present...');

  const bg = new MockElement('div');
  globalThis.renderSettingsModal(bg);

  const brCheckbox = bg.querySelector('.wia-feat-better-region');
  assert.ok(brCheckbox, 'Settings modal must contain .wia-feat-better-region checkbox');

  console.log('Test 1 passed: featBetterRegion checkbox exists.');

  // ============================================================
  // Test 2: featBetterRegion persisted in save handler (source)
  // ============================================================
  console.log('Test 2: featBetterRegion save handler source assertions...');

  const saveBlock = code.slice(
    code.indexOf('.wia-save').valueOf()
  );

  const gmSetLine = /GM_setValue\s*\(\s*KEYS\.featBetterRegion\s*,\s*featBetterRegion\s*\)/;
  assert.ok(gmSetLine.test(code), 'Save handler must call GM_setValue(KEYS.featBetterRegion, featBetterRegion)');

  const configAssign = /CONFIG\.featBetterRegion\s*=\s*featBetterRegion/;
  assert.ok(configAssign.test(code), 'Save handler must assign CONFIG.featBetterRegion');

  const teardownCondition = /!featAlertCompanyStorage\s*&&\s*!featAlertCompanyBonus\s*&&\s*!featAlertCompanyTax\s*&&\s*!featAlertCompanyDeposit\s*&&\s*!featBetterRegion/;
  assert.ok(teardownCondition.test(code), 'Teardown condition must include !featBetterRegion');

  console.log('Test 2 passed: featBetterRegion save + teardown wired correctly.');

  // ============================================================
  // Test 3: betterRegionCheck caches failure with checkedAt
  // ============================================================
  console.log('Test 3: betterRegionCheck error caching...');

  globalThis.CONFIG.featBetterRegion = true;

  globalThis.writeCache('wia.ecoBetterRegionAlerts', {});

  await globalThis.ensureBetterRegionCheck('comp123', 10);

  const alertsAfterFail = globalThis.readCache('wia.ecoBetterRegionAlerts');
  assert.ok(alertsAfterFail.comp123, 'Alert entry must exist after failed check');
  assert.ok(alertsAfterFail.comp123.checkedAt, 'checkedAt must be set on failure');
  assert.ok(Date.now() - alertsAfterFail.comp123.checkedAt < 5000, 'checkedAt must be recent');

  globalThis.CONFIG.featBetterRegion = false;

  // Source assertion: catch block must write checkedAt
  const catchBlockMatch = code.match(/catch\s*\(e\)\s*\{[\s\S]{0,100}betterRegionCheck failed[\s\S]{0,300}\.checkedAt\s*=\s*Date\.now\(\)/);
  assert.ok(catchBlockMatch, 'ensureBetterRegionCheck catch block must write checkedAt = Date.now()');

  console.log('Test 3 passed: betterRegionCheck failure caching prevents retry storm.');

  // ============================================================
  // Test 4: getRecommendedRegionIdsByItemCode uses POST
  // ============================================================
  console.log('Test 4: getRecommendedRegionIdsByItemCode POST assertion...');

  const cleanedCode = code.replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, '$1');

  const getCallRegex = /resolveApiBase\s*\(\s*['"]company\.getRecommendedRegionIdsByItemCode['"]/g;
  const getMatches = cleanedCode.match(getCallRegex);
  assert.strictEqual(getMatches, null, 'getRecommendedRegionIdsByItemCode must NOT use resolveApiBase (GET)');

  const postCallRegex = /resolveApiPost\s*\(\s*['"]company\.getRecommendedRegionIdsByItemCode['"]/g;
  const postMatches = cleanedCode.match(postCallRegex);
  assert.ok(postMatches && postMatches.length >= 2, 'getRecommendedRegionIdsByItemCode must use resolveApiPost (POST) in at least 2 call sites');

  console.log('Test 4 passed: getRecommendedRegionIdsByItemCode uses resolveApiPost.');

  // ============================================================
  // Test 5: Troop radar anchor finds header image structurally
  // ============================================================
  console.log('Test 5: findTroopRadarHeaderAnchor structural detection...');

  // Real MU DOM: #main-window > outerDiv > bannerDiv > contentDiv > innerDiv > img
  // The anchor should be outerDiv (grandparent of outerDiv = mainWin)
  const mainWin = new MockElement('div');
  mainWin.setAttribute('id', 'main-window');
  documentBody.appendChild(mainWin);

  const outerDiv = new MockElement('div');
  mainWin.appendChild(outerDiv);

  const bannerDiv = new MockElement('div');
  outerDiv.appendChild(bannerDiv);

  const headerImg = new MockElement('img');
  headerImg.setAttribute('src', '/images/mu/header/test.webp');
  bannerDiv.appendChild(headerImg);

  const anchor = globalThis.findTroopRadarHeaderAnchor();
  assert.ok(anchor, 'Anchor must be found when header image exists');
  assert.strictEqual(anchor, bannerDiv, 'Anchor must be the element whose grandparent is #main-window');

  mainWin.remove();
  console.log('Test 5 passed: findTroopRadarHeaderAnchor uses header image.');

  // ============================================================
  // Test 6: Anchor NOT found without header image
  // ============================================================
  console.log('Test 6: findTroopRadarHeaderAnchor returns null without header...');

  const mainWin2 = new MockElement('div');
  mainWin2.setAttribute('id', 'main-window');
  documentBody.appendChild(mainWin2);

  const emptyDiv = new MockElement('div');
  mainWin2.appendChild(emptyDiv);

  const noAnchor = globalThis.findTroopRadarHeaderAnchor();
  assert.strictEqual(noAnchor, null, 'Anchor must be null when no header image exists');

  mainWin2.remove();
  console.log('Test 6 passed: no false anchor without header image.');

  // ============================================================
  // Test 7: Anchor works with /headerv variant
  // ============================================================
  console.log('Test 7: findTroopRadarHeaderAnchor /headerv variant...');

  const mainWin3 = new MockElement('div');
  mainWin3.setAttribute('id', 'main-window');
  documentBody.appendChild(mainWin3);

  const outer3 = new MockElement('div');
  mainWin3.appendChild(outer3);

  const banner3 = new MockElement('div');
  outer3.appendChild(banner3);

  const img3 = new MockElement('img');
  img3.setAttribute('src', '/images/mu/headerv2/banner.webp');
  banner3.appendChild(img3);

  const anchor3 = globalThis.findTroopRadarHeaderAnchor();
  assert.ok(anchor3, 'Anchor must be found for /headerv variant');
  assert.strictEqual(anchor3, banner3, 'Anchor must be element whose grandparent is #main-window');

  mainWin3.remove();
  console.log('Test 7 passed: /headerv variant detected.');

  // ============================================================
  // Test 8: Pill badge uses emoji, not broken image
  // ============================================================
  console.log('Test 8: Pill badge uses emoji instead of image...');

  const pillSrc = code.match(/wia-pill-badge[\s\S]{0,500}/);
  assert.ok(pillSrc, 'Pill badge HTML must exist in source');

  assert.ok(!code.includes('cocain.png'), 'Source must not reference cocain.png (broken path)');

  const emojiMatch = code.match(/💊/);
  assert.ok(emojiMatch, 'Source must use 💊 emoji for pill icon');

  console.log('Test 8 passed: pill badge uses emoji.');

  // ============================================================
  // Test 9: Troop radar insertion uses nextSibling
  // ============================================================
  console.log('Test 9: Troop radar insertBefore uses anchor.nextSibling...');

  const insertPattern = /anchor\.parentNode\.insertBefore\(el,\s*anchor\.nextSibling\)/;
  assert.ok(insertPattern.test(code), 'Troop radar must insert after anchor (nextSibling), not before');

  const badPattern = /anchor\.parentNode\.insertBefore\(el,\s*anchor\s*\)/;
  assert.ok(!badPattern.test(code), 'Troop radar must NOT insert before anchor directly');

  console.log('Test 9 passed: troop radar inserts after banner.');

  console.log('All hotfix regression tests passed successfully!');
  process.exit(0);
  } catch (err) {
    console.error('Hotfix regression test failed:');
    console.error(err.stack || err);
    process.exit(1);
  }
  })();
} catch (err) {
  console.error('Script load failed:');
  console.error(err.stack || err);
  process.exit(1);
}
